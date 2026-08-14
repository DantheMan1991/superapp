"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, friendlyMessage, type LedgerCtx } from "../core";
import { isValidIsoDate, MAX_AMOUNT_CENTS } from "../lib/money";
import { resetBankLinkForEntry } from "../banking/match";
import { detachAllForTargets } from "../documents/links";
import {
  createCustomer,
  setCustomerActive,
  updateCustomer,
} from "./customers";
import {
  createInvoiceDraft,
  deleteInvoiceDraft,
  issueInvoice,
  updateInvoiceDraft,
  updateIssuedInvoice,
  voidInvoice,
} from "./invoices";
import { recordPayment, unapplyPayment } from "./payments";
import { invoiceLineSchema } from "./lines";
import { sendInvoiceEmail } from "./send-invoice";
import {
  setCustomerRemindersMuted,
  setInvoiceRemindersMuted,
  updateReminderSettings,
} from "./reminders";
import { sendTestReminder } from "./reminder-test";
import { listPaymentMethods } from "./catalogue";
import {
  MAX_OFFSET,
  MAX_OFFSETS,
  MIN_OFFSET,
} from "./reminder-schedule";

const BASE = "/dashboard/m/accounting";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

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

function fail(err: unknown): { error: string } {
  if (!(err instanceof LedgerError)) console.error("invoicing action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidateSales(invoiceId?: string): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/sales/invoices`);
  if (invoiceId) revalidatePath(`${BASE}/sales/invoices/${invoiceId}`);
  revalidatePath(`${BASE}/sales/customers`);
  revalidatePath(`${BASE}/reports/ar-aging`);
  revalidatePath(`${BASE}/journal`);
  revalidatePath(`${BASE}/trial-balance`);
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate, "Not a real calendar date");

// -------------------------------------------------------------- customers

const customerInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function createCustomerAction(
  input: z.infer<typeof customerInputSchema>,
): Promise<ActionResult<{ customerId: string }>> {
  const ctx = await gate();
  const parsed = customerInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const customer = await withTenant(ctx.tenantId, async (tx) => {
      const c = await createCustomer(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.customer_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "customer",
        targetId: c.id,
        meta: { name: c.name },
      });
      return c;
    });
    revalidateSales();
    return { ok: true, data: { customerId: customer.id } };
  } catch (err) {
    return fail(err);
  }
}

const updateCustomerSchema = z.object({
  customerId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: customerInputSchema.partial(),
});

export async function updateCustomerAction(
  input: z.infer<typeof updateCustomerSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const { before, after } = await updateCustomer(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.customer_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "customer",
        targetId: parsed.data.customerId,
        meta: { before: { name: before.name }, after: { name: after.name } },
      });
    });
    revalidateSales();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const setCustomerActiveSchema = z.object({
  customerId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  active: z.boolean(),
});

export async function setCustomerActiveAction(
  input: z.infer<typeof setCustomerActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = setCustomerActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const c = await setCustomerActive(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.active
          ? "invoice.customer_reactivated"
          : "invoice.customer_deactivated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "customer",
        targetId: c.id,
      });
    });
    revalidateSales();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// --------------------------------------------------------------- invoices

const draftInputSchema = z.object({
  customerId: z.string().uuid(),
  invoiceNumber: z.string().trim().min(1).max(30).optional(),
  issueDate: dateStr,
  dueDate: dateStr.nullable().optional(),
  memo: z.string().trim().max(2000).optional(),
  /** Null = no tax. The rate itself is validated against the tenant's own
   * list inside the transaction, so one deactivated mid-flight cannot slip
   * between the check and the write. */
  taxRateId: z.string().uuid().nullable().optional(),
  lines: z.array(invoiceLineSchema).min(1).max(100),
});

export async function createInvoiceDraftAction(
  input: z.infer<typeof draftInputSchema>,
): Promise<ActionResult<{ invoiceId: string }>> {
  const ctx = await gate();
  const parsed = draftInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const invoice = await withTenant(ctx.tenantId, async (tx) => {
      const inv = await createInvoiceDraft(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.draft_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: inv.id,
        meta: { number: inv.invoiceNumber, totalCents: inv.totalCents },
      });
      return inv;
    });
    revalidateSales(invoice.id);
    return { ok: true, data: { invoiceId: invoice.id } };
  } catch (err) {
    return fail(err);
  }
}

const updateDraftSchema = z.object({
  invoiceId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: draftInputSchema,
});

