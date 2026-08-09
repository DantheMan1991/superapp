import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/** What the default list is called before anybody renames it. */
export const DEFAULT_WORK_LIST_NAME = "Work";

/**
 * Every tenant gets exactly one default work list.
 *
 * WHY IT IS PROVISIONED RATHER THAN CREATED ON DEMAND. A list is the unit of
 * sharing, so "a tenant with no list" is a workspace nothing can be added to.
 * Making the first write create it would put that branch in every caller
 * forever, and would mean an empty list and a missing one look identical until
 * somebody hits the difference.
 *
 * PER TENANT, NOT PER PERSON — which is where this differs from
 * `ensurePrimaryCalendar`, whose shape it otherwise copies. A calendar answers
 * "where do MY events go"; a work list answers "where does the business's work
 * go", and one is enough until somebody makes a second.
 *
 * IDEMPOTENT, because it is called from a webhook path Clerk may deliver twice
 * and does not order. `ON CONFLICT DO NOTHING` in its bare form rather than
 * against a named target: the guarantee lives in the partial unique index
 * `work_lists_default_idx`, and naming a partial index as a conflict target
 * means restating its predicate here — a second copy of the rule.
 *
 * Called under `withSystem` from tenant-sync, so the superadmin policy is what
 * lets it write. `created_by_clerk_user_id` is left empty on purpose: nobody
 * made this list, the product did.
 */
export async function ensureDefaultWorkList(
  tx: Tx,
  tenantId: string,
): Promise<void> {
  await tx
    .insert(schema.workLists)
    .values({
      tenantId,
      name: DEFAULT_WORK_LIST_NAME,
      isDefault: true,
    })
    .onConflictDoNothing();
}

/**
 * The tenant's default list, or null before it has been provisioned.
 *
 * Null is a real state and not an error: a tenant whose Clerk webhook has not
 * landed yet has no list for a moment, and so does every tenant that predates
 * this module until its next membership sync. Callers decide what to do about
 * it.
 *
 * Runs under the CALLER's transaction and therefore under their RLS context —
 * so a staff member gets null if the default list were ever made owners-only.
 * That is correct, and it is why this returns a nullable rather than throwing.
 */
export async function findDefaultWorkListId(
  tx: Tx,
  tenantId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.workLists.id })
    .from(schema.workLists)
    .where(
      and(
        eq(schema.workLists.tenantId, tenantId),
        sql`${schema.workLists.isDefault}`,
      ),
    );
  return row?.id ?? null;
}
