"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit } from "@/lib/audit";
import { packContext } from "@/lib/packs/tenant-context";
import { allowsWrite } from "@/lib/packs/authorize";
import { friendlyMessage as friendlyDocsMessage } from "@/modules/documents/core/errors";
import {
  detachDocumentFromRecord,
  registerAttachedPhoto,
  setPrimaryAttachment,
} from "@/modules/documents/attachments";
import { todayInTimezone } from "@/lib/timezone";
import {
  askAdvisor,
  ADVISOR_HISTORY_MAX,
  ADVISOR_QUESTION_MAX,
} from "./ai/advisor";
import { speciesFrom } from "./vocabulary";
import {
  LivestockError,
  MAX_BREED_PARTS,
  addLotToParent,
  lotMembers,
  moveLotsToZone,
  removeLotFromParent,
  returnToMarket,
  transferToBreeding,
  MAX_INDIVIDUALS,
  addIdentifier,
  addLotToFeedGroup,
  closeFeedGroup,
  createFeedGroup,
  createLivestockLot,
  deleteTreatment,
  deleteWeight,
  endFeedGroupMembership,
  farmSnapshot,
  getLivestockLot,
  lastTreatmentOfProduct,
  markRoundNormal,
  moveLotToZone,
  placeHead,
  recordBirth,
  recordDailyCheck,
  recordDirectFeed,
  recordFeedDraw,
  recordTreatment,
  recordWeight,
  removeHead,
  retireIdentifier,
  setBreedParts,
  setParents,
  splitIntoIndividuals,
  splitLivestockLot,
  startIndividual,
  updateTreatment,
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
      // Every one of these already says what is wrong in a sentence — "8 head
      // here — record the one animal on its own first" is the whole answer.
      case "CAPITAL_INVALID":
      case "GROUP_INVALID":
      case "FEED_GROUP_INVALID":
      case "INVALID_WEIGHT":
      case "INVALID_TREATMENT":
        return { error: err.message };
      case "INVALID_METHOD":
        return { error: "Pick how it was weighed." };
      case "INVALID_BREED":
        return { error: err.message };
      // Every one of these already says which animal and why — "that animal is
      // already descended from this one" is the whole explanation, and a
      // generic sentence here would throw it away.
      case "INVALID_PARENT":
        return { error: err.message };
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
  // Photos are Documents' rows, so its refusals arrive here already written
  // for a person — "Only a photo can be the picture", not a code.
  if (err instanceof Error && err.name === "DocsError") {
    return { error: friendlyDocsMessage(err) };
  }
  // Slice 4f composes `assets` and the ledger, and both throw their own types.
  // Without these the capital transfer's refusals all arrived as "Something
  // went wrong saving that" — which is how the missing depreciation guard took
  // a browser session to diagnose instead of a sentence.
  if (err instanceof Error && err.name === "AssetError") {
    return { error: err.message };
  }
  if (err instanceof Error && err.name === "LedgerError") {
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

/**
 * Photos of an animal. Slice 4b.
 *
 * **THE PACK OWNS THESE ACTIONS AND CORE OWNS THE TABLE**, which is the whole
 * shape of the seam: `document_attachments` is polymorphic and names no pack, so
 * the code that DOES name one is here, where `livestock` is a fact rather than a
 * string the browser sent.
 *
 * **AND BECAUSE THERE IS NO FOREIGN KEY, THIS IS THE ONLY THING THAT PROVES THE
 * ANIMAL EXISTS.** A polymorphic reference cannot be policed by Postgres — the
 * trade the schema comment sets out — so `assertLot` is the compensating
 * control, not a nicety. Without it a photo could be hung on any UUID at all,
 * including one belonging to another tenant's record, and nothing would object.
 */
const PHOTO_ENTITY = "livestock_lot";

const photoTarget = (livestockLotId: string) => ({
  extensionSlug: PACK,
  entityType: PHOTO_ENTITY,
  entityId: livestockLotId,
});

const photoInput = z.object({
  entityId: z.string().uuid(),
  pathname: z.string().min(1).max(500),
});

const photoRef = z.object({
  entityId: z.string().uuid(),
  documentId: z.string().uuid(),
});

/**
 * Both modules, both gates. `livestock` because the record is this pack's, and
 * `documents` because the FILE is the DMS's — a farm that has not switched
 * Documents on has nowhere to put a photo, and the page says so rather than
 * offering a button that fails.
 */
async function photoGate() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  await requireModuleEnabled(ctx.tenant.id, "documents");
  // Taking a photo of an animal is a chore — `member`, like placing head and
  // moving a lot. The accountant role is read-only everywhere.
  if (!allowsWrite(ctx.role, "member")) {
    throw new LivestockError("FORBIDDEN", "cannot write here");
  }
  return ctx;
}

async function assertLot(
  ctx: Awaited<ReturnType<typeof requireTenant>>,
  livestockLotId: string,
): Promise<void> {
  const lot = await withTenant(
    ctx.tenant.id,
    (tx) => getLivestockLot(tx, ctx.tenant.id, livestockLotId),
    { role: ctx.role },
  );
  if (!lot) throw new LivestockError("NOT_FOUND", `lot ${livestockLotId}`);
}

export async function attachLotPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoInput.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    await assertLot(ctx, parsed.data.entityId);

    const result = await registerAttachedPhoto(
      { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role },
      {
        pathname: parsed.data.pathname,
        target: photoTarget(parsed.data.entityId),
      },
    );
    revalidatePath(BASE, "layout");
    return { ok: true as const, documentId: result.documentId };
  } catch (err) {
    return toResult(err);
  }
}

export async function setLotPhotoPrimaryAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    await assertLot(ctx, parsed.data.entityId);

    await withTenant(
      ctx.tenant.id,
      (tx) =>
        setPrimaryAttachment(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId },
          {
            documentId: parsed.data.documentId,
            target: photoTarget(parsed.data.entityId),
          },
        ),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

export async function detachLotPhotoAction(input: unknown) {
  try {
    const ctx = await photoGate();
    const parsed = photoRef.safeParse(input);
    if (!parsed.success) return { error: "Check the details and try again." };
    await assertLot(ctx, parsed.data.entityId);

    await withTenant(
      ctx.tenant.id,
      (tx) =>
        detachDocumentFromRecord(
          tx,
          { tenantId: ctx.tenant.id, userId: ctx.userId },
          {
            documentId: parsed.data.documentId,
            target: photoTarget(parsed.data.entityId),
          },
        ),
      { role: ctx.role },
    );
    // The FILE is untouched and stays in the cabinet. Removing a photo from an
    // animal and deleting a photo are different acts.
    revalidatePath(BASE, "layout");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
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

/**
 * State what an animal is made of. The whole set replaces the whole set.
 *
 * The empty list is a legitimate input — it means "I do not know after all" —
 * so this is not guarded by a `min(1)`.
 */
export async function setBreedPartsAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      parts: z
        .array(
          z.object({
            breed: z.string().min(1).max(63),
            // Whole parts, out of their own sum. The upper bound matches the
            // column's CHECK so the refusal happens with a sentence rather
            // than a constraint violation.
            parts: z.number().int().min(1).max(10_000),
          }),
        )
        .max(MAX_BREED_PARTS),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        setBreedParts(
          tx,
          ctxOf(ctx),
          parsed.data.livestockLotId,
          parsed.data.parts,
        ),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.breed.set",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      // Identifiers only: the breeds and their shares, which is a fact about an
      // animal rather than anything private.
      meta: { breeds: parsed.data.parts.map((p) => p.breed).join(",") },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Name a dam, a sire, or both — and clearing one is `null` rather than absence.
 *
 * The form always sends both keys, so a person who clears the sire box clears
 * the sire. `undefined` reaches `setParents` only from code that means "leave
 * that one alone".
 */
export async function setParentsAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      damLotId: z.string().uuid().nullable().optional(),
      sireLotId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) =>
        setParents(tx, ctxOf(ctx), parsed.data.livestockLotId, {
          damLotId: parsed.data.damLotId,
          sireLotId: parsed.data.sireLotId,
        }),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.parents.set",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: {
        damLotId: parsed.data.damLotId ?? "",
        sireLotId: parsed.data.sireLotId ?? "",
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/** A birth: the lot, both parents and the head, in one transaction. */
export async function recordBirthAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      damLotId: z.string().uuid().nullable().optional(),
      sireLotId: z.string().uuid().nullable().optional(),
      code: z.string().min(1).max(120),
      head,
      bornOn: requiredDate,
      itemId: z.string().uuid().optional(),
      newItemName: z.string().min(1).max(200).optional(),
      species: z.string().min(1).max(63).optional(),
      sex: z.enum(["male", "female", "mixed"]).nullable().optional(),
      locationAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => recordBirth(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.birth.recorded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: result.lot.id,
      meta: {
        damLotId: parsed.data.damLotId ?? "",
        sireLotId: parsed.data.sireLotId ?? "",
        head: String(parsed.data.head),
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, id: result.lot.id };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * **RECORD SOME OF A LOT AS INDIVIDUALS.** One name per animal; each becomes a
 * lot of one, carrying the biology across and wearing its name as an identifier.
 *
 * The names arrive as a single block of text because that is how somebody has
 * them — off a clipboard, out of a notebook, read off ten ear tags in a row —
 * and asking for ten separate fields would be the friction this action exists
 * to remove.
 */
export async function splitIntoIndividualsAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      names: z.array(z.string().min(1).max(120)).min(1).max(MAX_INDIVIDUALS),
      identifierKind: z.string().min(1).max(63),
      occurredOn: requiredDate,
      locationAssetId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const created = await withTenant(
      ctx.tenant.id,
      (tx) => splitIntoIndividuals(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.individuals.split",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: { count: String(created.length), kind: parsed.data.identifierKind },
    });
    revalidatePath(BASE, "layout");
    return { ok: true as const, count: created.length };
  } catch (err) {
    return toResult(err);
  }
}

