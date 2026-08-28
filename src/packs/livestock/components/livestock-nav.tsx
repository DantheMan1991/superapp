"use client";

import { ClipboardCheck, LayoutDashboard, Scale, Sparkles } from "lucide-react";
import {
  CategoryStrip,
  type CategoryItem,
} from "@/components/app/category-strip";

const BASE = "/dashboard/m/livestock";

/**
 * Livestock's sections.
 *
 * **THREE OUTLINE BUTTONS OUT OF THE HEADER'S ACTIONS ROW**, leaving the lot
 * form — the only verb — as the action. The icons are the ones those buttons
 * already carried, so nothing a person had learned to look for has moved
 * anywhere except onto a row that says what it is.
 *
 * Ordered as the buttons were, and that order is a recorded decision rather
 * than the order they were built in: the round is the DAILY act, feed is looked
 * at when one lot is being judged against the last, and Ask is the only
 * screen in the pack that works with nothing recorded at all.
 *
 * No props, unlike `ProductionNav`: none of these four names is a word the
 * tenant owns. `lotWord` is, and it is deliberately not in the strip — the hub
 * tab is "Overview" for the same pluralisation reason production's is.
 */
const ITEMS: CategoryItem[] = [
  { href: BASE, label: "Overview", icon: LayoutDashboard, exact: true },
  { href: `${BASE}/log`, label: "Daily round", icon: ClipboardCheck },
  { href: `${BASE}/feed`, label: "Feed", icon: Scale },
  { href: `${BASE}/ask`, label: "Ask", icon: Sparkles },
];

export function LivestockNav() {
  return <CategoryStrip items={ITEMS} />;
}
