import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Pencil } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { hostOf, minutesWords, timeOf } from "@/modules/food/core/recipe";
import { loadRecipe, recipePhotoUrl, recipeToInput } from "@/modules/food/recipe-ops";
import { DeleteRecipeButton } from "@/modules/food/components/delete-recipe-button";
import { RecipeView } from "@/modules/food/components/recipe-view";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A saved recipe, to cook from (docs/help/food/recipe.md). */
export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const row = await withTenant(ctx.tenant.id, (tx) => loadRecipe(tx, ctx.tenant.id, id), { role: ctx.role });
  if (!row) notFound();

  const recipe = recipeToInput(row);
  const host = hostOf(recipe.sourceUrl);
  const total = timeOf(recipe);
  const times = [
    total !== null ? minutesWords(total) : null,
    recipe.prepMinutes !== null ? `Prep ${minutesWords(recipe.prepMinutes)}` : null,
    recipe.cookMinutes !== null ? `Cook ${minutesWords(recipe.cookMinutes)}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title={recipe.title}
        description={times.length > 0 ? times.join(" · ") : undefined}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/personal/m/food/recipes/${row.id}/edit`}>
                <Pencil aria-hidden /> Edit
              </Link>
            </Button>
            <DeleteRecipeButton recipeId={row.id} title={recipe.title} />
          </div>
        }
      />
      {(host || recipe.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {host && recipe.sourceUrl && (
            <a
              href={recipe.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:underline"
            >
              From {host} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          {recipe.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      )}
      <RecipeView
        recipe={recipe}
        photo={
          row.photoPathname && row.photoWidth && row.photoHeight
            ? { url: recipePhotoUrl(row.id, row.photoPathname), width: row.photoWidth, height: row.photoHeight }
            : null
        }
      />
    </div>
  );
}
