import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { AddRecipe } from "@/modules/food/components/add-recipe";

export const dynamic = "force-dynamic";
/** Claude reads a page's words, a paste or photos in about a minute; its actions run here. */
export const maxDuration = 300;

/** Add a recipe (docs/help/food/add.md): from a link, pasted text, photos of a page, or typed in. */
export default async function AddRecipePage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader title="Add a recipe" description="You check what is read before anything is saved." />
      <AddRecipe />
    </div>
  );
}
