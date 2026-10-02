import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { knownTags, loadRecipe, recipePhotoUrl, recipeToInput } from "@/modules/food/recipe-ops";
import { RecipeEditor } from "@/modules/food/components/recipe-editor";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Edit a saved recipe (docs/help/food/editor.md). */
export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const [row, tags] = await withTenant(
    ctx.tenant.id,
    (tx) => Promise.all([loadRecipe(tx, ctx.tenant.id, id), knownTags(tx, ctx.tenant.id)]),
    { role: ctx.role },
  );
  if (!row) notFound();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Edit the recipe" description={row.title} />
      <RecipeEditor
        initial={recipeToInput(row)}
        mode={{
          kind: "edit",
          recipeId: row.id,
          photoUrl: row.photoPathname ? recipePhotoUrl(row.id, row.photoPathname) : null,
        }}
        tags={tags}
      />
    </div>
  );
}
