import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { leadLandings } from "./registry";
import type { LandedLead, LeadContext } from "./types";

/**
 * Hand a landed lead to every filler whose feature is switched on for this
 * tenant, inside the caller's transaction. Answers the slugs that ran, so a
 * door can say "the contact record exists" only when it does.
 *
 * The switch is read in the SAME transaction rather than through
 * `isModuleEnabled`, which opens its own: a door that has just written the
 * party should not go and open a second connection to ask whether CRM
 * exists. `tenant_modules` is readable under the tenant's own context, which
 * is the context every public door runs in.
 */
export async function landLead(
  tx: Tx,
  ctx: LeadContext,
  lead: LandedLead,
): Promise<string[]> {
  const landed: string[] = [];
  for (const landing of leadLandings) {
    const row = await tx.query.tenantModules.findFirst({
      where: and(
        eq(schema.tenantModules.tenantId, ctx.tenantId),
        eq(schema.tenantModules.moduleId, landing.slug),
      ),
      columns: { enabled: true },
    });
    if (!row?.enabled) continue;
    await landing.land(tx, ctx, lead);
    landed.push(landing.slug);
  }
  return landed;
}
