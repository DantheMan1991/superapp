import {
  buildPartyAging,
  type PartyAgingReport,
} from "../lib/aging-core";

/**
 * A/P aging — pure, thin over lib/aging-core (P20). Buckets by days past
 * due at the as-of date. Consistency note: aging reads the bill
 * subledger; the balance sheet's AP line reads account 2000. They agree
 * by construction — every approval/payment/void mutates both in one
 * transaction; the ledger integrity monitor is the drift alarm. Voided
 * bills are excluded entirely (a limitation for historical as-of views,
 * stated in the report caption).
 */

export interface ApAgingInput {
  billId: string;
  billNumber: string;
  vendorId: string;
  vendorName: string;
  dueDate: string | null;
  totalCents: number;
  paidCents: number;
}

export type ApAgingReport = PartyAgingReport;

export function buildApAging(
  input: ApAgingInput[],
  asOf: string,
): ApAgingReport {
  return buildPartyAging(
    input.map((i) => ({
      partyId: i.vendorId,
      partyName: i.vendorName,
      dueDate: i.dueDate,
      totalCents: i.totalCents,
      paidCents: i.paidCents,
    })),
    asOf,
  );
}