/** Start ONE animal: the lot, its name and the single head, in one act. */
export async function startIndividualAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      itemId: z.string().uuid().optional(),
      newItemName: z.string().min(1).max(200).optional(),
      name: z.string().min(1).max(120),
      identifierKind: z.string().min(1).max(63).optional(),
      species: z.string().min(1).max(63),
      sex: z.enum(["male", "female", "mixed"]).nullable().optional(),
      breed: z.string().max(63).optional(),
      bornOn: optionalDate.nullable(),
      occurredOn: requiredDate,
      source: z.enum(["purchased", "raised", "produced"]).optional(),
      notes: z.string().max(5000).optional(),
      /** Start her straight inside a lot. Optional — most animals are loose. */
      parentLotId: z.string().uuid().nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => startIndividual(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.individual.started",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: result.lot.id,
      meta: {
        species: result.lot.species,
        inventoryLotId: result.inventoryLotId,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true as const, id: result.lot.id };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * **PUT ANIMALS INSIDE A LOT** (slice 8b). What replaces `addLotToGroupAction`.
 *
 * Takes a LIST, because the act somebody is doing is "these six go in the north
 * pen" and six dialogs is the friction `splitIntoIndividuals` already exists to
 * remove. One transaction: they all go in or none does.
 */
export async function addLotToParentAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      parentLotId: z.string().uuid(),
      memberLotIds: z.array(z.string().uuid()).min(1).max(200),
      startedOn: requiredDate,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      async (tx) => {
        for (const memberLotId of parsed.data.memberLotIds) {
          await addLotToParent(tx, ctxOf(ctx), {
            parentLotId: parsed.data.parentLotId,
            memberLotId,
            startedOn: parsed.data.startedOn,
          });
        }
      },
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true as const, count: parsed.data.memberLotIds.length };
  } catch (err) {
    return toResult(err);
  }
}

