"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { RECIPE_PHOTO_BASE64_LIMIT, linkRequestSchema, photosRequestSchema, textRequestSchema } from "./core/draft";
import { FoodError, foodMessage } from "./core/errors";
import { recipeInputSchema } from "./core/recipe";
import { discardImport, readLink, readPhotos, readText, takeImport, type ReadResult } from "./import-ops";
import { discardPhoto, storeRecipePhoto, type StoredPhoto } from "./photo-ops";
import { logCook, undoCook } from "./cook-ops";
import { FOOD_HOME, FOOD_RECIPES, FOOD_WEEK, deleteRecipe, insertRecipe, recipeHref, updateRecipe } from "./recipe-ops";
import {
  changeEatenSchema,
  logFoodSchema,
  logPlateSchema,
  logRecipeSchema,
  targetsSchema,
} from "./core/eating";
import { plateRequestSchema } from "./core/plate";
import { changeEaten, deleteEaten, logFood, logPlate, logRecipe, setTargets } from "./eating-ops";
import { readPlate, type PlateDraftItem } from "./plate-ops";
import {
  addLeftoversSchema,
  ateItSchema,
  changePlanSchema,
  movePlanSchema,
  planCookSchema,
  planFoodSchema,
  repeatWeekSchema,
} from "./core/week";
import { addLeftovers, ateIt, changePlan, movePlan, planCook, planFood, removePlan, repeatWeek } from "./plan-ops";

/**
 * FOOD'S SERVER ACTIONS. Each one: the personal space's own door
 * (`requirePersonalSpace`: a business never reaches here), the module gate,
 * then zod on the input. Each returns `{ ok }` or `{ error }` with a sentence;
 * an exception's own text never reaches the screen.
 */

type Outcome<T extends object = object> = ({ ok: true } & T) | { error: string };

async function gate() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  return ctx;
}

function failure(err: unknown, fallback: string): { error: string } {
  if (err instanceof FoodError) return { error: foodMessage(err) };
  console.error("food action failed", err);
  return { error: fallback };
}

/**
 * The Food pages an action can change. Today is Food's front page since D4a
 * and the recipes moved to their own; D2 added the week, which a recipe's
 * change, a log and a plan all show. An action re-renders the page it was
 * called from only when that page is named here.
 */
function refreshFood() {
  revalidatePath(FOOD_HOME);
  revalidatePath(FOOD_RECIPES);
  revalidatePath(FOOD_WEEK);
}

function readOutcome(result: ReadResult): Outcome<{ importId: string }> & { importId?: string } {
  refreshFood();
  return "error" in result ? result : { ok: true, importId: result.importId };
}

/**
 * Read a recipe from a link. A page with its own recipe data takes a second or
 * two; one Claude reads takes up to a minute, so the Add page sets
 * `maxDuration` for it.
 */
export async function readLinkAction(input: unknown) {
  try {
    const ctx = await gate();
    const parsed = linkRequestSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("BAD_LINK")) };
    return readOutcome(await readLink(ctx, parsed.data.url));
  } catch (err) {
    return failure(err, "The recipe could not be read this time. Try again, or type it in.");
  }
}

export async function readTextAction(input: unknown) {
  try {
    const ctx = await gate();
    const parsed = textRequestSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("PASTE_TOO_LONG")) };
    return readOutcome(await readText(ctx, parsed.data.text));
  } catch (err) {
    return failure(err, "The recipe could not be read this time. Try again, or type it in.");
  }
}

export async function readPhotosAction(input: unknown) {
  try {
    const ctx = await gate();
    const parsed = photosRequestSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("PICTURES")) };
    return readOutcome(await readPhotos(ctx, parsed.data.pictures));
  } catch (err) {
    return failure(err, "The recipe could not be read this time. Try again, or type it in.");
  }
}

