import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  LandOccupancy,
  LandParcel,
  LandZone,
  LandZoneUse,
} from "@/db/schema";
import {
  archiveDimensionMember,
  listDimensionMembers,
  upsertDimensionMember,
} from "@/modules/accounting/core";
import { defaultProductive, isTenure, isValidZoneUse } from "./vocabulary";
import { zoneRest, daysOccupied, type ZoneRest } from "./core/rest";

/**
 * Land operations. Every function takes a `Tx` so the caller owns the
 * transaction — which, as in `assets`, is the whole point rather than a style
 * preference:
 *
 * **A write and its dimension sync happen in ONE transaction.**
 *
 * `dimension_members` is the seam core opened for exactly this. If the two
 * could land separately, a paddock would exist that the P&L cannot group by,
 * or a cost object would point at a row that was rolled back.
 *
 * TWO DIMENSION TYPES, NOT ONE, and the split does real work. Rent, property
 * tax and interest attach to a PARCEL — they are consequences of the deed, and
 * no paddock signed it. Fence repair, mowing, seed and grazing cost attach to a
 * ZONE. Collapsing them into one type would put deed-level rows in the column
 * headings of a report about paddocks, and would make "is this parcel earning
 * its keep" and "which paddock is expensive" the same unanswerable question.
 */

/** The dimension types this pack owns. Core stores them; only this pack means anything by them. */
export const PARCEL_DIMENSION = "parcel";
export const ZONE_DIMENSION = "zone";

export class LandError extends Error {
  constructor(
    readonly code:
      | "FORBIDDEN"
      | "NOT_FOUND"
      | "INVALID_USE"
      | "INVALID_TENURE"
      | "PARCEL_INVALID"
      | "DATE_ORDER"
      | "ALREADY_OCCUPIED"
      | "INVALID_OCCUPANT",
    message: string,
  ) {
    super(message);
    this.name = "LandError";
  }
}

export interface LandCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/**
 * Land is owner territory to write, member-wide to read.
 *
 * Same division as `assets`, and forced from below in the same way:
 * `upsertDimensionMember` calls `requireOwnerRole`, so a staff-created paddock
 * could not sync its cost object and would be invisible to every report — a
 * worse outcome than a refusal. Reading where the ground is remains ordinary
 * work for anybody who has to go and stand on it.
 */
function requireOwner(ctx: LandCtx): void {
  if (ctx.role !== "owner") {
    throw new LandError("FORBIDDEN", "owner role required");
  }
}

// ---------------------------------------------------------------- parcels ---

export async function listParcels(
  tx: Tx,
  tenantId: string,
  filter: { status?: string } = {},
): Promise<LandParcel[]> {
  const where = [eq(schema.landParcels.tenantId, tenantId)];
  if (filter.status) where.push(eq(schema.landParcels.status, filter.status));
  return tx.query.landParcels.findMany({
    where: and(...where),
    orderBy: (p, { asc: byAsc }) => [byAsc(p.name)],
  });
}

