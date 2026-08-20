"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { packContext } from "@/lib/packs/tenant-context";
import { todayInTimezone } from "@/lib/timezone";
import {
  askAdvisor,
  ADVISOR_HISTORY_MAX,
  ADVISOR_QUESTION_MAX,
} from "./ai/advisor";
import { speciesFrom } from "./vocabulary";
import {
  LivestockError,
  addIdentifier,
  addLotToFeedGroup,
  closeFeedGroup,
  createFeedGroup,
  createLivestockLot,
  deleteWeight,
  endFeedGroupMembership,
  farmSnapshot,
  markRoundNormal,
  moveLotToZone,
  placeHead,
  recordDailyCheck,
  recordFeedDraw,
  recordWeight,
  removeHead,
  retireIdentifier,
  splitLivestockLot,
  updateWeight,
  type LivestockCtx,
} from "./ops";

/**
 * Livestock write surface.
 *
 * `requireModuleEnabled` checks LIVESTOCK, and only livestock — even though
 * every action here also writes through `inventory` and some through `land`.
 * That is correct: the guard is the owning feature (extension-model §4b), and
 * the dependency graph is what guarantees the others are switched on. A pack
 * cannot be enabled with a requirement missing, so re-checking them here would
 * be belt on top of a belt.
 */

const PACK = "livestock";
const BASE = "/dashboard/m/livestock";

function toResult(err: unknown): { error: string } {
  if (err instanceof LivestockError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "Only an owner can change animal records." };
      case "NOT_FOUND":
        return { error: "That no longer exists." };
      case "INVALID_SPECIES":
        return { error: "Use lowercase letters, numbers and underscores." };
      case "INVALID_SEX":
        return { error: "Pick male, female or mixed." };
      case "INVALID_IDENTIFIER":
        return { error: "A tag kind must be lowercase letters and underscores." };
      case "LOT_INVALID":
      case "FEED_GROUP_INVALID":
      case "INVALID_WEIGHT":
        return { error: err.message };
      case "INVALID_METHOD":
        return { error: "Pick how it was weighed." };
    }
  }
  // Errors thrown by the packs this one composes reach here too, and their
  // messages are already written for a person.
  if (err instanceof Error && err.name === "InventoryError") {
    return { error: err.message };
  }
  if (err instanceof Error && err.name === "LandError") {
    return { error: err.message };
  }
  console.error("livestock action failed", err);
  return { error: "Something went wrong saving that." };
}

const requiredDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = requiredDate
  .optional()
  .or(z.literal("").transform(() => undefined));
const head = z.number().positive().max(1_000_000).multipleOf(0.0001);

