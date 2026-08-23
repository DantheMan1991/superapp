"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  LedgerError,
  entityForRegisterAccount,
  friendlyMessage,
  postIntercompanyPair,
  reverseIntercompanyPair,
  type LedgerCtx,
} from "./core";
import { MAX_AMOUNT_CENTS, isValidIsoDate } from "./lib/money";

/**
 * Moving money between two companies of one client (ADR 0010 slice 2).
 *
 * Its own action file for the reason `entity-actions.ts` is: this is not an
 * ordinary ledger mutation with a document behind it, and folding it into
 * `actions.ts` would put a second posting shape in a file whose every other
 * export writes exactly one entry.
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
  if (!(err instanceof LedgerError)) {
    console.error("intercompany action failed", err);
  }
  return { error: friendlyMessage(err) };
}

function revalidate(): void {
  revalidatePath(BASE, "layout");
}

const transferSchema = z.object({
  /**
   * The register the money LEFT. Its owner is the paying company — asking for
   * the account rather than the company means the two can never disagree, and
   * `postEntry` would refuse them anyway.
   */
  fromAccountId: z.string().uuid(),
  /** The company that benefited. */
  toEntityId: z.string().uuid(),
  amountCents: z
    .number()
    .int()
    .positive()
    .max(MAX_AMOUNT_CENTS),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidIsoDate, "Not a real calendar date"),
  memo: z.string().trim().max(1000).optional(),
  /**
   * WHAT THE RECEIVING COMPANY GOT, and it is required.
   *
   * Its own register when cash arrived; an expense or asset account when the
   * payer bought or settled something on its behalf. The first cut made this
   * optional — "it did not reach their account" — which produced an entry with
   * a single affiliate line that could not balance and could not post. There is
   * no accounting for nothing: if a company is better off by an amount, its
   * books say what it got.
   */
  toAccountId: z.string().uuid(),
});

export async function recordIntercompanyTransferAction(
  input: z.infer<typeof transferSchema>,
): Promise<ActionResult<{ intercompanyId: string }>> {
  const ctx = await gate();
  const parsed = transferSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const p = parsed.data;
  try {
    const pair = await withTenant(ctx.tenantId, async (tx) => {
      const fromEntityId = await entityForRegisterAccount(
        tx,
        ctx.tenantId,
        p.fromAccountId,
      );
      const result = await postIntercompanyPair(tx, ctx, {
        fromEntityId,
        toEntityId: p.toEntityId,
        amountCents: p.amountCents,
        entryDate: p.entryDate,
        memo: p.memo || "Transfer between companies",
        payerLines: [
          { accountId: p.fromAccountId, amountCents: -p.amountCents },
        ],
        payeeLines: [{ accountId: p.toAccountId, amountCents: p.amountCents }],
      });
      await logAuditInTx(tx, {
        action: "ledger.intercompany_recorded",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "journal_entry",
        targetId: result.from.id,
        meta: {
          intercompanyId: result.intercompanyId,
          fromEntityId,
          toEntityId: p.toEntityId,
          amountCents: p.amountCents,
        },
      });
      return result;
    });
    revalidate();
    return { ok: true, data: { intercompanyId: pair.intercompanyId } };
  } catch (err) {
    return fail(err);
  }
}

const reverseSchema = z.object({
  intercompanyId: z.string().uuid(),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(isValidIsoDate, "Not a real calendar date"),
});

/**
 * Undo BOTH halves. There is no single-leg equivalent, deliberately:
 * `assertNotIntercompanyLeg` refuses voiding or reversing one side from the
 * journal, because that leaves one company still owing an affiliate that no
 * longer owes it.
 */
export async function reverseIntercompanyTransferAction(
  input: z.infer<typeof reverseSchema>,
): Promise<ActionResult<{ intercompanyId: string }>> {
  const ctx = await gate();
  const parsed = reverseSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    const pair = await withTenant(ctx.tenantId, async (tx) => {
      const result = await reverseIntercompanyPair(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "ledger.intercompany_reversed",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "journal_entry",
        targetId: result.from.id,
        meta: {
          reversalOf: parsed.data.intercompanyId,
          intercompanyId: result.intercompanyId,
        },
      });
      return result;
    });
    revalidate();
    return { ok: true, data: { intercompanyId: pair.intercompanyId } };
  } catch (err) {
    return fail(err);
  }
}
