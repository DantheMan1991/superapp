import Link from "next/link";
import { Camera, ChefHat, ClipboardList, Link2, Loader2, Plus, TriangleAlert } from "lucide-react";
import { withTenant } from "@/db";
import { HelpButton } from "@/components/app/help-button";
import { requirePersonalSpace } from "@/lib/auth";
import { describeAgo } from "@/lib/last-seen";
import { requireModuleEnabled } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { todayInTimezone } from "@/lib/timezone";
import { hostOf } from "@/modules/food/core/recipe";
import { importDraft, listImports } from "@/modules/food/import-ops";
import { listInput } from "@/modules/food/list-ops";
import { FOOD_HOME, listRecipes } from "@/modules/food/recipe-ops";
import { DiscardDraftButton } from "@/modules/food/components/discard-draft-button";
import { FoodHeader } from "@/modules/food/components/food-header";
import { FoodNav } from "@/modules/food/components/food-nav";
import { FoodPage } from "@/modules/food/components/food-page";
import { FOOD_CARD, FOOD_PRIMARY, FOOD_SIZE, FOOD_SOFT } from "@/modules/food/components/food-styles";
import { RecipeList } from "@/modules/food/components/recipe-list";

export const dynamic = "force-dynamic";

/**
 * YOUR RECIPES (docs/help/food/recipes.md; in the "Fresh Market" skin, ADR
 * 0132): any draft still waiting (being read, ready to check, or failed),
 * then the recipes as photo cards with a search box and their tags (his call,
 * 2026-10-07). Food's front page until D4a made Today the front; the same
 * page, one tab over.
 */
export default async function RecipesPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const now = new Date();
  const today = todayInTimezone(ctx.tenant.timezone);
  const [recipes, imports, list] = await withTenant(
    ctx.tenant.id,
    async (tx) => [await listRecipes(tx, ctx.tenant.id), await listImports(tx, ctx.tenant.id), await listInput(tx, ctx.tenant.id, today)] as const,
    { role: ctx.role },
  );

  const sub = [
    recipes.length === 0 ? "No recipes yet" : `${recipes.length} ${recipes.length === 1 ? "recipe" : "recipes"}`,
    imports.length > 0 ? `${imports.length} on ${imports.length === 1 ? "its" : "their"} way in` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <FoodPage className="max-w-6xl space-y-5 @2xl:space-y-6">
      <FoodHeader
        title="Recipes"
        sub={sub}
        actions={
          <>
            <HelpButton />
            <Link href={`${FOOD_HOME}/add`} className={cn(FOOD_PRIMARY, FOOD_SIZE.sm, "@2xl:h-11 @2xl:px-4 @2xl:text-[15px]")}>
              <Plus className="size-4" aria-hidden />
              <span className="@2xl:hidden">Add</span>
              <span className="hidden @2xl:inline">Add a recipe</span>
            </Link>
          </>
        }
      />
      <FoodNav list={{ tenantId: ctx.tenant.id, today, ...list }} />

      {imports.length > 0 && (
        <section aria-label="Drafts" className={cn(FOOD_CARD, "px-4 py-3.5")}>
          <h2 className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Drafts</h2>
          <ul className="divide-y divide-divider">
            {imports.map((row) => {
              const Icon = row.kind === "link" ? Link2 : row.kind === "photo" ? Camera : ClipboardList;
              const title =
                (row.status === "draft" ? importDraft(row)?.title : null) ||
                (row.kind === "link" ? hostOf(row.sourceUrl) : row.kind === "photo" ? "Photos of a page" : "Pasted text");
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-food-tint text-food-accent-ink" aria-hidden>
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{title}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.status === "reading" && (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading, started {describeAgo(row.createdAt, now)}
                        </span>
                      )}
                      {row.status === "draft" && "Ready to check"}
                      {row.status === "failed" && (
                        <span className="inline-flex items-start gap-1 text-destructive">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          {row.error ?? "The recipe could not be read."}
                        </span>
                      )}
                    </div>
                  </div>
                  {row.status === "draft" && (
                    <Link href={`${FOOD_HOME}/drafts/${row.id}`} className={cn(FOOD_PRIMARY, FOOD_SIZE.sm)}>
                      Check it
                    </Link>
                  )}
                  {row.status !== "reading" && (
                    <DiscardDraftButton importId={row.id} variant="outline" size="sm" className={cn(FOOD_SOFT, FOOD_SIZE.sm, "border-0 shadow-none")} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {recipes.length === 0 ? (
        imports.length === 0 && (
          <section className={cn(FOOD_CARD, "flex flex-col items-center gap-3 px-6 py-10 text-center")}>
            <span className="flex size-14 items-center justify-center rounded-2xl bg-food-tint text-food-accent-ink" aria-hidden>
              <ChefHat className="size-7" />
            </span>
            <h2 className="font-food-display text-xl font-bold tracking-[-0.02em]">No recipes yet</h2>
            <p className="text-center text-sm text-muted-foreground">
              Add one from a link, a photo of a cookbook page, text you pasted, or type it in. You check it before it is saved.
            </p>
            <Link href={`${FOOD_HOME}/add`} className={cn(FOOD_PRIMARY, FOOD_SIZE.md)}>
              <Plus className="size-4" aria-hidden /> Add a recipe
            </Link>
          </section>
        )
      ) : (
        <RecipeList recipes={recipes} />
      )}
    </FoodPage>
  );
}
