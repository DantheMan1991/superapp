import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

/**
 * READ-ONLY check of migration state and RLS posture on the banking tables.
 *
 * `npm run db:inspect-banking` (app database) / `-- --dev` (Neon dev branch).
 *
 * Exists because a partial migration once left a table on production with row
 * -level security switched OFF while the migration itself reported success —
 * "the migration ran" is not the same claim as "the policies are there". Run it
 * after every migration that adds a tenant-scoped table.
 *
 * Prints the host only. The connection string carries the password and must
 * never be printed, logged, or pasted into a transcript.
 */
function resolveTarget(): { url: string; label: string } | null {
  if (process.argv.includes("--dev")) {
    const url = process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error("--dev needs TEST_DATABASE_URL_OWNER (or TEST_DATABASE_URL) set.");
      return null;
    }
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL_OWNER is not set.");
    return null;
  }
  return { url, label: "app database" };
}

const TABLES = [
  "bank_accounts",
  "bank_rules",
  "bank_transactions",
  "plaid_items",
  "reconciliation_lines",
  "reconciliations",
];

async function main() {
  const target = resolveTarget();
  if (!target) process.exit(1);
  if (!globalThis.WebSocket) neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: target.url });
  try {
    console.log(`Inspecting the ${target.label} (${new URL(target.url).host})\n`);

    const applied = await pool.query(
      `select count(*)::int as applied,
              to_timestamp(max(created_at)/1000)::timestamptz as latest
         from drizzle.__drizzle_migrations`,
    );
    console.log("migrations:", applied.rows[0]);

    const rows = await pool.query(
      `select c.relname as table,
              c.relrowsecurity as rls_enabled,
              c.relforcerowsecurity as rls_forced,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'public' and p.tablename = c.relname) as policies
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = any($1)
        order by c.relname`,
      [TABLES],
    );
    console.log("\nbanking tables:");
    console.table(rows.rows);

    const missing = TABLES.filter((t) => !rows.rows.some((r) => r.table === t));
    if (missing.length > 0) console.log("MISSING TABLES:", missing.join(", "));

    const unprotected = rows.rows.filter(
      (r) => !r.rls_enabled || !r.rls_forced || r.policies === 0,
    );
    if (unprotected.length > 0) {
      console.error(
        "\nNOT PROTECTED:",
        unprotected.map((r) => r.table).join(", "),
      );
      process.exitCode = 1;
    }

    const col = await pool.query(
      `select column_name, data_type, is_nullable
         from information_schema.columns
        where table_schema = 'public'
          and table_name = 'bank_transactions'
          and column_name in ('ai_suggestion', 'rule_suggestion')
        order by column_name`,
    );
    console.log("\nbank_transactions suggestion columns:");
    console.table(col.rows);

    if (missing.length === 0 && unprotected.length === 0 && col.rows.length === 2) {
      console.log("\nOK — every banking table has FORCE RLS and at least one policy.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
