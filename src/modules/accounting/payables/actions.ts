"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, friendlyMessage, type LedgerCtx } from "../core";
import { isValidIsoDate } from "../lib/money";
import { resetBankLinkForEntry } from "../banking/match";
import { detachAllForTargets } from "../documents/links";
import { suggestBillCodingForBill, trySuggestBillCoding } from "../ai/bill-code";
import { readBillCoding } from "../ai/bill-validate";
import { billLineSchema } from "./lines";
import {
  approveBill,
  createBillDraft,
  deleteBillDraft,
  findPossibleDuplicates,
  loadBill,
  loadBillLines,
  returnBillToDraft,
  submitBill,
  updateApprovedBill,
  updateBillDraft,
  voidBill,
  type DuplicateSignal,
} from "./bills";
import { recordBillPayment, unapplyBillPayment } from "./payments";
import {
  createBillFromDocument,
  findVendorCandidatesByName,
} from "./from-document";
import { createVendor, setVendorActive, updateVendor } from "./vendors";

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
  if (!(err instanceof LedgerError)) console.error("payables action failed", err);
  const msg = err instanceof Error ? err.message : "";
  if (msg.includes("ANTHROPIC_API_KEY")) {
    return { error: "The Claude API key isn't configured yet — see SETUP.md." };
  }
  return { error: friendlyMessage(err) };
}

