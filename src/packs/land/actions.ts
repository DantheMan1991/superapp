"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import {
  LandError,
  createParcel,
  createZone,
  deleteOccupancy,
  endOccupancy,
  endZoneUse,
  retireParcel,
  retireZone,
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
