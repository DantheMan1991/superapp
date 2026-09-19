"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withSystem } from "@/db";
import { requireSuperAdmin, requireTenantOwner } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { INTERVIEW_GRANT_KEY, INTERVIEW_OFF_KEY } from "./interview-gate";
import { PACK } from "./vocabulary";

/**
 * The two switches behind the estimate interview (X1, ADR 0098).
 *
 * ── `withSystem`, JUSTIFIED, and for `setJobTabsAction`'s reasons ───────────
 *
 * `tenant_modules` is deliberately SELECT-only for tenant context
 * (`drizzle/0001_rls.sql`) — it is the ENTITLEMENT table, and a member policy
 * that let an owner update their own row would let them switch modules on and
 * skip billing. RLS is row-level, not column-level, so there is no narrower
 * policy to write. Both conditions hold at both doors below: authorization
 * happens first, and the intent is not user-controlled — the module id is a
 * constant, and the only field written is the one boolean each is named for.
 *
 * **THE REST OF THE CONFIG SURVIVES.** The jsonb also holds the profile's
 * delivery methods, the cost-code sets and `tabsOff`; writing one key over it
 * would take a client's settings away and nothing would fail. Read, spread,
 * write — the lesson `setJobTabsAction` paid for.
 */

/** Read-spread-write of one boolean on a tenant's `jobs` config row. */
async function setConfigFlag(
  tenantId: string,
  key: string,
  value: boolean,
): Promise<boolean> {
  return withSystem(async (tx) => {
    const row = await tx.query.tenantModules.findFirst({
      where: and(
        eq(schema.tenantModules.tenantId, tenantId),
        eq(schema.tenantModules.moduleId, PACK),
      ),
      columns: { id: true, config: true },
    });
    if (!row) return false;
    const existing =
      row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? (row.config as Record<string, unknown>)
        : {};
    await tx
      .update(schema.tenantModules)
      .set({ config: { ...existing, [key]: value }, updatedAt: new Date() })
      .where(eq(schema.tenantModules.id, row.id));
    return true;
  });
}

const grantSchema = z.object({
  tenantId: z.string().uuid(),
  granted: z.boolean(),
});

/**
 * WHICH BUSINESSES HAVE THE LAYER — ours to decide, so superadmin-only.
 *
 * The tenant comes from the request here, unlike every tenant-facing action
 * in this pack, because the console is acting ON a tenant rather than inside
 * one. `requireSuperAdmin()` is what makes that safe, and it runs first.
 */
export async function setEstimateInterviewGrantAction(
  input: z.infer<typeof grantSchema>,
): Promise<{ ok: true } | { error: string }> {
  const admin = await requireSuperAdmin();
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };
  const { tenantId, granted } = parsed.data;

  try {
    const found = await setConfigFlag(tenantId, INTERVIEW_GRANT_KEY, granted);
    if (!found) return { error: "That business does not have Jobs switched on." };
    await withSystem(async (tx) => {
      await logAuditInTx(tx, {
        tenantId,
        actorClerkUserId: admin.userId,
        action: "jobs.estimate-interview.grant",
        targetType: "tenant_module",
        targetId: PACK,
        meta: { granted },
      });
    });
  } catch {
    return { error: "Could not save that. Try again." };
  }

  revalidatePath(`/admin/tenants/${tenantId}`);
  return { ok: true };
}

const switchSchema = z.object({ on: z.boolean() });

/**
 * WHETHER THIS BUSINESS USES IT — theirs to decide, and owner-only because it
 * changes what the whole team sees on every estimate.
 *
 * A tenant without the grant is refused rather than silently stored: a switch
 * that accepts a value it will never honour is a switch that lies.
 */
export async function setEstimateInterviewAction(
  input: z.infer<typeof switchSchema>,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireTenantOwner();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = switchSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid input" };

  try {
    const found = await setConfigFlag(ctx.tenant.id, INTERVIEW_OFF_KEY, !parsed.data.on);
    if (!found) return { error: "Could not save that. Try again." };
    await withSystem(async (tx) => {
      await logAuditInTx(tx, {
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        action: "jobs.estimate-interview.set",
        targetType: "tenant_module",
        targetId: PACK,
        meta: { on: parsed.data.on },
      });
    });
  } catch {
    return { error: "Could not save that. Try again." };
  }

  revalidatePath("/dashboard/m/jobs", "layout");
  return { ok: true };
}
