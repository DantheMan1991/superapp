"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  LedgerError,
  assertEntryNotSourceManaged,
  assertNotIntercompanyLeg,
  createAccount,
  deactivateAccount,
  deleteDraft,
  editEntry,
  friendlyMessage,
  getBalanceSheet,
  getCashActivity,
  getDefaultEntityId,
  getGeneralLedger,
  getProfitAndLoss,
  postDraft,
  postEntry,
  residualIfConsolidated,
  residualNote,
  resolveReportEntity,
  reverseEntry,
  updateAccount,
  voidEntry,
  type LedgerCtx,
} from "./core";
import {
  balanceSheetToCsvRows,
  cashActivityToCsvRows,
  generalLedgerToCsvRows,
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
  /**
   * `accountId` rides along when the failure is about ONE account, so a form
   * can put the message where the mistake is instead of only in a toast.
   * Optional and absent for every other error, so `"error" in result` and every
   * existing call site are unchanged.
   */
  | { error: string; accountId?: string };

async function gate(opts?: { allowExpert?: boolean }): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  // Fail closed for the expert (accountant) role: read-only actions must opt
  // in via allowExpert — a forgotten opt-in denies a read, never grants a write.
  if (ctx.role === "expert" && !opts?.allowExpert) {
    throw new LedgerError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string; accountId?: string } {
  if (!(err instanceof LedgerError)) {
    console.error("accounting action failed", err);
  }
  const accountId = err instanceof LedgerError ? err.meta?.accountId : undefined;
  return {
    error: friendlyMessage(err),
    ...(typeof accountId === "string" ? { accountId } : {}),
  };
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
  /**
   * Which company's books (ADR 0010). Optional over the wire, because a
   * single-entity tenant has no picker to send one from — absent means the
   * tenant's default. It is NOT optional at the posting engine, where it is
   * resolved explicitly below; the two are different questions.
   */
  entityId: z.string().uuid().optional(),
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
      const r = await postEntry(tx, ctx, {
        ...parsed.data,
        // The journal is the ONE write path in slice 1 that can name a company.
        // `postEntry` re-checks that it belongs to this tenant and is active.
        entityId:
          parsed.data.entityId ?? (await getDefaultEntityId(tx, ctx.tenantId)),
      });
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
      // Neither half of an intercompany pair moves alone: voiding one side
      // leaves the other company still owing an affiliate that no longer owes
      // it (ADR 0010 slice 2).
      await assertNotIntercompanyLeg(tx, ctx.tenantId, parsed.data.entryId);
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
      // Stricter than the managed-source rule, which permits a reverse: a
      // ONE-SIDED reversal of a transfer is exactly as wrong as a one-sided
      // void, so the pair is reversed as a unit instead.
      await assertNotIntercompanyLeg(tx, ctx.tenantId, parsed.data.entryId);
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

/**
 * A company name in a filename: lowercase, no spaces, nothing a shell or a
 * Windows path minds. Bounded, because a name can be long and a filename
 * cannot.
 */
function filenamePart(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "company"
  );
}

/**
 * `entity` is on every variant, and it is the same value the page was rendered
 * with. An export that quietly re-ran the report combined while the screen
 * showed one company would be the ADR 0010 failure with a download attached.
 *
 * IT IS NOT ONLY A UUID, and taking it for one was a bug this slice found by
 * reading rather than by driving. The picker's own "All companies" option
 * submits an EMPTY string, which `z.string().uuid()` rejects — so on a
 * two-company tenant, choosing combined and pressing Export CSV answered
 * "Invalid input" instead of downloading the file. `consolidated` is the third
 * value the picker can now produce, and it is not a uuid either.
 * `resolveEntityScope` is what decides what each one means; this only decides
 * what may be asked.
 */
const entityParam = z
  .union([z.string().uuid(), z.enum(["", "combined", "consolidated"])])
  .optional();

const exportCsvSchema = z.discriminatedUnion("report", [
  z.object({
    report: z.literal("pnl"),
    entity: entityParam,
    from: dateStr,
    to: dateStr,
    compare: z.enum(["prev-period", "prev-year"]).optional(),
    dim: z.string().regex(/^[a-z0-9_]+$/).max(32).optional(),
    spread: z.literal("month").optional(),
    basis: z.enum(["accrual", "cash"]).optional(),
  }),
  z.object({
    report: z.literal("balance-sheet"),
    entity: entityParam,
    asOf: dateStr,
    compare: z.enum(["prev-year"]).optional(),
    basis: z.enum(["accrual", "cash"]).optional(),
  }),
  z.object({
    report: z.literal("cash"),
    entity: entityParam,
    from: dateStr,
    to: dateStr,
  }),
  z.object({
    report: z.literal("general-ledger"),
    entity: entityParam,
    from: dateStr,
    to: dateStr,
    // Bounded so a crafted request cannot turn the filter into an enormous
    // IN list; the COA is nowhere near this many accounts.
    accountIds: z.array(z.string().uuid()).max(200).optional(),
  }),
]);

/**
 * CSV export re-runs the report server-side (never trusts client rows)
 * and returns the file content; the client downloads it as a Blob.
 */
export async function exportReportCsv(
  input: z.infer<typeof exportCsvSchema>,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  const ctx = await gate({ allowExpert: true }); // read-only report export
  const parsed = exportCsvSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const p = parsed.data;
  try {
    const data = await withTenant(ctx.tenantId, async (tx) => {
      // Only when there is a choice, so a single-company tenant's filenames are
      // unchanged and no process that reads them by name breaks. The label
      // differs between combined and consolidated, so the two files cannot be
      // mistaken for each other on disk either.
      const suffixOf = (label: string | undefined) =>
        label ? `_${filenamePart(label)}` : "";

      // CASH ACTIVITY RESOLVES ITS OWN SCOPE, and separately on purpose: it
      // DECLINES consolidation exactly as its page does, so `?entity=
      // consolidated` refuses here too rather than downloading the combined
      // figures under the consolidated name. Its own block is also what keeps
      // the scope's TYPE narrow enough for `getCashActivity` to accept it —
      // one shared resolve would widen it back to `EntityScope` and the
      // compiler would stop being able to tell the two apart.
      if (p.report === "cash") {
        const { scope, stampLabel } = await resolveReportEntity(
          tx,
          ctx.tenantId,
          p.entity,
          "declined",
        );
        const report = await getCashActivity(tx, ctx.tenantId, {
          scope,
          from: p.from,
          to: p.to,
        });
        return {
          filename: `cash-activity_${p.from}_${p.to}${suffixOf(stampLabel)}.csv`,
          csv: toCsv(cashActivityToCsvRows(report, stampLabel)),
        };
      }

      const { scope, stampLabel } = await resolveReportEntity(
        tx,
        ctx.tenantId,
        p.entity,
        "offered",
      );
      const suffix = suffixOf(stampLabel);
      if (p.report === "pnl") {
        const residual = await residualIfConsolidated(tx, ctx.tenantId, scope, {
          from: p.from,
          to: p.to,
        });
        const report = await getProfitAndLoss(tx, ctx.tenantId, {
          scope,
          from: p.from,
          to: p.to,
          compare: p.compare,
          dimensionType: p.dim,
          spread: p.spread,
          basis: p.basis,
        });
        return {
          // The basis is in the FILENAME as well as the content: these files
          // get emailed to accountants, and two profit figures for the same
          // period are only safe if you can tell them apart at a glance.
          filename: `profit-and-loss${p.spread === "month" ? "-by-month" : ""}_${p.from}_${p.to}_${p.basis ?? "accrual"}${suffix}.csv`,
          csv: toCsv(
            pnlToCsvRows(
              report,
              p.basis ?? "accrual",
              stampLabel,
              residual ? residualNote(residual) : undefined,
            ),
          ),
        };
      }
      if (p.report === "balance-sheet") {
        const residual = await residualIfConsolidated(tx, ctx.tenantId, scope, {
          asOf: p.asOf,
        });
        const report = await getBalanceSheet(tx, ctx.tenantId, {
          scope,
          asOf: p.asOf,
          compare: p.compare,
          basis: p.basis,
        });
        return {
          filename: `balance-sheet_${p.asOf}_${p.basis ?? "accrual"}${suffix}.csv`,
          csv: toCsv(
            balanceSheetToCsvRows(
              report,
              p.basis ?? "accrual",
              stampLabel,
              residual ? residualNote(residual) : undefined,
            ),
          ),
        };
      }
      if (p.report === "general-ledger") {
        const residual = await residualIfConsolidated(tx, ctx.tenantId, scope, {
          from: p.from,
          to: p.to,
        });
        const report = await getGeneralLedger(tx, ctx.tenantId, {
          scope,
          from: p.from,
          to: p.to,
          ...(p.accountIds?.length ? { accountIds: p.accountIds } : {}),
        });
        return {
          filename: `general-ledger_${p.from}_${p.to}${suffix}.csv`,
          csv: toCsv(
            generalLedgerToCsvRows(
              report,
              stampLabel,
              residual ? residualNote(residual) : undefined,
            ),
          ),
        };
      }
      // Unreachable: the discriminated union has four members and the other
      // three returned above. Stated rather than left as a fallthrough, so
      // adding a fifth report is a compile error here instead of a wrong file.
      throw new Error(`unhandled report ${(p as { report: string }).report}`);
    });
    return { ok: true, data };
  } catch (err) {
    return fail(err);
  }
}

// The period lock is managed from the Close page (session 7):
// closed_through is derived state written only by completeClose/reopenClose.
