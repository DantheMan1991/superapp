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
import { canReach, requireModuleEnabled } from "@/lib/modules";
import { PageHeader } from "@/components/app/page-header";
import { AccountingNav } from "@/modules/accounting/components/accounting-nav";
import { labelsForTenant } from "@/lib/packs/tenant-context";
import { partyWords, type PartyWords } from "@/lib/parties/vocabulary";

export const dynamic = "force-dynamic";

/**
 * Each tile carries the area key that guards its own page (ADR 0097), because
 * this index links to the seven reports directly rather than through a nav
 * primitive — so nothing else would filter it, and a tile onto a page that
 * refuses is the failure that makes a permission screen worthless.
 */
const REPORTS = [
  {
    href: "/dashboard/m/accounting/reports/pnl",
    area: "accounting:pnl",
    icon: BarChart3,
    title: "Profit & Loss",
    description:
      "Income, cost of goods sold, and expenses over a period — with comparisons and per-tag columns.",
  },
  {
    href: "/dashboard/m/accounting/reports/balance-sheet",
    area: "accounting:balance-sheet",
    icon: Landmark,
    title: "Balance Sheet",
    description:
      "What the business owns and owes as of a date, with computed Retained Earnings and Net Income.",
  },
  {
    href: "/dashboard/m/accounting/reports/general-ledger",
    area: "accounting:general-ledger",
    icon: BookOpen,
    title: "General Ledger",
    description:
      "Every posted line in the period, by account, with opening and running balances. Pick one account for a transaction detail.",
  },
  {
    href: "/dashboard/m/accounting/reports/cash",
    area: "accounting:cash",
    icon: Wallet,
    title: "Cash Activity",
    description:
      "Money in and out of every bank, cash, and credit-card account over a period.",
  },
  {
    href: "/dashboard/m/accounting/reports/ar-aging",
    area: "accounting:ar-aging",
    icon: Hourglass,
    title: "A/R Aging",
    description:
      "Who owes what and how overdue — open invoice balances bucketed by days past due.",
  },
  {
    href: "/dashboard/m/accounting/reports/ap-aging",
    area: "accounting:ap-aging",
    icon: Hourglass,
    title: "A/P Aging",
    // The one description naming a party. A function of the tenant's word rather
    // than a string, so this list can stay a module constant.
    description: (words: PartyWords) =>
      `What the business owes ${words.vendors.toLowerCase()} — open bill balances bucketed by days past due.`,
  },
  {
    href: "/dashboard/m/accounting/reports/sales-tax",
    area: "accounting:sales-tax",
    icon: Percent,
    title: "Sales Tax Summary",
    description:
      "Taxable and non-taxable sales by rate, and what you have collected but not yet remitted.",
  },
];

export default async function ReportsHubPage() {
  const ctx = await requireTenant();
  const words = partyWords(labelsForTenant(ctx.tenant));
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  const reports = (
    await Promise.all(
      REPORTS.map(async (r) => ((await canReach(ctx.tenant.id, r.area)) ? r : null)),
    )
  ).filter((r): r is (typeof REPORTS)[number] => r !== null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Financial statements for ${ctx.tenant.name}, computed live from the ledger.`}
      />
      <AccountingNav />
      {reports.length === 0 && (
        // Not an empty grid: an owner has closed every report to this person,
        // and saying so is better than a page that looks broken.
        <p className="rounded-xl bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No reports are open to you. Ask an owner if you need one.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
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
              {typeof r.description === "function"
                ? r.description(words)
                : r.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
