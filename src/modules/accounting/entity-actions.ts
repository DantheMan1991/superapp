"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import {
  LedgerError,
  createEntity,
  friendlyMessage,
  setDefaultEntity,
  updateEntity,
  type LedgerCtx,
} from "./core";

/**
 * Legal entities — the companies whose books this tenant keeps (ADR 0010).
 *
 * Its own action file rather than more of `actions.ts`, because none of this is
 * a ledger mutation: no posting engine, no period lock, no version CAS. What it
 * shares with the rest of the module is the gate, and that is deliberately
 * copied rather than exported — `gate` fails closed for the expert role, and a
 * shared mutable helper is not worth the coupling for six lines.
 *
 * OWNER ONLY, enforced in core by `requireOwnerRole`. Adding a company is a
 * decision about the business, not bookkeeping.
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
    console.error("entity action failed", err);
  }
  return { error: friendlyMessage(err) };
}

/**
 * Every report and every journal form reads this list, and the picker's
 * presence depends on how many there are — so a new company has to reach all of
 * them, not just this page.
 */
function revalidate(): void {
  revalidatePath(BASE, "layout");
}

const nameSchema = z.object({
  name: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(200).optional(),
});

export async function createEntityAction(
  input: z.infer<typeof nameSchema>,
): Promise<ActionResult<{ id: string }>> {
  const ctx = await gate();
  const parsed = nameSchema.safeParse(input);
  if (!parsed.success) return { error: "Give the company a name." };
  try {
    const entity = await withTenant(ctx.tenantId, async (tx) => {
      const created = await createEntity(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "ledger.entity_created",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "entity",
        targetId: created.id,
        meta: { name: created.name },
      });
      return created;
    });
    revalidate();
    return { ok: true, data: { id: entity.id } };
  } catch (err) {
    return fail(err);
  }
}

const updateSchema = z.object({
  entityId: z.string().uuid(),
  name: z.string().trim().min(1).max(120).optional(),
  legalName: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
});

export async function updateEntityAction(
  input: z.infer<typeof updateSchema>,
): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      const after = await updateEntity(tx, ctx, parsed.data);
      await logAuditInTx(tx, {
        action: "ledger.entity_updated",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "entity",
        targetId: parsed.data.entityId,
        meta: { name: after.name, isActive: after.isActive },
      });
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Move the default.
 *
 * Audited in both directions and worth it: the default is where every invoice,
 * bill and bank row posts while documents carry no company of their own, so
 * moving it changes where new money lands. "When did this change" is a question
 * somebody will eventually ask.
 */
export async function setDefaultEntityAction(input: {
  entityId: string;
}): Promise<ActionResult> {
  const ctx = await gate();
  const parsed = z.object({ entityId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  try {
    await withTenant(ctx.tenantId, async (tx) => {
      await setDefaultEntity(tx, ctx, parsed.data.entityId);
      await logAuditInTx(tx, {
        action: "ledger.entity_default_set",
        tenantId: ctx.tenantId,
        actorClerkUserId: ctx.userId,
        targetType: "entity",
        targetId: parsed.data.entityId,
      });
    });
    revalidate();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
