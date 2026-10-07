import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, ExternalLink, Pencil } from "lucide-react";
import { withTenant } from "@/db";
import { HelpButton } from "@/components/app/help-button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { madeWords } from "@/modules/food/core/cook";
import { hostOf, minutesWords, timeOf, yieldWords } from "@/modules/food/core/recipe";
import { cookSummary } from "@/modules/food/cook-ops";
import { perServingOf, workedStillFits } from "@/modules/food/core/nutrition";
import { FOOD_RECIPES, loadRecipe, recipeHref, recipePhotoUrl, recipeToInput } from "@/modules/food/recipe-ops";
import { DeleteRecipeButton } from "@/modules/food/components/delete-recipe-button";
import { FoodPage } from "@/modules/food/components/food-page";
import { FOOD_ROUND } from "@/modules/food/components/food-styles";
import { recipeTone } from "@/modules/food/components/food-thumb";
import { RecipeView } from "@/modules/food/components/recipe-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A saved recipe, to cook from (docs/help/food/recipe.md; in the "Fresh
 * Market" skin, ADR 0132): back to the recipes, help, Edit and Delete along
 * the top; the title, its times and what it makes as pills, and when it was
 * made, where it came from and its tags on a line under them; the rest is
 * `RecipeView`.
 */
export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const [row, made] = await withTenant(
    ctx.tenant.id,
    (tx) => Promise.all([loadRecipe(tx, ctx.tenant.id, id), cookSummary(tx, ctx.tenant.id, id)]),
    { role: ctx.role },
  );
  if (!row) notFound();
  const madeLine = madeWords(made.count, made.lastOn, todayInTimezone(ctx.tenant.timezone));

  const recipe = recipeToInput(row);
  const host = hostOf(recipe.sourceUrl);
  const total = timeOf(recipe);
  const pills = [
    recipe.prepMinutes !== null ? `Prep ${minutesWords(recipe.prepMinutes)}` : null,
    recipe.cookMinutes !== null ? `Cook ${minutesWords(recipe.cookMinutes)}` : null,
    recipe.yieldAmount !== null ? `Makes ${yieldWords(recipe.yieldAmount, recipe.yieldUnit)}` : null,
  ].filter((pill) => pill !== null);
  // One line under the pills: "Made 3 times, last on Sep 30 · From seriouseats.com · Dinner, Batch".
  const facts = [
    madeLine ? <span key="made">{madeLine.replace(/\.$/, "")}</span> : null,
    host && recipe.sourceUrl ? (
      <a
        key="from"
        href={recipe.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-semibold text-foreground underline-offset-2 hover:underline"
      >
        <span className="font-normal text-muted-foreground">From</span> {host} <ExternalLink className="size-3" aria-hidden />
      </a>
    ) : null,
    recipe.tags.length > 0 ? <span key="tags">{recipe.tags.join(", ")}</span> : null,
  ].filter((fact) => fact !== null);
  const pill = "inline-flex h-[30px] items-center gap-1.5 rounded-full bg-food-soft px-3 text-[13px] font-medium";

  return (
    <FoodPage className="max-w-6xl space-y-4 @2xl:space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={FOOD_RECIPES}
          className="-ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg px-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Recipes
        </Link>
        <div className="flex items-center gap-1.5">
          <HelpButton />
          <Link href={`${recipeHref(row.id)}/edit`} aria-label="Edit" title="Edit" className={FOOD_ROUND}>
            <Pencil className="size-4" aria-hidden />
          </Link>
          <DeleteRecipeButton recipeId={row.id} title={recipe.title} />
        </div>
      </div>
      <RecipeView
        recipeId={row.id}
        recipe={recipe}
        tone={recipeTone(row.id)}
        intro={
          <div>
            <h1 className="font-food-display text-[30px] leading-[1.1] font-bold tracking-[-0.02em] @3xl:text-[40px] @3xl:leading-[1.05] @3xl:tracking-[-0.03em]">
              {recipe.title}
            </h1>
            {(total !== null || pills.length > 0) && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {total !== null && (
                  <li className={pill}>
                    <Clock className="size-3.5" aria-hidden />
                    <span className="sr-only">Total time</span> {minutesWords(total)}
                  </li>
                )}
                {pills.map((words) => (
                  <li key={words} className={pill}>
                    {words}
                  </li>
                ))}
              </ul>
            )}
            {facts.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {facts.map((fact, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    {fact}
                  </span>
                ))}
              </p>
            )}
          </div>
        }
        worked={
          row.workedNutrition
            ? {
                perServing: perServingOf(row.workedNutrition.whole, recipe.yieldAmount),
                fits: workedStillFits(
                  row.workedNutrition,
                  recipe.ingredients.filter((line) => !line.heading).map((line) => line.text),
                ),
              }
            : null
        }
        photo={
          row.photoPathname && row.photoWidth && row.photoHeight
            ? { url: recipePhotoUrl(row.id, row.photoPathname), width: row.photoWidth, height: row.photoHeight }
            : null
        }
      />
    </FoodPage>
  );
}
