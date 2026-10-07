"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, CalendarRange, ShoppingCart, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildList, defaultRange, leftToBuy, marksFor, ownFor, rangeOk, type LineName, type ListCook, type ListFood } from "../core/list";
import { useShopping } from "./list-store";

/** What the List tab counts from: the list's own inputs and the phone's ticks (`listInput` on the server). */
export interface ListBadgeInput {
  tenantId: string;
  today: string;
  cooks: ListCook[];
  foods: ListFood[];
  names: Record<string, LineName[]>;
  always: string[];
}

interface Tab {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

/**
 * FOOD'S SECTIONS: Today, what was eaten, on the front page (D4a); the week's
 * plan (D2); the recipes; and the shopping list made from the week (D3).
 *
 * A segmented control of pills (the Fresh Market redesign, ADR 0132), Food's
 * own in place of the shared underlined strip, on a phone four equal items
 * with no icons. List carries how many things are still to buy, worked out
 * here from the list's own inputs and the ticks kept on this phone, by the
 * list's own rule (`leftToBuy`), so the count is the list's. A client file
 * because the icons are components and the ticks are on the phone.
 */
const TABS: readonly Tab[] = [
  { href: "/personal/m/food", label: "Today", icon: CalendarDays, exact: true },
  { href: "/personal/m/food/week", label: "Week", icon: CalendarRange },
  { href: "/personal/m/food/recipes", label: "Recipes", icon: BookOpen },
  { href: "/personal/m/food/list", label: "List", icon: ShoppingCart },
];

/** What is still to buy, by the list's rule and this phone's ticks; null without the list's inputs. */
export function useLeftToBuy(input: ListBadgeInput | null): number | null {
  const state = useShopping(input?.tenantId ?? "");
  if (!input) return null;
  const range = state.range && rangeOk(state.range, input.today) ? state.range : defaultRange(input.today);
  const list = buildList({ cooks: input.cooks, foods: input.foods, names: input.names, always: input.always, from: range.from, to: range.to });
  return leftToBuy(list, marksFor(state, range.from), ownFor(state, range.from));
}

export function FoodNav({ list = null }: { list?: ListBadgeInput | null }) {
  const pathname = usePathname();
  const left = useLeftToBuy(list);
  return (
    <nav aria-label="Food" className="flex">
      <div className="flex w-full gap-0.5 rounded-full bg-food-tabs-track p-1 @2xl:w-auto">
        {TABS.map((tab) => {
          const active = tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          const count = tab.label === "List" && left !== null && left > 0 ? left : null;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-[34px] min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] transition-colors @2xl:h-9 @2xl:flex-none @2xl:gap-2 @2xl:px-4 @2xl:text-sm",
                active ? "bg-card font-semibold text-foreground shadow-food-tab" : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className={cn("hidden size-4 shrink-0 @2xl:block", active && "text-food-accent")} aria-hidden />
              <span className="truncate">{tab.label}</span>
              {count !== null && (
                <span className="rounded-full bg-food-tint px-[7px] py-px text-[11px] font-semibold text-food-accent-ink tabular-nums">
                  {count}
                  <span className="sr-only"> to buy</span>
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
