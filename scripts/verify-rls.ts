import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

/**
 * `npm run db:verify-rls` — prove a database actually has the protection the
 * migrations claim to have installed.
 *
 * `npm run db:verify-rls -- --dev`               the Neon dev branch
 * `npm run db:verify-rls -- memberships`         also dump one table's policies
 *
 * Exists because "migrations complete" is not evidence. A partial migration
 * once left a table on production with RLS switched off entirely, and nothing
 * surfaced it — the app kept working, because RLS failing OPEN looks exactly
 * like RLS working until the day two tenants share a query. docs/security.md §8
 * requires this check after every migration; before this script the only way to
 * run it was psql, which is not installed on the machine that does the
 * migrating.
 *
 * Exit code is 1 when anything is unprotected, so it can gate a deploy.
 */

/** Tables that are deliberately global rather than tenant-scoped. */
const NOT_TENANT_SCOPED = new Set([
  "__drizzle_migrations",
  "modules", // global registry, readable by any signed-in role
]);

function resolveTarget(): { url: string; label: string } | null {
  const wantsDev = process.argv.includes("--dev");
  if (wantsDev) {
    const url =
      process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error(
        "--dev needs TEST_DATABASE_URL_OWNER (or TEST_DATABASE_URL) set.",
      );
      return null;
    }
    // Same guard as scripts/migrate.ts: if the "test" database IS the app
    // database, --dev would report on production while claiming otherwise.
    if (
      url === process.env.DATABASE_URL ||
      url === process.env.DATABASE_URL_OWNER
    ) {
      console.error(
        "REFUSING: TEST_DATABASE_URL_OWNER points at the same database as DATABASE_URL.",
      );
      return null;
    }
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env.");
    return null;
  }
  return { url, label: "app database" };
}

async function main() {
  const target = resolveTarget();
  if (!target) process.exit(1);
  if (!globalThis.WebSocket) neonConfig.webSocketConstructor = ws;

  const pool = new Pool({ connectionString: target.url });
  // Host only. The connection string carries the password and must never be
  // printed, logged, or pasted into a transcript.
  console.log(
    `RLS check — ${target.label} (${new URL(target.url).host})\n`,
  );

  const { rows: tables } = await pool.query<{
    relname: string;
    enabled: boolean;
    forced: boolean;
    policies: number;
  }>(`
    select c.relname,
           c.relrowsecurity  as enabled,
           c.relforcerowsecurity as forced,
           (select count(*) from pg_policies p
             where p.tablename = c.relname and p.schemaname = 'public') as policies
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
     order by c.relname
  `);

  const bad = tables.filter(
    (t) =>
      !NOT_TENANT_SCOPED.has(t.relname) &&
      (!t.enabled || !t.forced || Number(t.policies) === 0),
  );

  console.log(`${tables.length} tables checked.`);
  if (bad.length === 0) {
    console.log("✓ every table has RLS ENABLED, FORCED, and at least one policy.");
  } else {
    console.error(`\n✗ ${bad.length} table(s) NOT protected:\n`);
    for (const t of bad) {
      const why = [
        t.enabled ? null : "RLS not enabled",
        t.forced ? null : "not FORCED",
        Number(t.policies) === 0 ? "no policies" : null,
      ]
        .filter(Boolean)
        .join(", ");
      console.error(`  ${t.relname} — ${why}`);
    }
  }

  // Optional: dump one table's policies, for reviewing a specific migration.
  const named = process.argv
    .slice(2)
    .find((a) => !a.startsWith("--") && !a.endsWith(".ts"));
  if (named) {
    const { rows: policies } = await pool.query(
      `select policyname, cmd, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = $1 order by policyname`,
      [named],
    );
    console.log(`\n--- policies on "${named}" ---`);
    if (policies.length === 0) console.log("  (none)");
    for (const p of policies) {
      console.log(`\n  ${p.policyname} [${p.cmd}]`);
      console.log(`    USING: ${p.qual ?? "—"}`);
      console.log(`    CHECK: ${p.with_check ?? "—"}`);
    }
  }

  await pool.end();
  if (bad.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
