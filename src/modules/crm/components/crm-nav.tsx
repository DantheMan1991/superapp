"use client";

import {
  ChartColumn,
  Contact,
  CopyCheck,
  GitBranch,
  KanbanSquare,
  ListChecks,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import {
  CategoryStrip,
  type CategoryItem,
} from "@/components/app/category-strip";

const BASE = "/dashboard/m/crm";

/**
 * CRM's sections.
 *
 * This module had no sub-nav at all. The hub carried **six outline buttons** —
 * Follow-ups, Board, Fields, Reports, Automations, Duplicates — sitting where a
 * page's actions go, so navigation was dressed as actions and the one real
 * action (Add a record) was the seventh button in the row. Worse, none of the
 * sub-pages carried anything: once you were on Duplicates the only way back was
 * the browser's back button.
 *
 * So this is an IA change, not only a restyle: the six buttons become one strip,
 * and every CRM page renders it, which is what the other modules already had.
 *
 * `Records` is `exact` because it is the module index — without it the strip
 * would mark it active on every sub-route.
 */
/**
 * FOLLOW-UPS IS BACK (2026-08-15), and the reasoning that removed it still
 * holds — it just did not mean what it was taken to mean.
 *
 * It was pulled when `${BASE}/tasks` became a redirect into Work, on the
 * grounds that a tab landing you in another module is worse than no tab. True,
 * and that is exactly the friction the founder reported: raising a follow-up in
 * CRM and being ejected to work on it.
 *
 * The fix was to stop it being a redirect, not to leave the hole. `/tasks` is a
 * real page again, scoped to follow-ups attached to a record and honest about
 * what it leaves out. So the tab lands inside CRM, this strip stays, and the
 * active state matches.
 */
const TABS: CategoryItem[] = [
  { href: BASE, label: "Records", icon: Contact, exact: true },
  { href: `${BASE}/tasks`, label: "Follow-ups", icon: ListChecks },
  { href: `${BASE}/deals`, label: "Board", icon: KanbanSquare },
  { href: `${BASE}/pipelines`, label: "Pipelines", icon: GitBranch },
  { href: `${BASE}/fields`, label: "Fields", icon: SlidersHorizontal },
  { href: `${BASE}/reports`, label: "Reports", icon: ChartColumn },
  { href: `${BASE}/automations`, label: "Automations", icon: Zap },
  { href: `${BASE}/duplicates`, label: "Duplicates", icon: CopyCheck },
];

export function CrmNav() {
  return <CategoryStrip items={TABS} className="print:hidden" />;
}
