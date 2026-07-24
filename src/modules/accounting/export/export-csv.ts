import { centsToCsvAmount } from "../lib/money";
import { toCsv } from "../lib/csv";
import type {
  Account,
  AccountingSettings,
  AuditEntry,
  BankAccount,
  BankTransaction,
  Bill,
  BillLine,
  BillPayment,
  CloseNote,
  Customer,
  DimensionMember,
  Document,
  DocumentLink,
  Invoice,
  InvoiceLine,
  InvoicePayment,
  JournalEntry,
  JournalLine,
  LineDimension,
  PeriodClose,
  Reconciliation,
  ReconciliationLine,
  RecurringInvoice,
  Vendor,
} from "@/db/schema";

/**
 * Full-books export: pure per-table CSV builders (the testable seam).
 * Shape rules (P15):
 *  - business columns only — NEVER inbound_email_token, cooldown
 *    timestamps, plaid rows/ids, ai_coding or extraction jsonb
 *  - raw ids AND joined human labels where a cheap in-memory map suffices
 *  - money through centsToCsvAmount (integer construction), dates as ISO
 */

export interface BooksData {
  accounts: Account[];
  journalEntries: JournalEntry[];
  journalLines: JournalLine[];
  dimensionMembers: DimensionMember[];
  lineDimensions: LineDimension[];
  settings: AccountingSettings;
  periodCloses: PeriodClose[];
  closeNotes: CloseNote[];
  auditLog: AuditEntry[];
  customers: Customer[];
  invoices: Invoice[];
  invoiceLines: InvoiceLine[];
  invoicePayments: InvoicePayment[];
  recurringInvoices: RecurringInvoice[];
  vendors: Vendor[];
  bills: Bill[];
  billLines: BillLine[];
  billPayments: BillPayment[];
  bankAccounts: BankAccount[];
  bankTransactions: BankTransaction[];
  reconciliations: Reconciliation[];
  reconciliationLines: ReconciliationLine[];
  documents: Document[];
  documentLinks: DocumentLink[];
}

export interface BooksCsvFile {
  zipPath: string;
  description: string;
  content: string;
  rowCount: number;
}

const ts = (d: Date | null | undefined): string => (d ? d.toISOString() : "");
const money = (cents: number): string => centsToCsvAmount(cents);
const debit = (cents: number): string => (cents > 0 ? money(cents) : "");
const credit = (cents: number): string => (cents < 0 ? money(-cents) : "");

function file(
  zipPath: string,
  description: string,
  header: string[],
  body: string[][],
): BooksCsvFile {
  return {
    zipPath,
    description,
    content: toCsv([header, ...body]),
    rowCount: body.length,
  };
}

