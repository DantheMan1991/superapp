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
  | "IMPORT_INVALID"
  | "CUSTOMER_NOT_FOUND"
  | "CUSTOMER_INACTIVE"
  | "INVOICE_NOT_FOUND"
  | "INVOICE_NOT_DRAFT"
  | "INVOICE_NOT_OPEN"
  | "INVOICE_EMPTY"
  | "INVOICE_NUMBER_TAKEN"
  | "INVOICE_HAS_PAYMENTS"
  | "INVOICE_OVERPAYMENT"
  | "PAYMENT_NOT_FOUND"
  | "RECURRING_NOT_FOUND"
  | "RECURRING_TEMPLATE_INVALID"
  | "TXN_MATCH_INVALID"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_TRASHED"
  | "DOCUMENT_HAS_LINKS"
  | "DOCUMENT_LINK_EXISTS"
  | "DOCUMENT_TARGET_INVALID"
  | "DOCUMENT_NOT_EXTRACTABLE"
  | "DOCUMENT_UPLOAD_INVALID"
  | "VENDOR_NOT_FOUND"
  | "VENDOR_INACTIVE"
  | "BILL_NOT_FOUND"
  | "BILL_NOT_DRAFT"
  | "BILL_NOT_AWAITING"
  | "BILL_NOT_APPROVABLE"
  | "BILL_NOT_OPEN"
  | "BILL_EMPTY"
  | "BILL_UNCODED_LINES"
  | "BILL_HAS_PAYMENTS"
  | "BILL_OVERPAYMENT"
  | "BILL_PAYMENT_NOT_FOUND"
  | "ENTRY_SOURCE_MANAGED";

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
  CUSTOMER_NOT_FOUND: "That customer no longer exists.",
  CUSTOMER_INACTIVE: "That customer is inactive — reactivate them first.",
  INVOICE_NOT_FOUND: "That invoice no longer exists.",
  INVOICE_NOT_DRAFT: "Only draft invoices can be changed this way.",
  INVOICE_NOT_OPEN: "That invoice isn't open for payments.",
  INVOICE_EMPTY: "An invoice needs at least one line and a total above zero.",
  INVOICE_NUMBER_TAKEN: "That invoice number is already in use.",
  INVOICE_HAS_PAYMENTS: "Remove the payments first, then void.",
  INVOICE_OVERPAYMENT: "That's more than the remaining balance.",
  PAYMENT_NOT_FOUND: "That payment no longer exists.",
  RECURRING_NOT_FOUND: "That recurring template no longer exists.",
  RECURRING_TEMPLATE_INVALID:
    "The template references an inactive account or tag — edit it first.",
  TXN_MATCH_INVALID: "That entry can no longer be matched — refresh and try again.",
  DOCUMENT_NOT_FOUND: "That file no longer exists.",
  DOCUMENT_TRASHED: "That file is in the trash — restore it first.",
  DOCUMENT_HAS_LINKS:
    "Detach this file from its transactions before trashing it.",
  DOCUMENT_LINK_EXISTS: "That file is already attached there.",
  DOCUMENT_TARGET_INVALID:
    "That record can't take attachments or no longer exists.",
  DOCUMENT_NOT_EXTRACTABLE: "This file type can't be read automatically.",
  DOCUMENT_UPLOAD_INVALID:
    "That file type or size isn't supported — JPEG, PNG, WebP, GIF or PDF up to 20MB.",
  VENDOR_NOT_FOUND: "That vendor no longer exists.",
  VENDOR_INACTIVE: "That vendor is inactive — reactivate them first.",
  BILL_NOT_FOUND: "That bill no longer exists.",
  BILL_NOT_DRAFT: "Only draft bills can be changed this way.",
  BILL_NOT_AWAITING: "That bill isn't awaiting approval.",
  BILL_NOT_APPROVABLE: "Only draft or submitted bills can be approved.",
  BILL_NOT_OPEN: "That bill isn't open for payments.",
  BILL_EMPTY: "A bill needs at least one line and a total above zero.",
  BILL_UNCODED_LINES: "Every line needs an account before approval.",
  BILL_HAS_PAYMENTS: "Remove the payments first, then void.",
  BILL_OVERPAYMENT: "That's more than the remaining balance.",
  BILL_PAYMENT_NOT_FOUND: "That payment no longer exists.",
  ENTRY_SOURCE_MANAGED:
    "This entry belongs to an invoice or bill — manage it from that document instead.",
};

export function friendlyMessage(err: unknown): string {
  if (err instanceof LedgerError) return FRIENDLY[err.code];
  return "Something went wrong. Please try again.";
}
