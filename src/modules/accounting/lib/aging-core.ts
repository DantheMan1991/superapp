import { type ReportColumn, type ReportRow } from "../core/report-builders";

/**
 * Generic party aging — pure, client-shareable (no server-only). Extracted
 * from invoicing/aging.ts in session 6 so A/R (by customer) and A/P (by
 * vendor) share one bucketing engine. Buckets by days past due at the
 * as-of date: Current (no due date, or not yet due) / 1-30 / 31-60 /
 * 61-90 / 90+. Rows render through the existing report-table.
 */

export interface PartyAgingInput {
  partyId: string;
  partyName: string;
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

export interface PartyAgingReport {
  rows: ReportRow[];
  columns: ReportColumn[];
  totalCents: number;
  overdueCents: number;
  asOf: string;
}

export function buildPartyAging(
  input: PartyAgingInput[],
  asOf: string,
): PartyAgingReport {
  const open = input
    .map((i) => ({ ...i, balance: i.totalCents - i.paidCents }))
    .filter((i) => i.balance > 0);

  const byParty = new Map<
    string,
    { name: string; buckets: number[]; total: number }
  >();
  for (const item of open) {
    let entry = byParty.get(item.partyId);
    if (!entry) {
      entry = { name: item.partyName, buckets: [0, 0, 0, 0, 0], total: 0 };
      byParty.set(item.partyId, entry);
    }
    const bucket = agingBucketIndex(item.dueDate, asOf);
    entry.buckets[bucket] += item.balance;
    entry.total += item.balance;
  }

  const parties = [...byParty.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name),
  );
  const grand = [0, 0, 0, 0, 0];
  const rows: ReportRow[] = parties.map(([partyId, p]) => {
    p.buckets.forEach((v, i) => (grand[i] += v));
    return {
      kind: "account",
      label: p.name,
      depth: 1,
      accountId: partyId,
      perMemberCents: [...p.buckets, p.total],
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
