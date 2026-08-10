import "server-only";
import { withTenant, type Tx } from "@/db";

/**
 * `withTenant` for work, with the option that is not optional here.
 *
 * Every policy in drizzle/0105 reads `app_current_tenant_role()`, because a list
 * can be restricted to owners. `withTenant` defaults `role` to `"staff"`, the
 * least privileged value, so a forgotten option denies a read and can never
 * grant one — but it is still a bug nobody should be able to write.
 *
 * scheduling.md recorded why this exists in slice 0 rather than later:
 * drizzle/0077 named the fix and CRM never built it, so CRM repeats the options
 * at 49 call sites under a header comment and the comment is the only thing
 * holding the rule. `withSchedule()` was the first module not to spend that
 * lesson twice. This is the second.
 *
 * `userId` is carried even though no policy reads it yet. Slice 1 assigns work,
 * slice 4 answers "what is on ME today", and a context that already has the
 * acting user is one that does not need every call site revisited to add it.
 *
 * There is deliberately no overload that omits the context. If a caller cannot
 * produce a role and a user id, it has not authenticated anybody, and the thing
 * it wants is `withSystem` under a superadmin check — not this.
 */
export interface WorkCtx {
  tenantId: string;
  /** Clerk user id. Must come from requireTenant()/resolveTenantContext(). */
  userId: string;
  role: "owner" | "staff" | "expert";
}

export function withWork<T>(
  ctx: WorkCtx,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withTenant(ctx.tenantId, fn, { role: ctx.role, userId: ctx.userId });
}

/**
 * What a WRITE needs, which is less than `withWork` takes.
 *
 * `role` is consumed by `withWork` itself, to set `app.tenant_role` before the
 * transaction runs. Nothing inside `items.ts` or `entity-work.ts` reads it, and
 * requiring it invited the automation engine — which runs on behalf of a user
 * whose role it does not carry — to invent one. Asking for exactly what is used
 * is what stops that.
 */
export type WorkWriteCtx = Pick<WorkCtx, "tenantId" | "userId">;
