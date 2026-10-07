import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { workedStillFits, type DraftLine } from "@/modules/food/core/nutrition";
import { getIngredients, pastWithoutNumbers, recipeForWork } from "@/modules/food/nutrition-ops";
import { NutritionCheck } from "@/modules/food/components/nutrition-check";

export const dynamic = "force-dynamic";
/** The lines are matched by Claude from this page, in up to half a minute. */
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * WORKING OUT A RECIPE'S NUTRITION (D4, docs/help/food/recipe-nutrition.md,
 * ADR 0131): what was saved before, when it still fits the recipe, to check
 * again; otherwise the lines are matched when the page opens, and the lines
 * the recipe still has keep what was checked for them before. From the
 * recipe's Work it out, and from "no numbers" on Today and the week.
 */
export default async function RecipeNutritionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");

  const loaded = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const recipe = await recipeForWork(tx, ctx.tenant.id, id);
      if (!recipe) return null;
      const past = await pastWithoutNumbers(tx, ctx.tenant.id, id);
      const worked = recipe.worked;
      const foods = worked ? await getIngredients(tx, worked.lines.flatMap((l) => (l.fdcId === null ? [] : [l.fdcId]))) : new Map();
      // What was checked before, line by line; Claude's estimate is the grams of a line weighed by it.
      const checked: DraftLine[] = (worked?.lines ?? []).map((l) => ({
        line: l.line,
        food: l.fdcId === null ? null : (foods.get(l.fdcId) ?? null),
        grams: l.grams,
        source: l.source,
        counted: l.counted,
        estimate: l.source === "estimate" ? l.grams : null,
      }));
      const fits = worked !== null && workedStillFits(worked, recipe.lines);
      return { recipe, past, initial: fits ? checked : null, kept: fits ? [] : checked };
    },
    { role: ctx.role },
  );
  if (!loaded) notFound();
  const { recipe, past, initial, kept } = loaded;

  return (
    <NutritionCheck
      recipeId={id}
      title={recipe.title}
      yieldAmount={recipe.yieldAmount}
      yieldUnit={recipe.yieldUnit}
      past={past}
      initial={initial}
      kept={kept}
    />
  );
}
