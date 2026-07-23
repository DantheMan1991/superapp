import Link from "next/link";
import { BarChart3, Hourglass, Landmark, Wallet } from "lucide-react";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
];

export default async function ReportsHubPage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Financial statements for {ctx.tenant.name}, computed live from the
          ledger.
        </p>
      </div>
      <AccountingNav />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((r) => (
          <Link key={r.href} href={r.href} className="group">
            <Card className="h-full transition-colors group-hover:border-brand/50">
              <CardHeader>
                <div className="mb-1 flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                  <r.icon className="size-4.5" />
                </div>
                <CardTitle className="text-base">{r.title}</CardTitle>
                <CardDescription>{r.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
