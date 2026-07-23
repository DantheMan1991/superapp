import {
  AGING_COLUMNS,
  agingBucketIndex,
  buildPartyAging,
} from "../lib/aging-core";
import { type ReportColumn, type ReportRow } from "../core/report-builders";

/**
 * A/R aging — pure builder (client-shareable, no server-only). Buckets by
 * days past due at the as-of date (P17): Current (no due date, or not yet
 * due) / 1-30 / 31-60 / 61-90 / 90+. Since session 6 the bucketing engine
 * lives in lib/aging-core.ts (shared with A/P); this module keeps the
 * customer-shaped public API unchanged.
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

export { AGING_COLUMNS, agingBucketIndex };

export interface ArAgingReport {
  rows: ReportRow[];
  columns: ReportColumn[];
  totalCents: number;
  overdueCents: number;
  asOf: string;
}

export function buildArAging(input: AgingInput[], asOf: string): ArAgingReport {
  return buildPartyAging(
    input.map((i) => ({
      partyId: i.customerId,
      partyName: i.customerName,
      dueDate: i.dueDate,
      totalCents: i.totalCents,
      paidCents: i.paidCents,
    })),
    asOf,
  );
}
