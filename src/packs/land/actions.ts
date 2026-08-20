"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { packContext } from "@/lib/packs/tenant-context";
import { asBoundary, boundaryAreaAcres } from "./core/geo";
import {
  parcelSourceById,
  parcelSourceFrom,
  suggestedParcelName,
} from "./core/parcel-lookup";
import { lookupCurrency, lookupParcels } from "./parcel-lookup-service";
import {
  LandError,
  combineParcels,
  createParcel,
  createZone,
  deleteOccupancy,
  endOccupancy,
  endZoneUse,
  retireParcel,
  retireZone,
  getParcel,
  setParcelBoundary,
  zoneAtPoint,
  setZoneBoundary,
  startOccupancy,
  startZoneUse,
  updateParcel,
  updateZone,
  type LandCtx,
} from "./ops";

/**
 * Land write surface.
 *
 * Every action does the three things AGENTS.md requires of a pack: it
 * re-verifies the tenant server-side, checks the pack is switched ON for that
 * tenant, and does its work inside `withTenant` so RLS is in force.
 *
 * `{ role: ctx.role }` is passed through so `app.tenant_role` reflects the
 * actual caller. It defaults to `staff`, the least privileged value, and must
 * never be handed a role that did not come from `requireTenant()`.
 *
 * AREAS ARRIVE IN ACRES. The form converts from whatever the tenant enters in
 * (`core/area.ts`), because the canonical unit is a storage decision and the
 * boundary is the last place it can still be enforced.
 */

const PACK = "land";
const BASE = "/dashboard/m/land";

function toResult(err: unknown): { error: string } {
  if (err instanceof LandError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change the land records." };
      case "NOT_FOUND":
        return { error: "That no longer exists." };
      case "INVALID_USE":
        return {
          error: "A use must be lowercase letters, numbers and underscores.",
        };
      case "INVALID_TENURE":
        return { error: "Pick owned, leased or crop share." };
      case "PARCEL_INVALID":
        return { error: "That parcel does not exist." };
      case "DATE_ORDER":
        return { error: err.message };
      case "ALREADY_OCCUPIED":
        // Names the occupant rather than saying "conflict", because the fix is
        // to go and close that stay and the user needs to know which one.
        return { error: `${err.message}. Move it off first.` };
      case "INVALID_OCCUPANT":
        return {
          error: "An occupant kind must be lowercase letters and underscores.",
        };
      // The parser writes for a person — "that file has 12 shapes in it" — so
      // its message reaches the screen unaltered.
      case "INVALID_COMBINE":
        return { error: err.message };
      case "INVALID_GEOMETRY":
        return { error: err.message };
    }
  }
  console.error("land action failed", err);
  return { error: "Something went wrong saving that." };
}

/** Empty string from a form field means "not set", not an empty value. */
const optionalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Acres, to four decimals — the column's scale, enforced here so a value that
 * would be silently rounded on write is rejected at the boundary instead.
 * The upper bound is a typo guard: 10 million acres is larger than Massachusetts.
 */
const acres = z
  .number()
  .positive()
  .max(10_000_000)
  .multipleOf(0.0001)
  .nullable()
  .optional();

function landCtx(ctx: Awaited<ReturnType<typeof requireTenant>>): LandCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

// ---------------------------------------------------------------- parcels ---

const parcelSchema = z.object({
  name: z.string().min(1).max(200),
  tenure: z.enum(["owned", "leased", "crop_share"]).optional(),
  areaAcres: acres,
  identifier: z.string().max(200).optional(),
  notes: z.string().max(5000).optional(),
  // A year is the typo guard. Nobody rests a paddock for longer and means it.
  restTargetDays: z.number().int().min(1).max(365).nullable().optional(),
});

export async function createParcelAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = parcelSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const parcel = await withTenant(
      ctx.tenant.id,
      (tx) => createParcel(tx, landCtx(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.parcel.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_parcel",
      targetId: parcel.id,
      meta: { tenure: parcel.tenure },
    });
    revalidatePath(BASE);
    return { ok: true, id: parcel.id };
  } catch (err) {
    return toResult(err);
  }
}