function revalidatePurchases(billId?: string): void {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/purchases/bills`);
  if (billId) revalidatePath(`${BASE}/purchases/bills/${billId}`);
  revalidatePath(`${BASE}/purchases/vendors`);
  revalidatePath(`${BASE}/reports/ap-aging`);
  revalidatePath(`${BASE}/journal`);
  revalidatePath(`${BASE}/trial-balance`);
  revalidatePath(`${BASE}/receipts`);
}

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isValidIsoDate, "Not a real calendar date");

// ---------------------------------------------------------------- vendors

const vendorInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  defaultExpenseAccountId: z.string().uuid().nullable().optional(),
});

export async function createVendorAction(
  input: z.infer<typeof vendorInputSchema>,
): Promise<ActionResult<{ vendorId: string }>> {
  const ctx = await gate();
  const parsed = vendorInputSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const vendor = await withTenant(ctx.tenantId, async (tx) => {
      const v = await createVendor(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "bill.vendor_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "vendor",
        targetId: v.id,
      });
      return v;
    });
    revalidatePurchases();
    return { ok: true, data: { vendorId: vendor.id } };
  } catch (err) {
    return fail(err);
  }
}

const vendorUpdateSchema = z.object({
  vendorId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: vendorInputSchema,
});

export async function updateVendorAction(
  input: z.infer<typeof vendorUpdateSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = vendorUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await updateVendor(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "bill.vendor_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "vendor",
        targetId: parsed.data.vendorId,
      });
    });
    revalidatePurchases();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const vendorActiveSchema = z.object({
  vendorId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  isActive: z.boolean(),
});

export async function setVendorActiveAction(
  input: z.infer<typeof vendorActiveSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = vendorActiveSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await setVendorActive(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: parsed.data.isActive
          ? "bill.vendor_reactivated"
          : "bill.vendor_deactivated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "vendor",
        targetId: parsed.data.vendorId,
      });
    });
    revalidatePurchases();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function findVendorCandidatesAction(input: {
  name: string;
}): Promise<ActionResult<{ candidates: Array<{ id: string; name: string }> }>> {
  const ctx = await gate();
  const name = z.string().max(200).safeParse(input.name);
  if (!name.success) return { error: "Invalid input" };
  try {
    const candidates = await withTenant(ctx.tenantId, (tx) =>
      findVendorCandidatesByName(tx, ctx.tenantId, name.data),
    );
    return {
      ok: true,
      data: { candidates: candidates.map((v) => ({ id: v.id, name: v.name })) },
    };
  } catch (err) {
    return fail(err);
  }
}

// ------------------------------------------------------------------ bills

const billDraftSchema = z.object({
  vendorId: z.string().uuid(),
  billNumber: z.string().trim().max(100).optional(),
  billDate: dateStr,
  dueDate: dateStr.nullable().optional(),
  memo: z.string().trim().max(1000).optional(),
  lines: z.array(billLineSchema).min(1).max(100),
});

export async function createBillDraftAction(
  input: z.infer<typeof billDraftSchema>,
): Promise<ActionResult<{ billId: string; duplicates: DuplicateSignal[] }>> {
  const ctx = await gate();
  const parsed = billDraftSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const result = await withTenant(ctx.tenantId, async (tx) => {
      const bill = await createBillDraft(tx, ctx, parsed.data);
      const duplicates = await findPossibleDuplicates(tx, ctx.tenantId, {
        vendorId: bill.vendorId,
        billNumber: bill.billNumber,
        totalCents: bill.totalCents,
        billDate: bill.billDate,
        excludeBillId: bill.id,
      });
      await logAuditInTx(tx, {
        action: "bill.draft_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill",
        targetId: bill.id,
        meta: { totalCents: bill.totalCents, duplicateCount: duplicates.length },
      });
      return { bill, duplicates };
    });
    revalidatePurchases(result.bill.id);
    return {
      ok: true,
      data: { billId: result.bill.id, duplicates: result.duplicates },
    };
  } catch (err) {
    return fail(err);
  }
}

const createFromDocumentSchema = z
  .object({
    documentId: z.string().uuid(),
    vendorId: z.string().uuid().optional(),
    createVendorName: z.string().trim().min(1).max(200).optional(),
    billDateFallback: dateStr,
  })
  .refine((v) => !!v.vendorId !== !!v.createVendorName, {
    message: "exactly one of vendorId / createVendorName",
  });

/** The flagship: document → prefilled draft + attachment + AI coding. */
export async function createBillFromDocumentAction(
  input: z.infer<typeof createFromDocumentSchema>,
): Promise<
  ActionResult<{ billId: string; duplicates: DuplicateSignal[]; existing: boolean }>
> {
  const ctx = await gate();
  const parsed = createFromDocumentSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const result = await withTenant(ctx.tenantId, async (tx) => {
      const r = await createBillFromDocument(tx, ctx, parsed.data);
      if (!r.existing) {
        await logAuditInTx(tx, {
          action: "bill.created_from_document",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "bill",
          targetId: r.bill.id,
          meta: {
            documentId: parsed.data.documentId,
            duplicateCount: r.duplicates.length,
          },
        });
      }
      return r;
    });
    // Auto AI coding after the create tx commits (cooldown-aware, silent
    // failure — the manual Suggest button remains).
    if (!result.existing) {
      await trySuggestBillCoding(ctx, result.bill.id);
    }
    revalidatePurchases(result.bill.id);
    return {
      ok: true,
      data: {
        billId: result.bill.id,
        duplicates: result.duplicates,
        existing: result.existing,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

const billUpdateSchema = z.object({
  billId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: billDraftSchema,
});

export async function updateBillDraftAction(
  input: z.infer<typeof billUpdateSchema>,
): Promise<ActionResult<{ duplicates: DuplicateSignal[] }>> {
  const ctx = await gate();
  const parsed = billUpdateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const duplicates = await withTenant(ctx.tenantId, async (tx) => {
      const bill = await updateBillDraft(tx, ctx, parsed.data);
      const dups = await findPossibleDuplicates(tx, ctx.tenantId, {
        vendorId: bill.vendorId,
        billNumber: bill.billNumber,
        totalCents: bill.totalCents,
        billDate: bill.billDate,
        excludeBillId: bill.id,
      });
      await logAuditInTx(tx, {
        action: "bill.draft_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill",
        targetId: bill.id,
        meta: { totalCents: bill.totalCents },
      });
      return dups;
    });
    revalidatePurchases(parsed.data.billId);
    return { ok: true, data: { duplicates } };
  } catch (err) {
    return fail(err);
  }
}

const billRefSchema = z.object({
  billId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function deleteBillDraftAction(
  input: z.infer<typeof billRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = billRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      // P21: the bill FK on document_links is NO ACTION — detach
      // attachments in the same tx or the delete fails at the DB.
      await detachAllForTargets(tx, ctx.tenantId, "bill", [parsed.data.billId]);
      const bill = await deleteBillDraft(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "bill.draft_deleted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill",
        targetId: bill.id,
        meta: { billNumber: bill.billNumber },
      });
    });
    revalidatePurchases();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function submitBillForApprovalAction(
  input: z.infer<typeof billRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = billRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await submitBill(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "bill.submitted",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill",
        targetId: parsed.data.billId,
      });
    });
    revalidatePurchases(parsed.data.billId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function returnBillToDraftAction(
  input: z.infer<typeof billRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = billRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await returnBillToDraft(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "bill.returned_to_draft",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill",
        targetId: parsed.data.billId,
      });
    });
    revalidatePurchases(parsed.data.billId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function approveBillAction(
  input: z.infer<typeof billRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = billRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      // AI-acceptance audit (P23): count lines whose final account equals
      // the AI suggestion, before approval freezes them.
      const bill = await loadBill(tx, ctx.tenantId, parsed.data.billId);
      const coding = readBillCoding(bill.aiCoding);
      const lines = await loadBillLines(tx, ctx.tenantId, bill.id);
      const aiCodedLineCount = coding
        ? lines.filter((l) =>
            coding.suggestions.some(
              (s) => s.billLineId === l.id && s.accountId === l.accountId,
            ),
          ).length
        : 0;
      const approved = await approveBill(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "bill.approved",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill",
        targetId: approved.id,
        meta: {
          entryId: approved.journalEntryId,
          totalCents: approved.totalCents,
          aiCodedLineCount,
        },
      });
    });
    revalidatePurchases(parsed.data.billId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const billOpenPatchSchema = z.object({
  billId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  patch: z.object({
    memo: z.string().trim().max(1000).optional(),
    dueDate: dateStr.nullable().optional(),
  }),
});

export async function updateApprovedBillAction(
  input: z.infer<typeof billOpenPatchSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = billOpenPatchSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await updateApprovedBill(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "bill.updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill",
        targetId: parsed.data.billId,
      });
    });
    revalidatePurchases(parsed.data.billId);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

export async function voidBillAction(
  input: z.infer<typeof billRefSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = billRefSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const bill = await voidBill(tx, ctx, parsed.data);
      if (bill.journalEntryId) {
        await resetBankLinkForEntry(tx, ctx.tenantId, bill.journalEntryId);
      }
      await logAuditInTx(tx, {
        action: "bill.voided",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill",
        targetId: bill.id,
        meta: { entryId: bill.journalEntryId },
      });
    });
    revalidatePurchases(parsed.data.billId);
    revalidatePath(`${BASE}/banking`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// --------------------------------------------------------------- payments

const recordPaymentSchema = z.object({
  billId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
  paymentDate: dateStr,
  amountCents: z.number().int().positive(),
  paidFromAccountId: z.string().uuid(),
  method: z.enum(["cash", "check", "card", "bank_transfer", "other"]),
  memo: z.string().trim().max(500).optional(),
});

export async function recordBillPaymentAction(
  input: z.infer<typeof recordPaymentSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const { payment, bill } = await recordBillPayment(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "bill.payment_recorded",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill_payment",
        targetId: payment.id,
        meta: {
          billId: bill.id,
          amountCents: payment.amountCents,
          entryId: payment.journalEntryId,
        },
      });
    });
    revalidatePurchases(parsed.data.billId);
    revalidatePath(`${BASE}/banking`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const unapplyPaymentSchema = z.object({
  paymentId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function unapplyBillPaymentAction(
  input: z.infer<typeof unapplyPaymentSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = unapplyPaymentSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    let billId = "";
    await withTenant(ctx.tenantId, async (tx) => {
      const { payment, bill, voidedEntryId } = await unapplyBillPayment(
        tx,
        ctx,
        parsed.data,
      );
      billId = bill.id;
      // P13: a matched feed row goes back to review.
      await resetBankLinkForEntry(tx, ctx.tenantId, voidedEntryId);
      await logAuditInTx(tx, {
        action: "bill.payment_unapplied",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "bill_payment",
        targetId: payment.id,
        meta: { billId: bill.id, voidedEntryId },
      });
    });
    revalidatePurchases(billId);
    revalidatePath(`${BASE}/banking`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

// -------------------------------------------------------------- AI coding

const suggestSchema = z.object({ billId: z.string().uuid() });

export async function suggestBillCodingAction(
  input: z.infer<typeof suggestSchema>,
): Promise<ActionResult<{ suggested: number }>> {
  const ctx = await gate();
  const parsed = suggestSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const coding = await suggestBillCodingForBill(ctx, parsed.data.billId);
    revalidatePurchases(parsed.data.billId);
    return { ok: true, data: { suggested: coding.suggestions.length } };
  } catch (err) {
    return fail(err);
  }
}
