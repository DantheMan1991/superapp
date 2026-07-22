import "server-only";
import { and, asc, desc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { BankAccount, Reconciliation } from "@/db/schema";
import { LedgerError } from "./errors";
import { requireOwnerRole } from "./guards";
import type { LedgerCtx } from "./types";

/**
 * Reconciliation clears LEDGER LINES on a bank account's ledger account —
 * manual entries too, not just imported rows. Completing requires the
 * difference to be exactly zero, recomputed server-side. Cleared lines
 * lock their entries (third mutability tier, enforced in posting.ts and
 * backstopped by the NO ACTION FK on reconciliation_lines.journal_line_id).
 *
 * Math (binding):
 *   expectedLedgerCents  = kind === "credit_card"
 *                            ? -statementEndBalanceCents  (entered as owed)
 *                            : statementEndBalanceCents
 *   priorReconciledCents = Σ line amounts cleared by COMPLETED
 *                          reconciliations of this bank account
 *   differenceCents      = expectedLedgerCents
 *                          − (priorReconciledCents + checkedCents)
 */

async function loadBankAccount(
  tx: Tx,
  tenantId: string,
  bankAccountId: string,
): Promise<BankAccount> {
  const row = await tx.query.bankAccounts.findFirst({
    where: and(
      eq(schema.bankAccounts.tenantId, tenantId),
      eq(schema.bankAccounts.id, bankAccountId),
    ),
  });
  if (!row) {
    throw new LedgerError("BANK_ACCOUNT_NOT_FOUND", `bank account ${bankAccountId} missing`);
  }
  return row;
}

async function loadReconciliation(
  tx: Tx,
  tenantId: string,
  reconciliationId: string,
): Promise<Reconciliation> {
  const row = await tx.query.reconciliations.findFirst({
    where: and(
      eq(schema.reconciliations.tenantId, tenantId),
      eq(schema.reconciliations.id, reconciliationId),
    ),
  });
  if (!row) {
    throw new LedgerError("RECON_NOT_OPEN", `reconciliation ${reconciliationId} missing`);
  }
  return row;
}

export function expectedLedgerCents(
  kind: BankAccount["kind"],
  statementEndBalanceCents: number,
): number {
  return kind === "credit_card" ? -statementEndBalanceCents : statementEndBalanceCents;
}

export async function startReconciliation(
  tx: Tx,
  ctx: LedgerCtx,
  args: {
    bankAccountId: string;
    statementEndDate: string;
    statementEndBalanceCents: number;
  },
): Promise<Reconciliation> {
  requireOwnerRole(ctx);
  const bankAccount = await loadBankAccount(tx, ctx.tenantId, args.bankAccountId);
  if (!bankAccount.isActive) {
    throw new LedgerError("BANK_ACCOUNT_NOT_FOUND", "bank account inactive");
  }
  const rows = await tx
    .insert(schema.reconciliations)
    .values({
      tenantId: ctx.tenantId,
      bankAccountId: args.bankAccountId,
      statementEndDate: args.statementEndDate,
      statementEndBalanceCents: args.statementEndBalanceCents,
      createdByClerkUserId: ctx.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("RECON_ACTIVE_EXISTS", "an in-progress reconciliation exists");
  }
  return rows[0];
}

export interface ReconciliationCandidate {
  journalLineId: string;
  entryId: string;
  entryDate: string;
  entryMemo: string;
  lineMemo: string;
  amountCents: number;
  checked: boolean;
}

export interface ReconciliationView {
  reconciliation: Reconciliation;
  bankAccount: Pick<BankAccount, "id" | "name" | "kind" | "accountId">;
  candidates: ReconciliationCandidate[];
  priorReconciledCents: number;
  checkedCents: number;
  expectedLedgerCents: number;
  differenceCents: number;
}

export async function getReconciliationView(
  tx: Tx,
  tenantId: string,
  reconciliationId: string,
): Promise<ReconciliationView> {
  const reconciliation = await loadReconciliation(tx, tenantId, reconciliationId);
  const bankAccount = await loadBankAccount(tx, tenantId, reconciliation.bankAccountId);

  // Lines cleared by COMPLETED reconciliations of this bank account.
  const completedLineRows = await tx
    .select({
      journalLineId: schema.reconciliationLines.journalLineId,
      amountCents: schema.journalLines.amountCents,
    })
    .from(schema.reconciliationLines)
    .innerJoin(
      schema.reconciliations,
      and(
        eq(schema.reconciliations.tenantId, schema.reconciliationLines.tenantId),
        eq(schema.reconciliations.id, schema.reconciliationLines.reconciliationId),
      ),
    )
    .innerJoin(
      schema.journalLines,
      and(
        eq(schema.journalLines.tenantId, schema.reconciliationLines.tenantId),
        eq(schema.journalLines.id, schema.reconciliationLines.journalLineId),
      ),
    )
    .where(
      and(
        eq(schema.reconciliationLines.tenantId, tenantId),
        eq(schema.reconciliations.bankAccountId, reconciliation.bankAccountId),
        eq(schema.reconciliations.status, "completed" as const),
      ),
    );
  const completedLineIds = completedLineRows.map((r) => r.journalLineId);
  const priorReconciledCents = completedLineRows.reduce(
    (s, r) => s + r.amountCents,
    0,
  );

  // Lines checked in THIS reconciliation.
  const checkedRows = await tx
    .select({ journalLineId: schema.reconciliationLines.journalLineId })
    .from(schema.reconciliationLines)
    .where(
      and(
        eq(schema.reconciliationLines.tenantId, tenantId),
        eq(schema.reconciliationLines.reconciliationId, reconciliationId),
      ),
    );
  const checkedIds = new Set(checkedRows.map((r) => r.journalLineId));

  // Candidates: posted lines on the ledger account, dated <= statement end,
  // not cleared by a completed reconciliation.
  const candidateRows = await tx
    .select({
      journalLineId: schema.journalLines.id,
      entryId: schema.journalEntries.id,
      entryDate: schema.journalEntries.entryDate,
      entryMemo: schema.journalEntries.memo,
      lineMemo: schema.journalLines.memo,
      amountCents: schema.journalLines.amountCents,
      lineNo: schema.journalLines.lineNo,
    })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      and(
        eq(schema.journalEntries.tenantId, schema.journalLines.tenantId),
        eq(schema.journalEntries.id, schema.journalLines.entryId),
      ),
    )
    .where(
      and(
        eq(schema.journalLines.tenantId, tenantId),
        eq(schema.journalLines.accountId, bankAccount.accountId),
        eq(schema.journalEntries.status, "posted" as const),
        lte(schema.journalEntries.entryDate, reconciliation.statementEndDate),
        ...(completedLineIds.length > 0
          ? [notInArray(schema.journalLines.id, completedLineIds)]
          : []),
      ),
    )
    .orderBy(asc(schema.journalEntries.entryDate), asc(schema.journalLines.lineNo));

  const candidates: ReconciliationCandidate[] = candidateRows.map((r) => ({
    journalLineId: r.journalLineId,
    entryId: r.entryId,
    entryDate: r.entryDate,
    entryMemo: r.entryMemo,
    lineMemo: r.lineMemo,
    amountCents: r.amountCents,
    checked: checkedIds.has(r.journalLineId),
  }));
  const checkedCents = candidates
    .filter((c) => c.checked)
    .reduce((s, c) => s + c.amountCents, 0);
  const expected = expectedLedgerCents(
    bankAccount.kind,
    reconciliation.statementEndBalanceCents,
  );

  return {
    reconciliation,
    bankAccount: {
      id: bankAccount.id,
      name: bankAccount.name,
      kind: bankAccount.kind,
      accountId: bankAccount.accountId,
    },
    candidates,
    priorReconciledCents,
    checkedCents,
    expectedLedgerCents: expected,
    differenceCents: expected - (priorReconciledCents + checkedCents),
  };
}

export async function toggleReconciliationLine(
  tx: Tx,
  ctx: LedgerCtx,
  args: { reconciliationId: string; journalLineId: string; checked: boolean },
): Promise<void> {
  requireOwnerRole(ctx);
  const reconciliation = await loadReconciliation(tx, ctx.tenantId, args.reconciliationId);
  if (reconciliation.status !== "in_progress") {
    throw new LedgerError("RECON_NOT_OPEN", "reconciliation is not in progress");
  }
  if (!args.checked) {
    await tx
      .delete(schema.reconciliationLines)
      .where(
        and(
          eq(schema.reconciliationLines.tenantId, ctx.tenantId),
          eq(schema.reconciliationLines.reconciliationId, args.reconciliationId),
          eq(schema.reconciliationLines.journalLineId, args.journalLineId),
        ),
      );
    return;
  }
  const bankAccount = await loadBankAccount(tx, ctx.tenantId, reconciliation.bankAccountId);
  const line = await tx
    .select({
      id: schema.journalLines.id,
      accountId: schema.journalLines.accountId,
      entryStatus: schema.journalEntries.status,
      entryDate: schema.journalEntries.entryDate,
    })
    .from(schema.journalLines)
    .innerJoin(
      schema.journalEntries,
      and(
        eq(schema.journalEntries.tenantId, schema.journalLines.tenantId),
        eq(schema.journalEntries.id, schema.journalLines.entryId),
      ),
    )
    .where(
      and(
        eq(schema.journalLines.tenantId, ctx.tenantId),
        eq(schema.journalLines.id, args.journalLineId),
      ),
    )
    .limit(1);
  const l = line[0];
  if (
    !l ||
    l.accountId !== bankAccount.accountId ||
    l.entryStatus !== "posted" ||
    l.entryDate > reconciliation.statementEndDate
  ) {
    throw new LedgerError("RECON_LINE_INVALID", "line not clearable here");
  }
  const inserted = await tx
    .insert(schema.reconciliationLines)
    .values({
      tenantId: ctx.tenantId,
      reconciliationId: args.reconciliationId,
      journalLineId: args.journalLineId,
    })
    .onConflictDoNothing()
    .returning({ id: schema.reconciliationLines.id });
  if (inserted.length === 0) {
    // The line-clears-once unique fired: cleared in another reconciliation.
    const ours = await tx.query.reconciliationLines.findFirst({
      where: and(
        eq(schema.reconciliationLines.tenantId, ctx.tenantId),
        eq(schema.reconciliationLines.journalLineId, args.journalLineId),
        eq(schema.reconciliationLines.reconciliationId, args.reconciliationId),
      ),
    });
    if (!ours) {
      throw new LedgerError("RECON_LINE_INVALID", "line already cleared elsewhere");
    }
  }
}

export async function completeReconciliation(
  tx: Tx,
  ctx: LedgerCtx,
  args: { reconciliationId: string; expectedVersion: number },
): Promise<Reconciliation> {
  requireOwnerRole(ctx);
  const view = await getReconciliationView(tx, ctx.tenantId, args.reconciliationId);
  if (view.reconciliation.status !== "in_progress") {
    throw new LedgerError("RECON_NOT_OPEN", "reconciliation is not in progress");
  }
  if (view.differenceCents !== 0) {
    throw new LedgerError("RECON_NOT_BALANCED", "difference is not zero", {
      differenceCents: view.differenceCents,
    });
  }
  const rows = await tx
    .update(schema.reconciliations)
    .set({ status: "completed", completedAt: new Date(), version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.reconciliations.tenantId, ctx.tenantId),
        eq(schema.reconciliations.id, args.reconciliationId),
        eq(schema.reconciliations.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "reconciliation changed since loaded");
  }
  return rows[0];
}

export async function cancelReconciliation(
  tx: Tx,
  ctx: LedgerCtx,
  args: { reconciliationId: string; expectedVersion: number },
): Promise<void> {
  requireOwnerRole(ctx);
  const reconciliation = await loadReconciliation(tx, ctx.tenantId, args.reconciliationId);
  if (reconciliation.status !== "in_progress") {
    throw new LedgerError("RECON_NOT_OPEN", "only in-progress reconciliations cancel");
  }
  if (reconciliation.version !== args.expectedVersion) {
    throw new LedgerError("STALE_VERSION", "reconciliation changed since loaded");
  }
  // FK cascade removes its reconciliation_lines.
  await tx
    .delete(schema.reconciliations)
    .where(
      and(
        eq(schema.reconciliations.tenantId, ctx.tenantId),
        eq(schema.reconciliations.id, args.reconciliationId),
      ),
    );
}

/**
 * Reopen the LATEST completed reconciliation of its bank account. Lines
 * stay checked (and their entries stay locked) until unchecked in the
 * reopened workbench.
 */
export async function reopenReconciliation(
  tx: Tx,
  ctx: LedgerCtx,
  args: { reconciliationId: string; expectedVersion: number },
): Promise<Reconciliation> {
  requireOwnerRole(ctx);
  const reconciliation = await loadReconciliation(tx, ctx.tenantId, args.reconciliationId);
  if (reconciliation.status !== "completed") {
    throw new LedgerError("RECON_NOT_OPEN", "only completed reconciliations reopen");
  }
  const latest = await tx.query.reconciliations.findFirst({
    where: and(
      eq(schema.reconciliations.tenantId, ctx.tenantId),
      eq(schema.reconciliations.bankAccountId, reconciliation.bankAccountId),
      eq(schema.reconciliations.status, "completed"),
    ),
    orderBy: [
      desc(schema.reconciliations.statementEndDate),
      desc(schema.reconciliations.completedAt),
    ],
  });
  if (latest?.id !== reconciliation.id) {
    throw new LedgerError("RECON_NOT_LATEST", "not the latest completed reconciliation");
  }
  const active = await tx.query.reconciliations.findFirst({
    where: and(
      eq(schema.reconciliations.tenantId, ctx.tenantId),
      eq(schema.reconciliations.bankAccountId, reconciliation.bankAccountId),
      eq(schema.reconciliations.status, "in_progress"),
    ),
  });
  if (active) {
    throw new LedgerError("RECON_ACTIVE_EXISTS", "finish or cancel the open one first");
  }
  const rows = await tx
    .update(schema.reconciliations)
    .set({ status: "in_progress", completedAt: null, version: args.expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(schema.reconciliations.tenantId, ctx.tenantId),
        eq(schema.reconciliations.id, args.reconciliationId),
        eq(schema.reconciliations.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "reconciliation changed since loaded");
  }
  return rows[0];
}

/** List a bank account's reconciliations, newest first (for the history UI). */
export async function listReconciliations(
  tx: Tx,
  tenantId: string,
  bankAccountId: string,
): Promise<Reconciliation[]> {
  return tx.query.reconciliations.findMany({
    where: and(
      eq(schema.reconciliations.tenantId, tenantId),
      eq(schema.reconciliations.bankAccountId, bankAccountId),
    ),
    orderBy: [
      desc(schema.reconciliations.statementEndDate),
      desc(schema.reconciliations.createdAt),
    ],
  });
}
