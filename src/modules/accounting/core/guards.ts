import "server-only";
import { and, eq } from "drizzle-orm";
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
  const closedThrough = await getClosedThrough(tx, tenantId, entityId);
  if (closedThrough && entryDate <= closedThrough) {
    throw new LedgerError("PERIOD_CLOSED", `period closed through ${closedThrough}`, {
      closedThrough,
      entryDate,
    });
  }
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
