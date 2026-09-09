import "server-only";
import type { Tx } from "@/db";
import { findOpeningBalanceAccountId } from "./coa";
import { LedgerError } from "./errors";
import { getBooksStartOn } from "./guards";

/**
 * How a document that was OPEN ON THE DAY THE BOOKS BEGAN posts (ADR 0037).
 *
 * An invoice sent in November and still unpaid on January 1st is a real
 * receivable of the new books and a real income of the old ones. So its
 * issuance is dated ON the start day — its own date is before it, where
 * `assertPeriodOpen` would refuse — and its other leg is Opening Balance
 * Equity rather than income: the plug every opening balance lands on until
 * the accountant moves it to retained earnings. A bill is the mirror.
 *
 * Two refusals, both the person's to fix on the Opening page: no start day
 * yet (there is nothing to date the entry on), and a document dated on or
 * after the day (that is an ordinary invoice, and should be written as one).
 */
export interface OpeningPosting {
  /** The company's start day: what the issuance or approval entry is dated. */
  entryDate: string;
  /** Opening Balance Equity. */
  obeAccountId: string;
}

export async function openingPosting(
  tx: Tx,
  tenantId: string,
  entityId: string,
  documentDate: string,
): Promise<OpeningPosting> {
  const start = await getBooksStartOn(tx, tenantId, entityId);
  if (!start) throw new LedgerError("BOOKS_START_UNSET", `entity ${entityId}`);
  if (documentDate >= start) {
    throw new LedgerError("OPENING_NOT_BEFORE_START", `${documentDate} is not before ${start}`, {
      booksStartOn: start,
      documentDate,
    });
  }
  return { entryDate: start, obeAccountId: await findOpeningBalanceAccountId(tx, tenantId) };
}
