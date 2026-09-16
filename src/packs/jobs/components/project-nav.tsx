"use client";

import {
  Calculator,
  CalendarDays,
  FileDiff,
  FileSignature,
  FileText,
  HardHat,
  Layers,
  LayoutDashboard,
  Palette,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import {
  CategoryStrip,
  type CategoryItem,
} from "@/components/app/category-strip";

/**
 * A job's sections.
 *
 * ── WHY THIS IS A CLIENT COMPONENT AND NOT AN ARRAY IN THE LAYOUT ───────────
 *
 * `CategoryStrip` is a client component, and a lucide icon is a FUNCTION. Build
 * the array in the server layout and every item crosses the boundary carrying
 * one, which React refuses at render time:
 *
 *   Functions cannot be passed directly to Client Components
 *
 * `tsc` accepts it (`icon?: LucideIcon` is satisfied) and `npm run build`
 * compiles it — the page only fails when something actually renders it. So the
 * tabs are built HERE, on the client, and the server hands over the one thing
 * that is genuinely per-request: the project's id. Every other module's strip
 * is written exactly this way (`accounting-nav`, `crm-nav`, `documents-nav`,
 * `inventory-nav`, `livestock-nav`), which is the convention this follows
 * rather than invents.
 *
 * **Overview is `exact`.** `CategoryStrip` matches a prefix otherwise, so the
 * index route would light up on every tab at once. Everything else WANTS the
 * prefix match: a contract's own page at `/contracts/<id>` keeps Contracts lit.
 */
export function ProjectNav({ projectId }: { projectId: string }) {
  const base = `/dashboard/m/jobs/${projectId}`;
  const tabs: CategoryItem[] = [
    { href: base, label: "Overview", icon: LayoutDashboard, exact: true },
    { href: `${base}/contracts`, label: "Contracts", icon: FileSignature },
    { href: `${base}/changes`, label: "Changes", icon: FileDiff },
    { href: `${base}/cost`, label: "Job cost", icon: Calculator },
    { href: `${base}/ordered`, label: "Ordered", icon: ShoppingCart },
    { href: `${base}/schedule`, label: "Schedule", icon: CalendarDays },
    { href: `${base}/selections`, label: "Selections", icon: Palette },
    { href: `${base}/log`, label: "Field", icon: HardHat },
    // Added to the design's own list, which was drawn before the drawings
    // slice landed (ADR 0072) — leaving it out would hide a shipped feature.
    { href: `${base}/drawings`, label: "Drawings", icon: Layers },
    { href: `${base}/estimates`, label: "Estimates", icon: FileText },
    // After the job is done (ADR 0076): the period, and the calls that come in.
    { href: `${base}/warranty`, label: "Warranty", icon: ShieldCheck },
  ];
  return <CategoryStrip items={tabs} />;
}
