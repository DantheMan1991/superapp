import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CrmRecordCollaborator } from "@/db/schema";
import { CrmError } from "./core/errors";

/**
 * Who may see a restricted record.
 *
 * The whole table is three operations — list, grant, revoke — and the
 * interesting part is not in this file. It is in `0077`: the details policy
 * consults these rows, so a grant is enforced by the database rather than by
 * any query here, and every table that inherits record visibility inherits the
 * grant with it.
 *
 * NOTHING IN THIS FILE CHECKS THE CALLER'S ROLE, deliberately, and that is the
 * same division of labour the rest of the module uses: the ops take the
 * caller's `tx` and RLS decides. Writes are owner-only in the policy, so a
 * staff member calling `grantAccess` directly writes nothing rather than
 * escalating — and `collaborator-actions.ts` refuses first so the person gets a
 * sentence rather than silence.
 */

export async function listCollaborators(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<CrmRecordCollaborator[]> {
  return tx.query.crmRecordCollaborators.findMany({
    where: and(
      eq(schema.crmRecordCollaborators.tenantId, tenantId),
      eq(schema.crmRecordCollaborators.partyId, partyId),
    ),
    orderBy: asc(schema.crmRecordCollaborators.createdAt),
  });
}

/**
 * Let somebody see this record.
 *
 * GRANTING TWICE IS NOT AN ERROR. The unique refuses it and `onConflictDoNothing`
 * turns that into the outcome somebody expected anyway — two owners adding the
 * same person from two screens have not done anything wrong, and the second one
 * should not be told off for it. Returns null when nothing was written.
 *
 * A GRANT ON A `members` RECORD IS ALLOWED AND DOES NOTHING TODAY. Refusing it
 * would mean the order of two independent decisions mattered — restrict first,
 * then add people, or the grant is rejected — and somebody preparing a record
 * before restricting it is doing something reasonable. The row simply waits.
 */
export async function grantAccess(
  tx: Tx,
  tenantId: string,
  args: { partyId: string; clerkUserId: string; grantedByClerkUserId: string },
): Promise<CrmRecordCollaborator | null> {
  const clerkUserId = args.clerkUserId.trim();
  if (clerkUserId.length === 0) {
    throw new CrmError("COLLABORATOR_INVALID", "a person is required");
  }
  const rows = await tx
    .insert(schema.crmRecordCollaborators)
    .values({
      tenantId,
      partyId: args.partyId,
      clerkUserId,
      grantedByClerkUserId: args.grantedByClerkUserId,
    })
    .onConflictDoNothing()
    .returning();
  return rows[0] ?? null;
}

/**
 * Take access away.
 *
 * Scoped by id AND tenant, like every other write here. Reports whether a row
 * actually went: a revoke that silently matched nothing is the one outcome
 * somebody must not be told was a success, because the person they meant to
 * remove still has access to a confidential record.
 */
export async function revokeAccess(
  tx: Tx,
  tenantId: string,
  collaboratorId: string,
): Promise<void> {
  const rows = await tx
    .delete(schema.crmRecordCollaborators)
    .where(
      and(
        eq(schema.crmRecordCollaborators.tenantId, tenantId),
        eq(schema.crmRecordCollaborators.id, collaboratorId),
      ),
    )
    .returning({ id: schema.crmRecordCollaborators.id });
  if (rows.length === 0) {
    throw new CrmError("COLLABORATOR_NOT_FOUND", "that grant is already gone");
  }
}
