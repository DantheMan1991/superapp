import "server-only";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
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
import { zoneRest, dayBefore, daysOccupied, type ZoneRest } from "./core/rest";
import {
  asBoundary,
  boundaryAreaSqM,
  parseBoundary,
  pointInBoundary,
  type Boundary,
  type LinearRing,
  type Position,
} from "./core/geo";

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
      /** Distinct from ALREADY_OCCUPIED: moving them where they already are. */
      | "ALREADY_THERE"
      | "INVALID_OCCUPANT"
      | "INVALID_GEOMETRY"
      /** Fewer than two parcels, or one that cannot take part. */
      | "INVALID_COMBINE",
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
function requireWrite(ctx: LandCtx, level: WriteLevel): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new LandError("FORBIDDEN", "only an owner can change this");
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
  requireWrite(ctx, "owner");
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
  requireWrite(ctx, "owner");
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
  requireWrite(ctx, "owner");
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


/**
 * Combine several parcels into one operational block.
 *
 * **TWO DEEDS, ONE PIECE OF GROUND.** The founder imported five parcels from
 * the county and immediately wanted two of them to be one: same road, adjacent,
 * farmed as a unit. The model calls a parcel the LEGAL unit and it is right to
 * — but the thing that forces the issue is not tidiness, it is that a zone
 * belongs to exactly one parcel. A fence line that crosses a deed boundary is
 * a paddock this app could not draw.
 *
 * **It ABSORBS into a survivor rather than creating a new parcel.** The
 * survivor keeps its id, its `dimension_member`, its zones and every journal
 * line ever tagged to it. Creating a new parcel and retiring both originals
 * would be tidier to write and would strand the reporting history of both.
 *
 * **The absorbed parcels are RETIRED, never deleted** — the pack's standing
 * rule. Ground that carried cost and revenue for six years does not stop having
 * done so because two deeds are now farmed together, and every line tagged with
 * it still has to report.
 *
 * **The geometry becomes a MultiPolygon, and the shared edge is NOT dissolved.**
 * A true union needs a polygon-clipping library and would buy one cosmetic
 * thing: no seam where the two deeds meet. It would also be WRONG for the
 * ordinary case — this farm's parcels are spread across four roads, and
 * non-adjacent ground has no union to take. A MultiPolygon is exact either way:
 * `boundaryAreaSqM` sums the parts and `pointInBoundary` tests each of them.
 */
