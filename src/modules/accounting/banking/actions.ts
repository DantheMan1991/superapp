"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAudit, logAuditInTx } from "@/lib/audit";
import {
  LedgerError,
  cancelReconciliation,
  completeReconciliation,
  friendlyMessage,
  postEntry,
  reopenReconciliation,
  requireOwnerRole,
  startReconciliation,
  toggleReconciliationLine,
  type LedgerCtx,
} from "../core";
import { MAX_AMOUNT_CENTS, isValidIsoDate } from "../lib/money";
import {
  createBankAccount,
  loadBankAccount,
  setBankAccountActive,
  updateBankAccount,
} from "./accounts";
import {
  detectColumns,
  detectDateFormat,
  normalizeRows,
  parseCsv,
  type ColumnMapping,
} from "./csv-parse";
import { importTransactions } from "./import";
import { categorizeTransaction, readAiSuggestion, setTransactionExcluded } from "./review";
import { suggestCategoriesForBankAccount } from "../ai/suggest";
import {
  createLinkToken,
  disconnectPlaidItem,
  exchangePublicToken,
  syncPlaidItem,
} from "./plaid";

const BASE = "/dashboard/m/accounting";
const MAX_CSV_CHARS = 1_000_000;
const MAX_CSV_ROWS = 10_001;
const ACCEPT_CONFIDENCE = 0.7;

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof LedgerError) return { error: friendlyMessage(err) };
  console.error("banking action failed", err);
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("PLAID_CLIENT_ID")) {
    return { error: "Plaid isn't configured yet — add the keys to .env (see SETUP.md)." };
  }
  if (msg.includes("APP_ENCRYPTION_KEY")) {
    return { error: "APP_ENCRYPTION_KEY isn't configured yet — see SETUP.md." };
  }
  if (msg.includes("ANTHROPIC_API_KEY")) {
    return { error: "The Claude API key isn't configured yet — see SETUP.md." };
  }
  return { error: "Something went wrong. Please try again." };
}

