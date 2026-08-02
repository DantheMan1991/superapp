import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { schema, withTenant } from "@/db";

/**
 * Reading somebody's rules.
 *
 * IT LIVES HERE, NOT IN actions.ts, AND THAT IS THE WHOLE POINT OF THE FILE.
 *
 * `actions.ts` begins with `"use server"`, and in the App Router every export
 * from such a module becomes a callable endpoint with a generated id. This
 * function takes `tenantId`, `userId` and `role` as arguments and feeds them
 * straight into `withTenant`, which SETS the RLS context from them — so as an
 * action it was a way to read any tenant's rules by asking for them. RLS
 * cannot help: it is being told who to be.
 *
 * `server-only` gives the opposite guarantee. It is not callable from a
 * browser at all, and importing it into a client component fails the build
 * rather than shipping quietly.
 *
 * The general rule this is an instance of: a "use server" file may only export
 * things that are safe to hand a stranger, and anything taking a tenant id as
 * an argument never is.
 */
/** Everything this person has configured for this connection, in order. */
export async function loadRules(
  tenantId: string,
  userId: string,
  role: "owner" | "staff" | "expert",
  mailAccountId: string,
) {
  return withTenant(
    tenantId,
    (tx) =>
      tx
        .select()
        .from(schema.mailRules)
        .where(
          and(
            eq(schema.mailRules.tenantId, tenantId),
            eq(schema.mailRules.mailAccountId, mailAccountId),
          ),
        )
        .orderBy(asc(schema.mailRules.sortOrder)),
    { role, userId },
  );
}
