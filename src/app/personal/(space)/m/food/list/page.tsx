import { withTenant } from "@/db";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { listLines } from "@/modules/food/core/list";
import { listInput } from "@/modules/food/list-ops";
import { FoodPage } from "@/modules/food/components/food-page";
import { ShoppingList } from "@/modules/food/components/shopping-list";

export const dynamic = "force-dynamic";
/** Lines not named yet are named by Claude from this page, in up to half a minute. */
export const maxDuration = 60;

/**
 * THE SHOPPING LIST (D3, docs/help/food/list.md, ADR 0130; in the "Fresh
 * Market" skin, ADR 0132): this week's and next week's plan, what each line
 * buys and what the person always has; the list for the days they choose is
 * worked out on the phone, where its ticks are kept, so the header naming
 * those days is drawn there too (`ShoppingList`). The same read gives the
 * List tab its count on every Food page (`listInput`). A personal tool: this
 * only renders inside a personal space.
 */
export default async function FoodListPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const today = todayInTimezone(ctx.tenant.timezone);

  const list = await withTenant(ctx.tenant.id, (tx) => listInput(tx, ctx.tenant.id, today), { role: ctx.role });
  const unnamed = listLines(list.cooks, list.foods).filter((line) => !(line in list.names)).length;

  return (
    <FoodPage className="max-w-6xl space-y-5 @2xl:space-y-6">
      <ShoppingList
        tenantId={ctx.tenant.id}
        today={today}
        cooks={list.cooks}
        foods={list.foods}
        names={list.names}
        always={list.always}
        unnamed={unnamed}
      />
    </FoodPage>
  );
}
