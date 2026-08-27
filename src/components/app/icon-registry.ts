import {
  Banknote,
  Beef,
  BookOpen,
  Boxes,
  Calculator,
  Calendar,
  Clock,
  Contact,
  CreditCard,
  Factory,
  FolderOpen,
  LayoutDashboard,
  ListChecks,
  Mail,
  // Aliased on purpose: a bare `Map` import shadows the global `Map`
  // constructor for the whole module, which is a trap for whoever next reaches
  // for a lookup in here. lucide exports `Map as LucideMap` too; the name below
  // is the one the rest of the codebase would guess.
  Map as MapIcon,
  ScrollText,
  Settings,
  Sparkles,
  Sprout,
  SquareCheck,
  Store,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Name → icon, for the places where an icon has to cross a server/client
 * boundary as data.
 *
 * A React component cannot be serialised into a client component's props, so
 * anything the server decides (the sidebar's nav, built in
 * `app/dashboard/layout.tsx` from the `modules` table and the code-side
 * registry) can only name its icon as a string. This map is the single place
 * that turns the name back into a component.
 *
 * It lives here rather than inside `app-shell.tsx` because it had drifted: the
 * shell's private copy was missing `contact`, `calendar` and `check-square`,
 * which are precisely the three names `src/modules/index.ts` uses, so CRM,
 * Scheduling and Work all silently fell through to the `Boxes` fallback. One
 * map, imported by both sides, is what stops that recurring.
 *
 * Note `check-square` resolves to lucide's `SquareCheck`. Either spelling would
 * work — v1 still re-exports `SquareCheck as CheckSquare` — so the bug was only
 * ever the missing key, not the name. `getIcon` falls back to `Boxes` instead of
 * throwing, which is exactly why three wrong icons shipped unnoticed: add the
 * name here when you add a module.
 *
 * **AND IT RECURRED, EXACTLY AS THE PARAGRAPH ABOVE PREDICTED IT WOULD.** Every
 * pack in `src/packs/index.ts` names an icon, and five of the seven — `map`,
 * `beef`, `sprout`, `factory`, `store` — were never added here, so Land,
 * Livestock, Crops, Production and Retail all rendered the same generic box as
 * Inventory, in the rail and in the ⌘K palette, from the day each shipped until
 * 2026-08-26. The registry is the seam a pack has to touch and the one furthest
 * from anything a pack author is thinking about. There is still no test that
 * would catch it: the fix is to add the key in the same commit as the pack.
 *
 * Components only, no helpers: a `"use client"` module may import from here
 * freely because this file is not itself a client module.
 */
export const ICONS: Record<string, LucideIcon> = {
  audit: ScrollText,
  billing: CreditCard,
  // Deliberately NOT CreditCard: `billing` is the platform charging this
  // tenant, `payments` is the tenant taking money from its customer, and the
  // two sit next to each other in the same rail (ADR 0015).
  payments: Banknote,
  beef: Beef,
  book: BookOpen,
  boxes: Boxes,
  calculator: Calculator,
  calendar: Calendar,
  "check-square": SquareCheck,
  checks: ListChecks,
  clock: Clock,
  contact: Contact,
  dashboard: LayoutDashboard,
  factory: Factory,
  folder: FolderOpen,
  mail: Mail,
  map: MapIcon,
  settings: Settings,
  sparkles: Sparkles,
  sprout: Sprout,
  store: Store,
  users: Users,
  wrench: Wrench,
};

/** Falls back to a generic box so an unknown name renders, never throws. */
export function getIcon(name: string | undefined): LucideIcon {
  return (name && ICONS[name]) || Boxes;
}
