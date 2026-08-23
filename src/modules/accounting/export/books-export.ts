import "server-only";
import { asc, eq, isNotNull, and } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { logAuditInTx } from "@/lib/audit";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { LedgerError, type LedgerCtx } from "../core";
import { getSettings } from "../core/guards";
import { getTrialBalance } from "../core/balances";
import { residualIfConsolidated, residualNote } from "../core/consolidation";
import {
  entityScopeLabel,
  listEntities,
  type EntityScope,
} from "../core/entities";
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

/** A company name reduced to something safe inside a zip path. */
function statementFilePart(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "company"
  );
}

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
    entities: await listEntities(tx, tid, { includeInactive: true }),
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
    timezone: await getTenantTimezone(tx, tid),
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
    // The email and phone the two role CSVs carry. Whole-tenant rather than
    // joined per role row: a party that is both a customer and a vendor would
    // otherwise be fetched twice, and the builder indexes by party anyway.
    partyContactPoints: await tx.query.partyContactPoints.findMany({
      where: eq(schema.partyContactPoints.tenantId, tid),
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
    // Without these, `tax_rate` on an invoice row is a uuid nobody can read
    // and the tax columns cannot be checked against anything.
    salesTaxRates: await tx.query.salesTaxRates.findMany({
      where: eq(schema.salesTaxRates.tenantId, tid),
      orderBy: asc(schema.salesTaxRates.name),
    }),
    recurringEntries: await tx.query.recurringEntries.findMany({
      where: eq(schema.recurringEntries.tenantId, tid),
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
  //
  // ONE SET PER COMPANY, AND A COMBINED SET, once a tenant has more than one
  // legal entity (ADR 0010). A tax return is filed per entity, so a books
  // export that could only produce the combined statements would be incomplete
  // for exactly the client this feature was built for — and "take your books
  // and go" has to mean the books somebody actually files from. For the
  // single-entity tenant the loop runs once with no label, so every filename
  // and every byte is what it was.
  const fyStart = fiscalYearStart(opts.todayIso, settings.fiscalYearStartMonth);
  const multi = data.entities.length > 1;
  const runs: Array<{ scope: EntityScope; label: string | undefined }> = multi
    ? [
        ...data.entities.map((e) => ({
          scope: { kind: "one" as const, entityId: e.id },
          label: e.name,
        })),
        {
          scope: { kind: "combined" as const },
          label: entityScopeLabel({ kind: "combined" }, data.entities),
        },
        // AND A CONSOLIDATED SET (slice 3), which is the one an accountant
        // asked for: the group's figures with intercompany eliminated. It sits
        // BESIDE the combined set rather than replacing it — combined is the
        // plain sum and still means exactly what it meant, and an export whose
        // "combined" files quietly started eliminating would change what every
        // archived zip says.
        {
          scope: { kind: "consolidated" as const },
          label: entityScopeLabel({ kind: "consolidated" }, data.entities),
        },
      ]
    : [{ scope: { kind: "combined" as const }, label: undefined }];

  for (const run of runs) {
    const part = run.label ? `_${statementFilePart(run.label)}` : "";
    const suffix = run.label ? ` — ${run.label}` : "";
    // Null on every run but the consolidated one, and on that one only when a
    // hand-written affiliate journal left something elimination could not
    // follow. The two windows differ for the same reason they differ on the
    // pages: a P&L covers the period, a balance sheet is cumulative.
    const periodResidual = await residualIfConsolidated(tx, tid, run.scope, {
      from: fyStart,
      to: opts.todayIso,
    });
    const asOfResidual = await residualIfConsolidated(tx, tid, run.scope, {
      asOf: opts.todayIso,
    });
    const periodNote = periodResidual ? residualNote(periodResidual) : undefined;
    const asOfNote = asOfResidual ? residualNote(asOfResidual) : undefined;
    const pnl = await getProfitAndLoss(tx, tid, {
      scope: run.scope,
      from: fyStart,
      to: opts.todayIso,
    });
    csvFiles.push({
      zipPath: `reports/profit-and-loss_${fyStart}_${opts.todayIso}${part}.csv`,
      description: `Profit & loss, fiscal year to export date${suffix}`,
      content: toCsv(pnlToCsvRows(pnl, "accrual", run.label, periodNote)),
      rowCount: pnl.rows.length,
    });
    const bs = await getBalanceSheet(tx, tid, {
      scope: run.scope,
      asOf: opts.todayIso,
    });
    csvFiles.push({
      zipPath: `reports/balance-sheet_${opts.todayIso}${part}.csv`,
      description: `Balance sheet as of export date${suffix}`,
      content: toCsv(balanceSheetToCsvRows(bs, "accrual", run.label, asOfNote)),
      rowCount: bs.rows.length,
    });
    const tb = await getTrialBalance(tx, tid, opts.todayIso, run.scope);
    csvFiles.push({
      zipPath: `reports/trial-balance_${opts.todayIso}${part}.csv`,
      description: `Trial balance as of export date${suffix}`,
      content: toCsv(
        trialBalanceToCsvRows(tb, opts.todayIso, run.label, asOfNote),
      ),
      rowCount: tb.rows.length,
    });
  }

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
