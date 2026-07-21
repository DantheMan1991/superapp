import "server-only";
import { eq } from "drizzle-orm";
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
 * Reject writes dated inside the closed period. ISO date strings compare
 * lexically, so plain <= is correct.
 */
export async function assertPeriodOpen(
  tx: Tx,
  tenantId: string,
  entryDate: string,
): Promise<void> {
  const settings = await getSettings(tx, tenantId);
  if (settings.closedThrough && entryDate <= settings.closedThrough) {
    throw new LedgerError("PERIOD_CLOSED", `period closed through ${settings.closedThrough}`, {
      closedThrough: settings.closedThrough,
      entryDate,
    });
  }
}

/** Set (or clear) the closing date. Owner-only. Returns {before, after}. */
export async function setClosedThrough(
  tx: Tx,
  ctx: LedgerCtx,
  args: { date: string | null },
): Promise<{ before: string | null; after: string | null }> {
  requireOwnerRole(ctx);
  const settings = await getSettings(tx, ctx.tenantId);
  await tx
    .update(schema.accountingSettings)
    .set({ closedThrough: args.date, updatedAt: new Date() })
    .where(eq(schema.accountingSettings.id, settings.id));
  return { before: settings.closedThrough, after: args.date };
}