const saveInput = z.object({
  recipeId: z.string().uuid().nullable(),
  importId: z.string().uuid().nullable(),
  recipe: z.unknown(),
  /**
   * `keep`: the recipe's photo, or the draft's; `none`: no photo; `new`: a
   * photo the phone made smaller, as base64.
   */
  photo: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("keep") }),
    z.object({ kind: z.literal("none") }),
    z.object({
      kind: z.literal("new"),
      jpeg: z
        .string()
        .min(100)
        .max(RECIPE_PHOTO_BASE64_LIMIT)
        .regex(/^[A-Za-z0-9+/]+=*$/),
    }),
  ]),
});

/**
 * Save a recipe: a new one, typed in or from a draft, or an edit. A new photo
 * is prepared and stored before the row is written, and deleted again if the
 * row is not; a photo it replaces is deleted once the row has changed.
 */
export async function saveRecipeAction(input: unknown): Promise<Outcome<{ recipeId: string }>> {
  let stored: StoredPhoto | null = null;
  try {
    const ctx = await gate();
    const parsed = saveInput.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    const recipe = recipeInputSchema.safeParse(parsed.data.recipe);
    if (!recipe.success) return { error: foodMessage(new FoodError("INVALID")) };
    const { recipeId, importId, photo } = parsed.data;

    if (photo.kind === "new") {
      stored = await storeRecipePhoto(ctx.tenant.id, new Uint8Array(Buffer.from(photo.jpeg, "base64")));
    }
    const choice: "keep" | StoredPhoto | null = photo.kind === "new" ? stored : photo.kind === "keep" ? "keep" : null;

    const { id, letGo } = await withTenant(
      ctx.tenant.id,
      async (tx) => {
        if (recipeId) {
          const { replaced } = await updateRecipe(tx, ctx.tenant.id, recipeId, recipe.data, choice);
          return { id: recipeId, letGo: [replaced] };
        }
        let fromDraft: StoredPhoto | null = null;
        if (importId) fromDraft = (await takeImport(tx, ctx.tenant.id, importId)).photo;
        const kept = choice === "keep" ? fromDraft : choice;
        const id = await insertRecipe(tx, ctx, recipe.data, kept);
        return { id, letGo: [kept === fromDraft ? null : (fromDraft?.pathname ?? null)] };
      },
      { role: ctx.role },
    );
    stored = null;
    for (const pathname of letGo) await discardPhoto(pathname);
    refreshFood();
    return { ok: true, recipeId: id };
  } catch (err) {
    // No row vouches for it: the new photo goes too.
    await discardPhoto(stored?.pathname);
    return failure(err, "The recipe could not be saved. Try again.");
  }
}

const recipeIdInput = z.object({ recipeId: z.string().uuid() });

export async function deleteRecipeAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = recipeIdInput.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("RECIPE_MISSING")) };
    const photo = await withTenant(ctx.tenant.id, (tx) => deleteRecipe(tx, ctx.tenant.id, parsed.data.recipeId), {
      role: ctx.role,
    });
    await discardPhoto(photo);
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "The recipe could not be deleted. Try again.");
  }
}

const importIdInput = z.object({ importId: z.string().uuid() });

export async function discardImportAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = importIdInput.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("IMPORT_MISSING")) };
    const photo = await withTenant(ctx.tenant.id, (tx) => discardImport(tx, ctx.tenant.id, parsed.data.importId), {
      role: ctx.role,
    });
    await discardPhoto(photo);
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "The draft could not be discarded. Try again.");
  }
}

const logCookInput = z.object({
  cookId: z.string().uuid(),
  recipeId: z.string().uuid(),
  servings: z.number().positive().max(100_000).nullable(),
});

/**
 * "Log that you made it" (D1b): the end of cook mode. The id is the phone's,
 * made when cook mode opened, so a second press or a resend is one log.
 */
export async function logCookAction(input: unknown): Promise<Outcome<{ madeOn: string }>> {
  try {
    const ctx = await gate();
    const parsed = logCookInput.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    const { madeOn } = await withTenant(ctx.tenant.id, (tx) => logCook(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    revalidatePath(recipeHref(parsed.data.recipeId));
    return { ok: true, madeOn };
  } catch (err) {
    return failure(err, "It could not be logged. Try again.");
  }
}

const undoCookInput = z.object({ cookId: z.string().uuid(), recipeId: z.string().uuid() });

export async function undoCookAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = undoCookInput.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => undoCook(tx, ctx.tenant.id, parsed.data.cookId), { role: ctx.role });
    refreshFood();
    revalidatePath(recipeHref(parsed.data.recipeId));
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be undone. Try again.");
  }
}