export function buildBooksCsvFiles(data: BooksData): BooksCsvFile[] {
  const accountById = new Map(data.accounts.map((a) => [a.id, a]));
  const entryById = new Map(data.journalEntries.map((e) => [e.id, e]));
  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const vendorById = new Map(data.vendors.map((v) => [v.id, v]));
  const bankAccountById = new Map(data.bankAccounts.map((b) => [b.id, b]));
  const memberById = new Map(data.dimensionMembers.map((m) => [m.id, m]));
  const invoiceById = new Map(data.invoices.map((i) => [i.id, i]));
  const billById = new Map(data.bills.map((b) => [b.id, b]));
  const documentById = new Map(data.documents.map((d) => [d.id, d]));

  const acctCode = (id: string | null): string =>
    id ? (accountById.get(id)?.code ?? id) : "";
  const acctName = (id: string | null): string =>
    id ? (accountById.get(id)?.name ?? "") : "";
  const custName = (id: string): string => customerById.get(id)?.name ?? "";
  const vendName = (id: string): string => vendorById.get(id)?.name ?? "";

  const files: BooksCsvFile[] = [];

  files.push(
    file(
      "ledger/accounts.csv",
      "Chart of accounts",
      ["id", "code", "name", "type", "subtype", "parent_code", "active", "system", "description"],
      data.accounts.map((a) => [
        a.id, a.code, a.name, a.accountType, a.subtype,
        a.parentId ? acctCode(a.parentId) : "",
        String(a.isActive), String(a.isSystem), a.description,
      ]),
    ),
  );

  files.push(
    file(
      "ledger/journal_entries.csv",
      "Journal entry headers",
      ["id", "date", "memo", "status", "source", "source_id", "reverses_entry_id", "posted_at", "created_by"],
      data.journalEntries.map((e) => [
        e.id, e.entryDate, e.memo, e.status, e.source, e.sourceId ?? "",
        e.reversesEntryId ?? "", ts(e.postedAt), e.createdByClerkUserId ?? "",
      ]),
    ),
  );

  files.push(
    file(
      "ledger/journal_lines.csv",
      "Journal lines (debits and credits) with account and entry context",
      ["id", "entry_id", "entry_date", "entry_status", "line_no", "account_code", "account_name", "debit", "credit", "memo"],
      data.journalLines.map((l) => {
        const e = entryById.get(l.entryId);
        return [
          l.id, l.entryId, e?.entryDate ?? "", e?.status ?? "", String(l.lineNo),
          acctCode(l.accountId), acctName(l.accountId),
          debit(l.amountCents), credit(l.amountCents), l.memo,
        ];
      }),
    ),
  );

  files.push(
    file(
      "ledger/dimension_members.csv",
      "Reporting dimensions (tags)",
      ["id", "dimension_type", "name", "active"],
      data.dimensionMembers.map((m) => [
        m.id, m.dimensionType, m.displayName, String(m.isActive),
      ]),
    ),
  );

  files.push(
    file(
      "ledger/line_dimensions.csv",
      "Dimension tags applied to lines",
      ["id", "journal_line_id", "invoice_line_id", "bill_line_id", "dimension_type", "member_name"],
      data.lineDimensions.map((d) => [
        d.id, d.journalLineId ?? "", d.invoiceLineId ?? "", d.billLineId ?? "",
        d.dimensionType, memberById.get(d.memberId)?.displayName ?? "",
      ]),
    ),
  );

  // Exactly the five policy fields — never the email token or AI cooldowns.
  files.push(
    file(
      "ledger/settings.csv",
      "Accounting policy settings",
      ["closed_through", "coa_template", "fiscal_year_start_month", "entry_edit_policy", "bookkeeping_timezone"],
      [[
        data.settings.closedThrough ?? "",
        data.settings.coaTemplate,
        String(data.settings.fiscalYearStartMonth),
        data.settings.entryEditPolicy,
        data.settings.bookkeepingTimezone,
      ]],
    ),
  );

  files.push(
    file(
      "ledger/period_closes.csv",
      "Month-end close history",
      ["id", "period_end", "status", "completed_by", "completed_at", "signed_off_by", "signed_off_at", "reopened_by", "reopened_at", "open_items_at_close"],
      data.periodCloses.map((c) => {
        const checklist = c.checklist as { blockerCount?: number } | null;
        return [
          c.id, c.periodEnd, c.status,
          c.completedByClerkUserId, ts(c.completedAt),
          c.signedOffByClerkUserId ?? "", ts(c.signedOffAt),
          c.reopenedByClerkUserId ?? "", ts(c.reopenedAt),
          String(checklist?.blockerCount ?? ""),
        ];
      }),
    ),
  );

  files.push(
    file(
      "ledger/close_notes.csv",
      "Close review notes",
      ["id", "close_period_end", "author", "body", "created_at"],
      data.closeNotes.map((n) => {
        const close = data.periodCloses.find((c) => c.id === n.closeId);
        return [
          n.id, close?.periodEnd ?? "", n.authorClerkUserId, n.body, ts(n.createdAt),
        ];
      }),
    ),
  );

  files.push(
    file(
      "ledger/audit_log.csv",
      "The audit trail — every recorded action on these books",
      ["created_at", "action", "actor", "target_type", "target_id", "meta_json"],
      data.auditLog.map((a) => [
        ts(a.createdAt), a.action,
        a.actorClerkUserId ?? a.actorLabel ?? "",
        a.targetType ?? "", a.targetId ?? "",
        JSON.stringify(a.meta ?? {}),
      ]),
    ),
  );

  files.push(
    file(
      "sales/customers.csv",
      "Customers",
      ["id", "name", "email", "phone", "address", "notes", "active"],
      data.customers.map((c) => [
        c.id, c.name, c.email, c.phone, c.address, c.notes, String(c.isActive),
      ]),
    ),
  );

  files.push(
    file(
      "sales/invoices.csv",
      "Invoices",
      ["id", "invoice_number", "customer", "status", "issue_date", "due_date", "memo", "total", "journal_entry_id"],
      data.invoices.map((i) => [
        i.id, i.invoiceNumber, custName(i.customerId), i.status,
        i.issueDate, i.dueDate ?? "", i.memo, money(i.totalCents),
        i.journalEntryId ?? "",
      ]),
    ),
  );

  files.push(
    file(
      "sales/invoice_lines.csv",
      "Invoice lines",
      ["id", "invoice_number", "line_no", "description", "quantity", "unit_price", "amount", "income_account_code"],
      data.invoiceLines.map((l) => [
        l.id, invoiceById.get(l.invoiceId)?.invoiceNumber ?? l.invoiceId,
        String(l.lineNo), l.description, l.quantity, money(l.unitPriceCents),
        money(l.amountCents), acctCode(l.incomeAccountId),
      ]),
    ),
  );

  files.push(
    file(
      "sales/invoice_payments.csv",
      "Invoice payments received",
      ["id", "invoice_number", "date", "amount", "method", "deposited_to", "memo", "journal_entry_id"],
      data.invoicePayments.map((p) => [
        p.id, invoiceById.get(p.invoiceId)?.invoiceNumber ?? p.invoiceId,
        p.paymentDate, money(p.amountCents), p.method,
        acctName(p.depositAccountId) || acctCode(p.depositAccountId),
        p.memo, p.journalEntryId,
      ]),
    ),
  );

  files.push(
    file(
      "sales/recurring_invoices.csv",
      "Recurring invoice templates (template body omitted)",
      ["id", "name", "customer", "frequency", "day_of_month", "next_run_date", "active", "last_generated_at"],
      data.recurringInvoices.map((r) => [
        r.id, r.name, custName(r.customerId), r.frequency,
        String(r.dayOfMonth), r.nextRunDate, String(r.isActive),
        ts(r.lastGeneratedAt),
      ]),
    ),
  );

  files.push(
    file(
      "purchases/vendors.csv",
      "Vendors",
      ["id", "name", "email", "phone", "address", "notes", "default_expense_account", "active"],
      data.vendors.map((v) => [
        v.id, v.name, v.email, v.phone, v.address, v.notes,
        acctCode(v.defaultExpenseAccountId), String(v.isActive),
      ]),
    ),
  );

  // ai_coding jsonb deliberately omitted (AI artifact, not books of record).
  files.push(
    file(
      "purchases/bills.csv",
      "Vendor bills",
      ["id", "vendor", "vendor_invoice_number", "status", "bill_date", "due_date", "memo", "total", "journal_entry_id"],
      data.bills.map((b) => [
        b.id, vendName(b.vendorId), b.billNumber, b.status, b.billDate,
        b.dueDate ?? "", b.memo, money(b.totalCents), b.journalEntryId ?? "",
      ]),
    ),
  );

  files.push(
    file(
      "purchases/bill_lines.csv",
      "Bill lines",
      ["id", "bill_id", "vendor", "line_no", "description", "amount", "account_code"],
      data.billLines.map((l) => [
        l.id, l.billId, vendName(billById.get(l.billId)?.vendorId ?? ""),
        String(l.lineNo), l.description, money(l.amountCents),
        acctCode(l.accountId),
      ]),
    ),
  );

  files.push(
    file(
      "purchases/bill_payments.csv",
      "Bill payments made",
      ["id", "bill_id", "vendor", "date", "amount", "method", "paid_from", "memo", "journal_entry_id"],
      data.billPayments.map((p) => [
        p.id, p.billId, vendName(billById.get(p.billId)?.vendorId ?? ""),
        p.paymentDate, money(p.amountCents), p.method,
        acctName(p.paidFromAccountId) || acctCode(p.paidFromAccountId),
        p.memo, p.journalEntryId,
      ]),
    ),
  );

  // Plaid linkage ids omitted — connection metadata, not books of record.
  files.push(
    file(
      "banking/bank_accounts.csv",
      "Bank and card registers",
      ["id", "name", "kind", "institution", "last4", "ledger_account_code", "active"],
      data.bankAccounts.map((b) => [
        b.id, b.name, b.kind, b.institution, b.last4,
        acctCode(b.accountId), String(b.isActive),
      ]),
    ),
  );

  files.push(
    file(
      "banking/bank_transactions.csv",
      "Imported bank feed rows (raw source payload included)",
      ["id", "bank_account", "date", "description", "amount", "source", "status", "journal_entry_id", "raw_json"],
      data.bankTransactions.map((t) => [
        t.id, bankAccountById.get(t.bankAccountId)?.name ?? "",
        t.txnDate, t.description, money(t.amountCents), t.source, t.status,
        t.journalEntryId ?? "", t.raw ? JSON.stringify(t.raw) : "",
      ]),
    ),
  );

  files.push(
    file(
      "banking/reconciliations.csv",
      "Reconciliation statements",
      ["id", "bank_account", "statement_end_date", "statement_balance", "status", "completed_at", "created_by"],
      data.reconciliations.map((r) => [
        r.id, bankAccountById.get(r.bankAccountId)?.name ?? "",
        r.statementEndDate, money(r.statementEndBalanceCents), r.status,
        ts(r.completedAt), r.createdByClerkUserId,
      ]),
    ),
  );

  files.push(
    file(
      "banking/reconciliation_lines.csv",
      "Cleared ledger lines per reconciliation",
      ["id", "reconciliation_id", "journal_line_id"],
      data.reconciliationLines.map((l) => [
        l.id, l.reconciliationId, l.journalLineId,
      ]),
    ),
  );

  // extraction jsonb deliberately omitted (AI artifact).
  files.push(
    file(
      "documents/documents.csv",
      "Stored receipts, bills and files",
      ["id", "file_name", "mime_type", "size_bytes", "sha256", "source", "status", "email_from", "email_subject", "email_received_at", "uploaded_by", "created_at", "trashed_at", "zip_file"],
      data.documents.map((doc) => [
        doc.id, doc.fileName, doc.mimeType, String(doc.sizeBytes), doc.sha256,
        doc.source, doc.status, doc.emailFrom, doc.emailSubject,
        ts(doc.emailReceivedAt), doc.uploadedByClerkUserId ?? "",
        ts(doc.createdAt), ts(doc.trashedAt),
        doc.blobPathname ? documentZipEntryName(doc.id, doc.fileName) : "",
      ]),
    ),
  );

  files.push(
    file(
      "documents/document_links.csv",
      "Where each document is attached",
      ["id", "document_file_name", "linked_to", "created_at"],
      data.documentLinks.map((l) => {
        const target = l.journalEntryId
          ? `journal_entry:${l.journalEntryId}`
          : l.bankTransactionId
            ? `bank_transaction:${l.bankTransactionId}`
            : l.invoiceId
              ? `invoice:${invoiceById.get(l.invoiceId)?.invoiceNumber ?? l.invoiceId}`
              : l.billId
                ? `bill:${l.billId}`
                : "";
        return [
          l.id, documentById.get(l.documentId)?.fileName ?? "", target,
          ts(l.createdAt),
        ];
      }),
    ),
  );

  return files;
}

