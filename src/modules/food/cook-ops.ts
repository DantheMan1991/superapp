import "server-only";
import { and, count, eq, max } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { todayInTimezone } from "@/lib/timezone";
import { FoodError } from "./core/errors";

/**
 * "LOG THAT YOU MADE IT" (D1b): a row in `food_cooks` per time a recipe was
 * cooked, on the space's own day. The id is the phone's, so sending it twice
 * logs it once; undo deletes it.
 */

export interface CookSummary {
  count: number;
  lastOn: string | null;
}

export async function logCook(
  tx: Tx,
  ctx: TenantContext,
  input: { cookId: string; recipeId: string; servings: number | null },
  now: Date = new Date(),
): Promise<{ madeOn: string }> {
  const t = schema;
  // Its own small read, not recipe-ops' loadRecipe: recipe-ops reads the
  // counts from here, and the two must not import each other.
  const [recipe] = await tx
    .select({ id: t.foodRecipes.id })
    .from(t.foodRecipes)
    .where(and(eq(t.foodRecipes.tenantId, ctx.tenant.id), eq(t.foodRecipes.id, input.recipeId)))
    .limit(1);
  if (!recipe) throw new FoodError("RECIPE_MISSING");
  const madeOn = todayInTimezone(ctx.tenant.timezone, now);
  const [row] = await tx
    .insert(t.foodCooks)
    .values({
      id: input.cookId,
      tenantId: ctx.tenant.id,
      recipeId: input.recipeId,
      madeOn,
      servings: input.servings,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing({ target: t.foodCooks.id })
    .returning({ madeOn: t.foodCooks.madeOn });
  if (row) return { madeOn: row.madeOn };
  // Sent again: the first one stands, if it is this space's and this recipe's.
  const [existing] = await tx
    .select({ madeOn: t.foodCooks.madeOn, recipeId: t.foodCooks.recipeId })
    .from(t.foodCooks)
    .where(and(eq(t.foodCooks.tenantId, ctx.tenant.id), eq(t.foodCooks.id, input.cookId)))
    .limit(1);
  if (!existing || existing.recipeId !== input.recipeId) throw new FoodError("INVALID");
  return { madeOn: existing.madeOn };
}

/** Undo a log. One already gone is fine: the person wanted it gone. */
export async function undoCook(tx: Tx, tenantId: string, cookId: string): Promise<void> {
  const t = schema;
  await tx.delete(t.foodCooks).where(and(eq(t.foodCooks.tenantId, tenantId), eq(t.foodCooks.id, cookId)));
}

export async function cookSummary(tx: Tx, tenantId: string, recipeId: string): Promise<CookSummary> {
  const t = schema;
  const [row] = await tx
    .select({ count: count(), lastOn: max(t.foodCooks.madeOn) })
    .from(t.foodCooks)
    .where(and(eq(t.foodCooks.tenantId, tenantId), eq(t.foodCooks.recipeId, recipeId)));
  return { count: Number(row?.count ?? 0), lastOn: row?.lastOn ?? null };
}

/** How many times each recipe was made, for the list. */
export async function cookCounts(tx: Tx, tenantId: string): Promise<Map<string, number>> {
  const t = schema;
  const rows = await tx
    .select({ recipeId: t.foodCooks.recipeId, count: count() })
    .from(t.foodCooks)
    .where(eq(t.foodCooks.tenantId, tenantId))
    .groupBy(t.foodCooks.recipeId);
  return new Map(rows.map((row) => [row.recipeId, Number(row.count)]));
}
