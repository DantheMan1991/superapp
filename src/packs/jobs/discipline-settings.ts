"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, withSystem } from "@/db";
import { requireTenantOwner } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { ORDERABLE_DISCIPLINES } from "./drawings-math";
import { PACK } from "./vocabulary";

const inputSchema = z.object({
  /** Discipline keys, most-read first. Anything left out keeps the standard's place. */
  order: z.array(z.string().max(16)).max(ORDERABLE_DISCIPLINES.length * 2),
});

/**
 * WHICH ORDER THIS BUSINESS READS ITS DRAWINGS IN.
 *
 * The founder, looking at his own house on the drawings page: *"I should be
 * able to organize the categories. architectural, then structural etc. right
 * now structural shows first but I would not want that."* Structural leads
 * because `DISCIPLINE_ORDER` is the US National CAD Standard's and the
 * standard puts S before A — so this is a business overriding a convention,
 * not a bug being fixed, and it belongs in config rather than in the pack's
 * own list. A pack that shipped one builder's reading order would be the
 * pack knowing its client.
 *
 * **OWNER-ONLY**, the same level as `setJobTabsAction`: it changes what every
 * person on the team sees on every job.
 *
 * ── `withSystem`, JUSTIFIED (security.md S2) ────────────────────────────────
 *
 * `tenant_modules` is SELECT-only for tenant context (`drizzle/0001_rls.sql`)
 * because it is the ENTITLEMENT table. The two conditions the tabs action
 * relies on hold here unchanged: authorization happened first, and the intent
 * is not user-controlled — the tenant comes from the session, the module id is
 * a constant, and the only field written is `config.disciplineOrder`.
 *
 * **THE REST OF THE CONFIG SURVIVES.** The same jsonb holds `tabsOff`, the
 * profile's delivery methods and its cost-code sets. Read, spread, write.
 */
export async function setDisciplineOrderAction(
  input: z.infer<typeof inputSchema>,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireTenantOwner();
  await requireModuleEnabled(ctx.tenant.id, PACK);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  /**
   * **ONLY KEYS THE CONVENTION KNOWS, AND EACH ONE ONCE.** A key nothing can
   * label would sort a section under a blank heading, and a repeat would make
   * the saved order disagree with itself.
   */
  const order: string[] = [];
  for (const key of parsed.data.order) {
    if (!ORDERABLE_DISCIPLINES.includes(key) || order.includes(key)) continue;
    order.push(key);
  }

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
        .set({ config: { ...existing, disciplineOrder: order }, updatedAt: new Date() })
        .where(eq(schema.tenantModules.id, row.id));
      await logAuditInTx(tx, {
        tenantId: ctx.tenant.id,
        actorClerkUserId: ctx.userId,
        action: "jobs.disciplineOrder.set",
        targetType: "tenant_module",
        targetId: PACK,
        /** Discipline letters only — a convention's keys, never a job's drawings. */
        meta: { order },
      });
    });
  } catch {
    return { error: "Could not save that. Try again." };
  }

  revalidatePath("/dashboard/m/jobs", "layout");
  return { ok: true };
}
