import Link from "next/link";
import {
  BarChart3,
  BookOpen,
  Hourglass,
  Landmark,
  Percent,
  Wallet,
} from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";

export const dynamic = "force-dynamic";

const REPORTS = [
  {
    href: "/dashboard/m/accounting/reports/pnl",
    icon: BarChart3,
    title: "Profit & Loss",
    description:
      "Income, cost of goods sold, and expenses over a period — with comparisons and per-tag columns.",
  },
  {
    href: "/dashboard/m/accounting/reports/balance-sheet",
    icon: Landmark,
    title: "Balance Sheet",
    description:
      "What the business owns and owes as of a date, with computed Retained Earnings and Net Income.",
  },
  {
    href: "/dashboard/m/accounting/reports/general-ledger",
    icon: BookOpen,
    title: "General Ledger",
    description:
      "Every posted line in the period, by account, with opening and running balances. Pick one account for a transaction detail.",
  },
  {
    href: "/dashboard/m/accounting/reports/cash",
    icon: Wallet,
    title: "Cash Activity",
    description:
      "Money in and out of every bank, cash, and credit-card account over a period.",
  },
  {
    href: "/dashboard/m/accounting/reports/ar-aging",
    icon: Hourglass,
    title: "A/R Aging",
    description:
      "Who owes what and how overdue — open invoice balances bucketed by days past due.",
  },
  {
    href: "/dashboard/m/accounting/reports/ap-aging",
    icon: Hourglass,
    title: "A/P Aging",
    description:
      "What the business owes vendors — open bill balances bucketed by days past due.",
  },
  {
    href: "/dashboard/m/accounting/reports/sales-tax",
    icon: Percent,
    title: "Sales Tax Summary",
    description:
      "Taxable and non-taxable sales by rate, and what you have collected but not yet remitted.",
  },
];

export default async function ReportsHubPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Financial statements for ${ctx.tenant.name}, computed live from the ledger.`}
      />
      <AccountingNav />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            // Same tile as the Overview module grid: elevation that lifts on
            // hover, and the accent chip on `--module-accent` rather than
            // `text-brand`, which measured 2.81:1 on white.
            className="block h-full rounded-2xl bg-card p-4 shadow-elevation-1 transition-shadow hover:shadow-elevation-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <div className="flex size-9 items-center justify-center rounded-lg bg-module-accent/10 text-module-accent">
              <r.icon className="size-[18px]" />
            </div>
            <p className="mt-3 font-heading font-medium tracking-heading">
              {r.title}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {r.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
