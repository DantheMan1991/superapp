"use client";

import {
  ChartColumn,
  Contact,
  CopyCheck,
  GitBranch,
  KanbanSquare,
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
 * Follow-ups is deliberately NOT here. `${BASE}/tasks` is a redirect into Work
 * (crm.md / work.md slice 5b) — its own header says the route survives "in the
 * CRM nav until every link is chased down", and this is that link. A strip tab
 * that lands you in a different module, with this strip gone and no active state
 * to match, is worse than no tab: Work is already its own row in the rail.
 */
const TABS: CategoryItem[] = [
  { href: BASE, label: "Records", icon: Contact, exact: true },
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
