"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/m/accounting", label: "Overview", exact: true },
  { href: "/dashboard/m/accounting/accounts", label: "Chart of Accounts" },
  { href: "/dashboard/m/accounting/journal", label: "Journal" },
  { href: "/dashboard/m/accounting/reports", label: "Reports" },
  { href: "/dashboard/m/accounting/trial-balance", label: "Trial Balance" },
];

export function AccountingNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b pb-px">
      {TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
