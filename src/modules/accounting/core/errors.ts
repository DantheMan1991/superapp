export type LedgerErrorCode =
  | "FORBIDDEN"
  | "UNBALANCED"
  | "TOO_FEW_LINES"
  | "ZERO_AMOUNT_LINE"
  | "AMOUNT_TOO_LARGE"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_INACTIVE"
  | "ACCOUNT_NOT_CODABLE"
  | "PERIOD_CLOSED"
  | "ENTRY_NOT_FOUND"
  | "ENTRY_NOT_DRAFT"
  | "ENTRY_NOT_POSTED"
  | "ENTRY_IMMUTABLE"
  | "STALE_VERSION"
  | "DIMENSION_INVALID"
  | "ENTITY_MISSING"
  | "ENTITY_NOT_FOUND"
  | "ENTITY_INACTIVE"
  | "ENTITY_IS_DEFAULT"
  | "ENTITY_NAME_INVALID"
  | "ENTITY_NAME_TAKEN"
  | "SCOPE_NOT_OFFERED"
  | "CROSS_ENTITY_REGISTER"
  | "AFFILIATE_ACCOUNTS_MISSING"
  | "INTERCOMPANY_SAME_COMPANY"
  | "INTERCOMPANY_AMOUNT_INVALID"
  | "INTERCOMPANY_NOT_FOUND"
  | "INTERCOMPANY_INCOMPLETE"
  | "ENTRY_INTERCOMPANY"
  | "DUPLICATE_CODE"
  | "COA_SELF_PARENT"
  | "COA_CYCLE"
  | "COA_DEPTH"
  | "COA_TYPE_MISMATCH"
  | "SYSTEM_ACCOUNT"
  | "SETTINGS_MISSING"
  | "TXN_NOT_UNREVIEWED"
  | "BANK_ACCOUNT_NOT_FOUND"
  | "BANK_ACCOUNT_INACTIVE"
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
  | "INVOICE_NOT_SENDABLE"
  | "INVOICE_NO_RECIPIENT"
  | "INVOICE_NUMBER_TAKEN"
  | "PNL_TOO_MANY_MONTHS"
  | "PRODUCT_NAME_TAKEN"
  | "TERM_NAME_TAKEN"
  | "TERM_NOT_FOUND"
  | "PAYMENT_METHOD_INVALID"
  | "PAYMENT_METHOD_TAKEN"
  | "TAX_RATE_NAME_TAKEN"
  | "TAX_RATE_NOT_FOUND"
  | "TAX_RATE_INVALID"
  | "REMINDER_OFFSETS_INVALID"
  | "REMINDER_SCHEDULE_EMPTY"
  | "REMINDER_NOT_TESTABLE"
  | "INVOICE_HAS_PAYMENTS"
  | "INVOICE_OVERPAYMENT"
  | "PAYMENT_NOT_FOUND"
  | "RECURRING_NOT_FOUND"
  | "RECURRING_TEMPLATE_INVALID"
  | "RECURRING_SCHEDULE_BACKWARD"
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
  | "ENTRY_SOURCE_MANAGED"
  | "FORBIDDEN_EXPERT"
  | "CLOSE_NOT_FOUND"
  | "CLOSE_NOT_FORWARD"
  | "CLOSE_NOT_LATEST"
  | "CLOSE_NOT_COMPLETED"
  | "CLOSE_ALREADY_SIGNED"
  | "EXPORT_COOLDOWN";

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
  ACCOUNT_NOT_CODABLE:
    "A line is coded to an account that cannot be chosen by hand. Pick an ordinary account — or, if a match set it, undo the match first.",
  PERIOD_CLOSED:
    "That date falls in a closed period. Use a reversal, or reopen the period first.",
  ENTRY_NOT_FOUND: "That entry no longer exists.",
  ENTRY_NOT_DRAFT: "Only draft entries can be changed this way.",
  ENTRY_NOT_POSTED: "Only posted entries can be voided or reversed.",
  ENTRY_IMMUTABLE:
    "This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.",
  STALE_VERSION: "This entry changed since you opened it — reload and try again.",
  DIMENSION_INVALID: "One of the selected tags is invalid or inactive.",
  ENTITY_MISSING:
    "This business has no company set up to keep books for. Toggle the module off and on again.",
  ENTITY_NOT_FOUND: "That company no longer exists.",
  ENTITY_INACTIVE: "That company is inactive — reactivate it first.",
  ENTITY_IS_DEFAULT:
    "This is the default company — make another one the default first.",
  ENTITY_NAME_INVALID: "Give the company a name.",
  ENTITY_NAME_TAKEN: "A company already has that name.",
  SCOPE_NOT_OFFERED:
    "This report has no consolidated view — nothing it reads is affected by transfers between your companies. Pick a company, or all companies combined.",
  AFFILIATE_ACCOUNTS_MISSING:
    "This business is missing the Due from / Due to Affiliates accounts. Toggle the accounting module off and on again to add them.",
  INTERCOMPANY_SAME_COMPANY: "Pick two different companies.",
  INTERCOMPANY_AMOUNT_INVALID: "Enter an amount above zero.",
  INTERCOMPANY_NOT_FOUND: "That transfer no longer exists.",
  INTERCOMPANY_INCOMPLETE:
    "Say what the receiving company got — cash into an account, or what was paid for on its behalf.",
  ENTRY_INTERCOMPANY:
    "This is one half of a transfer between two of your companies. Undo it from the transfer, so both sides move together.",
  CROSS_ENTITY_REGISTER:
    "That bank account belongs to a different company. Use one of this company's own accounts — money moving between two of your companies is a transfer, and recording it properly needs both sides.",
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
  // Distinct from NOT_FOUND on purpose: the account is right there, and the
  // reader needs the way out rather than a message telling them it is gone.
  BANK_ACCOUNT_INACTIVE:
    "That account is closed. Reopen it from the account page to record anything new — everything already in the books stays either way.",
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
  INVOICE_NOT_SENDABLE:
    "Only an issued invoice can be emailed — a draft would go out saying DRAFT, and a void one should not go out at all.",
  INVOICE_NO_RECIPIENT:
    "This customer has no email address. Add one, or type an address to send to.",
  INVOICE_NUMBER_TAKEN: "That invoice number is already in use.",
  PNL_TOO_MANY_MONTHS:
    "That's too long a range for monthly columns — pick 24 months or fewer.",
  PRODUCT_NAME_TAKEN: "A saved item already has that name.",
  TERM_NAME_TAKEN: "A payment term already has that name.",
  TERM_NOT_FOUND: "That payment term no longer exists.",
  PAYMENT_METHOD_INVALID: "Give the payment method a name.",
  PAYMENT_METHOD_TAKEN: "That payment method already exists.",
  TAX_RATE_NAME_TAKEN: "A tax rate already has that name.",
  TAX_RATE_NOT_FOUND: "That tax rate no longer exists.",
  TAX_RATE_INVALID:
    "That tax rate is inactive or no longer exists — pick another one.",
  REMINDER_OFFSETS_INVALID:
    "That reminder schedule isn't valid — each entry is a whole number of days near the due date.",
  REMINDER_SCHEDULE_EMPTY:
    "Add at least one reminder before turning reminders on.",
  REMINDER_NOT_TESTABLE:
    "Only an unpaid invoice with a due date has a reminder to preview.",
  INVOICE_HAS_PAYMENTS: "Remove the payments first, then void.",
  INVOICE_OVERPAYMENT: "That's more than the remaining balance.",
  PAYMENT_NOT_FOUND: "That payment no longer exists.",
  RECURRING_NOT_FOUND: "That recurring template no longer exists.",
  RECURRING_TEMPLATE_INVALID:
    "The template can no longer be read — pause it and write a new one.",
  RECURRING_SCHEDULE_BACKWARD:
    "The next run cannot move back over months already generated — they would be created again.",
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
  FORBIDDEN_EXPERT:
    "Accountant access is read-only — reviews, sign-offs and exports only.",
  CLOSE_NOT_FOUND: "That close no longer exists.",
  CLOSE_NOT_FORWARD:
    "The close date must be after the current closed-through date.",
  CLOSE_NOT_LATEST: "Only the most recent close can be reopened.",
  CLOSE_NOT_COMPLETED: "That close was reopened — complete a new close first.",
  CLOSE_ALREADY_SIGNED: "This close is already signed off.",
  EXPORT_COOLDOWN: "An export just ran — try again in a minute.",
};

/**
 * A sentence for a stored error CODE.
 *
 * `recurring_entries.last_error` holds the code and never the message, and
 * `friendlyMessage` takes an error rather than a code — so the list page had no
 * way to say what a note meant. Unknown strings, including the sweep's own
 * `"UNKNOWN"`, get a plain fallback rather than `undefined` in a badge.
 */
export function failureSentence(code: string): string {
  return (
    (FRIENDLY as Record<string, string | undefined>)[code] ??
    "Failed for a reason the sweep could not name."
  );
}

export function friendlyMessage(err: unknown): string {
  if (err instanceof LedgerError) return FRIENDLY[err.code];
  return "Something went wrong. Please try again.";
}