function revalidateBanking(bankAccountId?: string): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/banking`);
  if (bankAccountId) {
    revalidatePath(`${BASE}/banking/${bankAccountId}`);
    revalidatePath(`${BASE}/banking/${bankAccountId}/reconcile`);
  }
  revalidatePath(`${BASE}/journal`);
  revalidatePath(`${BASE}/trial-balance`);
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate, "Not a real calendar date");

// ------------------------------------------------------------ bank accounts

const createBankAccountSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["checking", "savings", "credit_card"]),
    institution: z.string().trim().max(120).optional(),
    last4: z.string().regex(/^\d{0,4}$/).optional(),
    openingBalanceCents: z
      .number()
      .int()
      .refine((n) => Math.abs(n) <= MAX_AMOUNT_CENTS)
      .nullable()
      .optional(),
    openingBalanceDate: dateStr.nullable().optional(),
  })
  .refine(
    (v) =>
      v.openingBalanceCents == null ||
      v.openingBalanceCents === 0 ||
      !!v.openingBalanceDate,
    { message: "Opening balance needs a date" },
  );

export async function createBankAccountAction(
  input: z.infer<typeof createBankAccountSchema>,
): Promise<ActionResult<{ bankAccountId: string }>> {
  const ctx = await gate();
  const parsed = createBankAccountSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const result = await withTenant(ctx.tenantId, async (tx) => {
      const r = await createBankAccount(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "banking.account_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bank_account",
        targetId: r.bankAccount.id,
        meta: {
          kind: parsed.data.kind,
          code: r.ledgerAccount.code,
          openingBalanceCents: parsed.data.openingBalanceCents ?? 0,
        },
      });
      return r;
    });
    revalidateBanking(result.bankAccount.id);
    revalidatePath(`${BASE}/accounts`);
    return { ok: true, data: { bankAccountId: result.bankAccount.id } };
  } catch (err) {
    return fail(err);
  }
}

const updateBankAccountSchema = z.object({
  bankAccountId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    institution: z.string().trim().max(120).optional(),
    last4: z.string().regex(/^\d{0,4}$/).optional(),
  }),
});

export async function updateBankAccountAction(
  input: z.infer<typeof updateBankAccountSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateBankAccountSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const { before, after } = await updateBankAccount(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "banking.account_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bank_account",
        targetId: parsed.data.bankAccountId,
        meta: {
          before: { name: before.name, institution: before.institution },
          after: { name: after.name, institution: after.institution },
        },
      });
    });
    revalidateBanking(parsed.data.bankAccountId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const setActiveSchema = z.object({
  bankAccountId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  active: z.boolean(),
});

export async function setBankAccountActiveAction(
  input: z.infer<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await setBankAccountActive(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.active
          ? "banking.account_reactivated"
          : "banking.account_deactivated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bank_account",
        targetId: parsed.data.bankAccountId,
      });
    });
    revalidateBanking(parsed.data.bankAccountId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------ CSV

const csvPayloadSchema = z.object({
  bankAccountId: z.string().uuid(),
  csvText: z.string().min(1).max(MAX_CSV_CHARS),
});

export interface CsvPreview {
  headers: string[];
  hasHeader: boolean;
  sampleRows: string[][];
  suggestedMapping: Partial<ColumnMapping>;
  dateFormat: { format: ColumnMapping["dateFormat"]; ambiguous: boolean } | null;
  rowCount: number;
}

export async function parseCsvPreviewAction(
  input: z.infer<typeof csvPayloadSchema>,
): Promise<ActionResult<CsvPreview>> {
  const ctx = await gate();
  const parsed = csvPayloadSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    requireOwnerRole(ctx);
    await withTenant(ctx.tenantId, (tx) =>
      loadBankAccount(tx, ctx.tenantId, parsed.data.bankAccountId),
    );
    let rows: string[][];
    try {
      rows = parseCsv(parsed.data.csvText);
    } catch {
      return { error: "That file doesn't look like a valid CSV." };
    }
    if (rows.length === 0) return { error: "The file is empty." };
    if (rows.length > MAX_CSV_ROWS) {
      return { error: `Too many rows (max ${MAX_CSV_ROWS - 1}). Split the file.` };
    }
    const detected = detectColumns(rows[0]);
    const dataRows = detected.hasHeader ? rows.slice(1) : rows;
    const dateSamples =
      detected.dateCol !== undefined
        ? dataRows.slice(0, 25).map((r) => r[detected.dateCol!] ?? "")
        : [];
    return {
      ok: true,
      data: {
        headers: rows[0],
        hasHeader: detected.hasHeader,
        sampleRows: dataRows.slice(0, 10),
        suggestedMapping: detected,
        dateFormat: dateSamples.length > 0 ? detectDateFormat(dateSamples) : null,
        rowCount: dataRows.length,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

const mappingSchema = z
  .object({
    dateCol: z.number().int().min(0),
    descCol: z.number().int().min(0),
    dateFormat: z.enum(["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY"]),
    negate: z.boolean(),
    amountCol: z.number().int().min(0).optional(),
    debitCol: z.number().int().min(0).optional(),
    creditCol: z.number().int().min(0).optional(),
    hasHeader: z.boolean(),
  })
  .refine(
    (m) =>
      m.amountCol !== undefined ||
      (m.debitCol !== undefined && m.creditCol !== undefined),
    { message: "Pick an amount column or a debit + credit pair" },
  );

export async function importCsvTransactionsAction(
  input: z.infer<typeof csvPayloadSchema> & { mapping: z.infer<typeof mappingSchema> },
): Promise<ActionResult<{ imported: number; skippedDuplicates: number }>> {
  const ctx = await gate();
  const payload = csvPayloadSchema.safeParse(input);
  const mapping = mappingSchema.safeParse(input?.mapping);
  if (!payload.success || !mapping.success) return { error: "Invalid input" };
  try {
    let rows: string[][];
    try {
      rows = parseCsv(payload.data.csvText);
    } catch {
      return { error: "That file doesn't look like a valid CSV." };
    }
    if (rows.length > MAX_CSV_ROWS) {
      return { error: `Too many rows (max ${MAX_CSV_ROWS - 1}). Split the file.` };
    }
    const dataRows = mapping.data.hasHeader ? rows.slice(1) : rows;
    const { txns, errors } = normalizeRows(dataRows, mapping.data);
    if (errors.length > 0) {
      const sample = errors
        .slice(0, 5)
        .map((e) => e.rowIndex + 1 + (mapping.data.hasHeader ? 1 : 0))
        .join(", ");
      return {
        error: `Rows ${sample}${errors.length > 5 ? "…" : ""} couldn't be read (bad date or amount). Fix the file or the mapping.`,
      };
    }
    if (txns.length === 0) return { error: "No transactions found in that file." };
    const result = await withTenant(ctx.tenantId, async (tx) => {
      const r = await importTransactions(tx, ctx, {
        bankAccountId: payload.data.bankAccountId,
        txns,
      });
      await logAuditInTx(tx, {
        action: "banking.csv_imported",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bank_account",
        targetId: payload.data.bankAccountId,
        meta: { imported: r.imported, skipped: r.skippedDuplicates, rowCount: txns.length },
      });
      return r;
    });
    revalidateBanking(payload.data.bankAccountId);
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------- review

