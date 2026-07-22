"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/m/accounting/sales/invoices", label: "Invoices" },
  { href: "/dashboard/m/accounting/sales/customers", label: "Customers" },
  { href: "/dashboard/m/accounting/sales/recurring", label: "Recurring" },
];

export function SalesNav() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 print:hidden">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium",
            pathname.startsWith(tab.href)
              ? "bg-brand/10 text-brand"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
