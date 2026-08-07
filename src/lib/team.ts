import "server-only";
import { eq, ne, and, sql } from "drizzle-orm";
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
  /**
   * Carried so callers can narrow further without a second query. The
   * follow-up picker wants everybody here; the record-access picker drops
   * owners, who can already see every restricted record and for whom a grant
   * would be a control that does nothing.
   */
  role: "owner" | "staff";
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
      // Experts are excluded by the where clause, so what survives is exactly
      // this union — narrowed here rather than cast at each call site.
      role: sql<"owner" | "staff">`${schema.memberships.role}`,
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
