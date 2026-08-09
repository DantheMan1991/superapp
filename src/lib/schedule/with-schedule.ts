import "server-only";
import { withTenant, type Tx } from "@/db";

/**
 * `withTenant` for scheduling, with the two options that are not optional here.
 *
 * EVERY policy in drizzle/0097 reads `app_current_user()`, and most read
 * `app_current_tenant_role()` as well — a calendar is private by default, so
 * "which rows exist" is a question about a person and not only about a
 * workspace. `withTenant` defaults `userId` to the empty string, which
 * `app_current_user()` turns into NULL, which matches no grant and no
 * ownership. So a forgotten option does not open a hole; it makes somebody's
 * own calendar disappear, which is a bug report rather than a breach.
 *
 * That is still a bug nobody should be able to write. drizzle/0077 concluded
 * the same thing and named the fix — "which is why `withCrm()` in the module now
 * passes both rather than leaving 49 call sites to remember". CRM never
 * actually built it: it repeats the options at every call site under a header
 * comment, and the comment is the only thing holding the rule. This exists so
 * scheduling does not spend that lesson twice.
 *
 * There is deliberately no overload that omits the context. If a caller cannot
 * produce a role and a user id, it has not authenticated anybody, and the thing
 * it wants is `withSystem` under a superadmin check — not this.
 */
export interface ScheduleCtx {
  tenantId: string;
  /** Clerk user id. Must come from requireTenant()/resolveTenantContext(). */
  userId: string;
  role: "owner" | "staff" | "expert";
}

export function withSchedule<T>(
  ctx: ScheduleCtx,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(ctx.tenantId, fn, { role: ctx.role, userId: ctx.userId });
}