function ctxOf(ctx: Awaited<ReturnType<typeof requireTenant>>): LivestockCtx {
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

export async function createLivestockLotAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      // Exactly one of these. `createLivestockLot` enforces it rather than a
      // Zod union, so the rule has one home and the ops layer cannot be
      // called past it.
      itemId: z.string().uuid().optional(),
      newItemName: z.string().min(1).max(200).optional(),
      code: z.string().min(1).max(120),
      species: z.string().min(1).max(63),
      sex: z.enum(["male", "female", "mixed"]).nullable().optional(),
      breed: z.string().max(200).optional(),
      bornOn: optionalDate.nullable(),
      source: z.enum(["purchased", "raised", "produced"]).optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => createLivestockLot(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.lot.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: result.lot.id,
      meta: { species: result.lot.species, inventoryLotId: result.inventoryLotId },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: result.lot.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function placeHeadAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      inventoryLotId: z.string().uuid(),
      head,
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => placeHead(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.head.placed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_lot",
      targetId: parsed.data.inventoryLotId,
      meta: { occurredOn: parsed.data.occurredOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function removeHeadAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid(),
      inventoryLotId: z.string().uuid(),
      head,
      reason: z.enum(["death", "cull", "sold_live"]),
      occurredOn: requiredDate,
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => removeHead(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.head.removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "inventory_lot",
      targetId: parsed.data.inventoryLotId,
      meta: { reason: parsed.data.reason, occurredOn: parsed.data.occurredOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function splitLivestockLotAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      head,
      newCode: z.string().min(1).max(120),
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => splitLivestockLot(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.lot.split",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: { childId: result.lot.id },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: result.lot.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function moveLotToZoneAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      zoneId: z.string().uuid(),
      startedOn: requiredDate,
      endedOn: optionalDate.nullable(),
      areaAcres: z.number().positive().multipleOf(0.0001).nullable().optional(),
      structureAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => moveLotToZone(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.lot.moved",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: {
        zoneId: parsed.data.zoneId,
        startedOn: parsed.data.startedOn,
        // The move now closes a stay as well as opening one, and which stay it
        // closed is the half somebody would come back to the log to ask about.
        movedOffZoneId: result.movedOff?.zoneId ?? null,
        movedOffOn: result.movedOff?.endedOn ?? null,
      },
    });
    // Land's pages read this record too, so both trees are revalidated.
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/land", "layout");
    return { ok: true, movedOff: result.movedOff };
  } catch (err) {
    return toResult(err);
  }
}

export async function addIdentifierAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      identifierKind: z.string().min(1).max(63),
      value: z.string().min(1).max(200),
      appliedOn: optionalDate.nullable(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const identifier = await withTenant(
      ctx.tenant.id,
      (tx) => addIdentifier(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.identifier.added",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      // The kind, never the value — a tag number identifies an animal and
      // there is no reason for the audit log to carry it.
      meta: { kind: identifier.identifierKind },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function retireIdentifierAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ id: z.string().uuid(), removedOn: requiredDate })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => retireIdentifier(tx, ctxOf(ctx), parsed.data.id, parsed.data.removedOn),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.identifier.retired",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_identifier",
      targetId: parsed.data.id,
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Record one lot's daily check, and any loss found while looking.
 *
 * NOT owner-gated, and that is the point of the slice: the round is walked by
 * whoever is in the pens. `recordDailyCheck` is a `member` verb, and the loss
 * it may carry goes through `removeHead`, which is one too.
 */
export async function recordDailyCheckAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      loggedOn: requiredDate,
      status: z.enum(["normal", "attention"]).optional(),
      notes: z.string().max(2000).optional(),
      loss: z
        .object({
          head,
          reason: z.enum(["death", "cull", "sold_live"]),
          notes: z.string().max(2000).optional(),
        })
        .optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const log = await withTenant(
      ctx.tenant.id,
      (tx) => recordDailyCheck(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    // Audited because a check is a claim that somebody looked, and the
    // mortality denominator rests on it. Identifiers only — no notes, which are
    // free text about an animal and belong only in the row.
    await logAudit({
      action: "livestock.check.recorded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: {
        loggedOn: parsed.data.loggedOn,
        status: log.status,
        lostHead: parsed.data.loss?.head ?? 0,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * The one-tap round: everything not yet looked at today is normal.
 *
 * The ids come from the screen rather than being derived here on purpose — the
 * person is confirming the list they can see. `markRoundNormal` still refuses
 * to overwrite an exception, so a stale list cannot erase anything; the worst a
 * page left open all afternoon can do is mark a lot that was already marked,
 * which the conflict clause turns into nothing at all.
 */
export async function markRoundNormalAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotIds: z.array(z.string().uuid()).min(1).max(500),
      loggedOn: requiredDate,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const logs = await withTenant(
      ctx.tenant.id,
      (tx) => markRoundNormal(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.round.recorded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "tenant",
      targetId: ctx.tenant.id,
      meta: { loggedOn: parsed.data.loggedOn, recorded: logs.length },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, recorded: logs.length };
  } catch (err) {
    return toResult(err);
  }
}

// --------------------------------------------------------------- weights ---

/**
 * Record a weighing.
 *
 * NOT owner-gated. Catching ten birds and putting them in a crate is the
 * definition of a chore, and a weight that waits for the owner to be free is a
 * weight taken on the wrong day — which for a broiler at seven weeks is most of
 * the information gone.
 *
 * The action validates SHAPE; whether a tape reading is complete, or a sample
 * size makes sense, is `recordWeight`'s, so the rule has one home.
 */
export async function recordWeightAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const measurement = z.number().positive().max(100_000).multipleOf(0.001);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      weighedOn: requiredDate,
      method: z.string().min(1).max(63),
      sampleSize: z.number().int().positive().max(100_000).optional(),
      sampleWeightLb: measurement.nullable().optional(),
      heartGirthIn: measurement.nullable().optional(),
      bodyLengthIn: measurement.nullable().optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const weight = await withTenant(
      ctx.tenant.id,
      (tx) => recordWeight(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    // The method and the sample size, never the notes — those are free text
    // about an animal and belong only in the row.
    await logAudit({
      action: "livestock.weight.recorded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: {
        weighedOn: weight.weighedOn,
        method: weight.method,
        sampleSize: weight.sampleSize,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Correct a weighing.
 *
 * Same level as recording one, because it is the same act done twice — the
 * person who typed 625 for a 62.5 lb crate is the person standing there with the
 * scale, and making them fetch the owner to fix a digit is how a wrong number
 * stays in the record.
 *
 * **The audit entry carries what it WAS**, which is the whole history a
 * measurement needs: the row is corrected in place because no such measurement
 * ever existed, and the log is where "who changed this, from what" lives.
 */
export async function updateWeightAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const measurement = z.number().positive().max(100_000).multipleOf(0.001);
  const parsed = z
    .object({
      id: z.string().uuid(),
      weighedOn: requiredDate.optional(),
      method: z.string().min(1).max(63).optional(),
      sampleSize: z.number().int().positive().max(100_000).optional(),
      sampleWeightLb: measurement.nullable().optional(),
      heartGirthIn: measurement.nullable().optional(),
      bodyLengthIn: measurement.nullable().optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    const { before, after } = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const before = await tx.query.livestockWeights.findFirst({
          where: and(
            eq(schema.livestockWeights.tenantId, ctx.tenant.id),
            eq(schema.livestockWeights.id, id),
          ),
        });
        const after = await updateWeight(tx, ctxOf(ctx), id, patch);
        return { before, after };
      },
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.weight.corrected",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_weight",
      targetId: id,
      // Figures and dates, never the notes — those are free text about an
      // animal and belong only in the row.
      meta: {
        was: before
          ? {
              weighedOn: before.weighedOn,
              method: before.method,
              sampleSize: before.sampleSize,
              sampleWeightLb: before.sampleWeightLb,
              heartGirthIn: before.heartGirthIn,
              bodyLengthIn: before.bodyLengthIn,
            }
          : null,
        now: {
          weighedOn: after.weighedOn,
          method: after.method,
          sampleSize: after.sampleSize,
          sampleWeightLb: after.sampleWeightLb,
          heartGirthIn: after.heartGirthIn,
          bodyLengthIn: after.bodyLengthIn,
        },
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/** Remove a weighing entered by mistake. The audit entry keeps what it said. */
export async function deleteWeightAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const removed = await withTenant(
      ctx.tenant.id,
      (tx) => deleteWeight(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.weight.removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: removed.livestockLotId,
      meta: {
        weighedOn: removed.weighedOn,
        method: removed.method,
        sampleSize: removed.sampleSize,
        sampleWeightLb: removed.sampleWeightLb,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

// --------------------------------------------------------------- feeders ---

/**
 * Create a shared feeder — the allocation seam's front door.
 *
 * Owner-gated, unlike everything else in this section: deciding that fifteen
 * pens share one cost pot changes how this farm's largest cash cost is
 * attributed, and it is done once rather than daily.
 */
export async function createFeedGroupAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      name: z.string().trim().min(1).max(200),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Give the feeder a name." };

  try {
    const group = await withTenant(
      ctx.tenant.id,
      (tx) => createFeedGroup(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.feed_group.created",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_feed_group",
      targetId: group.id,
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: group.id };
  } catch (err) {
    return toResult(err);
  }
}

export async function closeFeedGroupAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => closeFeedGroup(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.feed_group.closed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_feed_group",
      targetId: parsed.data.id,
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Put a lot on a feeder, or take it off.
 *
 * NOT owner-gated, and the reasoning is `moveLotToZone`'s: this records that
 * somebody moved birds onto a bin, which is a fact about the yard rather than a
 * decision taken at the keyboard. The membership DATES are what the allocation
 * divides by, so recording them late is worse than recording them by whoever was
 * there.
 */
export async function addLotToFeedGroupAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      feedGroupId: z.string().uuid(),
      livestockLotId: z.string().uuid(),
      startedOn: requiredDate,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => addLotToFeedGroup(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.feed_group.lot_added",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_feed_group",
      targetId: parsed.data.feedGroupId,
      meta: {
        livestockLotId: parsed.data.livestockLotId,
        startedOn: parsed.data.startedOn,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

export async function endFeedGroupMembershipAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ memberId: z.string().uuid(), endedOn: requiredDate })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => endFeedGroupMembership(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.feed_group.lot_removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_feed_group_member",
      targetId: parsed.data.memberId,
      meta: { endedOn: parsed.data.endedOn },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Draw feed for a shared feeder.
 *
 * A chore, at `member`, exactly like issuing a bag to a named pen — because that
 * is what it is. The cost comes back so the toast can say what was stamped: it
 * is the number that will be spread across the pens, and seeing it at the moment
 * it is recorded is the only time anybody would notice it was wrong.
 */
export async function recordFeedDrawAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      feedGroupId: z.string().uuid(),
      itemId: z.string().uuid(),
      lotId: z.string().uuid().nullable().optional(),
      quantity: z.number().positive().max(10_000_000).multipleOf(0.0001),
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => recordFeedDraw(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.feed_group.drawn",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_feed_group",
      targetId: parsed.data.feedGroupId,
      meta: { itemId: parsed.data.itemId, occurredOn: parsed.data.occurredOn },
    });
    revalidatePath(BASE, "layout");
    revalidatePath("/dashboard/m/inventory", "layout");
    return { ok: true, costCents: result.costCents };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Ask the advisor a question about this farm — livestock slice 1b.
 *
 * **THE QUESTION IS THE ONLY THING THE BROWSER SENDS.** Every fact in the
 * answer comes from `farmSnapshot`, assembled inside `withTenant` under RLS. A
 * client that lied about its history could at worst mislead its own advisor;
 * it cannot reach another tenant's animals, because it never supplies a fact.
 *
 * It is a READ. Nothing here writes a record, and that is what makes the
 * pack-wide rule — AI never produces a number that enters the books or an
 * animal without a human seeing it first — true by construction here.
 */
export async function askAdvisorAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      question: z.string().trim().min(1).max(ADVISOR_QUESTION_MAX),
      history: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(20000),
          }),
        )
        .max(ADVISOR_HISTORY_MAX)
        .default([]),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Ask a shorter question." };

  try {
    const snapshot = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const pack = await packContext(
          tx,
          ctx.tenant.id,
          ctx.tenant.industry,
          PACK,
        );
        return farmSnapshot(tx, ctx.tenant.id, {
          today: todayInTimezone(ctx.tenant.timezone),
          species: speciesFrom(pack.config),
          // The whole config, not just the species: the tape divisors live in
          // it too, and without them a herd measured by tape reaches the
          // advisor with no weight at all.
          packConfig: pack.config,
        });
      },
      { role: ctx.role },
    );

    const answer = await askAdvisor({
      snapshot,
      history: parsed.data.history,
      question: parsed.data.question,
    });

    // Identifiers only — never the question or the answer. What is worth
    // recording is that this farm's records went to a model and when, not what
    // somebody wondered about their cows.
    await logAudit({
      action: "livestock.advisor.asked",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "tenant",
      targetId: ctx.tenant.id,
      meta: { lots: snapshot.lots.length, turns: parsed.data.history.length },
    });
    return { ok: true, answer };
  } catch (err) {
    if (err instanceof Error && err.message.includes("ANTHROPIC_API_KEY")) {
      return { error: "The advisor is not configured on this deployment yet." };
    }
    return toResult(err);
  }
}
