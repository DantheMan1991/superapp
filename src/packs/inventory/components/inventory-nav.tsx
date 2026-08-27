"use client";

import { Boxes, ClipboardList, Coins, FileCheck, Scale } from "lucide-react";
import {
  CategoryStrip,
  type CategoryItem,
} from "@/components/app/category-strip";

const BASE = "/dashboard/m/inventory";

/**
 * Inventory's sections.
 *
 * **THESE WERE FOUR OUTLINE BUTTONS IN THE PAGE HEADER'S ACTIONS ROW**, beside
 * the one control that actually does something. A header's actions are verbs —
 * *add an item* — and Counting, What it is worth, Deliveries & invoices and
 * When it is deducted are places. Rendered as five identical outline buttons
 * they read as one undifferentiated row of chrome, and the only real action sat
 * last in the queue because it was added last.
 *
 * **AND IT LEFT EVERY SUB-PAGE TO INVENT ITS OWN WAY BACK — six of them, in
 * four different shapes.** `/counts` and `/counts/[id]` put a `‹ All inventory`
 * link in a bare `<div>` above the title; `/value` put one inside the header's
 * `actions`, beside the as-of picker; `/matching` put one in a flex row; `/tax`
 * and `/[id]` used a bare chevron. Four hand-rolled variants of *go back*, and
 * not one of them says what else exists — so from Counting there was no way to
 * reach Deliveries without returning to the hub first.
 *
 * A strip replaces all six with one control that is also a map. Each converted
 * page drops its own link.
 *
 * The labels are the pages' own titles rather than shorter nav words. That is
 * deliberate — this pack names screens in plain English on purpose, and a nav
 * item that renames the page it leads to is a second name to learn. The strip
 * scrolls sideways when they do not fit, which is what it is for.
 */
export function InventoryNav({ isOwner }: { isOwner: boolean }) {
  const items: CategoryItem[] = [
    /**
     * `exact`, because every other route in this pack is a child of this one —
     * without it `startsWith(href + "/")` matches Counting, Value and an item
     * detail page too, and Items would be permanently active. The cost is that
     * an item detail page highlights nothing, which is honest: a record is not
     * a section.
     */
    { href: BASE, label: "Items", icon: Boxes, exact: true },
    { href: `${BASE}/counts`, label: "Counting", icon: ClipboardList },
    { href: `${BASE}/value`, label: "What it is worth", icon: Coins },
    {
      href: `${BASE}/matching`,
      label: "Deliveries & invoices",
      icon: FileCheck,
    },
    /**
     * OWNER ONLY, and the only one of the five that is gated — carried over
     * unchanged from the button this replaces, so no one's navigation loses or
     * gains a destination in a UI PR.
     *
     * **IT IS NOT AN AUTHORISATION BOUNDARY AND MUST NOT BE READ AS ONE.** The
     * page calls `requireTenant()`, not `requireTenantOwner()`: staff may open
     * `/inventory/tax` by URL and read it, and only the acts on it are gated on
     * `isOwner`. That is the pack's existing decision — a recorded tax election
     * is worth seeing and an owner's to make — and this tab only mirrors who
     * was being *pointed* at the page before.
     */
    ...(isOwner
      ? [{ href: `${BASE}/tax`, label: "When it is deducted", icon: Scale }]
      : []),
  ];

  return <CategoryStrip items={items} />;
}
