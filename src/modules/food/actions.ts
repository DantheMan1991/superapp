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
import { FOOD_HOME, deleteRecipe, insertRecipe, updateRecipe } from "./recipe-ops";

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

function readOutcome(result: ReadResult): Outcome<{ importId: string }> & { importId?: string } {
  revalidatePath(FOOD_HOME);
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
    revalidatePath(FOOD_HOME);
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
    revalidatePath(FOOD_HOME);
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
    revalidatePath(FOOD_HOME);
    return { ok: true };
  } catch (err) {
    return failure(err, "The draft could not be discarded. Try again.");
  }
}
