"use client";

import { usePathname } from "next/navigation";
import { FilterPills, type FilterPill } from "@/components/app/filter-pills";

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
