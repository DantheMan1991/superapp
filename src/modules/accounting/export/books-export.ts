import "server-only";
import { asc, eq, isNotNull, and } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, type LedgerCtx } from "../core";
import { getSettings } from "../core/guards";
import { getTrialBalance } from "../core/balances";
import { getBalanceSheet, getProfitAndLoss } from "../core/reports";
import {
  balanceSheetToCsvRows,
  pnlToCsvRows,
  toCsv,
  trialBalanceToCsvRows,
} from "../lib/csv";
import { fiscalYearStart } from "../lib/dates";
import {
  buildBooksCsvFiles,
  buildManifestCsv,
  buildReadme,
  documentZipEntryName,
  type BooksCsvFile,
} from "./export-csv";

const COOLDOWN_MS = 60_000;

export interface BooksExportGathered {
  csvFiles: BooksCsvFile[];
  docs: Array<{ zipPath: string; blobPathname: string; sizeBytes: number }>;
  readme: string;
  manifestCsv: string;
}

/**
 * One tenant read gathering every CSV for the books export, claiming the
 * 60s cooldown slot in the same tx (AI-cooldown precedent — in-memory
 * limits don't survive serverless), and writing the audit row. The caller
 * streams blobs AFTER this tx has committed — the tx never spans I/O to
 * the blob store.
 *
 * Owner + expert: pulling the books is the canonical accountant task.
 * Staff is refused — a bulk-exfiltration surface with no workflow need.
 */
