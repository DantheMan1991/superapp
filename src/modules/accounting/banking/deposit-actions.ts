"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { LedgerError, friendlyMessage, type LedgerCtx } from "../core";
import { isValidIsoDate } from "../lib/money";
import { resetBankLinkForEntry } from "./match";
import { recordDeposit, voidDeposit } from "./deposits";

/**
 * The deposit actions, in their own file: `banking/actions.ts` is already the
 * longest action file in the module, and a "use server" module may export
 * only async functions, so its `gate` and `fail` cannot be shared from
 * there — the dozen lines are repeated here on purpose.
 */

const BASE = "/dashboard/m/accounting";

type ActionResult<T = undefined> = { ok: true; data?: T } | { error: string };

async function gate(): Promise<LedgerCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "accounting");
  // Fail closed for the accountant: nothing here is a read.
  if (ctx.role === "expert") {
    throw new LedgerError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof LedgerError) return { error: friendlyMessage(err) };
  console.error("deposit action failed", err);
  return { error: "Something went wrong. Please try again." };
}

function revalidate(bankAccountId: string, depositId: string) {
  revalidatePath(BASE);
  revalidatePath(`${BASE}/banking`);
  revalidatePath(`${BASE}/banking/deposits`);
  revalidatePath(`${BASE}/banking/deposits/new`);
  revalidatePath(`${BASE}/banking/deposits/${depositId}`);
  revalidatePath(`${BASE}/banking/${bankAccountId}`);
  revalidatePath(`${BASE}/sales/invoices`);
  revalidatePath(`${BASE}/journal`);
}

const dateStr = z.string().refine(isValidIsoDate, "Invalid date");

const recordSchema = z.object({
  bankAccountId: z.string().uuid(),
  depositDate: dateStr,
  memo: z.string().trim().max(500).optional(),
  /** Two hundred cheques is a bigger Friday than any client of this product has. */
  paymentIds: z.array(z.string().uuid()).min(1).max(200),
});

export async function recordDepositAction(
  input: z.infer<typeof recordSchema>,
): Promise<ActionResult<{ depositId: string; totalCents: number }>> {
  const ctx = await gate();
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const deposit = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const { deposit, entryId } = await recordDeposit(tx, ctx, parsed.data);
        await logAuditInTx(tx, {
          action: "deposit.recorded",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "deposit",
          targetId: deposit.id,
          meta: {
            entryId,
            bankAccountId: deposit.bankAccountId,
            totalCents: deposit.totalCents,
            payments: parsed.data.paymentIds.length,
          },
        });
        return deposit;
      },
      // The deposits table lets members read and only owners write (its RLS),
      // so the transaction must carry the caller's real role.
      { role: ctx.role },
    );
    revalidate(deposit.bankAccountId, deposit.id);
    return { ok: true, data: { depositId: deposit.id, totalCents: deposit.totalCents } };
  } catch (err) {
    return fail(err);
  }
}

const voidSchema = z.object({
  depositId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export async function voidDepositAction(
  input: z.infer<typeof voidSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const deposit = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const { deposit, voidedEntryId } = await voidDeposit(tx, ctx, parsed.data);
        // P13: a feed row matched to the voided entry goes back to review.
        await resetBankLinkForEntry(tx, ctx.tenantId, voidedEntryId);
        await logAuditInTx(tx, {
          action: "deposit.voided",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "deposit",
          targetId: deposit.id,
          meta: { voidedEntryId, bankAccountId: deposit.bankAccountId },
        });
        return deposit;
      },
      { role: ctx.role },
    );
    revalidate(deposit.bankAccountId, deposit.id);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
