"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, friendlyMessage, type LedgerCtx } from "../core";
import { MAX_AMOUNT_CENTS } from "../lib/money";
import { MAX_DUE_IN_DAYS } from "./terms";
import {
  createPaymentMethod,
  createPaymentTerm,
  createProduct,
  renamePaymentMethod,
  setDefaultPaymentTerm,
  setPaymentMethodActive,
  setPaymentTermActive,
  setProductActive,
  updateProduct,
} from "./catalogue";

/**
 * Owner settings for the three reference lists.
 *
 * Its own file rather than more of `invoicing/actions.ts`, which is already
 * long: these are settings writes, they share no helpers with the invoice
 * lifecycle, and nothing here touches the ledger.
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
  if (!(err instanceof LedgerError)) console.error("catalogue action failed", err);
  return { error: friendlyMessage(err) };
}

function revalidateCatalogue(): void {
  revalidatePath(`${BASE}/sales/catalogue`);
  revalidatePath(`${BASE}/sales/invoices`);
  revalidatePath(`${BASE}/sales/customers`);
}

/* -- products ------------------------------------------------------------- */

const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(500).optional(),
  kind: z.enum(["service", "product"]).optional(),
  unitPriceCents: z
    .number()
    .int()
    .refine((n) => Math.abs(n) <= MAX_AMOUNT_CENTS, "Amount too large")
    .optional(),
  incomeAccountId: z.string().uuid().nullable().optional(),
  expenseAccountId: z.string().uuid().nullable().optional(),
});

export async function createProductAction(
  input: z.infer<typeof productSchema>,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await gate();
  const parsed = productSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const product = await withTenant(ctx.tenantId, async (tx) => {
      const p = await createProduct(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.product_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "product",
        targetId: p.id,
      });
      return p;
    });
    revalidateCatalogue();
    return { ok: true, data: { id: product.id } };
  } catch (err) {
    return fail(err);
  }
}

const updateProductSchema = z.object({
  productId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: productSchema,
});

export async function updateProductAction(
  input: z.infer<typeof updateProductSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const p = await updateProduct(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.product_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "product",
        targetId: p.id,
      });
    });
    revalidateCatalogue();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const setActiveSchema = z.object({
  id: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  active: z.boolean(),
});

export async function setProductActiveAction(
  input: z.infer<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, (tx) =>
      setProductActive(tx, ctx, {
        productId: parsed.data.id,
        expectedVersion: parsed.data.expectedVersion,
        active: parsed.data.active,
      }),
    );
    revalidateCatalogue();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- payment terms -------------------------------------------------------- */

const termSchema = z.object({
  name: z.string().trim().min(1).max(100),
  dueInDays: z.number().int().min(0).max(MAX_DUE_IN_DAYS),
});

export async function createPaymentTermAction(
  input: z.infer<typeof termSchema>,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await gate();
  const parsed = termSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const term = await withTenant(ctx.tenantId, (tx) =>
      createPaymentTerm(tx, ctx, parsed.data),
    );
    revalidateCatalogue();
    return { ok: true, data: { id: term.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function setDefaultPaymentTermAction(
  input: { termId: string },
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = z.object({ termId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await setDefaultPaymentTerm(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "invoice.default_terms_changed",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "payment_term",
        targetId: parsed.data.termId,
      });
    });
    revalidateCatalogue();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setPaymentTermActiveAction(
  input: z.infer<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, (tx) =>
      setPaymentTermActive(tx, ctx, {
        termId: parsed.data.id,
        expectedVersion: parsed.data.expectedVersion,
        active: parsed.data.active,
      }),
    );
    revalidateCatalogue();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/* -- payment methods ------------------------------------------------------ */

export async function createPaymentMethodAction(
  input: { name: string },
): Promise<ActionResult<{ id: string }>> {
  const ctx = await gate();
  const parsed = z
    .object({ name: z.string().trim().min(1).max(100) })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const method = await withTenant(ctx.tenantId, (tx) =>
      createPaymentMethod(tx, ctx, parsed.data),
    );
    revalidateCatalogue();
    return { ok: true, data: { id: method.id } };
  } catch (err) {
    return fail(err);
  }
}

export async function renamePaymentMethodAction(
  input: { methodId: string; expectedVersion: number; name: string },
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = z
    .object({
      methodId: z.string().uuid(),
      expectedVersion: z.number().int().min(1),
      name: z.string().trim().min(1).max(100),
    })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, (tx) => renamePaymentMethod(tx, ctx, parsed.data));
    revalidateCatalogue();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function setPaymentMethodActiveAction(
  input: z.infer<typeof setActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = setActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, (tx) =>
      setPaymentMethodActive(tx, ctx, {
        methodId: parsed.data.id,
        expectedVersion: parsed.data.expectedVersion,
        active: parsed.data.active,
      }),
    );
    revalidateCatalogue();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
