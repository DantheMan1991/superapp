import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { AccountingSettings } from "@/db/schema";
import { LedgerError } from "./errors";
import type { LedgerCtx } from "./types";

/** Staff may read and draft; everything that moves the ledger is owner-only. */
export function requireOwnerRole(ctx: LedgerCtx): void {
  if (ctx.role !== "owner") {
    throw new LedgerError("FORBIDDEN", "owner role required");
  }
}

/**
 * Entry sources produced by an OPERATIONAL act rather than by a person writing
 * a journal. See
 * [ADR 0011](../../../../docs/decisions/0011-machine-posted-entries.md).
 *
 * **THESE STRINGS ARE A PRIVILEGE BOUNDARY. Do not add one casually.** An entry
 * whose source is in this set posts without the owner check, on the reasoning
 * that the authorisation already happened where the act did: a staff member
 * allowed to issue feed was allowed by `requireModuleEnabled` plus the pack's
 * own write level, and the journal line is a CONSEQUENCE of that decision
 * rather than a second one. Perpetual inventory made this unavoidable — every
 * feed issue, market sale and production run posts, and all three are
 * deliberately staff-level chores.
 *
 * **What keeps it safe is that `source` is not user input.** It is absent from
 * `entryInputSchema`, so nothing arriving over the wire can name one; a caller
 * that does not set it gets `"manual"`, which still requires an owner. The day
 * `source` becomes settable from a client, this set becomes a privilege
 * escalation and the check has to move.
 *
 * Deliberately minimal. `depreciation` is a machine source by every argument
 * here and is NOT in the set, because nothing needs it to be — it runs from an
 * owner's screen today, and loosening a rule no caller is asking about only
 * widens what has to be reasoned about later.
 */
export const MACHINE_SOURCES = new Set([
  "inventory_receipt",
  "inventory_issue",
  "inventory_adjustment",
]);

/**
 * Who may cause this entry to be POSTED.
 *
 * An ordinary journal is an owner's decision and stays one. A machine-sourced
 * entry rides the authorisation of the act that produced it — but **an expert
 * still never posts anything**, machine-sourced or not, because that role is
 * read plus close-review by definition and an outside accountant issuing feed
 * is not a thing that should happen.
 */
export function requirePostingRight(
  ctx: LedgerCtx,
  source: string | null | undefined,
): void {
  if (MACHINE_SOURCES.has(source ?? "manual")) {
    if (ctx.role === "expert") {
      throw new LedgerError("FORBIDDEN", "an accountant does not post");
    }
    return;
  }
  requireOwnerRole(ctx);
}

/** Close-review surface (sign-off, notes): the accountant and the owner. */
export function requireReviewRole(ctx: LedgerCtx): void {
  if (ctx.role !== "owner" && ctx.role !== "expert") {
    throw new LedgerError("FORBIDDEN", "owner or accountant role required");
  }
}

/** Entry sources whose lifecycle a document tool owns (P19, session 6). */
const MANAGED_SOURCES = new Set([
  "invoice",
  "invoice_payment",
  "bill",
  "bill_payment",
  // A deposit's payments point at it; voiding its entry from the journal
  // would leave them marked as banked. Void it from the deposit instead.
  "deposit",
  // A credit memo's entry is also the entry of the payment row that settles
  // the invoice; the memo's own void removes both.
  "credit_memo",
]);

/**
 * Journal-voiding an entry born from an invoice or bill would silently
 * desync that document's status and aging — those entries are voided
 * from their document instead (voidInvoice/voidBill/unapply, which call
 * core voidEntry directly and stay unaffected). Reverse stays allowed.
 */
export async function assertEntryNotSourceManaged(
  tx: Tx,
  tenantId: string,
  entryId: string,
): Promise<void> {
  const entry = await tx.query.journalEntries.findFirst({
    where: eq(schema.journalEntries.id, entryId),
    columns: { source: true, tenantId: true },
  });
  if (entry && entry.tenantId === tenantId && MANAGED_SOURCES.has(entry.source)) {
    throw new LedgerError("ENTRY_SOURCE_MANAGED", entry.source);
  }
}

/**
 * NEITHER HALF OF AN INTERCOMPANY PAIR MOVES ALONE (ADR 0010 slice 2).
 *
 * Voiding or reversing one leg leaves the other company still owing an
 * affiliate that no longer owes it — both balance sheets stay internally
 * consistent and disagree with each other, which is the asymmetry the pair
 * exists to prevent. `reverseIntercompanyPair` undoes both as a new pair.
 *
 * Stricter than the managed-source guard above, which still permits a reverse:
 * here reverse is refused too, because a one-sided reversal is exactly as
 * wrong as a one-sided void.
 */
export async function assertNotIntercompanyLeg(
  tx: Tx,
  tenantId: string,
  entryId: string,
): Promise<void> {
  const entry = await tx.query.journalEntries.findFirst({
    where: eq(schema.journalEntries.id, entryId),
    columns: { tenantId: true, intercompanyId: true },
  });
  if (entry && entry.tenantId === tenantId && entry.intercompanyId) {
    throw new LedgerError("ENTRY_INTERCOMPANY", entry.intercompanyId);
  }
}

export async function getSettings(
  tx: Tx,
  tenantId: string,
): Promise<AccountingSettings> {
  const row = await tx.query.accountingSettings.findFirst({
    where: eq(schema.accountingSettings.tenantId, tenantId),
  });
  if (!row) {
    throw new LedgerError("SETTINGS_MISSING", "accounting_settings row missing");
  }
  return row;
}

