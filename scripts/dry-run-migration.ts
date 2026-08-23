import "dotenv/config";
import { readFileSync } from "node:fs";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

/**
 * Apply migration files inside a transaction and ROLL BACK, to find out whether
 * they would work before letting them near a database that matters.
 *
 *   npx tsx scripts/dry-run-migration.ts drizzle/0186_x.sql drizzle/0187_y.sql
 *
 * Targets `TEST_DATABASE_URL_OWNER` — the dev branch — and never the app
 * database. Pass `--app` to aim it at production, which is worth doing before a
 * migration a deploy is waiting on; it still rolls back.
 *
 * WHY THIS EXISTS. `npm run db:generate` emits every CREATE TABLE, then every
 * FOREIGN KEY, then every index. That order is wrong whenever a new table
 * references another NEW table on `(tenant_id, id)`: the composite FK needs a
 * UNIQUE index on those two columns and the only unique thing on the fresh table
 * is the primary key on `id`. Postgres says *"there is no unique constraint
 * matching given keys for referenced table"* and the whole migration rolls back.
 * The generated file has to be hand-reordered, and 0186 was — this script is how
 * that was found, in the minute before it would have been merged.
 *
 * It is NOT a substitute for running the migration. [ADR 0014] still applies:
 * apply it to both databases yourself, before the merge. This answers a
 * different question — *would it apply at all* — and answers it without leaving
 * a half-migrated database behind when the answer is no.
 *
 * A CLEAN DRY RUN IS NOT A PROMISE. It proves the SQL executes against the
 * schema as it stands right now; it says nothing about whether the data is what
 * you expected, and a file that has already been applied will fail here for the
 * ordinary reason that its table exists.
 */

const SEP = "--> statement-breakpoint";

async function main() {
  if (!globalThis.WebSocket) neonConfig.webSocketConstructor = ws;

  const args = process.argv.slice(2);
  const wantsApp = args.includes("--app");
  const files = args.filter((a) => a !== "--app");
  if (files.length === 0) {
    console.error(
      "Usage: npx tsx scripts/dry-run-migration.ts [--app] <file.sql> [more.sql ...]",
    );
    process.exit(1);
  }

  const url = wantsApp
    ? process.env.DATABASE_URL_OWNER
    : process.env.TEST_DATABASE_URL_OWNER;
  if (!url) {
    console.error(
      wantsApp
        ? "DATABASE_URL_OWNER is not set."
        : "TEST_DATABASE_URL_OWNER is not set. See AGENTS.md.",
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url });
  // Host only. The connection string carries the password and must never be
  // printed — the same rule scripts/migrate.ts follows.
  console.log(
    `Dry run against the ${wantsApp ? "app database" : "dev branch"} (${new URL(url).host})`,
  );

  const body = files.map((f) => readFileSync(f, "utf8")).join(SEP);
  const client = await pool.connect();
  let failed = false;
  let applied = 0;
  try {
    await client.query("BEGIN");
    for (const stmt of body.split(SEP)) {
      if (!stmt.trim()) continue;
      applied++;
      try {
        await client.query(stmt);
      } catch (err) {
        failed = true;
        const e = err as { message?: string; detail?: string; hint?: string };
        console.error(`\nFAILED at statement ${applied}: ${e.message ?? err}`);
        if (e.detail) console.error(`  detail: ${e.detail}`);
        if (e.hint) console.error(`  hint: ${e.hint}`);
        console.error(`  ${stmt.trim().slice(0, 200)}`);
        break;
      }
    }
    if (!failed) {
      console.log(`\n${applied} statements applied cleanly.`);
    }
  } finally {
    // ALWAYS. The point of the script is that nothing is left behind, including
    // when it throws for a reason that has nothing to do with the SQL.
    await client.query("ROLLBACK");
    console.log("Rolled back — nothing was changed.");
    client.release();
  }
  await pool.end();
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