/** Take one animal or sub-lot out of the lot it is in. */
export async function removeLotFromParentAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      memberLotId: z.string().uuid(),
      endedOn: requiredDate,
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    await withTenant(
      ctx.tenant.id,
      (tx) => removeLotFromParent(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    revalidatePath(BASE, "layout");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * **MOVE LOTS AND EVERYTHING IN THEM.** Slice 8d, and what replaces
 * `moveGroupToZoneAction` — the one thing a herd could do that a lot could not.
 *
 * Takes a LIST, so the hub can move several at once, and each one brings its
 * members without the caller naming them. Reports what it refused rather than a
 * bare count: a field where three of ten pens would not move is a thing
 * somebody has to be told, and "moved" would read as ten.
 */
export async function moveLotsToZoneAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotIds: z.array(z.string().uuid()).min(1).max(200),
      zoneId: z.string().uuid(),
      startedOn: requiredDate,
      structureAssetId: z.string().uuid().nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const result = await withTenant(
      ctx.tenant.id,
      (tx) => moveLotsToZone(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.lots.moved",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotIds[0],
      meta: {
        zoneId: parsed.data.zoneId,
        asked: String(parsed.data.livestockLotIds.length),
        moved: String(result.moved.length),
        refused: String(result.refused.length),
      },
    });
    revalidatePath(BASE, "layout");
    return {
      ok: true as const,
      moved: result.moved.length,
      refused: result.refused.length,
    };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * **THE CAPITAL TRANSFER.** Both directions gate on `assets` as well as this
 * pack, because a capital asset needs an asset register to live in — and
 * `livestock` deliberately does not `require` assets, so most of the pack works
 * without it and this one slice says so out loud instead.
 */
async function capitalGate() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  await requireModuleEnabled(ctx.tenant.id, "assets");
  return ctx;
}

export async function transferToBreedingAction(input: unknown) {
  const ctx = await capitalGate();
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      occurredOn: requiredDate,
      assetAccountId: z.string().uuid().nullable().optional(),
      assetKind: z.string().min(1).max(63).optional(),
      depreciationMethod: z.enum(["none", "straight_line"]).optional(),
      usefulLifeMonths: z.number().int().positive().max(1200).nullable().optional(),
      salvageValueCents: z.number().int().min(0).nullable().optional(),
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const transfer = await withTenant(
      ctx.tenant.id,
      (tx) => transferToBreeding(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.capital.to_breeding",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      // Identifiers and the amount — the figure IS the point of the event, and
      // it is a book value rather than anything private.
      meta: {
        amountCents: String(transfer.amountCents),
        assetId: transfer.assetId ?? "",
        journalEntryId: transfer.journalEntryId ?? "",
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true as const, amountCents: transfer.amountCents };
  } catch (err) {
    return toResult(err);
  }
}

export async function returnToMarketAction(input: unknown) {
  const ctx = await capitalGate();
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      occurredOn: requiredDate,
      notes: z.string().max(5000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const transfer = await withTenant(
      ctx.tenant.id,
      (tx) => returnToMarket(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.capital.to_market",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      meta: {
        amountCents: String(transfer.amountCents),
        assetId: transfer.assetId ?? "",
        journalEntryId: transfer.journalEntryId ?? "",
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true as const, amountCents: transfer.amountCents };
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
      async (tx) => {
        const primary = await moveLotToZone(tx, ctxOf(ctx), parsed.data);
        // **SLICE 8D: THE CONTENTS COME TOO.** A lot moves as one thing — that
        // is what made a herd worth having, and once animals live inside a lot
        // (8b) the same walk gives lots the same power. Moving the field
        // without the three pens inside it would leave them standing on ground
        // the field has left, which is exactly the half-done move the hub
        // already warns about.
        //
        // The lot itself goes FIRST and through the single path, so the
        // `movedOff` answer the toast needs is the primary lot's — a bulk call
        // would return counts and lose which paddock just started resting.
        //
        // Only the MEMBERS go through the bulk path. Passing the lot itself
        // would move it twice on one day, and `moveOccupant` would end the stay
        // it had just opened.
        const inside = await lotMembers(
          tx,
          ctx.tenant.id,
          parsed.data.livestockLotId,
          parsed.data.startedOn,
        );
        const rest = inside.length
          ? await moveLotsToZone(tx, ctxOf(ctx), {
              livestockLotIds: inside.map((m) => m.memberLotId),
              zoneId: parsed.data.zoneId,
              startedOn: parsed.data.startedOn,
              structureAssetId: parsed.data.structureAssetId ?? null,
              notes: parsed.data.notes,
            })
          : { moved: [] as string[], refused: [] };
        return { ...primary, alsoMoved: rest.moved.length };
      },
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
    return { ok: true, movedOff: result.movedOff, alsoMoved: result.alsoMoved };
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

// ------------------------------------------------------------ treatments ---

/**
 * Record a treatment, and start its withdrawal clock.
 *
 * NOT owner-gated, and of everything in this pack that is the least negotiable:
 * the person with the syringe knows what went in and when, and a treatment
 * recorded days later by somebody who was not there is how a withdrawal period
 * gets counted from the wrong date.
 *
 * **Audited with the product and both periods**, because this is the one record
 * here that decides whether meat and milk can lawfully be sold, and "who entered
 * that clock, and when" is a question somebody will eventually have to answer to
 * an inspector rather than to themselves.
 */
export async function recordTreatmentAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const days = z.number().int().min(0).max(3650);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
      treatedOn: requiredDate,
      product: z.string().trim().min(1).max(200),
      dose: z.string().max(200).optional(),
      route: z.string().min(1).max(63),
      headTreated: head.nullable().optional(),
      meatWithdrawalDays: days.nullable().optional(),
      milkWithdrawalDays: days.nullable().optional(),
      withdrawalSource: z.enum(["label", "vet", "none_stated"]).optional(),
      administeredBy: z.string().max(200).optional(),
      notes: z.string().max(2000).optional(),
      fromStock: z
        .object({
          itemId: z.string().uuid(),
          quantity: z.number().positive().max(1_000_000).multipleOf(0.0001),
          lotId: z.string().uuid().nullable().optional(),
        })
        .nullable()
        .optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const treatment = await withTenant(
      ctx.tenant.id,
      (tx) => recordTreatment(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.treatment.recorded",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
      // The product and the clocks, never the notes — those are free text about
      // an animal and belong only in the row.
      meta: {
        treatedOn: treatment.treatedOn,
        product: treatment.product,
        route: treatment.route,
        meatWithdrawalDays: treatment.meatWithdrawalDays,
        milkWithdrawalDays: treatment.milkWithdrawalDays,
        withdrawalSource: treatment.withdrawalSource,
      },
    });
    revalidatePath(BASE, "layout");
    // A treatment out of stock moves the ledger too.
    if (parsed.data.fromStock) {
      revalidatePath("/dashboard/m/inventory", "layout");
    }
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Correct a treatment.
 *
 * Same level as recording one, because it is the same act done twice — and
 * because the person who typed 10 where the label said 21 is the person holding
 * the bottle.
 *
 * **THE AUDIT ENTRY MATTERS MORE HERE THAN ANYWHERE ELSE IN THE APP.** A
 * withdrawal clock is a legal record: "who changed that date, from what, and
 * when" is a question that may one day be asked by an inspector rather than by
 * the person who changed it. Both clocks and the source travel, before and
 * after.
 */
export async function updateTreatmentAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const days = z.number().int().min(0).max(3650);
  const parsed = z
    .object({
      id: z.string().uuid(),
      treatedOn: requiredDate.optional(),
      product: z.string().trim().min(1).max(200).optional(),
      dose: z.string().max(200).optional(),
      route: z.string().min(1).max(63).optional(),
      headTreated: head.nullable().optional(),
      meatWithdrawalDays: days.nullable().optional(),
      milkWithdrawalDays: days.nullable().optional(),
      withdrawalSource: z.enum(["label", "vet", "none_stated"]).optional(),
      administeredBy: z.string().max(200).optional(),
      notes: z.string().max(2000).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  const { id, ...patch } = parsed.data;
  try {
    const { before, after } = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        const before = await tx.query.livestockTreatments.findFirst({
          where: and(
            eq(schema.livestockTreatments.tenantId, ctx.tenant.id),
            eq(schema.livestockTreatments.id, id),
          ),
        });
        const after = await updateTreatment(tx, ctxOf(ctx), id, patch);
        return { before, after };
      },
      { role: ctx.role },
    );
    const clocks = (t: typeof after) => ({
      treatedOn: t.treatedOn,
      product: t.product,
      route: t.route,
      meatWithdrawalDays: t.meatWithdrawalDays,
      milkWithdrawalDays: t.milkWithdrawalDays,
      withdrawalSource: t.withdrawalSource,
    });
    await logAudit({
      action: "livestock.treatment.corrected",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_treatment",
      targetId: id,
      // Clocks and identifiers, never the notes.
      meta: { was: before ? clocks(before) : null, now: clocks(after) },
    });
    revalidatePath(BASE, "layout");
    return { ok: true };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * Remove a treatment entered by mistake.
 *
 * **The stock issue is deliberately left standing** — the medicine really did
 * leave the shelf, and that is `inventory`'s event to correct with an
 * adjustment. The result says whether there was one, so the screen can tell
 * somebody rather than letting them find out from a cost they cannot explain.
 */
export async function deleteTreatmentAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const removed = await withTenant(
      ctx.tenant.id,
      (tx) => deleteTreatment(tx, ctxOf(ctx), parsed.data.id),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.treatment.removed",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: removed.livestockLotId,
      meta: {
        treatedOn: removed.treatedOn,
        product: removed.product,
        meatWithdrawalDays: removed.meatWithdrawalDays,
        milkWithdrawalDays: removed.milkWithdrawalDays,
        withdrawalSource: removed.withdrawalSource,
        // Recorded because the movement OUTLIVES the treatment, and this is the
        // only place that fact is written down.
        keptMovementId: removed.inventoryMovementId,
      },
    });
    revalidatePath(BASE, "layout");
    return { ok: true, keptStockIssue: removed.inventoryMovementId !== null };
  } catch (err) {
    return toResult(err);
  }
}

/**
 * What this farm entered last time for the same product.
 *
 * **The only "default" the app offers anywhere**, and it is the farm's own
 * record rather than the app's claim — the design forbids presenting a
 * withdrawal number as authoritative, and a figure somebody here typed off a
 * label three weeks ago is not the app asserting anything.
 *
 * A read, so no audit entry. It returns nothing at all when this farm has never
 * recorded that product, which is the ordinary case and must stay silent rather
 * than suggesting a zero.
 */
export async function lastTreatmentOfProductAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({ product: z.string().trim().min(1).max(200) })
    .safeParse(input);
  if (!parsed.success) return { error: "Check the details and try again." };

  try {
    const previous = await withTenant(
      ctx.tenant.id,
      (tx) => lastTreatmentOfProduct(tx, ctx.tenant.id, parsed.data.product),
      { role: ctx.role },
    );
    return {
      ok: true,
      previous: previous
        ? {
            treatedOn: previous.treatedOn,
            dose: previous.dose,
            route: previous.route,
            meatWithdrawalDays: previous.meatWithdrawalDays,
            milkWithdrawalDays: previous.milkWithdrawalDays,
            withdrawalSource: previous.withdrawalSource,
          }
        : null,
    };
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
 * **FEED ONE ANIMAL BY NAME** — slice 8f, the other half of the founder's rule.
 *
 * Mirrors `recordFeedDrawAction` exactly except for the target: a lot instead
 * of a feeder, which is what makes the cost measured rather than allocated.
 */
export async function recordDirectFeedAction(input: unknown) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = z
    .object({
      livestockLotId: z.string().uuid(),
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
      (tx) => recordDirectFeed(tx, ctxOf(ctx), parsed.data),
      { role: ctx.role },
    );
    await logAudit({
      action: "livestock.feed.issued",
      tenantId: ctx.tenant.id,
      actorClerkUserId: ctx.userId,
      targetType: "livestock_lot",
      targetId: parsed.data.livestockLotId,
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
