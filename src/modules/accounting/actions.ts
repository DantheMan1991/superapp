"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  LedgerError,
  assertEntryNotSourceManaged,
  createAccount,
  deactivateAccount,
  deleteDraft,
  editEntry,
  friendlyMessage,
  getBalanceSheet,
  getCashActivity,
  getProfitAndLoss,
  postDraft,
  postEntry,
  reverseEntry,
  setClosedThrough,
  updateAccount,
  voidEntry,
  type LedgerCtx,
} from "./core";
import {
  balanceSheetToCsvRows,
  cashActivityToCsvRows,
  pnlToCsvRows,
  toCsv,
} from "./lib/csv";
import { resetBankLinkForEntry } from "./banking/match";
import { detachAllForTargets } from "./documents/links";
import { MAX_AMOUNT_CENTS, isValidIsoDate } from "./lib/money";

/**
 * Server actions for the accounting module. Every action:
 *   requireTenant → requireModuleEnabled → Zod → withTenant(core + audit)
 * The audit row is written by logAuditInTx INSIDE the same transaction as
 * the ledger mutation — they commit or roll back together.
 */

const BASE = "/dashboard/m/accounting";

type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { error: string };

async function gate(): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (!(err instanceof LedgerError)) {
    console.error("accounting action failed", err);
  }
  return { error: friendlyMessage(err) };
}

