import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

/**
 * `npx tsx scripts/restamp-migration.ts <old> <new> [--dev] [--write]`
 *
 * Move ONE already-applied migration's stamp in a database's ledger, so a
 * renumbered migration is recognised as applied rather than run again.
 *
 * This is the second half of the repair conventions.md prescribes when a
 * parallel session raises the high-water mark past your migration: the journal
 * entry gets a `when` above the mark, and every database where the migration
 * is ALREADY APPLIED needs its `drizzle.__drizzle_migrations.created_at` moved
 * to match — otherwise the next `db:migrate` sees a stamp above the mark,
 * re-runs the DDL, and aborts the whole transaction on a `CREATE TABLE` that
 * already exists.
 *
 * **IT EDITS ONLY THE LEDGER.** No DDL, no application data, and one row
 * matched on an exact stamp. It prints what it would do and changes nothing
 * without `--write`, because a migrations table is the one place in this
 * codebase where being approximately right is worse than doing nothing.
 */
function resolveTarget(): { url: string; label: string } {
  const dev = process.argv.includes("--dev");
  const url = dev
    ? (process.env.TEST_DATABASE_URL_OWNER ?? process.env.TEST_DATABASE_URL ?? "")
    : (process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL ?? "");
  return { url, label: dev ? "dev branch" : "app database" };
}

async function main(): Promise<void> {
  const [oldRaw, newRaw] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const oldWhen = Number(oldRaw);
  const newWhen = Number(newRaw);
  if (!Number.isFinite(oldWhen) || !Number.isFinite(newWhen)) {
    console.error("usage: restamp-migration.ts <oldWhen> <newWhen> [--dev] [--write]");
    process.exit(1);
  }
  const write = process.argv.includes("--write");
  const { url, label } = resolveTarget();
  if (!url) {
    console.error("no connection string for that target");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const before = await pool.query<{ created_at: string; hash: string }>(
    `select created_at::text, hash from drizzle.__drizzle_migrations where created_at = $1`,
    [oldWhen],
  );
  const clash = await pool.query<{ n: string }>(
    `select count(*)::text as n from drizzle.__drizzle_migrations where created_at = $1`,
    [newWhen],
  );
  console.log(`${label}: rows at ${oldWhen}: ${before.rowCount}; rows already at ${newWhen}: ${clash.rows[0].n}`);
  if (before.rowCount !== 1) {
    console.error("REFUSING: expected exactly one row to move.");
    process.exit(1);
  }
  if (clash.rows[0].n !== "0") {
    console.error("REFUSING: the new stamp is already taken.");
    process.exit(1);
  }
  if (!write) {
    console.log(`would move hash ${before.rows[0].hash.slice(0, 12)}… → ${newWhen} (pass --write)`);
    await pool.end();
    return;
  }
  const res = await pool.query(
    `update drizzle.__drizzle_migrations set created_at = $1 where created_at = $2`,
    [newWhen, oldWhen],
  );
  console.log(`moved ${res.rowCount} row to ${newWhen}`);
  await pool.end();
}

void main();
