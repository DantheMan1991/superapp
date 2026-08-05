"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { CrmError, friendlyMessage } from "./core/errors";
import type { CrmCtx } from "./core/types";
import { grantAccess, revokeAccess } from "./collaborator-ops";

/**
 * Granting and revoking access to a restricted record.
 *
 * OWNER-ONLY, and checked here as well as in RLS. The policy already makes an
 * unauthorized write affect zero rows; this exists so the person is told "you
 * need to be an owner" instead of watching a button do nothing.
 *
 * BOTH ACTIONS ARE AUDITED, which is not the default in this module — most CRM
 * writes are not. These are, because "who could see the confidential record,
 * and who let them" is a question asked after something has gone wrong, and by
 * then the row itself may have been revoked. `granted_by_clerk_user_id` on the
 * row answers it while the grant lives; the audit entry answers it afterwards.
 */

const BASE = "/dashboard/m/crm";

type ActionResult = { ok: true } | { error: string };

async function gate(): Promise<CrmCtx> {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "crm");
  if (ctx.role === "expert") {
    throw new CrmError("FORBIDDEN_EXPERT", "accountant access is read-only");
  }
  if (ctx.role !== "owner") {
    throw new CrmError("FORBIDDEN", "owner role required");
  }
  return { tenantId: ctx.tenant.id, userId: ctx.userId, role: ctx.role };
}

function fail(err: unknown): { error: string } {
  if (err instanceof CrmError) return { error: friendlyMessage(err) };
  console.error("crm collaborator action failed", err);
  return { error: friendlyMessage(err) };
}

const grantSchema = z.object({
  partyId: z.string().uuid(),
  clerkUserId: z.string().min(1).max(120),
});

export async function grantRecordAccessAction(
  input: z.infer<typeof grantSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = grantSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const granted = await grantAccess(tx, ctx.tenantId, {
          partyId: parsed.data.partyId,
          clerkUserId: parsed.data.clerkUserId,
          grantedByClerkUserId: ctx.userId,
        });
        // Null means the grant already existed. Nothing changed, so nothing is
        // audited — an audit log that records non-events is one nobody reads.
        if (!granted) return;
        await logAuditInTx(tx, {
          action: "crm.record_access_granted",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: parsed.data.partyId,
          meta: { grantedTo: parsed.data.clerkUserId },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`${BASE}/records/${parsed.data.partyId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

const revokeSchema = z.object({
  partyId: z.string().uuid(),
  collaboratorId: z.string().uuid(),
  /** For the audit entry, which outlives the row being deleted. */
  clerkUserId: z.string().min(1).max(120),
});

export async function revokeRecordAccessAction(
  input: z.infer<typeof revokeSchema>,
): Promise<ActionResult> {
  try {
    const ctx = await gate();
    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) return { error: "Invalid input" };

    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await revokeAccess(tx, ctx.tenantId, parsed.data.collaboratorId);
        await logAuditInTx(tx, {
          action: "crm.record_access_revoked",
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          targetType: "party",
          targetId: parsed.data.partyId,
          meta: { revokedFrom: parsed.data.clerkUserId },
        });
      },
      { role: ctx.role, userId: ctx.userId },
    );

    revalidatePath(`${BASE}/records/${parsed.data.partyId}`);
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}