function revalidate(): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/journal`);
  revalidatePath(`${BASE}/trial-balance`);
  revalidatePath(`${BASE}/accounts`);
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate, "Not a real calendar date");

const lineSchema = z.object({
  accountId: z.string().uuid(),
  amountCents: z
    .number()
    .int()
    .refine((n) => n !== 0, "Amount cannot be zero")
    .refine((n) => Math.abs(n) <= MAX_AMOUNT_CENTS, "Amount too large"),
  memo: z.string().trim().max(500).optional(),
  dimensionMemberIds: z.array(z.string().uuid()).max(10).optional(),
});

const entryInputSchema = z.object({
  entryDate: dateStr,
  memo: z.string().trim().max(1000).optional(),
  lines: z.array(lineSchema).min(1).max(100),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const createEntrySchema = entryInputSchema.extend({
  status: z.enum(["draft", "posted"]),
});

export async function createEntry(
  input: z.infer<typeof createEntrySchema>,
): Promise<ActionResult<{ entryId: string }>> {
  const ctx = await gate();
  const parsed = createEntrySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const result = await withTenant(ctx.tenantId, async (tx) => {
      const r = await postEntry(tx, ctx, parsed.data);
      if (!r.deduped) {
        await logAuditInTx(tx, {
          action:
            parsed.data.status === "posted"
              ? "ledger.entry_posted"
              : "ledger.entry_drafted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "journal_entry",
          targetId: r.entry.id,
          meta: {
            entryDate: parsed.data.entryDate,
            lineCount: parsed.data.lines.length,
            totalDebits: parsed.data.lines
              .filter((l) => l.amountCents > 0)
              .reduce((a, l) => a + l.amountCents, 0),
          },
        });
      }
      return r;
    });
    revalidate();
    return { ok: true, data: { entryId: result.entry.id } };
  } catch (err) {
    return fail(err);
  }
}

const entryRefSchema = z.object({
  entryId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function postDraftEntry(
  input: z.infer<typeof entryRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = entryRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const entry = await postDraft(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "ledger.entry_posted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "journal_entry",
        targetId: entry.id,
        meta: { from: "draft" },
      });
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const updateEntrySchema = entryRefSchema.extend({
  patch: z.object({
    entryDate: dateStr.optional(),
    memo: z.string().trim().max(1000).optional(),
    lines: z.array(lineSchema).min(1).max(100).optional(),
  }),
});

export async function updateEntry(
  input: z.infer<typeof updateEntrySchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateEntrySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const { before, after } = await editEntry(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "ledger.entry_edited",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "journal_entry",
        targetId: parsed.data.entryId,
        meta: { before, after },
      });
    });
    revalidate();
    revalidatePath(`${BASE}/journal/${parsed.data.entryId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function deleteDraftEntry(
  input: z.infer<typeof entryRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = entryRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      // P21 (session 5): the entry FK on document_links is NO ACTION —
      // detach attachments in the same tx or the delete fails at the DB.
      await detachAllForTargets(tx, ctx.tenantId, "entry", [
        parsed.data.entryId,
      ]);
      const before = await deleteDraft(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "ledger.draft_deleted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "journal_entry",
        targetId: parsed.data.entryId,
        meta: { before },
      });
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function voidPostedEntry(
  input: z.infer<typeof entryRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = entryRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      // P19 (session 6): document-owned entries are voided from their
      // document (voidInvoice/voidBill/unapply) — never from the journal.
      await assertEntryNotSourceManaged(tx, ctx.tenantId, parsed.data.entryId);
      const entry = await voidEntry(tx, ctx, parsed.data);
      // Tool coordination (actions layer — core stays tool-unaware): a
      // voided entry that satisfies a bank-feed row — whether born from
      // the feed (bank_import) or MATCHED to it (invoice payment,
      // quick-add) — sends that row back to review. No-op otherwise.
      await resetBankLinkForEntry(tx, ctx.tenantId, entry.id);
      await logAuditInTx(tx, {
        action: "ledger.entry_voided",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "journal_entry",
        targetId: parsed.data.entryId,
      });
    });
    revalidate();
    revalidatePath(`${BASE}/journal/${parsed.data.entryId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const reverseSchema = z.object({
  entryId: z.string().uuid(),
  entryDate: dateStr.optional(),
  memo: z.string().trim().max(1000).optional(),
});

export async function reversePostedEntry(
  input: z.infer<typeof reverseSchema>,
): Promise<ActionResult<{ reversalEntryId: string }>> {
  const ctx = await gate();
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const result = await withTenant(ctx.tenantId, async (tx) => {
      const r = await reverseEntry(tx, ctx, parsed.data);
      if (!r.deduped) {
        await logAuditInTx(tx, {
          action: "ledger.entry_reversed",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "journal_entry",
          targetId: parsed.data.entryId,
          meta: { reversalEntryId: r.entry.id },
        });
      }
      return r;
    });
    revalidate();
    revalidatePath(`${BASE}/journal/${parsed.data.entryId}`);
    return { ok: true, data: { reversalEntryId: result.entry.id } };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------- COA

const accountTypeSchema = z.enum([
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
]);

const createAccountSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(120),
  accountType: accountTypeSchema,
  subtype: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]*$/)
    .max(64)
    .optional(),
  parentId: z.string().uuid().nullable().optional(),
  description: z.string().trim().max(500).optional(),
});

export async function createCoaAccount(
  input: z.infer<typeof createAccountSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = createAccountSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const account = await createAccount(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "coa.account_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "account",
        targetId: account.id,
        meta: { code: account.code, name: account.name, type: account.accountType },
      });
    });
    revalidatePath(`${BASE}/accounts`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const updateAccountSchema = z.object({
  accountId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: z.object({
    code: z.string().trim().min(1).max(16).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    subtype: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]*$/)
      .max(64)
      .optional(),
    parentId: z.string().uuid().nullable().optional(),
    description: z.string().trim().max(500).optional(),
  }),
});

export async function updateCoaAccount(
  input: z.infer<typeof updateAccountSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateAccountSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const { before, after } = await updateAccount(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "coa.account_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "account",
        targetId: parsed.data.accountId,
        meta: {
          before: { code: before.code, name: before.name, parentId: before.parentId },
          after: { code: after.code, name: after.name, parentId: after.parentId },
        },
      });
    });
    revalidatePath(`${BASE}/accounts`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const setActiveSchema = z.object({
  accountId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  active: z.boolean(),
});

export async function setCoaAccountActive(
  input: z.infer<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const account = await deactivateAccount(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.active
          ? "coa.account_reactivated"
          : "coa.account_deactivated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "account",
        targetId: account.id,
        meta: { code: account.code },
      });
    });
    revalidatePath(`${BASE}/accounts`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// --------------------------------------------------------------- reports

const exportCsvSchema = z.discriminatedUnion("report", [
  z.object({
    report: z.literal("pnl"),
    from: dateStr,
    to: dateStr,
    compare: z.enum(["prev-period", "prev-year"]).optional(),
    dim: z.string().regex(/^[a-z0-9_]+$/).max(32).optional(),
  }),
  z.object({
    report: z.literal("balance-sheet"),
    asOf: dateStr,
    compare: z.enum(["prev-year"]).optional(),
  }),
  z.object({
    report: z.literal("cash"),
    from: dateStr,
    to: dateStr,
  }),
]);

/**
 * CSV export re-runs the report server-side (never trusts client rows)
 * and returns the file content; the client downloads it as a Blob.
 */
export async function exportReportCsv(
  input: z.infer<typeof exportCsvSchema>,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  const ctx = await gate();
  const parsed = exportCsvSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const p = parsed.data;
  try {
    const data = await withTenant(ctx.tenantId, async (tx) => {
      if (p.report === "pnl") {
        const report = await getProfitAndLoss(tx, ctx.tenantId, {
          from: p.from,
          to: p.to,
          compare: p.compare,
          dimensionType: p.dim,
        });
        return {
          filename: `profit-and-loss_${p.from}_${p.to}.csv`,
          csv: toCsv(pnlToCsvRows(report)),
        };
      }
      if (p.report === "balance-sheet") {
        const report = await getBalanceSheet(tx, ctx.tenantId, {
          asOf: p.asOf,
          compare: p.compare,
        });
        return {
          filename: `balance-sheet_${p.asOf}.csv`,
          csv: toCsv(balanceSheetToCsvRows(report)),
        };
      }
      const report = await getCashActivity(tx, ctx.tenantId, {
        from: p.from,
        to: p.to,
      });
      return {
        filename: `cash-activity_${p.from}_${p.to}.csv`,
        csv: toCsv(cashActivityToCsvRows(report)),
      };
    });
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------- period

const closeSchema = z.object({ date: dateStr.nullable() });

export async function updateClosedThrough(
  input: z.infer<typeof closeSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const { before, after } = await setClosedThrough(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "period.closed_through_set",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        meta: { before, after },
      });
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
