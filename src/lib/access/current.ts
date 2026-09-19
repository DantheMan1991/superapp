import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { withSystem, schema } from "@/db";

/**
 * WHAT THIS REQUEST'S CALLER MAY NOT REACH (ADR 0093).
 *
 * One function, read by the gate in `requireModuleEnabled` and by the rail, so
 * a row cannot be hidden from the menu while its page stays open — or the
 * reverse, which is worse.
 *
 * ── IT IS ADDITIVE, NEVER A REPLACEMENT ─────────────────────────────────────
 *
 * This answers ONE question: does the person have a level that forbids this
 * key. It does not ask whether they are signed in, whether they belong to the
 * tenant, or whether the module is switched on — `requireTenant()` and
 * `isModuleEnabled()` own those and are called either side of it. So when it
 * cannot identify a caller it returns NOTHING DENIED rather than everything,
 * and that is the right way round precisely because it is never the only gate:
 * nobody reaches a module page without `requireTenant()` having already
 * answered for them.
 *
 * **`auth()`, NOT `requireTenant()`**, deliberately. `requireTenant` redirects,
 * and a redirect thrown from inside a module check would turn "this tool is not
 * yours" into a navigation somewhere else, from 349 call sites that are not
 * expecting one. `auth()` returns nulls and never throws.
 *
 * ── AN OWNER IS NEVER RESTRICTED ────────────────────────────────────────────
 *
 * Clerk owns owner-vs-member (security.md S6) and `org:admin` is read straight
 * from the session here, before any row is consulted — so an access level
 * wrongly attached to an owner by some future bug still cannot take anything
 * away from them. `drizzle/0085` makes writing one impossible from tenant
 * context in the first place; this makes it inert even if it happened.
 */
export const deniedFor = cache(async (tenantId: string): Promise<string[]> => {
  const { userId, orgId, orgRole } = await auth();
  // No session, or a superadmin's support view of somebody else's workspace:
  // both are somebody else's gate to answer, and neither is a person on a
  // level in THIS tenant.
  if (!userId || !orgId) return [];
  if (orgRole === "org:admin") return [];

  /**
   * S2 JUSTIFICATION: this is role resolution, the same class of read as
   * `lookupTenantAndRole` in `src/lib/auth.ts` and next to it in the request.
   * It reads ONE membership — the caller's own, matched on a Clerk id taken
   * from the session and never from an argument — and the tenant is matched on
   * `clerk_org_id` from that same session. Tenant context cannot be used: the
   * caller's role is what this is in the middle of deciding, and passing the
   * unknown role to `withTenant` would be the upward grant S3 forbids.
   */
  const [row] = await withSystem((tx) =>
    tx
      .select({ denied: schema.accessLevels.denied })
      .from(schema.memberships)
      .innerJoin(
        schema.profiles,
        eq(schema.profiles.id, schema.memberships.profileId),
      )
      .innerJoin(
        schema.tenants,
        eq(schema.tenants.id, schema.memberships.tenantId),
      )
      .innerJoin(
        schema.accessLevels,
        and(
          eq(schema.accessLevels.tenantId, schema.memberships.tenantId),
          eq(schema.accessLevels.id, schema.memberships.accessLevelId),
        ),
      )
      .where(
        and(
          eq(schema.memberships.tenantId, tenantId),
          eq(schema.profiles.clerkUserId, userId),
          // The workspace the SESSION is in has to be the workspace being
          // asked about, or this is not the caller's level to apply.
          eq(schema.tenants.clerkOrgId, orgId),
        ),
      )
      .limit(1),
  );
  // An INNER JOIN on the level, so "no level" and "no membership" are the same
  // no-rows answer: nothing denied.
  return row?.denied ?? [];
});