/** Windows/zip-safe file name: strip reserved chars, collapse spaces, cap. */
export function sanitizeZipFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "file").slice(0, 120);
}

/** Stable zip entry name for a document blob. */
export function documentZipEntryName(id: string, fileName: string): string {
  return `documents/files/${id.slice(0, 8)}_${sanitizeZipFileName(fileName)}`;
}

export function buildManifestCsv(
  files: BooksCsvFile[],
  documents: Array<{ zipPath: string; sizeBytes: number }>,
): string {
  const rows: string[][] = [["path", "description", "rows_or_bytes"]];
  for (const f of files) {
    rows.push([f.zipPath, f.description, `${f.rowCount} rows`]);
  }
  for (const d of documents) {
    rows.push([d.zipPath, "Original document file", `${d.sizeBytes} bytes`]);
  }
  return toCsv(rows);
}

export function buildReadme(opts: {
  tenantName: string;
  exportedAtIso: string;
  includesFiles: boolean;
  reportNote: string;
}): string {
  return [
    `FULL BOOKS EXPORT — ${opts.tenantName}`,
    `Exported ${opts.exportedAtIso} by Yosher.`,
    "",
    "Your books belong to you. This archive is a complete copy of your",
    "accounting records, readable by any spreadsheet program:",
    "",
    "  ledger/     Chart of accounts, every journal entry and line, tags,",
    "              policy settings, close history, and the full audit trail.",
    "  reports/    Human-readable statements as of the export date.",
    `              ${opts.reportNote}`,
    "  sales/      Customers, invoices, lines, payments, recurring templates.",
    "  purchases/  Vendors, bills, lines, payments.",
    "  banking/    Registers, imported feed rows, reconciliations.",
    "  documents/  The document register and attachment index." +
      (opts.includesFiles
        ? " Original files are under documents/files/."
        : " (File contents were not included in this export.)"),
    "",
    "  manifest.csv lists every file in this archive.",
    "",
    "All amounts are decimal dollars; dates are YYYY-MM-DD.",
    "If this archive fails to open, the download was interrupted — export again.",
    "",
  ].join("\n");
}
