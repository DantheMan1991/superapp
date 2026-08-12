import "server-only";
import { and, eq, like } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { LedgerError, requireOwnerRole, type LedgerCtx } from "../core";
import { reminderKeyPrefix, sentOffsetsFromKeys } from "./reminder-email";
import { parseOffsets, reminderOffsetsSchema } from "./reminder-schedule";

/**
 * Owner controls for automatic reminders: the schedule, and the two mutes.
 *
 * The deciding logic is in `reminder-schedule.ts` (pure) and the sending in
 * `reminder-run.ts` (the cron). This file only reads and writes rows.
 */

export interface ReminderSettings {
  enabled: boolean;
  offsets: number[];
}

export async function getReminderSettings(
  tx: Tx,
  tenantId: string,
): Promise<ReminderSettings> {
  const row = await tx.query.accountingSettings.findFirst({
    where: eq(schema.accountingSettings.tenantId, tenantId),
  });
  return {
    enabled: row?.remindersEnabled ?? false,
    offsets: parseOffsets(row?.reminderOffsets),
  };
}

export async function updateReminderSettings(
  tx: Tx,
  ctx: LedgerCtx,
  args: { enabled: boolean; offsets: number[] },
): Promise<ReminderSettings> {
  // Owner only. Turning this on commits the business to mailing its own
  // customers under its own name — not a staff decision, and never an
  // accountant's.
  requireOwnerRole(ctx);

  const parsed = reminderOffsetsSchema.safeParse(args.offsets);
  if (!parsed.success) {
    throw new LedgerError("REMINDER_OFFSETS_INVALID", "invalid reminder schedule");
  }
  // Enabled with an empty schedule would be a switch that says on and does
  // nothing — the kind of state somebody discovers three months later when
  // they wonder why nobody was chased.
  if (args.enabled && parsed.data.length === 0) {
    throw new LedgerError(
      "REMINDER_SCHEDULE_EMPTY",
      "add at least one reminder before turning them on",
    );
  }

  const rows = await tx
    .update(schema.accountingSettings)
    .set({
      remindersEnabled: args.enabled,
      reminderOffsets: parsed.data,
      updatedAt: new Date(),
    })
    .where(eq(schema.accountingSettings.tenantId, ctx.tenantId))
    .returning();
  if (rows.length === 0) {
    throw new LedgerError("SETTINGS_MISSING", "accounting_settings row missing");
  }
  return { enabled: rows[0].remindersEnabled, offsets: parsed.data };
}

export async function setInvoiceRemindersMuted(
  tx: Tx,
  ctx: LedgerCtx,
  args: { invoiceId: string; expectedVersion: number; muted: boolean },
): Promise<{ id: string }> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.invoices)
    .set({
      remindersMuted: args.muted,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.invoices.tenantId, ctx.tenantId),
        eq(schema.invoices.id, args.invoiceId),
        eq(schema.invoices.version, args.expectedVersion),
      ),
    )
    .returning({ id: schema.invoices.id });
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "invoice changed since loaded");
  }
  return rows[0];
}

export async function setCustomerRemindersMuted(
  tx: Tx,
  ctx: LedgerCtx,
  args: { customerId: string; expectedVersion: number; muted: boolean },
): Promise<{ id: string }> {
  requireOwnerRole(ctx);
  const rows = await tx
    .update(schema.customers)
    .set({
      remindersMuted: args.muted,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.customers.tenantId, ctx.tenantId),
        eq(schema.customers.id, args.customerId),
        eq(schema.customers.version, args.expectedVersion),
      ),
    )
    .returning({ id: schema.customers.id });
  if (rows.length === 0) {
    throw new LedgerError("STALE_VERSION", "customer changed since loaded");
  }
  return rows[0];
}

export interface ReminderSendRecord {
  offset: number;
  toAddress: string;
  status: string;
  createdAt: Date;
}

/**
 * Every reminder sent for one invoice, newest first.
 *
 * Read from the send log rather than a column on the invoice, the same call
 * `send-invoice.ts` made: one fact, one home. It also means the history on the
 * screen is the delivery record, so a bounce shows up as a bounce rather than
 * as a tick that says "sent".
 */
export async function listInvoiceReminders(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
): Promise<ReminderSendRecord[]> {
  const rows = await tx
    .select({
      idempotencyKey: schema.outboundEmails.idempotencyKey,
      toAddress: schema.outboundEmails.toAddress,
      status: schema.outboundEmails.status,
      createdAt: schema.outboundEmails.createdAt,
    })
    .from(schema.outboundEmails)
    .where(
      and(
        eq(schema.outboundEmails.tenantId, tenantId),
        eq(schema.outboundEmails.kind, "invoice_reminder"),
        // Uuids cannot contain a colon, so this prefix is exact.
        like(schema.outboundEmails.idempotencyKey, `${reminderKeyPrefix(invoiceId)}%`),
      ),
    )
    .orderBy(schema.outboundEmails.createdAt);

  return rows
    .map((r) => {
      const [offset] = sentOffsetsFromKeys([r.idempotencyKey]);
      return offset === undefined
        ? null
        : {
            offset,
            toAddress: r.toAddress,
            status: r.status,
            createdAt: r.createdAt,
          };
    })
    .filter((r): r is ReminderSendRecord => r !== null)
    .reverse();
}
