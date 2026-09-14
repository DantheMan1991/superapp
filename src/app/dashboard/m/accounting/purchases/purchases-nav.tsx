"use client";

import { usePathname } from "next/navigation";
import { FilterPills, type FilterPill } from "@/components/app/filter-pills";
import { usePartyWords } from "@/components/app/label-provider";

const TABS: FilterPill[] = [
  {
    key: "bills",
    label: "Bills",
    href: "/dashboard/m/accounting/purchases/bills",
  },
  {
    key: "vendors",
    label: "Vendors",
    href: "/dashboard/m/accounting/purchases/vendors",
  },
];

/**
 * Which list inside Purchases. The Sales equivalent carries the reasoning for
 * the `accent` variant, including the contrast failure it fixes.
 */
export function PurchasesNav() {
  const pathname = usePathname();
  // The tenant's word. Built here rather than in the constant above, for the
  // reason the Sales nav spells out.
  const { vendors } = usePartyWords();
  const tabs = TABS.map((tab) =>
    tab.key === "vendors" ? { ...tab, label: vendors } : tab,
  );
  const active = tabs.find((tab) => pathname.startsWith(tab.href));
  return (
    <FilterPills
      items={tabs}
      activeKey={active?.key ?? ""}
      variant="accent"
      className="print:hidden"
    />
  );
}
