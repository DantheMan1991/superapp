import Link from "next/link";
import { Camera, ClipboardList, Link2, Loader2, Plus, TriangleAlert, UtensilsCrossed } from "lucide-react";
import { withTenant } from "@/db";
import type { TenantContext } from "@/lib/auth";
import { PageHeader } from "@/components/app/page-header";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { describeAgo } from "@/lib/last-seen";
import { hostOf } from "./core/recipe";
import { importDraft, listImports } from "./import-ops";
import { FOOD_HOME, listRecipes } from "./recipe-ops";
import { DiscardDraftButton } from "./components/discard-draft-button";
import { RecipeList } from "./components/recipe-list";

/**
 * FOOD, the tool's front page (docs/help/food/overview.md): any draft still
 * waiting (being read, ready to check, or failed), then the recipes with a
 * search box and their tags. A personal tool: this only ever renders inside a
 * personal space, behind `requirePersonalSpace` and a module gate that
 * refuses it anywhere else (ADR 0111).
 */
export async function FoodModule({ ctx }: { ctx: TenantContext }) {
  const now = new Date();
  const [recipes, imports] = await withTenant(
    ctx.tenant.id,
    (tx) => Promise.all([listRecipes(tx, ctx.tenant.id), listImports(tx, ctx.tenant.id)]),
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
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Food"
        description="Your recipes in one place: from a link, a photo of a page, pasted text, or typed in."
        icon={<UtensilsCrossed />}
        actions={add}
      />

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
    </div>
  );
}