export async function updateInvoiceDraftAction(
  input: z.infer<typeof updateDraftSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateDraftSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const inv = await updateInvoiceDraft(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.draft_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: inv.id,
        meta: { number: inv.invoiceNumber, totalCents: inv.totalCents },
      });
    });
    revalidateSales(parsed.data.invoiceId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const invoiceRefSchema = z.object({
  invoiceId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function deleteInvoiceDraftAction(
  input: z.infer<typeof invoiceRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = invoiceRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      // P21 (session 5): invoice FK on document_links is NO ACTION —
      // detach attachments in the same tx or the delete fails at the DB.
      await detachAllForTargets(tx, ctx.tenantId, "invoice", [
        parsed.data.invoiceId,
      ]);
      const inv = await deleteInvoiceDraft(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.draft_deleted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: inv.id,
        meta: { number: inv.invoiceNumber },
      });
    });
    revalidateSales();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function issueInvoiceAction(
  input: z.infer<typeof invoiceRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = invoiceRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const inv = await issueInvoice(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.issued",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: inv.id,
        meta: {
          number: inv.invoiceNumber,
          totalCents: inv.totalCents,
          entryId: inv.journalEntryId,
        },
      });
    });
    revalidateSales(parsed.data.invoiceId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const updateIssuedSchema = z.object({
  invoiceId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: z.object({
    memo: z.string().trim().max(2000).optional(),
    dueDate: dateStr.nullable().optional(),
  }),
});

export async function updateIssuedInvoiceAction(
  input: z.infer<typeof updateIssuedSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateIssuedSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const inv = await updateIssuedInvoice(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: inv.id,
      });
    });
    revalidateSales(parsed.data.invoiceId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function voidInvoiceAction(
  input: z.infer<typeof invoiceRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = invoiceRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const inv = await voidInvoice(tx, ctx, parsed.data);
      // The issuance entry might have been matched to a feed row (unusual
      // but possible via the journal screen) — keep the invariant.
      if (inv.journalEntryId) {
        await resetBankLinkForEntry(tx, ctx.tenantId, inv.journalEntryId);
      }
      await logAuditInTx(tx, {
        action: "invoice.voided",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: inv.id,
        meta: { number: inv.invoiceNumber },
      });
    });
    revalidateSales(parsed.data.invoiceId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// --------------------------------------------------------------- payments

const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  paymentDate: dateStr,
  amountCents: z
    .number()
    .int()
    .positive()
    .refine((n) => n <= MAX_AMOUNT_CENTS),
  depositAccountId: z.string().uuid(),
  /**
   * A payment-method CODE. No longer a fixed enum — the tenant owns the list
   * (`payment_methods`), so the shape is validated here and membership is
   * checked against their own rows below. Accepting any slug would let a
   * crafted request write a method the list never offered.
   */
  method: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  memo: z.string().trim().max(500).optional(),
});

export async function recordInvoicePaymentAction(
  input: z.infer<typeof recordPaymentSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      // The method must be one this tenant actually offers. Checked inside the
      // same transaction as the posting, so a method deactivated mid-flight
      // cannot slip through between the check and the write.
      const methods = await listPaymentMethods(tx, ctx.tenantId, {
        activeOnly: true,
      });
      if (!methods.some((m) => m.code === parsed.data.method)) {
        throw new LedgerError(
          "PAYMENT_METHOD_INVALID",
          "that payment method is not on this business's list",
        );
      }
      const { payment, invoice } = await recordPayment(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.payment_recorded",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice_payment",
        targetId: payment.id,
        meta: {
          invoiceId: invoice.id,
          number: invoice.invoiceNumber,
          amountCents: payment.amountCents,
          entryId: payment.journalEntryId,
          status: invoice.status,
        },
      });
    });
    revalidateSales(parsed.data.invoiceId);
    revalidatePath(`${BASE}/banking`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const unapplySchema = z.object({
  paymentId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function unapplyInvoicePaymentAction(
  input: z.infer<typeof unapplySchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = unapplySchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const { payment, invoice, voidedEntryId } = await unapplyPayment(
        tx,
        ctx,
        parsed.data,
      );
      // P13: if the payment's entry was matched to a bank-feed row, that
      // row returns to review — otherwise it stays satisfied by a void
      // entry (silent double-count).
      await resetBankLinkForEntry(tx, ctx.tenantId, voidedEntryId);
      await logAuditInTx(tx, {
        action: "invoice.payment_unapplied",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice_payment",
        targetId: payment.id,
        meta: {
          invoiceId: invoice.id,
          amountCents: payment.amountCents,
          status: invoice.status,
        },
      });
    });
    revalidateSales();
    revalidatePath(`${BASE}/banking`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// ---------------------------------------------------------------- delivery

const sendInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  /** Blank = use the customer's stored address. */
  to: z.string().trim().email().max(320).optional().or(z.literal("")),
});

/**
 * Email the invoice to the customer, PDF attached.
 *
 * The send itself is idempotent per (invoice, recipient) — a double-clicked
 * button reports success without a second email — so the action does not need
 * its own guard against that.
 */
export async function sendInvoiceAction(
  input: z.infer<typeof sendInvoiceSchema>,
): Promise<ActionResult<{ to: string; duplicate: boolean }>> {
  const ctx = await gate();
  const parsed = sendInvoiceSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const { result, to } = await withTenant(ctx.tenantId, (tx) =>
      sendInvoiceEmail(tx, ctx, {
        invoiceId: parsed.data.invoiceId,
        ...(parsed.data.to ? { toOverride: parsed.data.to } : {}),
      }),
    );
    if (!result.ok) return { error: result.message };

    // Audited AFTER the send, and only on success: an audit row saying an
    // invoice was emailed when it was not is worse than no row at all.
    await withTenant(ctx.tenantId, (tx) =>
      logAuditInTx(tx, {
        action: "invoice.emailed",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: parsed.data.invoiceId,
        // Identifiers and coarse metadata only — the recipient's domain, not
        // the address, per the audit rule in AGENTS.md.
        meta: {
          toDomain: to.split("@")[1] ?? "",
          duplicate: result.duplicate,
          sentAs: result.sentAs.kind,
        },
      }),
    );
    revalidateSales(parsed.data.invoiceId);
    return { ok: true, data: { to, duplicate: result.duplicate } };
  } catch (err) {
    return fail(err);
  }
}

