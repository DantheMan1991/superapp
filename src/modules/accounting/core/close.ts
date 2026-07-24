import "server-only";
import { and, desc, eq, gt, isNull, lte, max, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CloseNote, PeriodClose } from "@/db/schema";
import { LedgerError } from "./errors";
import { getSettings, requireOwnerRole, requireReviewRole, setClosedThrough } from "./guards";
import { getLedgerIntegrity } from "./integrity";
import type { LedgerCtx } from "./types";
import { addDaysIso, fiscalYearStart } from "../lib/dates";

/**
 * Month-end close (session 7). Each completed close snapshots its checklist
 * and establishes the period lock; accounting_settings.closed_through is
 * DERIVED state — written only here (completeClose/reopenClose), which is
 * what makes drift between the lock and the close history unrepresentable.
 */

const BASE = "/dashboard/m/accounting";

export interface CloseChecklistItem {
  key:
    | "unreviewed_bank_txns"
    | "draft_entries"
    | "draft_invoices"
    | "draft_bills"
    | "awaiting_bills"
    | "inbox_documents"
    | "unreconciled_accounts"
    | "ledger_integrity";
  label: string;
  count: number;
  ok: boolean;
  /** Deep link to the surface where the item gets fixed. */
  href: string;
  detail?: string;
}

export interface CloseChecklist {
  periodEnd: string;
  computedAt: string;
  items: CloseChecklistItem[];
  /** Items not ok. Blockers WARN, they never block (bookkeeping reality). */
  blockerCount: number;
}

/**
 * Live pre-close review: what still needs attention on or before periodEnd.
 * Undated sources (the receipts inbox) are counted unscoped.
 */
export async function getCloseChecklist(
  tx: Tx,
  tenantId: string,
  periodEnd: string,
): Promise<CloseChecklist> {
  const [unreviewed] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bankTransactions)
    .where(
      and(
        eq(schema.bankTransactions.tenantId, tenantId),
        eq(schema.bankTransactions.status, "unreviewed"),
        lte(schema.bankTransactions.txnDate, periodEnd),
      ),
    );
  const [draftEntries] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.journalEntries)
    .where(
      and(
        eq(schema.journalEntries.tenantId, tenantId),
        eq(schema.journalEntries.status, "draft"),
        lte(schema.journalEntries.entryDate, periodEnd),
      ),
    );
  const [draftInvoices] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.tenantId, tenantId),
        eq(schema.invoices.status, "draft"),
        lte(schema.invoices.issueDate, periodEnd),
      ),
    );
  const [draftBills] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bills)
    .where(
      and(
        eq(schema.bills.tenantId, tenantId),
        eq(schema.bills.status, "draft"),
        lte(schema.bills.billDate, periodEnd),
      ),
    );
  const [awaitingBills] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bills)
    .where(
      and(
        eq(schema.bills.tenantId, tenantId),
        eq(schema.bills.status, "awaiting_approval"),
        lte(schema.bills.billDate, periodEnd),
      ),
    );
  const [inboxDocs] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.tenantId, tenantId),
        eq(schema.documents.status, "inbox"),
      ),
    );

  // Active bank accounts whose latest COMPLETED reconciliation doesn't
  // reach period end (or that were never reconciled at all).
  const reconRows = await tx
    .select({
      name: schema.bankAccounts.name,
      lastCompleted: max(schema.reconciliations.statementEndDate),
    })
    .from(schema.bankAccounts)
    .leftJoin(
      schema.reconciliations,
      and(
        eq(schema.reconciliations.tenantId, schema.bankAccounts.tenantId),
        eq(schema.reconciliations.bankAccountId, schema.bankAccounts.id),
        eq(schema.reconciliations.status, "completed"),
      ),
    )
    .where(
      and(
        eq(schema.bankAccounts.tenantId, tenantId),
        eq(schema.bankAccounts.isActive, true),
      ),
    )
    .groupBy(schema.bankAccounts.id, schema.bankAccounts.name);
  const behind = reconRows.filter(
    (r) => !r.lastCompleted || r.lastCompleted < periodEnd,
  );

  const integrity = await getLedgerIntegrity(tx, tenantId);

  const items: CloseChecklistItem[] = [
    {
      key: "unreviewed_bank_txns",
      label: "Unreviewed bank transactions",
      count: unreviewed.n,
      ok: unreviewed.n === 0,
      href: `${BASE}/banking`,
    },
    {
      key: "draft_entries",
      label: "Draft journal entries",
      count: draftEntries.n,
      ok: draftEntries.n === 0,
      href: `${BASE}/journal`,
    },
    {
      key: "draft_invoices",
      label: "Draft invoices",
      count: draftInvoices.n,
      ok: draftInvoices.n === 0,
      href: `${BASE}/sales`,
    },
    {
      key: "draft_bills",
      label: "Draft bills",
      count: draftBills.n,
      ok: draftBills.n === 0,
      href: `${BASE}/purchases/bills`,
    },
    {
      key: "awaiting_bills",
      label: "Bills awaiting approval",
      count: awaitingBills.n,
      ok: awaitingBills.n === 0,
      href: `${BASE}/purchases/bills`,
    },
    {
      key: "inbox_documents",
      label: "Unfiled inbox documents",
      count: inboxDocs.n,
      ok: inboxDocs.n === 0,
      href: `${BASE}/receipts`,
    },
    {
      key: "unreconciled_accounts",
      label: "Bank accounts not reconciled through period end",
      count: behind.length,
      ok: behind.length === 0,
      href: `${BASE}/banking`,
      detail: behind.length ? behind.map((r) => r.name).join(", ") : undefined,
    },
    {
      key: "ledger_integrity",
      label: "Ledger out of balance",
      count: integrity.unbalancedEntries.length,
      ok: integrity.balanced,
      href: `${BASE}/trial-balance`,
    },
  ];

  return {
    periodEnd,
    computedAt: new Date().toISOString(),
    items,
    blockerCount: items.filter((i) => !i.ok).length,
  };
}

