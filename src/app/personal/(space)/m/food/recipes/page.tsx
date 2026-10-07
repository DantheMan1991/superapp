import Link from "next/link";
import { Camera, ClipboardList, Link2, Loader2, Plus, TriangleAlert, UtensilsCrossed } from "lucide-react";
import { withTenant } from "@/db";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { describeAgo } from "@/lib/last-seen";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { hostOf } from "@/modules/food/core/recipe";
import { importDraft, listImports } from "@/modules/food/import-ops";
import { listInput } from "@/modules/food/list-ops";
import { FOOD_HOME, listRecipes } from "@/modules/food/recipe-ops";
import { DiscardDraftButton } from "@/modules/food/components/discard-draft-button";
import { FoodNav } from "@/modules/food/components/food-nav";
import { FoodPage } from "@/modules/food/components/food-page";
import { RecipeList } from "@/modules/food/components/recipe-list";

export const dynamic = "force-dynamic";

/**
 * YOUR RECIPES (docs/help/food/recipes.md): any draft still waiting (being
 * read, ready to check, or failed), then the recipes with a search box and
 * their tags. Food's front page until D4a made Today the front; the same page,
 * one tab over.
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

  const add = (
    <Button asChild size="sm">
      <Link href={`${FOOD_HOME}/add`}>
        <Plus aria-hidden /> Add a recipe
      </Link>
    </Button>
  );

  return (
    <FoodPage className="max-w-3xl space-y-6">
      <PageHeader
        title="Food"
        description="Your recipes in one place: from a link, a photo of a page, pasted text, or typed in."
        icon={<UtensilsCrossed />}
        actions={add}
      />
      <FoodNav list={{ tenantId: ctx.tenant.id, today, ...list }} />

      {imports.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-heading font-medium tracking-heading">Drafts</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
            {imports.map((row) => {
              const Icon = row.kind === "link" ? Link2 : row.kind === "photo" ? Camera : ClipboardList;
              const title =
                (row.status === "draft" ? importDraft(row)?.title : null) ||
                (row.kind === "link" ? hostOf(row.sourceUrl) : row.kind === "photo" ? "Photos of a page" : "Pasted text");
              return (
                <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <Icon className="size-5 shrink-0 text-module-accent" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{title}</div>
                    <div className="text-sm text-muted-foreground">
                      {row.status === "reading" && (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading, started{" "}
                          {describeAgo(row.createdAt, now)}
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
                    <Button asChild size="sm">
                      <Link href={`${FOOD_HOME}/drafts/${row.id}`}>Check it</Link>
                    </Button>
                  )}
                  {row.status !== "reading" && <DiscardDraftButton importId={row.id} variant="outline" size="sm" />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {recipes.length === 0 ? (
        imports.length === 0 && (
          <EmptyState
            panel
            icon={<UtensilsCrossed />}
            title="No recipes yet"
            description="Add one from a link, a photo of a cookbook page, text you pasted, or type it in. You check it before it is saved."
            action={add}
          />
        )
      ) : (
        <RecipeList recipes={recipes} />
      )}
    </FoodPage>
  );
}