const updateParcelSchema = parcelSchema.partial().extend({
  id: z.string().uuid(),
});

export async function updateParcelAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = updateParcelSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { id, ...patch } = parsed.data;

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => updateParcel(tx, landCtx(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.parcel.updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_parcel",
      targetId: id,
      meta: { fields: Object.keys(patch) },
    });
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${id}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function retireParcelAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => retireParcel(tx, landCtx(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.parcel.retired",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_parcel",
      targetId: parsed.data.id,
      meta: { zonesRetired: result.zonesRetired },
    });
    revalidatePath(BASE);
    revalidatePath(`${BASE}/${parsed.data.id}`);
    return { ok: true, zonesRetired: result.zonesRetired };
  } catch (err) {
    return toResult(err);
  }
}

// ------------------------------------------------------------------ zones ---

const zoneSchema = z.object({
  parcelId: z.string().uuid(),
  name: z.string().min(1).max(200),
  areaAcres: acres,
  notes: z.string().max(5000).optional(),
});

export async function createZoneAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = zoneSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const zone = await withTenant(
      ctx.tenant.id,
      (tx) => createZone(tx, landCtx(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.zone.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_zone",
      targetId: zone.id,
      meta: { parcelId: zone.parcelId },
    });
    revalidatePath(`${BASE}/${parsed.data.parcelId}`);
    revalidatePath(BASE);
    return { ok: true, id: zone.id };
  } catch (err) {
    return toResult(err);
  }
}

const updateZoneSchema = zoneSchema.partial().extend({
  id: z.string().uuid(),
});

