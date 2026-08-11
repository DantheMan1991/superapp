"use client";

import { usePathname } from "next/navigation";
import { FilterPills, type FilterPill } from "@/components/app/filter-pills";

const TABS: FilterPill[] = [
  {
    key: "invoices",
    label: "Invoices",
    href: "/dashboard/m/accounting/sales/invoices",
  },
  {
    key: "customers",
    label: "Customers",
    href: "/dashboard/m/accounting/sales/customers",
  },
  {
    key: "recurring",
    label: "Recurring",
    href: "/dashboard/m/accounting/sales/recurring",
  },
];

/**
 * Which list inside Sales.
 *
 * Pills on the `accent` variant, so this reads as sub-navigation while the
 * status filter beside it on the invoices page — Open / Drafts / Paid — reads as
 * a filter. Both are pills; only one is filled solid.
 *
 * The old active state was `bg-brand/10 text-brand`, and `--brand` measures
 * 2.81:1 on white: this control was failing WCAG AA in production. The accent
 * variant uses `--module-accent`, which is pitched to clear 4.5:1.
 */
export function SalesNav() {
  const pathname = usePathname();
  const active = TABS.find((tab) => pathname.startsWith(tab.href));
  return (
    <FilterPills
      items={TABS}
      activeKey={active?.key ?? ""}
      variant="accent"
      className="print:hidden"
    />
  );
}
