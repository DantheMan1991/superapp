import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, NeonDatabase } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import ws from "ws";
import * as schema from "./schema";

/**
 * Tenant-aware database access.
 *
 * Every tenant-scoped table has Row-Level Security enabled and FORCED
 * (drizzle/0001_rls.sql). Policies read two transaction-local settings:
 *
 *   app.role      — "superadmin" | "member"
 *   app.tenant_id — the tenant whose rows are visible when role = member
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
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.role', 'member', true)`);
    await tx.execute(
      sql`select set_config('app.tenant_id', ${tenantId}, true)`,
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