/* ---------------------------------------------------------------- reminders */

const reminderSettingsSchema = z.object({
  enabled: z.boolean(),
  offsets: z.array(z.number().int().min(MIN_OFFSET).max(MAX_OFFSET)).max(MAX_OFFSETS),
});

/**
 * Turn automatic reminders on or off, and set the schedule.
 *
 * AUDITED IN BOTH DIRECTIONS, unlike most settings writes. This is the switch
 * that decides whether the platform mails a client's customers without anyone
 * clicking send, so "when did this start" and "who turned it on" are questions
 * that will eventually be asked.
 */
export async function updateReminderSettingsAction(
  input: z.infer<typeof reminderSettingsSchema>,
): Promise<ActionResult<{ enabled: boolean; offsets: number[] }>> {
  const ctx = await gate();
  const parsed = reminderSettingsSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const settings = await withTenant(ctx.tenantId, async (tx) => {
      const updated = await updateReminderSettings(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.enabled
          ? "invoice.reminders_enabled"
          : "invoice.reminders_disabled",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "accounting_settings",
        targetId: ctx.tenantId,
        // The schedule itself is not a secret and is the thing that changed.
        meta: { offsets: updated.offsets },
      });
      return updated;
    });
    revalidateSales();
    revalidatePath(`${BASE}/sales/reminders`);
    return { ok: true, data: settings };
  } catch (err) {
    return fail(err);
  }
}

const muteInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  muted: z.boolean(),
});

/** Stop chasing one invoice — a dispute, or a plan agreed by phone. */
export async function setInvoiceRemindersMutedAction(
  input: z.infer<typeof muteInvoiceSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = muteInvoiceSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const inv = await setInvoiceRemindersMuted(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.muted
          ? "invoice.reminders_muted"
          : "invoice.reminders_unmuted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: inv.id,
      });
    });
    revalidateSales(parsed.data.invoiceId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const muteCustomerSchema = z.object({
  customerId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  muted: z.boolean(),
});

/** Never chase this customer automatically — standing, across all invoices. */
export async function setCustomerRemindersMutedAction(
  input: z.infer<typeof muteCustomerSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = muteCustomerSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const c = await setCustomerRemindersMuted(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.muted
          ? "invoice.customer_reminders_muted"
          : "invoice.customer_reminders_unmuted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "customer",
        targetId: c.id,
      });
    });
    revalidateSales();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const testReminderSchema = z.object({ invoiceId: z.string().uuid() });

/**
 * Send this invoice's next reminder to the owner, to check the wording.
 *
 * The invoice id is the ONLY thing the client chooses. Which reminder gets
 * previewed, and above all who receives it, are decided server-side — the
 * recipient comes from `profiles`, so this action cannot be turned into a way
 * to mail an arbitrary address from the tenant's own domain.
 */
export async function sendTestReminderAction(
  input: z.infer<typeof testReminderSchema>,
): Promise<ActionResult<{ to: string; offset: number }>> {
  const ctx = await gate();
  const parsed = testReminderSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    // Minute bucket: a double-clicked button is one email, a deliberate
    // re-test a minute later is a new one. Computed here rather than in the
    // pure key builder, which stays clock-free and table-testable.
    const nonce = new Date().toISOString().slice(0, 16);
    const { to, offset, result } = await withTenant(ctx.tenantId, (tx) =>
      sendTestReminder(tx, ctx, { invoiceId: parsed.data.invoiceId, nonce }),
    );
    if (!result.ok) return { error: result.message };

    await withTenant(ctx.tenantId, (tx) =>
      logAuditInTx(tx, {
        action: "invoice.reminder_tested",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "invoice",
        targetId: parsed.data.invoiceId,
        // The offset is the interesting fact; the address is the actor's own
        // and is not recorded, per the audit rule in AGENTS.md.
        meta: { offset, duplicate: result.duplicate },
      }),
    );
    return { ok: true, data: { to, offset } };
  } catch (err) {
    return fail(err);
  }
}