export async function combineParcels(
  tx: Tx,
  ctx: LandCtx,
  input: { survivorId: string; absorbedIds: string[]; name?: string },
): Promise<{ parcel: LandParcel; absorbed: number; zonesMoved: number }> {
  requireWrite(ctx, "owner");

  const absorbedIds = [...new Set(input.absorbedIds)].filter(
    (id) => id !== input.survivorId,
  );
  if (absorbedIds.length === 0) {
    throw new LandError("INVALID_COMBINE", "pick at least two parcels to combine");
  }

  const survivor = await getParcel(tx, ctx.tenantId, input.survivorId);
  if (!survivor) {
    throw new LandError("NOT_FOUND", `parcel ${input.survivorId} not found`);
  }

  const absorbed: LandParcel[] = [];
  for (const id of absorbedIds) {
    const parcel = await getParcel(tx, ctx.tenantId, id);
    if (!parcel) throw new LandError("NOT_FOUND", `parcel ${id} not found`);
    if (parcel.status !== "active") {
      // Absorbing retired ground would resurrect it sideways, without going
      // through the un-retire this pack does not have.
      throw new LandError(
        "INVALID_COMBINE",
        `${parcel.name} is retired and cannot be combined`,
      );
    }
    absorbed.push(parcel);
  }

  /**
   * Every polygon from every parcel, flattened into one MultiPolygon.
   *
   * A parcel with no boundary contributes nothing rather than blocking the
   * combine: most ground in this pack has no geometry for most of its life, and
   * refusing would make the feature unusable exactly where it is most wanted.
   */
  const polygons: LinearRing[][] = [];
  for (const parcel of [survivor, ...absorbed]) {
    const boundary = asBoundary(parcel.geometry);
    if (!boundary) continue;
    if (boundary.type === "Polygon") polygons.push(boundary.coordinates);
    else polygons.push(...boundary.coordinates);
  }
  const geometry: Boundary | null =
    polygons.length === 0
      ? null
      : polygons.length === 1
        ? { type: "Polygon", coordinates: polygons[0] }
        : { type: "MultiPolygon", coordinates: polygons };

  /**
   * Declared acreage adds up, and an unknown one poisons the total.
   *
   * `totalArea`'s rule, applied here: if any part has never been measured the
   * sum is not the area of the whole, and storing it as though it were would
   * put a confidently wrong divisor into every per-acre figure. Null is the
   * honest answer, and the measured boundary still reports on the page.
   */
  const areas = [survivor, ...absorbed].map((parcel) => parcel.areaAcres);
  const areaAcres: number | null = areas.some((area) => area === null)
    ? null
    : Math.round(
        areas.reduce<number>((sum, area) => sum + (area ?? 0), 0) * 10_000,
      ) / 10_000;

  /**
   * Both parcel numbers, kept.
   *
   * The county still knows these as separate deeds and always will — the tax
   * bill arrives twice. Losing the numbers would make the combined parcel
   * impossible to reconcile against the record it came from.
   */
  const identifiers = [survivor, ...absorbed]
    .map((parcel) => parcel.identifier.trim())
    .filter((identifier) => identifier !== "");
  const identifier = [...new Set(identifiers)].join(" + ");

  // The zones move FIRST: retiring a parcel retires its zones, and a paddock
  // that survived the combine as "retired" would be a silent loss of ground.
  let zonesMoved = 0;
  for (const parcel of absorbed) {
    const zones = await listZones(tx, ctx.tenantId, {
      parcelId: parcel.id,
      status: "active",
    });
    for (const zone of zones) {
      await tx
        .update(schema.landZones)
        .set({ parcelId: survivor.id, updatedAt: new Date() })
        .where(
          and(
            eq(schema.landZones.tenantId, ctx.tenantId),
            eq(schema.landZones.id, zone.id),
          ),
        );
      zonesMoved += 1;
    }
  }

  for (const parcel of absorbed) {
    await retireParcel(tx, ctx, parcel.id);
  }

  const rows = await tx
    .update(schema.landParcels)
    .set({
      name: input.name?.trim() || survivor.name,
      geometry,
      areaAcres,
      identifier,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.landParcels.tenantId, ctx.tenantId),
        eq(schema.landParcels.id, survivor.id),
      ),
    )
    .returning();

  // The cost object keeps its id and gains the new name, so every journal line
  // already tagged to this parcel follows it.
  await upsertDimensionMember(tx, ctx, {
    dimensionType: PARCEL_DIMENSION,
    packEntityId: rows[0].id,
    displayName: rows[0].name,
  });

  return { parcel: rows[0], absorbed: absorbed.length, zonesMoved };
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
  requireWrite(ctx, "owner");
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
  requireWrite(ctx, "owner");
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
  requireWrite(ctx, "owner");
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
  requireWrite(ctx, "owner");
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
  requireWrite(ctx, "owner");
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
  /**
   * The structure they are in, while on the zone — a pen, a barn, a chicken
   * tractor. Null means loose on the zone, which is what cattle do and is not
   * a missing value.
   */
  structureAssetId?: string | null;
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
  requireWrite(ctx, "member");
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

  // THE GUARD IS ABOUT THE OCCUPANT, NOT THE ZONE — corrected 2026-08-15.
  //
  // It first refused a second open stay on the same ZONE, reasoning that two of
  // them make "when did rest start" unanswerable. That reasoning was wrong on
  // both counts. `zoneRest` already takes the LATEST end date across every
  // span, so several stays are fine; and a paddock really does carry several
  // occupants at once — the pilot runs multiple chicken tractors on one
  // paddock, and the design's own eggmobile follows the cattle onto the ground
  // they are still grazing.
  //
  // What IS an error is the same lot being recorded onto ground twice without
  // being moved off the first, which is a data mistake rather than a farming
  // arrangement. Hand-entered records (no `occupantId`) are exempt: there is no
  // identity to compare, and a wrong one can simply be removed.
  if (!input.endedOn && input.occupantId) {
    const open = await tx.query.landOccupancy.findFirst({
      where: and(
        eq(schema.landOccupancy.tenantId, ctx.tenantId),
        eq(schema.landOccupancy.extensionSlug, input.extensionSlug?.trim() || "land"),
        eq(schema.landOccupancy.occupantId, input.occupantId),
        isNull(schema.landOccupancy.endedOn),
      ),
    });
    if (open) {
      throw new LandError(
        "ALREADY_OCCUPIED",
        `${open.occupantLabel} is already somewhere and has not been moved off`,
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
      structureAssetId: input.structureAssetId ?? null,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

/**
 * Structures something can be kept in: active assets.
 *
 * A pen, a barn, a chicken tractor, a greenhouse — all of them assets, which is
 * why this pack declares `assets` in `requires`.
 *
 * It DID offer every active asset, on the reasoning that `assets.kind` is an
 * open taxonomy and this pack has no business deciding which kinds can hold
 * something. Driving it on production settled that: the picker offered a chest
 * freezer and a tractor as homes for chickens. Deciding is unavoidable — the
 * choice is only whether the decision is a constant or config, and it is
 * config (`structureKindsFrom`).
 */
export async function listStructures(
  tx: Tx,
  tenantId: string,
  /**
   * Which asset kinds count as a place to put something — from
   * `structureKindsFrom(pack.config)`. REQUIRED, and required on purpose: this
   * shipped unfiltered and offered a chest freezer and a tractor as homes for
   * chickens, so a caller that has not thought about the filter should not
   * compile.
   */
  kinds: string[],
): Promise<{ id: string; name: string; kind: string }[]> {
  if (kinds.length === 0) return [];
  return tx
    .select({
      id: schema.assets.id,
      name: schema.assets.name,
      kind: schema.assets.kind,
    })
    .from(schema.assets)
    .where(
      and(
        eq(schema.assets.tenantId, tenantId),
        eq(schema.assets.status, "active"),
        // `inArray`, never an interpolated JS array in a raw fragment.
        inArray(schema.assets.kind, kinds),
      ),
    )
    .orderBy(asc(schema.assets.name));
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
  requireWrite(ctx, "member");
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

export interface MoveResult {
  occupancy: LandOccupancy;
  /** The stay this closed, if there was one. Null when they were nowhere. */
  movedOff: { zoneId: string; endedOn: string } | null;
}

/**
 * Move an occupant from wherever it is to a zone — off the old ground and onto
 * the new one, in one act.
 *
 * WHY THIS EXISTS. `startOccupancy` refuses to open a second stay for the same
 * occupant, correctly: a lot in two places at once is a data mistake. But that
 * made MOVING — the single most frequent act on a rotational farm — impossible
 * from the animal's own page. The daily loop was: go to Land, find the paddock
 * they are on, move off, come back, move on. Five clicks across two modules,
 * times however many groups. Found by driving it, 2026-08-16.
 *
 * **THE DATE RULE IS THE WHOLE OF THE DESIGN.** `ended_on` is inclusive, so a
 * move on the 16th means the old stay's last day was the 15th — `dayBefore`.
 * Closing it ON the 16th instead would count that day's grazing on both
 * paddocks and quietly inflate every rotation figure that reads them. This is
 * the one place in the pack where two spans meet, so it is the one place that
 * can get it wrong.
 *
 * IT LIVES IN LAND, not in the pack calling it. `livestock` should not be
 * arithmetic on `ended_on` any more than it should know what a paddock is.
 */
export async function moveOccupant(
  tx: Tx,
  ctx: LandCtx,
  zoneId: string,
  input: OccupancyInput,
): Promise<MoveResult> {
  requireWrite(ctx, "member");

  // Only an OPEN arrival displaces anything. Recording a completed stay that
  // happened last month must not move them off the paddock they are on today —
  // and this is exactly the condition under which `startOccupancy`'s guard
  // fires, so the two stay in step by construction.
  const open =
    !input.endedOn && input.occupantId
      ? await tx.query.landOccupancy.findFirst({
          where: and(
            eq(schema.landOccupancy.tenantId, ctx.tenantId),
            eq(
              schema.landOccupancy.extensionSlug,
              input.extensionSlug?.trim() || "land",
            ),
            eq(schema.landOccupancy.occupantId, input.occupantId),
            isNull(schema.landOccupancy.endedOn),
          ),
        })
      : null;

  let movedOff: MoveResult["movedOff"] = null;
  if (open) {
    if (open.zoneId === zoneId) {
      // Not a move. Changing the strip size or the pen they are in is an edit
      // of the stay they are on, and closing and reopening it would invent a
      // break in ground they never left.
      throw new LandError(
        "ALREADY_THERE",
        `${open.occupantLabel} is already on this one, since ${open.startedOn}`,
      );
    }
    if (input.startedOn < open.startedOn) {
      // They cannot arrive somewhere before they arrived where they are. This
      // is a mis-keyed year far more often than it is a real correction, and
      // silently reordering two stays would be worse than refusing.
      throw new LandError(
        "DATE_ORDER",
        `they have been on ${open.occupantLabel === input.occupantLabel ? "their current spot" : "another spot"} since ${open.startedOn}, so they cannot have moved on ${input.startedOn}`,
      );
    }
    // Clamped, not just `dayBefore`. Moving them on the day they arrived is a
    // same-day move or a correction; either way the old stay cannot end before
    // it began, and refusing would put the user back in the five-click hole
    // this function exists to close. A one-day stay is the honest record at
    // day granularity.
    const endedOn =
      open.startedOn > dayBefore(input.startedOn)
        ? open.startedOn
        : dayBefore(input.startedOn);
    await endOccupancy(tx, ctx, open.id, endedOn);
    movedOff = { zoneId: open.zoneId, endedOn };
  }

  return { occupancy: await startOccupancy(tx, ctx, zoneId, input), movedOff };
}

/** Remove a stay entered by mistake. Correcting a record is not rewriting history. */
export async function deleteOccupancy(
  tx: Tx,
  ctx: LandCtx,
  occupancyId: string,
): Promise<void> {
  requireWrite(ctx, "member");
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
 * Where each of these occupants currently is, keyed by `occupant_id`.
 *
 * THE READ THE OWNING PACK NEEDS, owned by the pack that owns the table.
 * `livestock` wants "which paddock is this herd on" and may not query
 * `land_occupancy` itself — so the query lives here and the caller passes its
 * own `extension_slug`. Land still learns nothing about what a lot is.
 *
 * Only OPEN stays count: a herd that has moved off is not anywhere.
 */
export interface OccupantPlace {
  zoneId: string;
  zoneName: string;
  startedOn: string;
  /** The pen or barn they are in. Null means loose on the zone. */
  structureAssetId: string | null;
  structureName: string | null;
}

export async function currentZoneForOccupants(
  tx: Tx,
  tenantId: string,
  extensionSlug: string,
  occupantIds: string[],
  /**
   * "Currently" needs a date, and this is the third read that turned out to
   * need one. `zoneRest` learned it first; this one kept reporting the stay
   * with no end date, so a herd booked onto a paddock for next Monday showed
   * as being there today — while Land's own page said that paddock was
   * resting. Two pages, the same rows, different answers.
   */
  today: string,
): Promise<Map<string, OccupantPlace>> {
  const out = new Map<string, OccupantPlace>();
  if (occupantIds.length === 0) return out;
  const rows = await tx
    .select({
      occupantId: schema.landOccupancy.occupantId,
      zoneId: schema.landOccupancy.zoneId,
      zoneName: schema.landZones.name,
      startedOn: schema.landOccupancy.startedOn,
      structureAssetId: schema.landOccupancy.structureAssetId,
      structureName: schema.assets.name,
    })
    .from(schema.landOccupancy)
    .innerJoin(
      schema.landZones,
      and(
        eq(schema.landZones.tenantId, schema.landOccupancy.tenantId),
        eq(schema.landZones.id, schema.landOccupancy.zoneId),
      ),
    )
    // LEFT join: being in no structure is the ordinary case for cattle, and an
    // inner join here would silently hide every loose herd on the farm.
    .leftJoin(
      schema.assets,
      and(
        eq(schema.assets.tenantId, schema.landOccupancy.tenantId),
        eq(schema.assets.id, schema.landOccupancy.structureAssetId),
      ),
    )
    .where(
      and(
        eq(schema.landOccupancy.tenantId, tenantId),
        eq(schema.landOccupancy.extensionSlug, extensionSlug),
        inArray(schema.landOccupancy.occupantId, occupantIds),
        // The stay that COVERS today. Not "the one with no end date": after a
        // move the old stay is closed on a date that may still be ahead, and
        // that closed stay is where the animals actually are.
        lte(schema.landOccupancy.startedOn, today),
        or(
          isNull(schema.landOccupancy.endedOn),
          gte(schema.landOccupancy.endedOn, today),
        ),
      ),
    )
    // Overlapping stays are legitimate — see the guard's note — so when two
    // cover today the most recent arrival wins. Ascending, and later rows
    // overwrite, which keeps this a single pass.
    .orderBy(asc(schema.landOccupancy.startedOn));
  for (const row of rows) {
    if (row.occupantId) {
      out.set(row.occupantId, {
        zoneId: row.zoneId,
        zoneName: row.zoneName,
        startedOn: row.startedOn,
        structureAssetId: row.structureAssetId,
        structureName: row.structureName,
      });
    }
  }
  return out;
}

/**
 * When each occupant was last HAULED — moved to a zone on a different parcel.
 *
 * **A WALK IS NOT A HAUL, AND THE DIFFERENCE IS THE PARCEL BOUNDARY.** This
 * pack's own design settles it: *a move between adjacent paddocks is a walk —
 * daily, free. A move between parcels is a haul — fuel, labour, trailer time.*
 * Nothing in this schema records which one happened, and nothing needs to: the
 * parcel of the zone they left and the parcel of the zone they arrived on
 * already say it.
 *
 * Written for `livestock`'s weights, and it is here because the record is
 * land's. **Shrink will lie to weight data** — cattle drop 3–5% on a trailer and
 * take days to put it back — so a weighing taken just after a haul must not read
 * as a loss. A flag that fired on every daily paddock move instead would be
 * ignored inside a week, which is why this cannot simply be "when did they last
 * move".
 *
 * Null for an occupant that has only ever been on one parcel, which is most of
 * them and is not a missing value.
 */
export async function lastHauledOn(
  tx: Tx,
  tenantId: string,
  extensionSlug: string,
  occupantIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (occupantIds.length === 0) return out;

  const rows = await tx
    .select({
      occupantId: schema.landOccupancy.occupantId,
      parcelId: schema.landZones.parcelId,
      startedOn: schema.landOccupancy.startedOn,
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
        eq(schema.landOccupancy.extensionSlug, extensionSlug),
        inArray(schema.landOccupancy.occupantId, occupantIds),
      ),
    )
    .orderBy(asc(schema.landOccupancy.startedOn), asc(schema.landOccupancy.createdAt));

  // Walk each occupant's stays in order and remember the last time the parcel
  // under them changed. The FIRST stay is an arrival rather than a haul —
  // nobody hauled them from nowhere.
  const previousParcel = new Map<string, string>();
  for (const row of rows) {
    if (!row.occupantId) continue;
    const before = previousParcel.get(row.occupantId);
    if (before !== undefined && before !== row.parcelId) {
      out.set(row.occupantId, row.startedOn);
    }
    previousParcel.set(row.occupantId, row.parcelId);
  }
  return out;
}

/**
 * What is currently in each of these structures — "what is in Pen 3".
 *
 * The read that happens standing in front of it, and it is here rather than in
 * `livestock` because the record is land's. The label is the occupant's own
 * copy, so this answers without joining into any pack.
 */
export async function occupantsInStructures(
  tx: Tx,
  tenantId: string,
  structureAssetIds: string[],
  /** Same rule as `currentZoneForOccupants`: "in it" means in it TODAY. */
  today: string,
): Promise<Map<string, { occupantLabel: string; zoneName: string }[]>> {
  const out = new Map<string, { occupantLabel: string; zoneName: string }[]>();
  if (structureAssetIds.length === 0) return out;
  const rows = await tx
    .select({
      structureAssetId: schema.landOccupancy.structureAssetId,
      occupantLabel: schema.landOccupancy.occupantLabel,
      zoneName: schema.landZones.name,
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
        inArray(schema.landOccupancy.structureAssetId, structureAssetIds),
        lte(schema.landOccupancy.startedOn, today),
        or(
          isNull(schema.landOccupancy.endedOn),
          gte(schema.landOccupancy.endedOn, today),
        ),
      ),
    );
  for (const row of rows) {
    if (!row.structureAssetId) continue;
    const entry = { occupantLabel: row.occupantLabel, zoneName: row.zoneName };
    const list = out.get(row.structureAssetId);
    if (list) list.push(entry);
    else out.set(row.structureAssetId, [entry]);
  }
  return out;
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
 * one still standing there does not yet. **A stay that has not finished YET is
 * excluded for the same reason** — a planned departure is not a measurement,
 * and feeding one into the rotation formula would report a graze length nobody
 * has done. Same rule `zoneRest` applies; see its comment.
 */
export async function completedStayDays(
  tx: Tx,
  tenantId: string,
  parcelId: string,
  today: string,
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
    .filter(
      (r): r is { startedOn: string; endedOn: string } =>
        !!r.endedOn && r.endedOn <= today,
    )
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

// ------------------------------------------------------------ boundaries ---

/**
 * Set (or clear) a parcel's boundary.
 *
 * **THE VALIDATION IS HERE, NOT IN THE ACTION**, because the input is a paste
 * box: whatever a person had on the clipboard, which might be a county GIS
 * export, a phone track, or the wrong file entirely. A rule that lived in the
 * action could be called past by the next caller; here it cannot.
 *
 * `null` clears it, and that is a real thing to want — a boundary traced wrong
 * is worse than none, because everything downstream treats it as measured.
 *
 * **Setting a boundary does NOT touch `area_acres`.** The declared figure comes
 * from a deed or a county record and is what the rent and the tax are based on;
 * the drawn one is what the fence encloses. Overwriting the first with the
 * second would destroy the more authoritative number with the more recent one,
 * and the whole value of having both is being able to see them disagree.
 */
export async function setParcelBoundary(
  tx: Tx,
  ctx: LandCtx,
  id: string,
  input: unknown,
): Promise<LandParcel> {
  requireWrite(ctx, "owner");
  const existing = await getParcel(tx, ctx.tenantId, id);
  if (!existing) throw new LandError("NOT_FOUND", `parcel ${id} not found`);

  const geometry = boundaryOrThrow(input);
  const rows = await tx
    .update(schema.landParcels)
    .set({ geometry, updatedAt: new Date() })
    .where(
      and(
        eq(schema.landParcels.tenantId, ctx.tenantId),
        eq(schema.landParcels.id, id),
      ),
    )
    .returning();
  return rows[0];
}

/** Set (or clear) a zone's boundary. Same rules as the parcel's. */
export async function setZoneBoundary(
  tx: Tx,
  ctx: LandCtx,
  id: string,
  input: unknown,
): Promise<LandZone> {
  requireWrite(ctx, "owner");
  const existing = await getZone(tx, ctx.tenantId, id);
  if (!existing) throw new LandError("NOT_FOUND", `zone ${id} not found`);

  const geometry = boundaryOrThrow(input);
  const rows = await tx
    .update(schema.landZones)
    .set({ geometry, updatedAt: new Date() })
    .where(
      and(
        eq(schema.landZones.tenantId, ctx.tenantId),
        eq(schema.landZones.id, id),
      ),
    )
    .returning();
  return rows[0];
}

/** Parse-or-refuse, with the parser's own message — it is written for a person. */
function boundaryOrThrow(input: unknown): Boundary | null {
  if (input === null || input === undefined) return null;
  const result = parseBoundary(input);
  if (!result.ok) throw new LandError("INVALID_GEOMETRY", result.error);
  return result.boundary;
}

/**
 * Which zone is this point in?
 *
 * **The 10x data-entry win, and the reason geometry outranked weather in the
 * slice order.** Standing in a paddock, a phone that knows where it is can fill
 * the zone in rather than making somebody pick it off a list of two hundred.
 * The screens that call this are slice 2a.2; it is here now because it is the
 * read that geometry exists for, and building the column without it would be
 * storing shapes for a map to look pretty with.
 *
 * Returns the SMALLEST match. Zones can legitimately overlap — a strip inside a
 * paddock, a paddock inside a parcel-sized zone — and the smallest containing
 * one is the most specific answer, which is what somebody standing on it means.
 */
export async function zoneAtPoint(
  tx: Tx,
  tenantId: string,
  point: Position,
): Promise<LandZone | null> {
  const zones = await listZones(tx, tenantId, { status: "active" });
  let best: { zone: LandZone; area: number } | null = null;
  for (const zone of zones) {
    const boundary = asBoundary(zone.geometry);
    if (!boundary) continue;
    if (!pointInBoundary(point, boundary)) continue;
    const area = boundaryAreaSqM(boundary);
    if (!best || area < best.area) best = { zone, area };
  }
  return best?.zone ?? null;
}

/**
 * How many active zones have a boundary drawn.
 *
 * A COUNT rather than the rows, because the only caller needs to know whether
 * "which paddock am I in" can answer at all — and loading every polygon on the
 * farm to decide whether to render one button would be a strange way to find
 * out.
 */
export async function mappedZoneCount(tx: Tx, tenantId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.landZones)
    .where(
      and(
        eq(schema.landZones.tenantId, tenantId),
        eq(schema.landZones.status, "active"),
        sql`${schema.landZones.geometry} is not null`,
      ),
    );
  return rows[0]?.count ?? 0;
}
