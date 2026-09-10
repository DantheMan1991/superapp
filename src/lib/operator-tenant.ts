import "server-only";
import { eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";

/**
 * The operator tenant — the business that runs the platform, running on it
 * (ADR 0041). Read by the console to open the operator's own context for a
 * narrow read (`withTenant(operator.id, …)`, never `withSystem`) and, from
 * back-office slice 2, by the health check to know where a lead lands.
 *
 * One `withSystem` lookup, identifiers only: the id, and the Clerk
 * organization id the console needs to switch a person INTO the operator's
 * workspace before opening a record there. Null while no operator is named
 * (`scripts/operator-tenant.ts` names one), and every caller degrades rather
 * than throws, because a platform with no operator is a legal state — it was
 * every state before 2026-09-09.
 */
export interface OperatorTenant {
  id: string;
  clerkOrgId: string | null;
}

export async function getOperatorTenant(): Promise<OperatorTenant | null> {
  const row = await withSystem((tx) =>
    tx.query.tenants.findFirst({
      where: eq(schema.tenants.isOperator, true),
      columns: { id: true, clerkOrgId: true },
    }),
  );
  return row ?? null;
}