export async function updateZoneAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = updateZoneSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { id, ...patch } = parsed.data;

  try {
    const zone = await withTenant(
      ctx.tenant.id,
      (tx) => updateZone(tx, landCtx(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.zone.updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_zone",
      targetId: id,
      meta: { fields: Object.keys(patch) },
    });
    revalidatePath(`${BASE}/${zone.parcelId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function retireZoneAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ id: z.string().uuid(), endedOn: optionalDate })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const zone = await withTenant(
      ctx.tenant.id,
      (tx) =>
        retireZone(tx, landCtx(ctx), parsed.data.id, parsed.data.endedOn),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.zone.retired",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_zone",
      targetId: parsed.data.id,
    });
    revalidatePath(`${BASE}/${zone.parcelId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// ------------------------------------------------------------------- uses ---

const useSchema = z.object({
  zoneId: z.string().uuid(),
  use: z.string().min(1).max(63),
  startedOn: requiredDate,
  isProductive: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
});

export async function startZoneUseAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = useSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { zoneId, ...rest } = parsed.data;

  try {
    const use = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const started = await startZoneUse(tx, landCtx(ctx), zoneId, rest);
        return started;
      },
      { role: ctx.role },
    );
    await logAudit({
      action: "land.zone.use_started",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_zone",
      targetId: zoneId,
      meta: { use: use.use, startedOn: use.startedOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: use.id };
  } catch (err) {
    return toResult(err);
  }
}

// -------------------------------------------------------------- occupancy ---

const occupancySchema = z.object({
  zoneId: z.string().uuid(),
  occupantLabel: z.string().min(1).max(200),
  startedOn: requiredDate,
  endedOn: optionalDate.nullable(),
  areaAcres: acres,
  notes: z.string().max(5000).optional(),
});

export async function startOccupancyAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = occupancySchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { zoneId, ...rest } = parsed.data;

  try {
    const stay = await withTenant(
      ctx.tenant.id,
      (tx) => startOccupancy(tx, landCtx(ctx), zoneId, rest),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.occupancy.started",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_zone",
      targetId: zoneId,
      // The label is the tenant's own words for an animal group, so only the
      // shape of the record is logged — identifiers, never content.
      meta: { startedOn: stay.startedOn, closed: stay.endedOn !== null },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: stay.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function endOccupancyAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ occupancyId: z.string().uuid(), endedOn: requiredDate })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        endOccupancy(
          tx,
          landCtx(ctx),
          parsed.data.occupancyId,
          parsed.data.endedOn,
        ),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.occupancy.ended",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_occupancy",
      targetId: parsed.data.occupancyId,
      meta: { endedOn: parsed.data.endedOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteOccupancyAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ occupancyId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => deleteOccupancy(tx, landCtx(ctx), parsed.data.occupancyId),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.occupancy.deleted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_occupancy",
      targetId: parsed.data.occupancyId,
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function endZoneUseAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ useId: z.string().uuid(), endedOn: requiredDate })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        endZoneUse(tx, landCtx(ctx), parsed.data.useId, parsed.data.endedOn),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.zone.use_ended",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_zone_use",
      targetId: parsed.data.useId,
      meta: { endedOn: parsed.data.endedOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Paste a boundary onto a zone, or clear it.
 *
 * The GeoJSON arrives as TEXT and stays text all the way to `setZoneBoundary`,
 * which parses it. Zod checks only that it is a string of sane length: a schema
 * that tried to describe GeoJSON here would be a second, weaker copy of
 * `parseBoundary`, and the first thing to drift.
 */
export async function setZoneBoundaryAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      // A county's field boundary runs to a few hundred KB at full precision.
      geojson: z.string().max(2_000_000).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const zone = await withTenant(
      ctx.tenant.id,
      (tx) => setZoneBoundary(tx, landCtx(ctx), parsed.data.id, parsed.data.geojson),
      { role: ctx.role },
    );
    await logAudit({
      action: parsed.data.geojson
        ? "land.zone.boundary_set"
        : "land.zone.boundary_cleared",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_zone",
      targetId: zone.id,
      // Identifiers only. The boundary itself is the tenant's data and has no
      // business in the platform-wide audit log.
      meta: { hasBoundary: zone.geometry !== null },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/** The same, for a parcel. */
export async function setParcelBoundaryAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      geojson: z.string().max(2_000_000).nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const parcel = await withTenant(
      ctx.tenant.id,
      (tx) => setParcelBoundary(tx, landCtx(ctx), parsed.data.id, parsed.data.geojson),
      { role: ctx.role },
    );
    await logAudit({
      action: parsed.data.geojson
        ? "land.parcel.boundary_set"
        : "land.parcel.boundary_cleared",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_parcel",
      targetId: parcel.id,
      meta: { hasBoundary: parcel.geometry !== null },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Search the public parcel record. READ-ONLY — it writes nothing and creates
 * nothing, which is why it is a `member` verb while importing is the owner's.
 *
 * The SOURCE comes from the tenant's pack config and is resolved against a
 * closed registry; the only thing that travels from the browser is what
 * somebody typed into a box. There is no path here from user input to a URL.
 */
export async function lookupParcelsAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      kind: z.enum(["parcel_number", "mailing_address"]),
      query: z.string().min(1).max(200),
      region: z.string().max(80).optional(),
      /**
       * Which public service to ask. **An ID, never a URL** — it is resolved
       * against `PARCEL_SOURCES` below, so the browser can choose BETWEEN
       * sources and can never introduce one. That distinction is the whole
       * SSRF defence.
       */
      sourceId: z.string().max(60).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the search and try again." };

  const pack = await withTenant(
    ctx.tenant.id,
    (tx) => packContext(tx, ctx.tenant.id, ctx.tenant.industry, PACK),
    { role: ctx.role },
  );
  // The tenant's pinned source wins; otherwise whatever the person picked, and
  // both go through the registry.
  const source =
    parcelSourceFrom(pack.config) ?? parcelSourceById(parsed.data.sourceId);
  if (!source) {
    return { error: "Pick which parcel service to search." };
  }

  // Both together: the answer, and how old the answer is. The second matters
  // most exactly when the first is empty.
  const [result, currency] = await Promise.all([
    lookupParcels(source, parsed.data),
    lookupCurrency(source, parsed.data.region ?? ""),
  ]);
  if (!result.ok) return { error: result.error };

  // The geometry is validated HERE rather than on import, so a candidate that
  // could never become a boundary is never offered as one.
  const candidates = result.candidates
    .map((candidate) => {
      const boundary = asBoundary(candidate.geometry);
      if (!boundary) return null;
      return {
        parcelNumber: candidate.parcelNumber,
        situsAddress: candidate.situsAddress,
        mailingAddress: candidate.mailingAddress,
        declaredAcres: candidate.declaredAcres,
        measuredAcres: boundaryAreaAcres(boundary),
        suggestedName: suggestedParcelName(candidate),
        geojson: JSON.stringify(boundary),
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  return { ok: true, candidates, attribution: source.attribution, currency };
}

/**
 * Turn chosen candidates into parcels, each with its boundary.
 *
 * OWNER, because every row here becomes a parcel and therefore a cost object —
 * the same reason `createParcel` is owner-only on its own. One transaction for
 * the lot: importing four parcels and failing on the third must not leave two
 * behind with nothing said about the rest.
 *
 * **The county's acreage lands in `area_acres` as the DECLARED figure**, not as
 * truth. The boundary is measured separately and the two are compared on the
 * page, which is the whole discipline of this pack applied to somebody else's
 * data: report the difference, correct nothing.
 */
export async function importParcelsAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      parcels: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            parcelNumber: z.string().min(1).max(120),
            declaredAcres: z.number().positive().max(1_000_000).nullable(),
            geojson: z.string().min(2).max(2_000_000),
          }),
        )
        .min(1)
        .max(50),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the selection and try again." };

  try {
    const created = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const ids: string[] = [];
        for (const row of parsed.data.parcels) {
          const parcel = await createParcel(tx, landCtx(ctx), {
            name: row.name,
            areaAcres: row.declaredAcres,
            // The number that found it, kept where a person would look for it.
            identifier: row.parcelNumber,
          });
          await setParcelBoundary(tx, landCtx(ctx), parcel.id, JSON.parse(row.geojson));
          ids.push(parcel.id);
        }
        return ids;
      },
      { role: ctx.role },
    );

    await logAudit({
      action: "land.parcels.imported",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "tenant",
      targetId: ctx.tenant.id,
      meta: {
        count: created.length,
        parcelNumbers: parsed.data.parcels.map((p) => p.parcelNumber),
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, created: created.length };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Which paddock am I standing in?
 *
 * A READ, so any member may ask — the person walking the farm is exactly who
 * this is for, and they are not usually the owner. It writes nothing and
 * returns names, not geometry: the browser sent a coordinate and gets an
 * answer, rather than downloading every boundary on the farm to work it out
 * itself.
 */
export async function zoneAtPointAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      // Longitude first, as GeoJSON has it everywhere else in this pack.
      lon: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "That location did not make sense." };

  try {
    const found = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const zone = await zoneAtPoint(tx, ctx.tenant.id, [
          parsed.data.lon,
          parsed.data.lat,
        ]);
        if (!zone) return null;
        // The parcel's name travels with it, because "North Pasture" means
        // little on a farm with two of them and the person is not at a desk.
        const parcel = await getParcel(tx, ctx.tenant.id, zone.parcelId);
        return {
          zoneId: zone.id,
          zoneName: zone.name,
          parcelId: zone.parcelId,
          parcelName: parcel?.name ?? "",
          areaAcres: zone.areaAcres,
        };
      },
      { role: ctx.role },
    );
    return { ok: true, zone: found };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Combine several parcels into one block of ground.
 *
 * OWNER, because it retires cost objects and moves paddocks between them —
 * every part of it is a decision about how the books are grouped, not a chore.
 */
export async function combineParcelsAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      survivorId: z.string().uuid(),
      absorbedIds: z.array(z.string().uuid()).min(1).max(50),
      name: z.string().min(1).max(200).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Pick at least two parcels to combine." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => combineParcels(tx, landCtx(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.parcels.combined",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_parcel",
      targetId: result.parcel.id,
      meta: {
        absorbed: parsed.data.absorbedIds,
        zonesMoved: result.zonesMoved,
      },
    });
    revalidatePath(BASE, "layout");
    return {
      ok: true,
      absorbed: result.absorbed,
      zonesMoved: result.zonesMoved,
      name: result.parcel.name,
    };
  } catch (err) {
    return toResult(err);
  }
}
