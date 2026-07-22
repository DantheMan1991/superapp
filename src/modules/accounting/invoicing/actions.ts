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
import {
  createRecurringInvoice,
  generateRecurringInvoices,
  recurringTemplateSchema,
  setRecurringActive,
  updateRecurringInvoice,
} from "./recurring";

const BASE = "/dashboard/m/accounting";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
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
  revalidatePath(`${BASE}/sales/recurring`);
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
  method: z.enum(["cash", "check", "card", "bank_transfer", "other"]),
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

// -------------------------------------------------------------- recurring

const createRecurringSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  dayOfMonth: z.number().int().min(1).max(28),
  nextRunDate: dateStr,
  template: recurringTemplateSchema,
});

export async function createRecurringInvoiceAction(
  input: z.infer<typeof createRecurringSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = createRecurringSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const r = await createRecurringInvoice(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.recurring_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "recurring_invoice",
        targetId: r.id,
        meta: { name: r.name },
      });
    });
    revalidateSales();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const updateRecurringSchema = z.object({
  recurringInvoiceId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    dayOfMonth: z.number().int().min(1).max(28).optional(),
    nextRunDate: dateStr.optional(),
    template: recurringTemplateSchema.optional(),
  }),
});

export async function updateRecurringInvoiceAction(
  input: z.infer<typeof updateRecurringSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateRecurringSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const r = await updateRecurringInvoice(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.recurring_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "recurring_invoice",
        targetId: r.id,
      });
    });
    revalidateSales();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const setRecurringActiveSchema = z.object({
  recurringInvoiceId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  active: z.boolean(),
});

export async function setRecurringActiveAction(
  input: z.infer<typeof setRecurringActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = setRecurringActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const r = await setRecurringActive(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.active
          ? "invoice.recurring_reactivated"
          : "invoice.recurring_deactivated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "recurring_invoice",
        targetId: r.id,
      });
    });
    revalidateSales();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function generateRecurringInvoicesAction(): Promise<
  ActionResult<{ created: number; templatesRun: number; errors: Array<{ name: string; error: string }> }>
> {
  const ctx = await gate();
  try {
    const result = await generateRecurringInvoices(ctx);
    await withTenant(ctx.tenantId, (tx) =>
      logAuditInTx(tx, {
        action: "invoice.recurring_generated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        meta: {
          created: result.created,
          templatesRun: result.templatesRun,
          errors: result.errors.length,
        },
      }),
    );
    revalidateSales();
    return {
      ok: true,
      data: {
        created: result.created,
        templatesRun: result.templatesRun,
        errors: result.errors.map((e) => ({ name: e.name, error: e.error })),
      },
    };
  } catch (err) {
    return fail(err);
  }
}