export async function gatherBooksExport(
  tx: Tx,
  ctx: LedgerCtx,
  opts: { includeFiles: boolean; todayIso: string; tenantName: string },
): Promise<BooksExportGathered> {
  if (ctx.role === "staff") {
    throw new LedgerError("FORBIDDEN", "owner or accountant role required");
  }
  const settings = await getSettings(tx, ctx.tenantId);
  if (settings.booksExportLastAt) {
    const age = Date.now() - settings.booksExportLastAt.getTime();
    if (age < COOLDOWN_MS) {
      throw new LedgerError("EXPORT_COOLDOWN", `last export ${age}ms ago`);
    }
  }
  await tx
    .update(schema.accountingSettings)
    .set({ booksExportLastAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.accountingSettings.id, settings.id));

  const tid = ctx.tenantId;
  const data = {
    accounts: await tx.query.accounts.findMany({
      where: eq(schema.accounts.tenantId, tid),
      orderBy: asc(schema.accounts.code),
    }),
    journalEntries: await tx.query.journalEntries.findMany({
      where: eq(schema.journalEntries.tenantId, tid),
      orderBy: asc(schema.journalEntries.entryDate),
    }),
    journalLines: await tx.query.journalLines.findMany({
      where: eq(schema.journalLines.tenantId, tid),
    }),
    dimensionMembers: await tx.query.dimensionMembers.findMany({
      where: eq(schema.dimensionMembers.tenantId, tid),
    }),
    lineDimensions: await tx.query.lineDimensions.findMany({
      where: eq(schema.lineDimensions.tenantId, tid),
    }),
    settings,
    periodCloses: await tx.query.periodCloses.findMany({
      where: eq(schema.periodCloses.tenantId, tid),
      orderBy: asc(schema.periodCloses.periodEnd),
    }),
    closeNotes: await tx.query.closeNotes.findMany({
      where: eq(schema.closeNotes.tenantId, tid),
      orderBy: asc(schema.closeNotes.createdAt),
    }),
    auditLog: await tx
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.tenantId, tid))
      .orderBy(asc(schema.auditLog.createdAt)),
    customers: await tx.query.customers.findMany({
      where: eq(schema.customers.tenantId, tid),
    }),
    invoices: await tx.query.invoices.findMany({
      where: eq(schema.invoices.tenantId, tid),
      orderBy: asc(schema.invoices.issueDate),
    }),
    invoiceLines: await tx.query.invoiceLines.findMany({
      where: eq(schema.invoiceLines.tenantId, tid),
    }),
    invoicePayments: await tx.query.invoicePayments.findMany({
      where: eq(schema.invoicePayments.tenantId, tid),
    }),
    recurringInvoices: await tx.query.recurringInvoices.findMany({
      where: eq(schema.recurringInvoices.tenantId, tid),
    }),
    vendors: await tx.query.vendors.findMany({
      where: eq(schema.vendors.tenantId, tid),
    }),
    bills: await tx.query.bills.findMany({
      where: eq(schema.bills.tenantId, tid),
      orderBy: asc(schema.bills.billDate),
    }),
    billLines: await tx.query.billLines.findMany({
      where: eq(schema.billLines.tenantId, tid),
    }),
    billPayments: await tx.query.billPayments.findMany({
      where: eq(schema.billPayments.tenantId, tid),
    }),
    bankAccounts: await tx.query.bankAccounts.findMany({
      where: eq(schema.bankAccounts.tenantId, tid),
    }),
    bankTransactions: await tx.query.bankTransactions.findMany({
      where: eq(schema.bankTransactions.tenantId, tid),
      orderBy: asc(schema.bankTransactions.txnDate),
    }),
    reconciliations: await tx.query.reconciliations.findMany({
      where: eq(schema.reconciliations.tenantId, tid),
    }),
    reconciliationLines: await tx.query.reconciliationLines.findMany({
      where: eq(schema.reconciliationLines.tenantId, tid),
    }),
    documents: await tx.query.documents.findMany({
      where: eq(schema.documents.tenantId, tid),
    }),
    documentLinks: await tx.query.documentLinks.findMany({
      where: eq(schema.documentLinks.tenantId, tid),
    }),
  };

  const csvFiles = buildBooksCsvFiles(data);

  // Human-readable statements as of the export date.
  const fyStart = fiscalYearStart(opts.todayIso, settings.fiscalYearStartMonth);
  const pnl = await getProfitAndLoss(tx, tid, {
    from: fyStart,
    to: opts.todayIso,
  });
  csvFiles.push({
    zipPath: `reports/profit-and-loss_${fyStart}_${opts.todayIso}.csv`,
    description: "Profit & loss, fiscal year to export date",
    content: toCsv(pnlToCsvRows(pnl)),
    rowCount: pnl.rows.length,
  });
  const bs = await getBalanceSheet(tx, tid, { asOf: opts.todayIso });
  csvFiles.push({
    zipPath: `reports/balance-sheet_${opts.todayIso}.csv`,
    description: "Balance sheet as of export date",
    content: toCsv(balanceSheetToCsvRows(bs)),
    rowCount: bs.rows.length,
  });
  const tb = await getTrialBalance(tx, tid, opts.todayIso);
  csvFiles.push({
    zipPath: `reports/trial-balance_${opts.todayIso}.csv`,
    description: "Trial balance as of export date",
    content: toCsv(trialBalanceToCsvRows(tb, opts.todayIso)),
    rowCount: tb.rows.length,
  });

  // Soft-deleted (trashed) documents included: this is the retention artifact.
  const docs = opts.includeFiles
    ? (
        await tx.query.documents.findMany({
          where: and(
            eq(schema.documents.tenantId, tid),
            isNotNull(schema.documents.blobPathname),
          ),
        })
      ).map((doc) => ({
        zipPath: documentZipEntryName(doc.id, doc.fileName),
        blobPathname: doc.blobPathname as string,
        sizeBytes: doc.sizeBytes,
      }))
    : [];

  const manifestCsv = buildManifestCsv(csvFiles, docs);
  const readme = buildReadme({
    tenantName: opts.tenantName,
    exportedAtIso: new Date().toISOString(),
    includesFiles: opts.includeFiles,
    reportNote: `Fiscal year starts month ${settings.fiscalYearStartMonth}.`,
  });

  const csvBytes = csvFiles.reduce((a, f) => a + f.content.length, 0);
  await logAuditInTx(tx, {
    action: "books.exported",
    tenantId: tid,
    actorClerkUserId: ctx.userId,
    targetType: "tenant",
    targetId: tid,
    meta: {
      files: opts.includeFiles,
      tables: csvFiles.length,
      documents: docs.length,
      csvBytes,
    },
  });

  return { csvFiles, docs, readme, manifestCsv };
}
