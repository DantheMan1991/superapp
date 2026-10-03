"use client";

import { BookOpen, CalendarDays } from "lucide-react";
import { CategoryStrip, type CategoryItem } from "@/components/app/category-strip";

/**
 * FOOD'S TWO SECTIONS (D4a): Today, what was eaten, on the front page; and the
 * recipes. A client file because the strip's icons are components, which a
 * server page cannot hand across. The strip, not pills: these are sections of
 * the tool, not filters on one list (filter-pills.tsx says why the two differ).
 */
const TABS: readonly CategoryItem[] = [
  { href: "/personal/m/food", label: "Today", icon: CalendarDays, exact: true },
  { href: "/personal/m/food/recipes", label: "Recipes", icon: BookOpen },
];

export function FoodNav() {
  return <CategoryStrip items={TABS} />;
}
