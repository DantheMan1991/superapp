export type LedgerErrorCode =
  | "FORBIDDEN"
  | "UNBALANCED"
  | "TOO_FEW_LINES"
  | "ZERO_AMOUNT_LINE"
  | "AMOUNT_TOO_LARGE"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_INACTIVE"
  | "PERIOD_CLOSED"
  | "ENTRY_NOT_FOUND"
  | "ENTRY_NOT_DRAFT"
  | "ENTRY_NOT_POSTED"
  | "ENTRY_IMMUTABLE"
  | "STALE_VERSION"
  | "DIMENSION_INVALID"
  | "DUPLICATE_CODE"
  | "COA_SELF_PARENT"
  | "COA_CYCLE"
  | "COA_DEPTH"
  | "COA_TYPE_MISMATCH"
  | "SYSTEM_ACCOUNT"
  | "SETTINGS_MISSING"
  | "TXN_NOT_UNREVIEWED"
  | "BANK_ACCOUNT_NOT_FOUND"
  | "RECON_ACTIVE_EXISTS"
  | "RECON_NOT_OPEN"
  | "RECON_NOT_BALANCED"
  | "RECON_LINE_INVALID"
  | "RECON_NOT_LATEST"
  | "AI_COOLDOWN"
  | "AI_UNAVAILABLE"
  | "IMPORT_INVALID";

/**
 * Typed failure from the ledger core. Server actions catch these and map
 * them to friendly messages; anything else is a genuine bug and surfaces
 * as a generic error.
 */
export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
    readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

const FRIENDLY: Record<LedgerErrorCode, string> = {
  FORBIDDEN: "Only the business owner can do that.",
  UNBALANCED: "Debits and credits must be equal before posting.",
  TOO_FEW_LINES: "A journal entry needs at least two lines.",
  ZERO_AMOUNT_LINE: "Every line needs a non-zero amount.",
  AMOUNT_TOO_LARGE: "That amount is larger than the ledger accepts.",
  ACCOUNT_NOT_FOUND: "One of the selected accounts no longer exists.",
  ACCOUNT_INACTIVE: "One of the selected accounts is inactive.",
  PERIOD_CLOSED:
    "That date falls in a closed period. Use a reversal, or reopen the period first.",
  ENTRY_NOT_FOUND: "That entry no longer exists.",
  ENTRY_NOT_DRAFT: "Only draft entries can be changed this way.",
  ENTRY_NOT_POSTED: "Only posted entries can be voided or reversed.",
  ENTRY_IMMUTABLE:
    "This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.",
  STALE_VERSION: "This entry changed since you opened it — reload and try again.",
  DIMENSION_INVALID: "One of the selected tags is invalid or inactive.",
  DUPLICATE_CODE: "That account code is already in use.",
  COA_SELF_PARENT: "An account cannot be its own parent.",
  COA_CYCLE: "That parent choice would create a loop in the account tree.",
  COA_DEPTH: "The chart of accounts supports at most three levels.",
  COA_TYPE_MISMATCH: "A sub-account must have the same type as its parent.",
  SYSTEM_ACCOUNT: "System accounts cannot be changed or deactivated.",
  SETTINGS_MISSING:
    "Accounting is not fully set up for this business. Toggle the module off and on again.",
  TXN_NOT_UNREVIEWED:
    "That bank transaction was already handled — refresh the page.",
  BANK_ACCOUNT_NOT_FOUND: "That bank account no longer exists.",
  RECON_ACTIVE_EXISTS:
    "A reconciliation is already in progress for this account.",
  RECON_NOT_OPEN: "That reconciliation is not open.",
  RECON_NOT_BALANCED:
    "The difference isn't zero yet — keep clearing transactions.",
  RECON_LINE_INVALID: "That line can't be cleared in this reconciliation.",
  RECON_NOT_LATEST:
    "Only the most recent completed reconciliation can be reopened.",
  AI_COOLDOWN: "Suggestions were just requested — try again in a moment.",
  AI_UNAVAILABLE: "The AI service didn't return usable suggestions. Try again.",
  IMPORT_INVALID: "Some rows couldn't be read. Check the column mapping.",
};

export function friendlyMessage(err: unknown): string {
  if (err instanceof LedgerError) return FRIENDLY[err.code];
  return "Something went wrong. Please try again.";
}