const categorizeSchema = z.object({
  transactionId: z.string().uuid(),
  accountId: z.string().uuid(),
  dimensionMemberIds: z.array(z.string().uuid()).max(10).optional(),
  memo: z.string().trim().max(500).optional(),
});

export async function categorizeTransactionAction(
  input: z.infer<typeof categorizeSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = categorizeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const { entry, fromSuggestion, confidence } = await categorizeTransaction(
        tx,
        ctx,
        parsed.data,
      );
      await logAuditInTx(tx, {
        action: "banking.txn_categorized",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bank_transaction",
        targetId: parsed.data.transactionId,
        meta: {
          entryId: entry.id,
          accountId: parsed.data.accountId,
          fromSuggestion,
          confidence,
        },
      });
    });
    revalidateBanking();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const txnRefSchema = z.object({ transactionId: z.string().uuid() });

export async function excludeTransactionAction(
  input: z.infer<typeof txnRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = txnRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const txn = await setTransactionExcluded(tx, ctx, {
        transactionId: parsed.data.transactionId,
        excluded: true,
      });
      await logAuditInTx(tx, {
        action: "banking.txn_excluded",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bank_transaction",
        targetId: txn.id,
      });
    });
    revalidateBanking();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function restoreTransactionAction(
  input: z.infer<typeof txnRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = txnRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const txn = await setTransactionExcluded(tx, ctx, {
        transactionId: parsed.data.transactionId,
        excluded: false,
      });
      await logAuditInTx(tx, {
        action: "banking.txn_restored",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bank_transaction",
        targetId: txn.id,
      });
    });
    revalidateBanking();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const acceptSchema = z.object({
  transactionIds: z.array(z.string().uuid()).min(1).max(50),
});

/**
 * One transaction per item on purpose: a PERIOD_CLOSED (or any failure)
 * on item 3 must not roll back items 1–2.
 */
export async function acceptSuggestionsAction(
  input: z.infer<typeof acceptSchema>,
): Promise<ActionResult<{ posted: number; skipped: number; firstError?: string }>> {
  const ctx = await gate();
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  let posted = 0;
  let skipped = 0;
  let firstError: string | undefined;
  for (const transactionId of parsed.data.transactionIds) {
    try {
      const done = await withTenant(ctx.tenantId, async (tx) => {
        const txn = await tx.query.bankTransactions.findFirst({
          where: and(
            eq(schema.bankTransactions.tenantId, ctx.tenantId),
            eq(schema.bankTransactions.id, transactionId),
          ),
        });
        if (!txn || txn.status !== "unreviewed") return false;
        const suggestion = readAiSuggestion(txn);
        if (!suggestion || suggestion.confidence < ACCEPT_CONFIDENCE) return false;
        const { entry } = await categorizeTransaction(tx, ctx, {
          transactionId,
          accountId: suggestion.accountId,
        });
        await logAuditInTx(tx, {
          action: "banking.txn_categorized",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "bank_transaction",
          targetId: transactionId,
          meta: {
            entryId: entry.id,
            accountId: suggestion.accountId,
            fromSuggestion: true,
            confidence: suggestion.confidence,
            bulk: true,
          },
        });
        return true;
      });
      if (done) posted += 1;
      else skipped += 1;
    } catch (err) {
      skipped += 1;
      firstError ??= friendlyMessage(err);
    }
  }
  revalidateBanking();
  return { ok: true, data: { posted, skipped, firstError } };
}

// -------------------------------------------------------------------- AI

const suggestSchema = z.object({ bankAccountId: z.string().uuid() });

