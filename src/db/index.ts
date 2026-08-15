import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, NeonDatabase } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import ws from "ws";
import * as schema from "./schema";

/**
 * Tenant-aware database access.
 *
 * Every tenant-scoped table has Row-Level Security enabled and FORCED
 * (drizzle/0001_rls.sql). Policies read three transaction-local settings:
 *
 *   app.role           — "superadmin" | "member"
 *   app.tenant_id      — the tenant whose rows are visible when role = member
 *   app.tenant_role    — "owner" | "staff" | "expert" (drizzle/0024): lets a
 *                        policy distinguish owners from staff, which the
 *                        Documents module's owners-only folders depend on
 *   app.clerk_user_id  — the acting user (drizzle/0043): lets a policy scope
 *                        rows to ONE PERSON inside a tenant. Mail needs it —
 *                        a mailbox is private correspondence, so tenant-level
 *                        scoping is not enough
 *
 * Nothing is visible until one of the helpers below sets that context inside
 * a transaction, so a query that forgets a `where` clause returns nothing
 * instead of another client's data.
 */

if (!globalThis.WebSocket) {
  neonConfig.webSocketConstructor = ws;
}

let pool: Pool | undefined;

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. See SETUP.md.");
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

export type Db = NeonDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function getDb(): Db {
  return drizzle(getPool(), { schema });
}

/**
 * Run `fn` with visibility limited to a single tenant. Use for every query
 * made on behalf of a tenant user.
 *
 * `opts.role` is the caller's tenant role, and it must only ever come from
 * requireTenant()/resolveTenantContext() — never from user input. It defaults
 * to "staff", the LEAST privileged value, so every existing two-argument call
 * site keeps working and is denied owners-only rows. A forgotten opt-in denies
 * a read; it can never grant one. (The role union is inlined rather than
 * imported from lib/auth, which imports this module.)
 *
 * `opts.userId` is the acting user's Clerk id, and carries the same rule and
 * the same direction. It defaults to the empty string, which
 * `app_current_user()` turns into NULL, which matches no row — so a caller who
 * forgets it sees NOTHING from a per-user table rather than everything the
 * tenant has. Pass it whenever reading something that belongs to one person
 * rather than to the business: today that means the mail tables, whose rows are
 * somebody's private correspondence.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
  opts?: { role?: "owner" | "staff" | "expert"; userId?: string },
): Promise<T> {
  const tenantRole = opts?.role ?? "staff";
  // Always set, never conditionally: these are transaction-local, but on a
  // pooled connection an unset variable is one that still holds whatever the
  // previous transaction on this backend left behind. Writing "" explicitly is
  // what makes "no user was passed" mean no user.
  const clerkUserId = opts?.userId ?? "";
  return getDb().transaction(async (tx) => {
    // ONE STATEMENT, NOT FOUR, and the reason is latency rather than tidiness.
    //
    // Every one of these was a separate round trip to Neon, so establishing
    // tenant context cost four before the caller's own query had run — six with
    // the BEGIN and COMMIT around them. `set_config` returns a value, so
    // selecting all four in one row sets all four, with identical semantics:
    // the third argument is `is_local`, which makes each one transaction-scoped
    // exactly as before.
    //
    // Measured 2026-08-15 on the database suite, which is almost pure network
    // wait: it is the difference between a round trip count of 6 per
    // `withTenant` and 3. It matters just as much in production — every request
    // that touches a tenant table opens one of these.
    await tx.execute(
      sql`select set_config('app.role', 'member', true),
                 set_config('app.tenant_id', ${tenantId}, true),
                 set_config('app.tenant_role', ${tenantRole}, true),
                 set_config('app.clerk_user_id', ${clerkUserId}, true)`,
    );
    return fn(tx);
  });
}

/**
 * Run `fn` with the RLS superadmin context (visibility across all tenants).
 * Only call after the caller has been verified as platform owner
 * (requireSuperAdmin), or from trusted server-side sync code (webhooks,
 * migrations, seeds) — never with user-controlled intent.
 */
export async function withSystem<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.role', 'superadmin', true)`);
    return fn(tx);
  });
}

export { schema };