export async function getParcel(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<LandParcel | null> {
  const row = await tx.query.landParcels.findFirst({
    where: and(
      eq(schema.landParcels.tenantId, tenantId),
      eq(schema.landParcels.id, id),
    ),
  });
  return row ?? null;
}

export interface ParcelInput {
  name: string;
  tenure?: string;
  areaAcres?: number | null;
  identifier?: string;
  notes?: string;
  /** A comparison line for the rest report. Nothing schedules against it. */
  restTargetDays?: number | null;
}

export async function createParcel(
  tx: Tx,
  ctx: LandCtx,
  input: ParcelInput,
): Promise<LandParcel> {
  requireOwner(ctx);
  const tenure = input.tenure ?? "owned";
  if (!isTenure(tenure)) {
    throw new LandError("INVALID_TENURE", `invalid tenure: ${input.tenure}`);
  }

  const rows = await tx
    .insert(schema.landParcels)
    .values({
      tenantId: ctx.tenantId,
      name: input.name.trim(),
      tenure,
      areaAcres: input.areaAcres ?? null,
      identifier: input.identifier?.trim() ?? "",
      restTargetDays: input.restTargetDays ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  const parcel = rows[0];

  // Same transaction, always. See the file header.
  await upsertDimensionMember(tx, ctx, {
    dimensionType: PARCEL_DIMENSION,
    packEntityId: parcel.id,
    displayName: parcel.name,
  });

  return parcel;
}

export async function updateParcel(
  tx: Tx,
  ctx: LandCtx,
  id: string,
  input: Partial<ParcelInput>,
): Promise<LandParcel> {
  requireOwner(ctx);
  const existing = await getParcel(tx, ctx.tenantId, id);
  if (!existing) throw new LandError("NOT_FOUND", `parcel ${id} not found`);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.tenure !== undefined) {
    if (!isTenure(input.tenure)) {
      throw new LandError("INVALID_TENURE", `invalid tenure: ${input.tenure}`);
    }
    patch.tenure = input.tenure;
  }
  if (input.areaAcres !== undefined) patch.areaAcres = input.areaAcres;
  if (input.identifier !== undefined) patch.identifier = input.identifier.trim();
  if (input.restTargetDays !== undefined) {
    patch.restTargetDays = input.restTargetDays;
  }
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.landParcels)
    .set(patch)
    .where(
      and(
        eq(schema.landParcels.tenantId, ctx.tenantId),
        eq(schema.landParcels.id, id),
      ),
    )
    .returning();
  const parcel = rows[0];

  // The member's display name is a COPY, so a rename that skipped this would
  // leave every report labelling the parcel by its old name.
  if (input.name !== undefined) {
    await upsertDimensionMember(tx, ctx, {
      dimensionType: PARCEL_DIMENSION,
      packEntityId: parcel.id,
      displayName: parcel.name,
    });
  }
  return parcel;
}

/**
 * Retire a parcel. NOT a delete, and it takes its zones with it.
 *
 * Ground that is sold, or a lease that ends, stops being managed — but every
 * cost and every journal line tagged with it stays exactly where it is. The
 * dimension members are ARCHIVED rather than removed, which stops them being
 * taggable while existing tags keep reporting: precisely what a disposal wants,
 * and the same behaviour `disposeAsset` relies on.
 *
 * The zones go too, because a paddock on ground you no longer hold is not an
 * active paddock. Leaving them behind would put them in every picker and every
 * rest report forever, which is a slower and more confusing wrong answer than
 * cascading.
 */
export async function retireParcel(
  tx: Tx,
  ctx: LandCtx,
  id: string,
): Promise<{ parcel: LandParcel; zonesRetired: number }> {
  requireOwner(ctx);
  const existing = await getParcel(tx, ctx.tenantId, id);
  if (!existing) throw new LandError("NOT_FOUND", `parcel ${id} not found`);

  const zones = await listZones(tx, ctx.tenantId, {
    parcelId: id,
    status: "active",
  });
  for (const zone of zones) {
    await retireZone(tx, ctx, zone.id);
  }

  const rows = await tx
    .update(schema.landParcels)
    .set({ status: "retired", updatedAt: new Date() })
    .where(
      and(
        eq(schema.landParcels.tenantId, ctx.tenantId),
        eq(schema.landParcels.id, id),
      ),
    )
    .returning();

  await archiveMember(tx, ctx, PARCEL_DIMENSION, id);
  return { parcel: rows[0], zonesRetired: zones.length };
}

// ------------------------------------------------------------------ zones ---

export async function listZones(
  tx: Tx,
  tenantId: string,
  filter: { parcelId?: string; status?: string } = {},
): Promise<LandZone[]> {
  const where = [eq(schema.landZones.tenantId, tenantId)];
  if (filter.parcelId) where.push(eq(schema.landZones.parcelId, filter.parcelId));
  if (filter.status) where.push(eq(schema.landZones.status, filter.status));
  return tx.query.landZones.findMany({
    where: and(...where),
    orderBy: (z, { asc: byAsc }) => [byAsc(z.name)],
  });
}

export async function getZone(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<LandZone | null> {
  const row = await tx.query.landZones.findFirst({
    where: and(
      eq(schema.landZones.tenantId, tenantId),
      eq(schema.landZones.id, id),
    ),
  });
  return row ?? null;
}

export interface ZoneInput {
  parcelId: string;
  name: string;
  areaAcres?: number | null;
  notes?: string;
}

export async function createZone(
  tx: Tx,
  ctx: LandCtx,
  input: ZoneInput,
): Promise<LandZone> {
  requireOwner(ctx);
  const parcel = await getParcel(tx, ctx.tenantId, input.parcelId);
  if (!parcel) {
    throw new LandError("PARCEL_INVALID", "that parcel does not exist");
  }

  const rows = await tx
    .insert(schema.landZones)
    .values({
      tenantId: ctx.tenantId,
      parcelId: input.parcelId,
      name: input.name.trim(),
      areaAcres: input.areaAcres ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  const zone = rows[0];

  await upsertDimensionMember(tx, ctx, {
    dimensionType: ZONE_DIMENSION,
    packEntityId: zone.id,
    displayName: zone.name,
  });

  return zone;
}

export async function updateZone(
  tx: Tx,
  ctx: LandCtx,
  id: string,
  input: Partial<ZoneInput>,
): Promise<LandZone> {
  requireOwner(ctx);
  const existing = await getZone(tx, ctx.tenantId, id);
  if (!existing) throw new LandError("NOT_FOUND", `zone ${id} not found`);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.areaAcres !== undefined) patch.areaAcres = input.areaAcres;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.parcelId !== undefined && input.parcelId !== existing.parcelId) {
    // Moving a zone between parcels is real: ground gets re-surveyed, and a
    // lease can absorb a paddock that used to sit on owned ground.
    const parcel = await getParcel(tx, ctx.tenantId, input.parcelId);
    if (!parcel) {
      throw new LandError("PARCEL_INVALID", "that parcel does not exist");
    }
    patch.parcelId = input.parcelId;
  }

  const rows = await tx
    .update(schema.landZones)
    .set(patch)
    .where(
      and(
        eq(schema.landZones.tenantId, ctx.tenantId),
        eq(schema.landZones.id, id),
      ),
    )
    .returning();
  const zone = rows[0];

  if (input.name !== undefined) {
    await upsertDimensionMember(tx, ctx, {
      dimensionType: ZONE_DIMENSION,
      packEntityId: zone.id,
      displayName: zone.name,
    });
  }
  return zone;
}

/**
 * Retire a zone. Its use history stays; so does every cost tagged with it.
 *
 * The open use is CLOSED rather than left dangling — a paddock that is no
 * longer managed is not still "currently hay ground", and an open-ended use on
 * a retired zone would keep answering questions it has no business answering.
 */
export async function retireZone(
  tx: Tx,
  ctx: LandCtx,
  id: string,
  endedOn?: string,
): Promise<LandZone> {
  requireOwner(ctx);
  const existing = await getZone(tx, ctx.tenantId, id);
  if (!existing) throw new LandError("NOT_FOUND", `zone ${id} not found`);

  if (endedOn) {
    await tx
      .update(schema.landZoneUses)
      .set({ endedOn, updatedAt: new Date() })
      .where(
        and(
          eq(schema.landZoneUses.tenantId, ctx.tenantId),
          eq(schema.landZoneUses.zoneId, id),
          isNull(schema.landZoneUses.endedOn),
          // Never close a use before it started — a zone retired the day it was
          // created would otherwise violate the range CHECK and fail the whole
          // retirement over a date nobody cares about.
          sql`${schema.landZoneUses.startedOn} <= ${endedOn}::date`,
        ),
      );
  }

  const rows = await tx
    .update(schema.landZones)
    .set({ status: "retired", updatedAt: new Date() })
    .where(
      and(
        eq(schema.landZones.tenantId, ctx.tenantId),
        eq(schema.landZones.id, id),
      ),
    )
    .returning();

  await archiveMember(tx, ctx, ZONE_DIMENSION, id);
  return rows[0];
}

// ------------------------------------------------------------------- uses ---

/** Every use a zone has had, newest first. */
export async function listZoneUses(
  tx: Tx,
  tenantId: string,
  zoneId: string,
): Promise<LandZoneUse[]> {
  return tx.query.landZoneUses.findMany({
    where: and(
      eq(schema.landZoneUses.tenantId, tenantId),
      eq(schema.landZoneUses.zoneId, zoneId),
    ),
    orderBy: (u, { desc: byDesc }) => [byDesc(u.startedOn), byDesc(u.createdAt)],
  });
}

/**
 * The current use of each of these zones, keyed by zone id.
 *
 * One query for a whole parcel rather than one per zone: at 10× there are ~200
 * paddocks on a page and a per-row query is 200 round trips to render a table.
 */
export async function currentUses(
  tx: Tx,
  tenantId: string,
  zoneIds: string[],
): Promise<Map<string, LandZoneUse>> {
  if (zoneIds.length === 0) return new Map();
  // `inArray`, NOT sql`= any(${zoneIds})`. Interpolating a JS array into a raw
  // fragment binds the whole array as ONE parameter and Postgres rejects it
  // with `malformed array literal`. That shipped once in assets/ops.ts and
  // silently disabled a guard; it does not get to happen twice.
  const rows = await tx.query.landZoneUses.findMany({
    where: and(
      eq(schema.landZoneUses.tenantId, tenantId),
      inArray(schema.landZoneUses.zoneId, zoneIds),
      isNull(schema.landZoneUses.endedOn),
    ),
    orderBy: (u, { desc: byDesc }) => [byDesc(u.startedOn)],
  });
  const out = new Map<string, LandZoneUse>();
  for (const row of rows) {
    // At most one open use per zone is an invariant of `startZoneUse`, but a
    // direct write or a restored backup could break it. Keep the newest rather
    // than trusting the invariant to render a page.
    if (!out.has(row.zoneId)) out.set(row.zoneId, row);
  }
  return out;
}

/**
 * The full use history of several zones at once, newest first within each.
 *
 * One query for a whole parcel. It serves both reads the detail page needs —
 * the per-zone timeline in the dialog, and the chronological "what changed"
 * list across the parcel — so neither costs a second round trip, and at ~200
 * paddocks a per-row query would be 200 of them.
 */
export async function usesByZone(
  tx: Tx,
  tenantId: string,
  zoneIds: string[],
): Promise<Map<string, LandZoneUse[]>> {
  const out = new Map<string, LandZoneUse[]>();
  if (zoneIds.length === 0) return out;
  const rows = await tx.query.landZoneUses.findMany({
    where: and(
      eq(schema.landZoneUses.tenantId, tenantId),
      inArray(schema.landZoneUses.zoneId, zoneIds),
    ),
    orderBy: (u, { desc: byDesc }) => [byDesc(u.startedOn), byDesc(u.createdAt)],
  });
  for (const row of rows) {
    const list = out.get(row.zoneId);
    if (list) list.push(row);
    else out.set(row.zoneId, [row]);
  }
  return out;
}

export interface ZoneUseInput {
  use: string;
  startedOn: string;
  isProductive?: boolean;
  notes?: string;
}

/**
 * Declare what a zone is for, from a date.
 *
 * THE SUPERSEDING RULE, which is what makes "current use" an unambiguous
 * question: an open use is closed the day BEFORE this one starts. `ended_on` is
 * inclusive (see the table comment), so the two ranges abut with no gap and no
 * overlap.
 *
 * The one awkward case is a correction — an open use that started on or after
 * the new start date. Closing it would need an `ended_on` before its own
 * `started_on`, which the range CHECK rightly refuses, and it is not a period
 * of history anybody is losing: it is a row entered by mistake minutes ago,
 * describing a period that never elapsed. So it is DELETED rather than closed.
 */
export async function startZoneUse(
  tx: Tx,
  ctx: LandCtx,
  zoneId: string,
  input: ZoneUseInput,
): Promise<LandZoneUse> {
  requireOwner(ctx);
  const zone = await getZone(tx, ctx.tenantId, zoneId);
  if (!zone) throw new LandError("NOT_FOUND", `zone ${zoneId} not found`);

  const use = input.use.trim().toLowerCase();
  if (!isValidZoneUse(use)) {
    throw new LandError("INVALID_USE", `invalid zone use: ${input.use}`);
  }

  // A use that never applied: entered by mistake, superseded before its first
  // day elapsed. Removed, not closed — see the doc comment.
  await tx
    .delete(schema.landZoneUses)
    .where(
      and(
        eq(schema.landZoneUses.tenantId, ctx.tenantId),
        eq(schema.landZoneUses.zoneId, zoneId),
        isNull(schema.landZoneUses.endedOn),
        sql`${schema.landZoneUses.startedOn} >= ${input.startedOn}::date`,
      ),
    );

  // Day arithmetic in SQL rather than JS. `new Date("2026-03-01")` minus a day
  // is a timezone question in JS and is not one in Postgres, and the assets
  // pack already paid for the equivalent lesson on months.
  await tx
    .update(schema.landZoneUses)
    .set({
      endedOn: sql`(${input.startedOn}::date - 1)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.landZoneUses.tenantId, ctx.tenantId),
        eq(schema.landZoneUses.zoneId, zoneId),
        isNull(schema.landZoneUses.endedOn),
      ),
    );

  const rows = await tx
    .insert(schema.landZoneUses)
    .values({
      tenantId: ctx.tenantId,
      zoneId,
      use,
      isProductive: input.isProductive ?? defaultProductive(use),
      startedOn: input.startedOn,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/** Close a use without starting another — ground that has simply stopped being used for anything. */
export async function endZoneUse(
  tx: Tx,
  ctx: LandCtx,
  useId: string,
  endedOn: string,
): Promise<LandZoneUse> {
  requireOwner(ctx);
  const existing = await tx.query.landZoneUses.findFirst({
    where: and(
      eq(schema.landZoneUses.tenantId, ctx.tenantId),
      eq(schema.landZoneUses.id, useId),
    ),
  });
  if (!existing) throw new LandError("NOT_FOUND", `use ${useId} not found`);
  if (endedOn < existing.startedOn) {
    throw new LandError(
      "DATE_ORDER",
      "a use cannot end before the day it started",
    );
  }

  const rows = await tx
    .update(schema.landZoneUses)
    .set({ endedOn, updatedAt: new Date() })
    .where(
      and(
        eq(schema.landZoneUses.tenantId, ctx.tenantId),
        eq(schema.landZoneUses.id, useId),
      ),
    )
    .returning();
  return rows[0];
}

// -------------------------------------------------------------- occupancy ---

/**
 * THE SEAM `livestock` AND `crops` WRITE THROUGH.
 *
 * They own the fact; `land` owns the place and the rest clock, and a pack may
 * not read another pack's tables — so the record lands here and the occupant is
 * DESCRIBED rather than joined. `occupantLabel` is a copy, like
 * `dimension_members.display_name`, so a rest report never needs a pack that
 * may not be installed.
 *
 * Hand-entered records default to `extensionSlug: 'land'` and
 * `occupantType: 'manual'`, which is the day-one case and the reason this is
 * usable before either of those packs exists.
 */
export interface OccupancyInput {
  occupantLabel: string;
  startedOn: string;
  endedOn?: string | null;
  /** How much of the zone. Null (the default) means all of it. */
  areaAcres?: number | null;
  notes?: string;
  /** Defaults to the hand-entered shape. `livestock` passes its own. */
  extensionSlug?: string;
  occupantType?: string;
  occupantId?: string | null;
}

export async function listOccupancy(
  tx: Tx,
  tenantId: string,
  zoneId: string,
): Promise<LandOccupancy[]> {
  return tx.query.landOccupancy.findMany({
    where: and(
      eq(schema.landOccupancy.tenantId, tenantId),
      eq(schema.landOccupancy.zoneId, zoneId),
    ),
    orderBy: (o, { desc: byDesc }) => [byDesc(o.startedOn), byDesc(o.createdAt)],
  });
}

/** Every stay across a set of zones, keyed by zone. One query for a parcel. */
export async function occupancyByZone(
  tx: Tx,
  tenantId: string,
  zoneIds: string[],
): Promise<Map<string, LandOccupancy[]>> {
  const out = new Map<string, LandOccupancy[]>();
  if (zoneIds.length === 0) return out;
  const rows = await tx.query.landOccupancy.findMany({
    where: and(
      eq(schema.landOccupancy.tenantId, tenantId),
      inArray(schema.landOccupancy.zoneId, zoneIds),
    ),
    orderBy: (o, { desc: byDesc }) => [byDesc(o.startedOn), byDesc(o.createdAt)],
  });
  for (const row of rows) {
    const list = out.get(row.zoneId);
    if (list) list.push(row);
    else out.set(row.zoneId, [row]);
  }
  return out;
}

/**
 * Record something arriving on a zone.
 *
 * **Two occupants at once is refused**, and this is the one guard the rest
 * clock genuinely needs: `zoneRest` reads an open stay as "occupied", so two
 * of them would make "when did rest start" unanswerable rather than merely
 * wrong. Overlapping CLOSED stays are allowed — a paddock really can carry
 * cattle and poultry in the same week, and the eggmobile following the herd is
 * the pilot's own example.
 */
export async function startOccupancy(
  tx: Tx,
  ctx: LandCtx,
  zoneId: string,
  input: OccupancyInput,
): Promise<LandOccupancy> {
  requireOwner(ctx);
  const zone = await getZone(tx, ctx.tenantId, zoneId);
  if (!zone) throw new LandError("NOT_FOUND", `zone ${zoneId} not found`);

  const occupantType = (input.occupantType ?? "manual").trim().toLowerCase();
  if (!isValidZoneUse(occupantType)) {
    throw new LandError(
      "INVALID_OCCUPANT",
      `invalid occupant type: ${input.occupantType}`,
    );
  }
  if (input.endedOn && input.endedOn < input.startedOn) {
    throw new LandError(
      "DATE_ORDER",
      "a stay cannot end before the day it started",
    );
  }

  // Only an OPEN stay blocks another. A closed one is history.
  if (!input.endedOn) {
    const open = await tx.query.landOccupancy.findFirst({
      where: and(
        eq(schema.landOccupancy.tenantId, ctx.tenantId),
        eq(schema.landOccupancy.zoneId, zoneId),
        isNull(schema.landOccupancy.endedOn),
      ),
    });
    if (open) {
      throw new LandError(
        "ALREADY_OCCUPIED",
        `${open.occupantLabel} has not been moved off yet`,
      );
    }
  }

  const rows = await tx
    .insert(schema.landOccupancy)
    .values({
      tenantId: ctx.tenantId,
      zoneId,
      extensionSlug: input.extensionSlug?.trim() || "land",
      occupantType,
      occupantId: input.occupantId ?? null,
      occupantLabel: input.occupantLabel.trim(),
      startedOn: input.startedOn,
      endedOn: input.endedOn ?? null,
      areaAcres: input.areaAcres ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/**
 * Move something off. THIS is what starts the rest clock — the whole reason
 * closing a stay matters, and why the UI has to make it a single obvious act
 * rather than an edit buried in a form.
 */
export async function endOccupancy(
  tx: Tx,
  ctx: LandCtx,
  occupancyId: string,
  endedOn: string,
): Promise<LandOccupancy> {
  requireOwner(ctx);
  const existing = await tx.query.landOccupancy.findFirst({
    where: and(
      eq(schema.landOccupancy.tenantId, ctx.tenantId),
      eq(schema.landOccupancy.id, occupancyId),
    ),
  });
  if (!existing) {
    throw new LandError("NOT_FOUND", `occupancy ${occupancyId} not found`);
  }
  if (endedOn < existing.startedOn) {
    throw new LandError(
      "DATE_ORDER",
      "a stay cannot end before the day it started",
    );
  }

  const rows = await tx
    .update(schema.landOccupancy)
    .set({ endedOn, updatedAt: new Date() })
    .where(
      and(
        eq(schema.landOccupancy.tenantId, ctx.tenantId),
        eq(schema.landOccupancy.id, occupancyId),
      ),
    )
    .returning();
  return rows[0];
}

/** Remove a stay entered by mistake. Correcting a record is not rewriting history. */
export async function deleteOccupancy(
  tx: Tx,
  ctx: LandCtx,
  occupancyId: string,
): Promise<void> {
  requireOwner(ctx);
  const deleted = await tx
    .delete(schema.landOccupancy)
    .where(
      and(
        eq(schema.landOccupancy.tenantId, ctx.tenantId),
        eq(schema.landOccupancy.id, occupancyId),
      ),
    )
    .returning();
  if (deleted.length === 0) {
    throw new LandError("NOT_FOUND", `occupancy ${occupancyId} not found`);
  }
}

/**
 * Rest for each of these zones, as of the tenant's today.
 *
 * Computed, never stored — the same reasoning accumulated depreciation follows
 * in `assets`. A `rest_days` column would be wrong the moment the clock ticked,
 * and a backdated correction would leave it wrong forever.
 */
export async function restByZone(
  tx: Tx,
  tenantId: string,
  zoneIds: string[],
  today: string,
): Promise<Map<string, ZoneRest>> {
  const spans = await occupancyByZone(tx, tenantId, zoneIds);
  const out = new Map<string, ZoneRest>();
  for (const zoneId of zoneIds) {
    out.set(zoneId, zoneRest(spans.get(zoneId) ?? [], today));
  }
  return out;
}

/**
 * Completed stay lengths across a parcel, for the rotation finding.
 *
 * Open stays are excluded: a herd that moved on this morning has a length, and
 * one still standing there does not yet.
 */
export async function completedStayDays(
  tx: Tx,
  tenantId: string,
  parcelId: string,
): Promise<number[]> {
  const rows = await tx
    .select({
      startedOn: schema.landOccupancy.startedOn,
      endedOn: schema.landOccupancy.endedOn,
    })
    .from(schema.landOccupancy)
    .innerJoin(
      schema.landZones,
      and(
        eq(schema.landZones.tenantId, schema.landOccupancy.tenantId),
        eq(schema.landZones.id, schema.landOccupancy.zoneId),
      ),
    )
    .where(
      and(
        eq(schema.landOccupancy.tenantId, tenantId),
        eq(schema.landZones.parcelId, parcelId),
      ),
    );
  return rows
    .filter((r): r is { startedOn: string; endedOn: string } => !!r.endedOn)
    .map((r) => daysOccupied(r.startedOn, r.endedOn));
}

// ----------------------------------------------------------------- shared ---

/** Zone counts per parcel, for the list page. One grouped index scan. */
export async function zoneCountsByParcel(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      parcelId: schema.landZones.parcelId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.landZones)
    .where(
      and(
        eq(schema.landZones.tenantId, tenantId),
        eq(schema.landZones.status, "active"),
      ),
    )
    .groupBy(schema.landZones.parcelId);
  return new Map(rows.map((r) => [r.parcelId, r.count]));
}

/** Uses actually in use, for the picker. Ordered so the common ones come first. */
export async function listUsesInUse(
  tx: Tx,
  tenantId: string,
): Promise<{ use: string; count: number }[]> {
  return tx
    .select({
      use: schema.landZoneUses.use,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.landZoneUses)
    .where(eq(schema.landZoneUses.tenantId, tenantId))
    .groupBy(schema.landZoneUses.use)
    .orderBy(asc(schema.landZoneUses.use));
}

/** Archive the dimension member for an entity, if it has one. */
async function archiveMember(
  tx: Tx,
  ctx: LandCtx,
  dimensionType: string,
  packEntityId: string,
): Promise<void> {
  const members = await listDimensionMembers(tx, ctx.tenantId, dimensionType);
  const member = members.find((m) => m.packEntityId === packEntityId);
  if (member) {
    await archiveDimensionMember(tx, ctx, { memberId: member.id });
  }
}
