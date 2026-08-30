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
  createFeature,
  createParcel,
  createZone,
  deleteFeature,
  deleteFeatures,
  discardZones,
  deleteOccupancy,
  endOccupancy,
  endZoneUse,
  retireParcel,
  retireZone,
  activateZone,
  addPlanItem,
  createPlan,
  deletePlan,
  deletePlanItem,
  getFeature,
  getParcel,
  getPlan,
  layoutPaddocks,
  saveTakeoff,
  updatePlanItem,
  setFeatureGeometry,
  setFeatureStatus,
  setParcelBoundary,
  updateFeature,
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
      case "INVALID_KIND":
        return {
          error: "A kind must be lowercase letters, numbers and underscores.",
        };
      case "INVALID_STATUS":
        return { error: "Pick planned, built or removed." };
      // Both write for a person and name the offending detail, so they reach
      // the screen unaltered — the same courtesy the geometry parser gets.
      case "INVALID_ATTRIBUTES":
        return { error: err.message };
      case "INVALID_FEED":
        return { error: err.message };
      case "INVALID_WIDTH":
        return { error: err.message };
      // The subdivider writes for a person — "that ground is in two pieces" —
      // so its refusals reach the screen unaltered.
      case "LAYOUT_INVALID":
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
  // Drawn or walked on the site plan. Validated by `parseBoundary`, whose
  // refusals are written for a person, not by a second Zod shape for GeoJSON.
  geometry: z.unknown().optional(),
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

// --------------------------------------------------------------- features ---

/**
 * The site plan's write surface (slice 2b.0).
 *
 * Same three obligations as every other action here — re-verify the tenant,
 * check the pack is on, work inside `withTenant` — with one difference worth
 * naming: **these are member-level writes.** A feature is not a cost object, so
 * nothing forces the owner line, and the person who knows where the waterline
 * actually went is usually not the owner. See the ops comment for the argument.
 *
 * GEOMETRY IS NEVER VALIDATED HERE. Zod checks that something arrived; the
 * GeoJSON itself goes to `parseFeatureGeometry`, whose refusals are written for
 * a person ("that line needs at least two points") and reach the screen intact.
 * A second Zod shape for GeoJSON would be a worse copy of that parser.
 */

/**
 * A flat bag of scalars. The depth limit, the key format and the size cap are
 * enforced in ops so they hold for every caller; this only keeps a nested
 * document from reaching them.
 */
const attributes = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional();

const featureSchema = z.object({
  parcelId: z.string().uuid(),
  kind: z.string().min(1).max(63),
  name: z.string().max(200).optional(),
  status: z.enum(["planned", "built", "removed"]).optional(),
  geometry: z.unknown().optional(),
  attributes,
  fedById: z.string().uuid().nullable().optional(),
  // Bounds match the CHECK and `isLineWidth`. Null puts it back to the kind's
  // own weight, which is why it is nullable rather than merely optional.
  lineWidth: z.number().min(0.5).max(12).nullable().optional(),
  notes: z.string().max(5000).optional(),
});

export async function createFeatureAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = featureSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const feature = await withTenant(
      ctx.tenant.id,
      (tx) => createFeature(tx, landCtx(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.feature.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_feature",
      targetId: feature.id,
      meta: { kind: feature.kind, status: feature.status },
    });
    revalidatePath(`${BASE}/${parsed.data.parcelId}`);
    return { ok: true, id: feature.id };
  } catch (err) {
    return toResult(err);
  }
}

const updateFeatureSchema = featureSchema
  .omit({ parcelId: true, geometry: true })
  .partial()
  .extend({ id: z.string().uuid() });