export async function suggestCategoriesAction(
  input: z.infer<typeof suggestSchema>,
): Promise<ActionResult<{ requested: number; returned: number }>> {
  const ctx = await gate();
  const parsed = suggestSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const result = await suggestCategoriesForBankAccount(
      ctx,
      parsed.data.bankAccountId,
    );
    if (result.requested > 0) {
      await logAudit({
        action: "banking.ai_suggested",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bank_account",
        targetId: parsed.data.bankAccountId,
        meta: { requested: result.requested, returned: result.returned },
      });
    }
    revalidateBanking(parsed.data.bankAccountId);
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

// -------------------------------------------------------------- quick add

const quickAddSchema = z.object({
  bankAccountId: z.string().uuid(),
  direction: z.enum(["expense", "income"]),
  txnDate: dateStr,
  categoryAccountId: z.string().uuid(),
  amountCents: z
    .number()
    .int()
    .positive()
    .refine((n) => n <= MAX_AMOUNT_CENTS),
  memo: z.string().trim().max(500).optional(),
  dimensionMemberIds: z.array(z.string().uuid()).max(10).optional(),
});

export async function quickAddTransactionAction(
  input: z.infer<typeof quickAddSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = quickAddSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const p = parsed.data;
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const bankAccount = await loadBankAccount(tx, ctx.tenantId, p.bankAccountId);
      const a = p.amountCents;
      const lines =
        p.direction === "expense"
          ? [
              {
                accountId: p.categoryAccountId,
                amountCents: a,
                dimensionMemberIds: p.dimensionMemberIds,
              },
              { accountId: bankAccount.accountId, amountCents: -a },
            ]
          : [
              { accountId: bankAccount.accountId, amountCents: a },
              {
                accountId: p.categoryAccountId,
                amountCents: -a,
                dimensionMemberIds: p.dimensionMemberIds,
              },
            ];
      const status = ctx.role === "owner" ? ("posted" as const) : ("draft" as const);
      const { entry } = await postEntry(tx, ctx, {
        status,
        entryDate: p.txnDate,
        memo: p.memo ?? "",
        source: "manual",
        lines,
      });
      await logAuditInTx(tx, {
        action: status === "posted" ? "ledger.entry_posted" : "ledger.entry_drafted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "journal_entry",
        targetId: entry.id,
        meta: { via: "quick_add", bankAccountId: p.bankAccountId },
      });
    });
    revalidateBanking(p.bankAccountId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// -------------------------------------------------------- reconciliation

const startReconSchema = z.object({
  bankAccountId: z.string().uuid(),
  statementEndDate: dateStr,
  statementEndBalanceCents: z
    .number()
    .int()
    .refine((n) => Math.abs(n) <= MAX_AMOUNT_CENTS),
});

export async function startReconciliationAction(
  input: z.infer<typeof startReconSchema>,
): Promise<ActionResult<{ reconciliationId: string }>> {
  const ctx = await gate();
  const parsed = startReconSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const recon = await withTenant(ctx.tenantId, async (tx) => {
      const r = await startReconciliation(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "banking.reconciliation_started",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "reconciliation",
        targetId: r.id,
        meta: {
          bankAccountId: parsed.data.bankAccountId,
          statementEndDate: parsed.data.statementEndDate,
          statementEndBalanceCents: parsed.data.statementEndBalanceCents,
        },
      });
      return r;
    });
    revalidateBanking(parsed.data.bankAccountId);
    return { ok: true, data: { reconciliationId: recon.id } };
  } catch (err) {
    return fail(err);
  }
}

const toggleLineSchema = z.object({
  reconciliationId: z.string().uuid(),
  journalLineId: z.string().uuid(),
  checked: z.boolean(),
});

/** Individual toggles are deliberately not audited (noise) — P13. */
export async function toggleReconciliationLineAction(
  input: z.infer<typeof toggleLineSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = toggleLineSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, (tx) => toggleReconciliationLine(tx, ctx, parsed.data));
    revalidateBanking();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const reconRefSchema = z.object({
  reconciliationId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function completeReconciliationAction(
  input: z.infer<typeof reconRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = reconRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const recon = await completeReconciliation(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "banking.reconciliation_completed",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "reconciliation",
        targetId: recon.id,
        meta: {
          bankAccountId: recon.bankAccountId,
          statementEndDate: recon.statementEndDate,
          statementEndBalanceCents: recon.statementEndBalanceCents,
        },
      });
    });
    revalidateBanking();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function cancelReconciliationAction(
  input: z.infer<typeof reconRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = reconRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await cancelReconciliation(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "banking.reconciliation_canceled",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "reconciliation",
        targetId: parsed.data.reconciliationId,
      });
    });
    revalidateBanking();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function reopenReconciliationAction(
  input: z.infer<typeof reconRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = reconRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const recon = await reopenReconciliation(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "banking.reconciliation_reopened",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "reconciliation",
        targetId: recon.id,
        meta: {
          bankAccountId: recon.bankAccountId,
          statementEndDate: recon.statementEndDate,
        },
      });
    });
    revalidateBanking();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------ Plaid