/**
 * The date THIS COMPANY's books are locked through, or null.
 *
 * Per entity since ADR 0010 slice 4: ten LLCs close in different months, and
 * one bookkeeper finishing Maple's June while Oak is still missing a bank
 * statement is the ordinary case rather than an edge one.
 */
export async function getClosedThrough(
  tx: Tx,
  tenantId: string,
  entityId: string,
): Promise<string | null> {
  const row = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, tenantId),
      eq(schema.entities.id, entityId),
    ),
    columns: { closedThrough: true },
  });
  if (!row) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${entityId} not found`);
  }
  return row.closedThrough;
}

/**
 * Reject writes dated inside the closed period. ISO date strings compare
 * lexically, so plain <= is correct.
 *
 * `entityId` IS REQUIRED, and that is the whole safety story of slice 4 — the
 * same instrument slices 1 and 3 used. A period check that read a tenant-wide
 * lock would refuse a write to a company whose books are open, and — far worse
 * — ACCEPT one into a company whose books are closed, the moment two companies
 * close in different months. Neither is visible on a single-company tenant,
 * which is every other fixture in the repo.
 */
export async function assertPeriodOpen(
  tx: Tx,
  tenantId: string,
  entityId: string,
  entryDate: string,
): Promise<void> {
  // Both ends of the period in one read: the day the books begin (ADR 0035)
  // and the day they are closed through. A date before the start is refused
  // first — it is also inside any close there is, and the start is the more
  // specific thing to say about it.
  const row = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, tenantId),
      eq(schema.entities.id, entityId),
    ),
    columns: { closedThrough: true, booksStartOn: true },
  });
  if (!row) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${entityId} not found`);
  }
  if (row.booksStartOn && entryDate < row.booksStartOn) {
    throw new LedgerError("BEFORE_BOOKS_START", `books begin ${row.booksStartOn}`, {
      booksStartOn: row.booksStartOn,
      entryDate,
    });
  }
  const closedThrough = row.closedThrough;
  if (closedThrough && entryDate <= closedThrough) {
    throw new LedgerError("PERIOD_CLOSED", `period closed through ${closedThrough}`, {
      closedThrough,
      entryDate,
    });
  }
}

/**
 * The first day ONE COMPANY's books cover, or null when nobody has said
 * (ADR 0035). The other bound of the period `getClosedThrough` reads.
 */
export async function getBooksStartOn(
  tx: Tx,
  tenantId: string,
  entityId: string,
): Promise<string | null> {
  const row = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, tenantId),
      eq(schema.entities.id, entityId),
    ),
    columns: { booksStartOn: true },
  });
  if (!row) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${entityId} not found`);
  }
  return row.booksStartOn;
}

/**
 * Set, move or clear the day ONE COMPANY's books begin. Owner-only.
 *
 * Earlier is always allowed and clearing is always allowed; the two refusals
 * are the two ways the day could contradict the books. It cannot be moved past
 * money already recorded — a non-void entry dated before the proposed day —
 * because then the books would begin after their own first entry; and it
 * cannot lie after the close, because the closed period would then contain
 * days the books do not cover.
 */
export async function setBooksStartOn(
  tx: Tx,
  ctx: LedgerCtx,
  args: { entityId: string; date: string | null },
): Promise<{ before: string | null; after: string | null }> {
  requireOwnerRole(ctx);
  const row = await tx.query.entities.findFirst({
    where: and(
      eq(schema.entities.tenantId, ctx.tenantId),
      eq(schema.entities.id, args.entityId),
    ),
    columns: { closedThrough: true, booksStartOn: true },
  });
  if (!row) {
    throw new LedgerError("ENTITY_NOT_FOUND", `entity ${args.entityId} not found`);
  }
  if (args.date !== null) {
    if (row.closedThrough && args.date > row.closedThrough) {
      throw new LedgerError("BOOKS_START_AFTER_CLOSE", `closed through ${row.closedThrough}`, {
        closedThrough: row.closedThrough,
        booksStartOn: args.date,
      });
    }
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.journalEntries)
      .where(
        and(
          eq(schema.journalEntries.tenantId, ctx.tenantId),
          eq(schema.journalEntries.entityId, args.entityId),
          sql`${schema.journalEntries.status} <> 'void'`,
          sql`${schema.journalEntries.entryDate} < ${args.date}`,
        ),
      );
    if (n > 0) {
      throw new LedgerError("BOOKS_START_HAS_ENTRIES", `${n} entries before ${args.date}`, {
        count: n,
        booksStartOn: args.date,
      });
    }
  }
  await tx
    .update(schema.entities)
    .set({ booksStartOn: args.date, updatedAt: new Date() })
    .where(
      and(
        eq(schema.entities.tenantId, ctx.tenantId),
        eq(schema.entities.id, args.entityId),
      ),
    );
  return { before: row.booksStartOn, after: args.date };
}

/**
 * Set (or clear) ONE COMPANY's closing date. Owner-only.
 *
 * Still derived state with exactly two writers — `completeClose` and
 * `reopenClose` — which is what makes the lock and the close history unable to
 * disagree. It moved from `accounting_settings` to `entities` without changing
 * that rule.
 */
export async function setClosedThrough(
  tx: Tx,
  ctx: LedgerCtx,
  args: { entityId: string; date: string | null },
): Promise<{ before: string | null; after: string | null }> {
  requireOwnerRole(ctx);
  const before = await getClosedThrough(tx, ctx.tenantId, args.entityId);
  await tx
    .update(schema.entities)
    .set({ closedThrough: args.date, updatedAt: new Date() })
    .where(
      and(
        eq(schema.entities.tenantId, ctx.tenantId),
        eq(schema.entities.id, args.entityId),
      ),
    );
  return { before, after: args.date };
}
