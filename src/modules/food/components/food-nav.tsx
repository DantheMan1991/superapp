"use client";

import { BookOpen, CalendarDays, CalendarRange, ShoppingCart } from "lucide-react";
import { CategoryStrip, type CategoryItem } from "@/components/app/category-strip";

/**
 * FOOD'S SECTIONS: Today, what was eaten, on the front page (D4a); the week's
 * plan (D2); the recipes; and the shopping list made from the week (D3). A
 * client file because the strip's icons are components, which a server page
 * cannot hand across. The strip, not pills: these are sections of the tool,
 * not filters on one list (filter-pills.tsx says why the two differ).
 */
const TABS: readonly CategoryItem[] = [
  { href: "/personal/m/food", label: "Today", icon: CalendarDays, exact: true },
  { href: "/personal/m/food/week", label: "Week", icon: CalendarRange },
  { href: "/personal/m/food/recipes", label: "Recipes", icon: BookOpen },
  { href: "/personal/m/food/list", label: "List", icon: ShoppingCart },
];

export function FoodNav() {
  return <CategoryStrip items={TABS} />;
}
