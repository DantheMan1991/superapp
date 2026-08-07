import "server-only";
import { eq, ne, and } from "drizzle-orm";
import { schema, type Tx } from "@/db";

/**
 * The people in a tenant who can be given work.
 *
 * Takes the caller's `tx` rather than opening its own: `memberships` and
 * `profiles` are both readable from tenant context (drizzle/0001), so what this
 * returns is exactly the roster the caller may already see. No `withSystem`,
 * and therefore no way for an assignee picker to reveal somebody a person could
 * not otherwise find.
 *
 * EXPERTS ARE EXCLUDED. The outside accountant is read-only across CRM by
 * construction — every CRM action refuses `role === "expert"` — so offering
 * them in a picker would let somebody assign work that its owner is structurally
 * barred from doing, and it would land in their digest as an instruction they
 * cannot follow.
 */
export interface AssignableMember {
  clerkUserId: string;
  name: string | null;
  email: string;
}

export async function listAssignableMembers(
  tx: Tx,
  tenantId: string,
): Promise<AssignableMember[]> {
  return tx
    .select({
      clerkUserId: schema.profiles.clerkUserId,
      name: schema.profiles.name,
      email: schema.profiles.email,
    })
    .from(schema.memberships)
    .innerJoin(
      schema.profiles,
      eq(schema.profiles.id, schema.memberships.profileId),
    )
    .where(
      and(
        eq(schema.memberships.tenantId, tenantId),
        ne(schema.memberships.role, "expert"),
      ),
    )
    .orderBy(schema.profiles.email);
}

/** "Sam Rivera", or the email when we have no name yet. */
export function memberLabel(m: AssignableMember): string {
  return m.name?.trim() || m.email;
}
