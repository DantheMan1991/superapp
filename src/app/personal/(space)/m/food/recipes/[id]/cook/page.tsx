import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { loadRecipe } from "@/modules/food/recipe-ops";
import { CookMode } from "@/modules/food/components/cook-mode";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The servings chosen on the recipe page, carried in the link; nothing else is trusted from it. */
function servingsOf(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 && n <= 999 ? n : null;
}

/** Cook mode (docs/help/food/cook.md, D1b): a recipe one step at a time, with the screen on. */
export default async function CookPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const row = await withTenant(ctx.tenant.id, (tx) => loadRecipe(tx, ctx.tenant.id, id), { role: ctx.role });
  if (!row) notFound();
  const search = await searchParams;
  return (
    <CookMode
      recipeId={row.id}
      title={row.title}
      yieldAmount={row.yieldAmount}
      yieldUnit={row.yieldUnit}
      ingredients={row.ingredients}
      steps={row.steps}
      urlServings={row.yieldAmount ? servingsOf(search.servings) : null}
      today={todayInTimezone(ctx.tenant.timezone)}
    />
  );
}