export async function updateFeatureAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = updateFeatureSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { id, ...patch } = parsed.data;

  try {
    const feature = await withTenant(
      ctx.tenant.id,
      (tx) => updateFeature(tx, landCtx(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.feature.updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_feature",
      targetId: id,
      meta: { fields: Object.keys(patch) },
    });
    revalidatePath(`${BASE}/${feature.parcelId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function setFeatureGeometryAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ id: z.string().uuid(), geometry: z.unknown() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const feature = await withTenant(
      ctx.tenant.id,
      (tx) =>
        setFeatureGeometry(tx, landCtx(ctx), parsed.data.id, parsed.data.geometry),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.feature.redrawn",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_feature",
      targetId: parsed.data.id,
      meta: { drawn: feature.geometry !== null },
    });
    revalidatePath(`${BASE}/${feature.parcelId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Promotion, and it is audited under its own name.
 *
 * `land.feature.status` rather than `land.feature.updated` because THIS is the
 * entry somebody will one day go looking for — the moment a proposed waterline
 * became a fact about the ground. Burying it among renames would make the audit
 * log technically complete and practically useless.
 */
export async function setFeatureStatusAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      status: z.enum(["planned", "built", "removed"]),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const before = await withTenant(
      ctx.tenant.id,
      (tx) => getFeature(tx, ctx.tenant.id, parsed.data.id),
      { role: ctx.role },
    );
    const feature = await withTenant(
      ctx.tenant.id,
      (tx) => setFeatureStatus(tx, landCtx(ctx), parsed.data.id, parsed.data.status),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.feature.status",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_feature",
      targetId: parsed.data.id,
      meta: { from: before?.status ?? null, to: feature.status, kind: feature.kind },
    });
    revalidatePath(`${BASE}/${feature.parcelId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Delete several features in one act.
 *
 * The cap is the same order as `MAX_PADDOCKS` — a selection of more than a few
 * dozen is a filter that did not do its job, and an unbounded `IN` list from a
 * browser is a request nobody meant to make.
 */
const deleteFeaturesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export async function deleteFeaturesAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = deleteFeaturesSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    // The op returns the rows it deleted, so there is no pre-read: the single
    // version needs one because it returns nothing, and reading every feature
    // in the tenant to describe a handful would be a scan for an audit line.
    const gone = await withTenant(
      ctx.tenant.id,
      (tx) => deleteFeatures(tx, landCtx(ctx), parsed.data.ids),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.features.deleted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_parcel",
      targetId: gone[0]?.parcelId ?? null,
      // Identifiers and counts only — the kinds say what went without naming
      // anything, which is the rule the rest of this file follows.
      meta: {
        deleted: gone.length,
        kinds: Array.from(new Set(gone.map((feature) => feature.kind))),
      },
    });
    for (const parcelId of new Set(gone.map((feature) => feature.parcelId))) {
      revalidatePath(`${BASE}/${parcelId}`);
    }
    return { ok: true, deleted: gone.length };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Throw away proposed paddocks. Owner-only, and planned ground only — see
 * `discardZones`.
 */
const discardZonesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
});

export async function discardZonesAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = discardZonesSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const gone = await withTenant(
      ctx.tenant.id,
      (tx) => discardZones(tx, landCtx(ctx), parsed.data.ids),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.zones.discarded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_parcel",
      targetId: gone[0]?.parcelId ?? null,
      meta: { discarded: gone.length },
    });
    for (const parcelId of new Set(gone.map((zone) => zone.parcelId))) {
      revalidatePath(`${BASE}/${parcelId}`);
    }
    return { ok: true, discarded: gone.length };
  } catch (err) {
    return toResult(err);
  }
}

export async function deleteFeatureAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    // Read it BEFORE the delete: the audit entry needs to say what went, and
    // afterwards there is nothing left to ask.
    const before = await withTenant(
      ctx.tenant.id,
      (tx) => getFeature(tx, ctx.tenant.id, parsed.data.id),
      { role: ctx.role },
    );
    await withTenant(
      ctx.tenant.id,
      (tx) => deleteFeature(tx, landCtx(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.feature.deleted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_feature",
      targetId: parsed.data.id,
      meta: { kind: before?.kind ?? null, status: before?.status ?? null },
    });
    if (before) revalidatePath(`${BASE}/${before.parcelId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Divide ground into paddocks, and make a planned one real.
 *
 * **OWNER-ONLY, unlike the rest of the feature surface.** Drawing a fence is a
 * chore; deciding that this field is four paddocks is not — they become cost
 * objects the moment they are activated, and `upsertDimensionMember` requires
 * the owner role. See the ops comment.
 */
const layoutSchema = z.object({
  parcelId: z.string().uuid(),
  zoneId: z.string().uuid().nullable().optional(),
  // The fences bounding the ground to divide. The RING is recomputed from
  // stored geometry in the op — see `LayoutInput.fenceFeatureIds` for why the
  // polygon itself never travels. Capped because a loop of more than a few
  // dozen runs is not a field.
  fenceFeatureIds: z.array(z.string().uuid()).max(60).optional(),
  laneFeatureId: z.string().uuid(),
  // The upper bound matches `MAX_PADDOCKS`; the lower one is the subdivider's,
  // which refuses one paddock because that is not a division.
  count: z.number().int().min(2).max(60),
  namePrefix: z.string().max(60).optional(),
  placement: z.enum(["edge", "split"]).optional(),
  // Metres. A lane narrower than half a metre is not a lane, and one wider
  // than 30 m would swallow the ground it is meant to serve.
  laneWidthM: z.number().min(0.5).max(30).optional(),
});

export async function layoutPaddocksAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => layoutPaddocks(tx, landCtx(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.paddocks.laid_out",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_parcel",
      targetId: parsed.data.parcelId,
      meta: {
        count: parsed.data.count,
        placement: parsed.data.placement ?? "split",
        zones: result.zoneIds.length,
        features: result.featureIds.length,
        unreachable: result.warnings.length,
      },
    });
    revalidatePath(`${BASE}/${parsed.data.parcelId}`);
    return { ok: true, ...result };
  } catch (err) {
    return toResult(err);
  }
}

export async function activateZoneAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const zone = await withTenant(
      ctx.tenant.id,
      (tx) => activateZone(tx, landCtx(ctx), parsed.data.id),
      { role: ctx.role },
    );
    // Its own action name, like `land.feature.status`: this is the entry
    // somebody will go looking for — the moment proposed ground became a
    // paddock the books can group by.
    await logAudit({
      action: "land.zone.activated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_zone",
      targetId: zone.id,
      meta: { parcelId: zone.parcelId },
    });
    revalidatePath(`${BASE}/${zone.parcelId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// ----------------------------------------------- plans and the takeoff ---

/**
 * **OWNER-ONLY, all of it.** Drawing a fence is a chore; deciding to spend
 * money on four paddocks is not. The one act in this area a person in a field
 * performs is marking a feature built, and that stayed where it was.
 */

const takeoffLineSchema = z.object({
  material: z.string().min(1).max(63),
  label: z.string().min(1).max(200),
  quantity: z.number().positive().max(100_000_000),
  unit: z.enum(["each", "ft", "m"]),
  sourceFeatureId: z.string().uuid().nullable().optional(),
  // A price nobody typed is null, not zero — zero is a thing that is free.
  unitCost: z.number().min(0).max(10_000_000).nullable().optional(),
  notes: z.string().max(2000).optional(),
});

export async function createPlanAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      parcelId: z.string().uuid(),
      name: z.string().min(1).max(200),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const plan = await withTenant(
      ctx.tenant.id,
      (tx) => createPlan(tx, landCtx(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.plan.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_plan",
      targetId: plan.id,
      meta: { parcelId: plan.parcelId },
    });
    revalidatePath(`${BASE}/${parsed.data.parcelId}`);
    return { ok: true, id: plan.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function deletePlanAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    // Read it first: afterwards there is nothing left to say what went.
    const before = await withTenant(
      ctx.tenant.id,
      (tx) => getPlan(tx, ctx.tenant.id, parsed.data.id),
      { role: ctx.role },
    );
    await withTenant(
      ctx.tenant.id,
      (tx) => deletePlan(tx, landCtx(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.plan.deleted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_plan",
      targetId: parsed.data.id,
      meta: { name: before?.name ?? null },
    });
    if (before) revalidatePath(`${BASE}/${before.parcelId}`);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Save the list as it stands.
 *
 * **THE LINES ARRIVE FROM THE CLIENT, COMPUTED**, and that is deliberate rather
 * than lazy: what gets stored has to be exactly what the person was looking at
 * when they pressed the button. The arithmetic is pure and lives in
 * `core/takeoff.ts`, so the screen and this action run the same function — and
 * `saveTakeoff` validates every line before it is written, because "arrives
 * from the client" and "is trusted" are different things.
 */
export async function saveTakeoffAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      planId: z.string().uuid(),
      lines: z.array(takeoffLineSchema).max(500),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const items = await withTenant(
      ctx.tenant.id,
      (tx) => saveTakeoff(tx, landCtx(ctx), parsed.data.planId, parsed.data.lines),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.plan.taken_off",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_plan",
      targetId: parsed.data.planId,
      meta: { lines: parsed.data.lines.length, stored: items.length },
    });
    revalidatePath(BASE);
    return { ok: true, items: items.length };
  } catch (err) {
    return toResult(err);
  }
}

export async function addPlanItemAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = takeoffLineSchema
    .omit({ sourceFeatureId: true })
    .extend({ planId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { planId, ...line } = parsed.data;

  try {
    const item = await withTenant(
      ctx.tenant.id,
      (tx) => addPlanItem(tx, landCtx(ctx), planId, line),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.plan.item_added",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_plan",
      targetId: planId,
      meta: { material: item.material },
    });
    revalidatePath(BASE);
    return { ok: true, id: item.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function updatePlanItemAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      id: z.string().uuid(),
      quantity: z.number().positive().max(100_000_000).optional(),
      unitCost: z.number().min(0).max(10_000_000).nullable().optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };
  const { id, ...patch } = parsed.data;

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => updatePlanItem(tx, landCtx(ctx), id, patch),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.plan.item_updated",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_plan_item",
      targetId: id,
      meta: { fields: Object.keys(patch) },
    });
    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function deletePlanItemAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => deletePlanItem(tx, landCtx(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "land.plan.item_deleted",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "land_plan_item",
      targetId: parsed.data.id,
      meta: {},
    });
    revalidatePath(BASE);
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}