/* -- what was eaten (D4a) ------------------------------------------------- */

/** Log a food from the list. Its id is the phone's: an Add sent twice is one row. */
export async function logFoodAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = logFoodSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => logFood(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be logged. Try again.");
  }
}

/** Log a saved recipe by servings. */
export async function logRecipeAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = logRecipeSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => logRecipe(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be logged. Try again.");
  }
}

/**
 * Read a photo of the plate (D4a): Claude names the foods and their grams,
 * each is matched on the food list, and the draft comes back to be checked.
 * Nothing is written, and the photo is kept nowhere. A read takes up to half
 * a minute; the Log food page sets `maxDuration` for it.
 */
export async function readPlateAction(input: unknown): Promise<Outcome<{ items: PlateDraftItem[] }>> {
  try {
    const ctx = await gate();
    const parsed = plateRequestSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("PHOTO")) };
    return { ok: true, items: await readPlate(ctx, parsed.data.jpeg) };
  } catch (err) {
    return failure(err, "The photo could not be read this time. Try again, or search for the foods.");
  }
}

/** Log a plate the person checked: all its items, or none. */
export async function logPlateAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = logPlateSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => logPlate(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be logged. Try again.");
  }
}

/** Change how much, or which meal. */
export async function changeEatenAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = changeEatenSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => changeEaten(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be changed. Try again.");
  }
}

const eatenIdInput = z.object({ id: z.string().uuid() });

export async function deleteEatenAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = eatenIdInput.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => deleteEaten(tx, ctx.tenant.id, parsed.data.id), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be removed. Try again.");
  }
}

/* -- the week (D2) ---------------------------------------------------------- */

/** Put a recipe on the week: cooked at a meal, what is eaten there, and its leftovers on later meals. */
export async function planCookAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = planCookSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => planCook(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be put on the week. Try again.");
  }
}

/** Put a food from the list on the week. */
export async function planFoodAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = planFoodSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => planFood(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be put on the week. Try again.");
  }
}

/** More leftovers of a cook already on the week. */
export async function addLeftoversAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = addLeftoversSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => addLeftovers(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "The leftovers could not be put on the week. Try again.");
  }
}

export async function movePlanAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = movePlanSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => movePlan(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be moved. Try again.");
  }
}

export async function changePlanAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = changePlanSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => changePlan(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be changed. Try again.");
  }
}

const planIdInput = z.object({ id: z.string().uuid() });

/** Take a planned meal off the week; a cook takes its leftovers. */
export async function removePlanAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = planIdInput.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => removePlan(tx, ctx.tenant.id, parsed.data.id), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be taken off the week. Try again.");
  }
}

/** "Ate it" on Today: a planned meal logged as it was planned. */
export async function ateItAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = ateItSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => ateIt(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "It could not be logged. Try again.");
  }
}

/** Repeat a past week on this week or the next. */
export async function repeatWeekAction(input: unknown): Promise<Outcome<{ added: number }>> {
  try {
    const ctx = await gate();
    const parsed = repeatWeekSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("PLAN_WEEK")) };
    const added = await withTenant(ctx.tenant.id, (tx) => repeatWeek(tx, ctx, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true, added };
  } catch (err) {
    return failure(err, "The week could not be repeated. Try again.");
  }
}

/** The daily targets for calories and protein; either may be cleared. */
export async function setTargetsAction(input: unknown): Promise<Outcome> {
  try {
    const ctx = await gate();
    const parsed = targetsSchema.safeParse(input);
    if (!parsed.success) return { error: foodMessage(new FoodError("INVALID")) };
    await withTenant(ctx.tenant.id, (tx) => setTargets(tx, ctx.tenant.id, parsed.data), { role: ctx.role });
    refreshFood();
    return { ok: true };
  } catch (err) {
    return failure(err, "The targets could not be saved. Try again.");
  }
}
