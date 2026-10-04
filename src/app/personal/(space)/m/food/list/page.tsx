import { UtensilsCrossed } from "lucide-react";
import { withTenant } from "@/db";
import { PageHeader } from "@/components/app/page-header";
import { requirePersonalSpace } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { todayInTimezone } from "@/lib/timezone";
import { listLines } from "@/modules/food/core/list";
import { plannable } from "@/modules/food/core/week";
import { alwaysHave, lineNames, shoppingPlan } from "@/modules/food/list-ops";
import { FoodNav } from "@/modules/food/components/food-nav";
import { ShoppingList } from "@/modules/food/components/shopping-list";

export const dynamic = "force-dynamic";
/** Lines not named yet are named by Claude from this page, in up to half a minute. */
export const maxDuration = 60;

/**
 * THE SHOPPING LIST (D3, docs/help/food/list.md, ADR 0130): this week's and
 * next week's plan, what each line buys and what the person always has; the
 * list for the days they choose is worked out on the phone, where its ticks
 * are kept. A personal tool: this only renders inside a personal space.
 */
export default async function FoodListPage() {
  const ctx = await requirePersonalSpace();
  await requireModuleEnabled(ctx.tenant.id, "food");
  const today = todayInTimezone(ctx.tenant.timezone);
  const reach = plannable(today);

  const { plan, names, always } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const plan = await shoppingPlan(tx, ctx.tenant.id, reach.from, reach.to);
      return {
        plan,
        names: await lineNames(tx, ctx.tenant.id, listLines(plan.cooks, plan.foods)),
        always: await alwaysHave(tx, ctx.tenant.id),
      };
    },
    { role: ctx.role },
  );
  const unnamed = listLines(plan.cooks, plan.foods).filter((line) => !(line in names)).length;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <PageHeader title="Food" description="What you ate, the week ahead, and your recipes." icon={<UtensilsCrossed />} />
      <FoodNav />
      <ShoppingList
        tenantId={ctx.tenant.id}
        today={today}
        cooks={plan.cooks}
        foods={plan.foods}
        names={names}
        always={always}
        unnamed={unnamed}
      />
    </div>
  );
}
