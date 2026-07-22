import { type ReportColumn, type ReportRow } from "../core/report-builders";

/**
 * A/R aging — pure builder (client-shareable, no server-only). Buckets by
 * days past due at the as-of date (P17): Current (no due date, or not yet
 * due) / 1-30 / 31-60 / 61-90 / 90+.
 *
 * Consistency note: aging reads the invoice subledger; the balance
 * sheet's AR line reads account 1200. They agree by construction — every
 * issuance/payment/void mutates both in one transaction; the ledger
 * integrity monitor is the drift alarm. Voided invoices are excluded
 * entirely (a limitation for historical as-of views, stated in the report
 * caption).
 */

export interface AgingInput {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  dueDate: string | null;
  totalCents: number;
  paidCents: number;
}

export const AGING_COLUMNS: ReportColumn[] = [
  { key: "current", label: "Current", memberId: null },
  { key: "b1_30", label: "1–30", memberId: null },
  { key: "b31_60", label: "31–60", memberId: null },
  { key: "b61_90", label: "61–90", memberId: null },
  { key: "b90plus", label: "90+", memberId: null },
  { key: "total", label: "Total", memberId: null },
];

function daysBetweenIso(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

export function agingBucketIndex(dueDate: string | null, asOf: string): number {
  if (!dueDate) return 0;
  const past = daysBetweenIso(dueDate, asOf);
  if (past <= 0) return 0;
  if (past <= 30) return 1;
  if (past <= 60) return 2;
  if (past <= 90) return 3;
  return 4;
}

export interface ArAgingReport {
  rows: ReportRow[];
  columns: ReportColumn[];
  totalCents: number;
  overdueCents: number;
  asOf: string;
}

export function buildArAging(input: AgingInput[], asOf: string): ArAgingReport {
  const open = input
    .map((i) => ({ ...i, balance: i.totalCents - i.paidCents }))
    .filter((i) => i.balance > 0);

  const byCustomer = new Map<
    string,
    { name: string; buckets: number[]; total: number }
  >();
  for (const invoice of open) {
    let entry = byCustomer.get(invoice.customerId);
    if (!entry) {
      entry = { name: invoice.customerName, buckets: [0, 0, 0, 0, 0], total: 0 };
      byCustomer.set(invoice.customerId, entry);
    }
    const bucket = agingBucketIndex(invoice.dueDate, asOf);
    entry.buckets[bucket] += invoice.balance;
    entry.total += invoice.balance;
  }

  const customers = [...byCustomer.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  );
  const grand = [0, 0, 0, 0, 0];
  const rows: ReportRow[] = customers.map(([customerId, c]) => {
    c.buckets.forEach((v, i) => (grand[i] += v));
    return {
      kind: "account",
      label: c.name,
      depth: 1,
      accountId: customerId,
      perMemberCents: [...c.buckets, c.total],
    };
  });
  const grandTotal = grand.reduce((s, v) => s + v, 0);
  rows.push({
    kind: "total",
    label: "Total",
    depth: 0,
    perMemberCents: [...grand, grandTotal],
  });

  return {
    rows,
    columns: AGING_COLUMNS,
    totalCents: grandTotal,
    overdueCents: grand[1] + grand[2] + grand[3] + grand[4],
    asOf,
  };
}