export async function createPlaidLinkTokenAction(): Promise<
  ActionResult<{ linkToken: string }>
> {
  const ctx = await gate();
  try {
    const linkToken = await createLinkToken(ctx);
    return { ok: true, data: { linkToken } };
  } catch (err) {
    return fail(err);
  }
}

const exchangeSchema = z.object({
  publicToken: z.string().min(1).max(500),
  institutionName: z.string().trim().max(200),
});

export async function exchangePlaidPublicTokenAction(
  input: z.infer<typeof exchangeSchema>,
): Promise<
  ActionResult<{
    plaidItemId: string;
    accounts: Array<{ plaidAccountId: string; name: string; mask: string; kind: "checking" | "savings" | "credit_card" }>;
  }>
> {
  const ctx = await gate();
  const parsed = exchangeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const result = await exchangePublicToken(ctx, parsed.data);
    await logAudit({
      action: "banking.plaid_connected",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      meta: {
        institution: parsed.data.institutionName,
        accountCount: result.accounts.length,
      },
    });
    revalidateBanking();
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

const linkAccountsSchema = z.object({
  plaidItemId: z.string().min(1).max(200),
  institutionName: z.string().trim().max(200),
  selections: z
    .array(
      z.object({
        plaidAccountId: z.string().min(1).max(200),
        name: z.string().trim().min(1).max(120),
        mask: z.string().regex(/^\d{0,4}$/),
        kind: z.enum(["checking", "savings", "credit_card"]),
        /** Link to this existing register instead of creating a new one. */
        existingBankAccountId: z.string().uuid().nullable(),
      }),
    )
    .min(1)
    .max(20),
});

export async function linkPlaidAccountsAction(
  input: z.infer<typeof linkAccountsSchema>,
): Promise<ActionResult<{ linked: number }>> {
  const ctx = await gate();
  const parsed = linkAccountsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const p = parsed.data;
  try {
    const linked = await withTenant(ctx.tenantId, async (tx) => {
      let count = 0;
      for (const sel of p.selections) {
        if (sel.existingBankAccountId) {
          const rows = await tx
            .update(schema.bankAccounts)
            .set({
              plaidItemId: p.plaidItemId,
              plaidAccountId: sel.plaidAccountId,
              institution: p.institutionName,
              ...(sel.mask ? { last4: sel.mask } : {}),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.bankAccounts.tenantId, ctx.tenantId),
                eq(schema.bankAccounts.id, sel.existingBankAccountId),
              ),
            )
            .returning({ id: schema.bankAccounts.id });
          count += rows.length;
        } else {
          await createBankAccount(tx, ctx, {
            name: sel.name,
            kind: sel.kind,
            institution: p.institutionName,
            last4: sel.mask,
            plaidItemId: p.plaidItemId,
            plaidAccountId: sel.plaidAccountId,
          });
          count += 1;
        }
      }
      await logAuditInTx(tx, {
        action: "banking.plaid_accounts_linked",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        meta: { institution: p.institutionName, linked: count },
      });
      return count;
    });
    revalidateBanking();
    revalidatePath(`${BASE}/accounts`);
    return { ok: true, data: { linked } };
  } catch (err) {
    return fail(err);
  }
}

const itemRefSchema = z.object({ plaidItemId: z.string().min(1).max(200) });

export async function syncPlaidItemAction(
  input: z.infer<typeof itemRefSchema>,
): Promise<
  ActionResult<{ added: number; modified: number; removed: number }>
> {
  const ctx = await gate();
  const parsed = itemRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const result = await syncPlaidItem(ctx, parsed.data.plaidItemId);
    await logAudit({
      action: "banking.plaid_synced",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
      meta: {
        added: result.added,
        modified: result.modified,
        removed: result.removed,
      },
    });
    revalidateBanking();
    return { ok: true, data: result };
  } catch (err) {
    return fail(err);
  }
}

export async function disconnectPlaidItemAction(
  input: z.infer<typeof itemRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = itemRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await disconnectPlaidItem(ctx, parsed.data.plaidItemId);
    await logAudit({
      action: "banking.plaid_disconnected",
      tenantId: ctx.tenantId,
      actorClerkUserId: ctx.userId,
    });
    revalidateBanking();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
