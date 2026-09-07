import { LedgerError } from "../core/errors";
import type { EntryLineInput } from "../core/types";

/**
 * One feed row, several categories — the arithmetic, pure.
 *
 * A Farm & Fleet run that is half repairs and half supplies used to be posted
 * to one account or hand-written in the journal and matched. A split is the
 * same posting `categorizeTransaction` always made, with the far side of the
 * bank in several lines instead of one: still ONE entry for ONE row, so P12
 * (a row is satisfied by exactly one entry) and everything built on it —
 * Undo, void from the journal, the per-attempt idempotency key — are
 * untouched.
 *
 * The caller says how much money moved (`magnitude`, always positive) and
 * which way (`inflow`); each split line is a positive amount on a category.
 * This turns them into signed entry lines and refuses what does not add up.
 */

export interface SplitInput {
  accountId: string;
  /** Positive cents. The lines add up to the row's amount. */
  amountCents: number;
  dimensionMemberIds?: string[];
}

export function splitFarSide(
  splits: readonly SplitInput[],
  magnitude: number,
  registerAccountId: string,
  inflow: boolean,
): EntryLineInput[] {
  if (splits.length < 2) {
    throw new LedgerError("SPLIT_TOO_FEW", `${splits.length} line(s)`);
  }
  for (const s of splits) {
    if (!s.accountId || !Number.isInteger(s.amountCents) || s.amountCents <= 0) {
      throw new LedgerError("SPLIT_LINE_INVALID", "empty category or non-positive amount");
    }
    if (s.accountId === registerAccountId) {
      throw new LedgerError("ACCOUNT_NOT_FOUND", "cannot split to the register's own account");
    }
  }
  const total = splits.reduce((sum, s) => sum + s.amountCents, 0);
  if (total !== magnitude) {
    throw new LedgerError("SPLIT_MISMATCH", `lines ${total}, row ${magnitude}`, {
      assignedCents: total,
      rowCents: magnitude,
    });
  }
  // Money in credits the categories; money out debits them — the mirror of
  // the bank line the caller adds.
  return splits.map((s) => ({
    accountId: s.accountId,
    amountCents: inflow ? -s.amountCents : s.amountCents,
    dimensionMemberIds: s.dimensionMemberIds,
  }));
}