/**
 * Close the books through periodEnd. Monotonic: the new date must be after
 * the current closed-through. Outstanding checklist items warn but never
 * block; the checklist is recomputed here (never trusted from the client)
 * and snapshotted on the close row.
 */
export async function completeClose(
  tx: Tx,
  ctx: LedgerCtx,
  args: { periodEnd: string },
): Promise<{ close: PeriodClose; checklist: CloseChecklist }> {
  requireOwnerRole(ctx);
  const settings = await getSettings(tx, ctx.tenantId);
  if (settings.closedThrough && args.periodEnd <= settings.closedThrough) {
    throw new LedgerError("CLOSE_NOT_FORWARD", "period end not after closed_through", {
      closedThrough: settings.closedThrough,
      periodEnd: args.periodEnd,
    });
  }
  const checklist = await getCloseChecklist(tx, ctx.tenantId, args.periodEnd);
  const [close] = await tx
    .insert(schema.periodCloses)
    .values({
      tenantId: ctx.tenantId,
      periodEnd: args.periodEnd,
      previousClosedThrough: settings.closedThrough,
      checklist,
      completedByClerkUserId: ctx.userId,
    })
    .returning();
  await setClosedThrough(tx, ctx, { date: args.periodEnd });
  return { close, checklist };
}

/**
 * Reopen the LATEST completed close (reconciliation's latest-only reopen
 * precedent) and restore the closed-through date it replaced — which also
 * correctly unwinds scalar closes that predate the period_closes table.
 */
export async function reopenClose(
  tx: Tx,
  ctx: LedgerCtx,
  args: { closeId: string; expectedVersion: number },
): Promise<PeriodClose> {
  requireOwnerRole(ctx);
  const close = await loadClose(tx, ctx.tenantId, args.closeId);
  if (close.status !== "completed") {
    throw new LedgerError("CLOSE_NOT_COMPLETED", "close already reopened");
  }
  const [newer] = await tx
    .select({ id: schema.periodCloses.id })
    .from(schema.periodCloses)
    .where(
      and(
        eq(schema.periodCloses.tenantId, ctx.tenantId),
        eq(schema.periodCloses.status, "completed"),
        gt(schema.periodCloses.periodEnd, close.periodEnd),
      ),
    )
    .limit(1);
  if (newer) {
    throw new LedgerError("CLOSE_NOT_LATEST", "a later completed close exists");
  }
  const [updated] = await tx
    .update(schema.periodCloses)
    .set({
      status: "reopened",
      reopenedByClerkUserId: ctx.userId,
      reopenedAt: new Date(),
      version: close.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.periodCloses.tenantId, ctx.tenantId),
        eq(schema.periodCloses.id, close.id),
        eq(schema.periodCloses.version, args.expectedVersion),
      ),
    )
    .returning();
  if (!updated) {
    throw new LedgerError("STALE_VERSION", "close changed since loaded");
  }
  await setClosedThrough(tx, ctx, { date: close.previousClosedThrough });
  return updated;
}

