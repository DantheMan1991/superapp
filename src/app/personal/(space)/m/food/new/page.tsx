import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { emptyRecipe } from "@/modules/food/core/recipe";
import { knownTags } from "@/modules/food/recipe-ops";
import { RecipeEditor } from "@/modules/food/components/recipe-editor";

export const dynamic = "force-dynamic";

/** Type a recipe in (docs/help/food/editor.md): the editor, started empty. */
export default async function NewRecipePage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const tags = await withTenant(ctx.tenant.id, (tx) => knownTags(tx, ctx.tenant.id), { role: ctx.role });
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Type a recipe in" description="The name, what it makes, the ingredients and the steps." />
      <RecipeEditor initial={emptyRecipe()} mode={{ kind: "new" }} tags={tags} />
    </div>
  );
}
