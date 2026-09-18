"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withSystem } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { ALWAYS_ON, JOB_TABS, type JobTab } from "./tabs";
import { PACK } from "./vocabulary";

const inputSchema = z.object({
  /** The optional tabs to hide. The three mandatory ones are refused, not ignored. */
  tabsOff: z
    .array(z.enum(JOB_TABS))
    .max(JOB_TABS.length)
    .refine(
      (tabs) => tabs.every((tab) => !ALWAYS_ON.includes(tab)),
      "Overview, Contracts and Job cost are what make a job a job.",
    ),
});

/**
 * WHICH PARTS OF A JOB THIS BUSINESS DOES (`tabs.ts`).
 *
 * Owner-only, and that is the right level: it changes what everybody on the
 * team can see, and a foreman deciding the company no longer tracks warranty
 * is not a decision a foreman makes.
 *
 * ── `withSystem`, JUSTIFIED (security.md S2) ────────────────────────────────
 *
 * `tenant_modules` is deliberately SELECT-only for tenant context
 * (`drizzle/0001_rls.sql`) and must stay that way — it is the ENTITLEMENT
 * table, and a member policy that let an owner update their own row would let
 * them switch modules on and skip billing. RLS is row-level, not column-level,
 * so there is no narrower policy to write.
 *
 * The same two conditions `setTenantTimezoneAction` relies on hold here:
 * authorization happened first, and the intent is not user-controlled — the
 * tenant comes from the session and never from the request, the module id is a
 * constant, and the only field written is `config.tabsOff`.
 *
 * **THE REST OF THE CONFIG SURVIVES.** The jsonb holds the profile's delivery
 * methods and cost-code sets too; writing `{ tabsOff }` over it would silently
 * take a client's delivery methods away, and nothing would have failed. Read,
 * spread, write.
 */
export async function setJobTabsAction(
  input: z.infer<typeof inputSchema>,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireTenantOwner();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  // Stored in the pack's own order, so the value does not churn on every save
  // just because the checkboxes were clicked in a different sequence.
  const tabsOff: JobTab[] = JOB_TABS.filter((tab) => parsed.data.tabsOff.includes(tab));

  try {
    await withSystem(async (tx) => {
      const row = await tx.query.tenantModules.findFirst({
        where: and(
          eq(schema.tenantModules.tenantId, ctx.tenant.id),
          eq(schema.tenantModules.moduleId, PACK),
        ),
        columns: { id: true, config: true },
      });
      if (!row) return;
      const existing =
        row.config && typeof row.config === "object" && !Array.isArray(row.config)
          ? (row.config as Record<string, unknown>)
          : {};
      await tx
        .update(schema.tenantModules)
        .set({ config: { ...existing, tabsOff }, updatedAt: new Date() })
        .where(eq(schema.tenantModules.id, row.id));
      await logAuditInTx(tx, {
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        action: "jobs.tabs.set",
        targetType: "tenant_module",
        targetId: PACK,
        // Slugs only — what a business does, never what is on a job.
        meta: { tabsOff },
      });
    });
  } catch {
    return { error: "Could not save that. Try again." };
  }

  revalidatePath("/dashboard/m/jobs", "layout");
  return { ok: true };
}