/** Review sign-off: owner or accountant, completed closes only, once. */
export async function signOffClose(
  tx: Tx,
  ctx: LedgerCtx,
  args: { closeId: string; expectedVersion: number },
): Promise<PeriodClose> {
  requireReviewRole(ctx);
  const close = await loadClose(tx, ctx.tenantId, args.closeId);
  if (close.status !== "completed") {
    throw new LedgerError("CLOSE_NOT_COMPLETED", "cannot sign off a reopened close");
  }
  if (close.signedOffAt) {
    throw new LedgerError("CLOSE_ALREADY_SIGNED", "already signed off");
  }
  const [updated] = await tx
    .update(schema.periodCloses)
    .set({
      signedOffByClerkUserId: ctx.userId,
      signedOffAt: new Date(),
      version: close.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.periodCloses.tenantId, ctx.tenantId),
        eq(schema.periodCloses.id, close.id),
        eq(schema.periodCloses.version, args.expectedVersion),
        isNull(schema.periodCloses.signedOffAt),
      ),
    )
    .returning();
  if (!updated) {
    throw new LedgerError("STALE_VERSION", "close changed since loaded");
  }
  return updated;
}

/** Append a review note (owner ↔ accountant dialogue). Append-only. */
export async function addCloseNote(
  tx: Tx,
  ctx: LedgerCtx,
  args: { closeId: string; body: string },
): Promise<CloseNote> {
  requireReviewRole(ctx);
  const close = await loadClose(tx, ctx.tenantId, args.closeId);
  const [note] = await tx
    .insert(schema.closeNotes)
    .values({
      tenantId: ctx.tenantId,
      closeId: close.id,
      authorClerkUserId: ctx.userId,
      body: args.body,
    })
    .returning();
  return note;
}

export async function loadClose(
  tx: Tx,
  tenantId: string,
  closeId: string,
): Promise<PeriodClose> {
  const close = await tx.query.periodCloses.findFirst({
    where: and(
      eq(schema.periodCloses.tenantId, tenantId),
      eq(schema.periodCloses.id, closeId),
    ),
  });
  if (!close) throw new LedgerError("CLOSE_NOT_FOUND", "no such close");
  return close;
}

export async function listCloses(
  tx: Tx,
  tenantId: string,
): Promise<PeriodClose[]> {
  return tx.query.periodCloses.findMany({
    where: eq(schema.periodCloses.tenantId, tenantId),
    orderBy: [
      desc(schema.periodCloses.periodEnd),
      desc(schema.periodCloses.completedAt),
    ],
  });
}

export interface CloseNoteWithAuthor extends CloseNote {
  authorName: string | null;
  authorEmail: string | null;
}

export async function getClose(
  tx: Tx,
  tenantId: string,
  closeId: string,
): Promise<{ close: PeriodClose; notes: CloseNoteWithAuthor[] }> {
  const close = await loadClose(tx, tenantId, closeId);
  const rows = await tx
    .select({
      note: schema.closeNotes,
      authorName: schema.profiles.name,
      authorEmail: schema.profiles.email,
    })
    .from(schema.closeNotes)
    .leftJoin(
      schema.profiles,
      eq(schema.profiles.clerkUserId, schema.closeNotes.authorClerkUserId),
    )
    .where(
      and(
        eq(schema.closeNotes.tenantId, tenantId),
        eq(schema.closeNotes.closeId, closeId),
      ),
    )
    .orderBy(schema.closeNotes.createdAt);
  return {
    close,
    notes: rows.map((r) => ({
      ...r.note,
      authorName: r.authorName,
      authorEmail: r.authorEmail,
    })),
  };
}

/**
 * The period a close covers, for reports/narrative: starts the day after
 * the previous closed-through, or at the fiscal-year start of periodEnd
 * for a first close. Pure.
 */
export function closePeriodStart(
  close: Pick<PeriodClose, "periodEnd" | "previousClosedThrough">,
  fiscalYearStartMonth: number,
): string {
  return close.previousClosedThrough
    ? addDaysIso(close.previousClosedThrough, 1)
    : fiscalYearStart(close.periodEnd, fiscalYearStartMonth);
}
