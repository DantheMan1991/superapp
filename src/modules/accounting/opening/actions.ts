"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, friendlyMessage, type LedgerCtx } from "../core";
import { isValidIsoDate, MAX_AMOUNT_CENTS } from "../lib/money";
import { recordOpeningBill, recordOpeningInvoice } from "./position";

/**
 * The Opening page's two actions (ADR 0037). Each makes one real document
 * through the module's own verbs and says so in the audit trail.
 */

const BASE = "/dashboard/m/accounting";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  if (ctx.role === "expert") {
    throw new LedgerError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (!(err instanceof LedgerError)) console.error("opening action failed", err);
  return { error: friendlyMessage(err) };
}

const openingDocumentSchema = z.object({
  entityId: z.string().uuid(),
  partyId: z.string().uuid(),
  number: z.string().trim().max(40).optional(),
  documentDate: z.string().refine(isValidIsoDate, "Not a real calendar date"),
  dueDate: z
    .string()
    .refine(isValidIsoDate, "Not a real calendar date")
    .nullable()
    .optional(),
  amountCents: z.number().int().positive().max(MAX_AMOUNT_CENTS),
  accountId: z.string().uuid(),
  memo: z.string().trim().max(500).optional(),
});

export type OpeningDocumentActionInput = z.infer<typeof openingDocumentSchema>;

function revalidate(): void {
  revalidatePath(`${BASE}/opening`);
  revalidatePath(`${BASE}/sales`);
  revalidatePath(`${BASE}/sales/invoices`);
  revalidatePath(`${BASE}/purchases`);
  revalidatePath(`${BASE}/purchases/bills`);
  revalidatePath(`${BASE}/trial-balance`);
  revalidatePath("/dashboard");
}

export async function recordOpeningInvoiceAction(
  input: OpeningDocumentActionInput,
): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const ctx = await gate();
    const parsed = openingDocumentSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const invoice = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await recordOpeningInvoice(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "accounting.opening_invoice_recorded",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "invoice",
          targetId: created.id,
          meta: { entityId: parsed.data.entityId, amountCents: parsed.data.amountCents },
        });
        return created;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true, data: { id: invoice.id, number: invoice.invoiceNumber } };
  } catch (err) {
    return fail(err);
  }
}

export async function recordOpeningBillAction(
  input: OpeningDocumentActionInput,
): Promise<ActionResult<{ id: string; number: string }>> {
  try {
    const ctx = await gate();
    const parsed = openingDocumentSchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
    const bill = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const created = await recordOpeningBill(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "accounting.opening_bill_recorded",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "bill",
          targetId: created.id,
          meta: { entityId: parsed.data.entityId, amountCents: parsed.data.amountCents },
        });
        return created;
      },
      { role: ctx.role, userId: ctx.userId },
    );
    revalidate();
    return { ok: true, data: { id: bill.id, number: bill.billNumber } };
  } catch (err) {
    return fail(err);
  }
}
