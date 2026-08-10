import "dotenv/config";
import { readFileSync } from "node:fs";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";

/**
 * READ-ONLY: reconcile the drizzle journal on disk against what a database
 * actually has applied, by the `when` timestamp drizzle keys on.
 *
 * `npx tsx scripts/inspect-migration-state.ts [--dev]`
 *
 * Answers the only question that matters before running a migration: which
 * tags are pending, and has anything been applied that this checkout does not
 * know about. Prints the host only, never the connection string.
 */
interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function resolveTarget(): { url: string; label: string } | null {
  if (process.argv.includes("--dev")) {
    const url = process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL;
    if (!url) return null;
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) return null;
  return { url, label: "app database" };
}

async function main() {
  const target = resolveTarget();
  if (!target) {
    console.error("No connection string for that target.");
    process.exit(1);
  }
  if (!globalThis.WebSocket) neonConfig.webSocketConstructor = ws;

  const journal = JSON.parse(
    readFileSync("drizzle/meta/_journal.json", "utf8"),
  ) as { entries: JournalEntry[] };

  const pool = new Pool({ connectionString: target.url });
  try {
    console.log(`Inspecting the ${target.label} (${new URL(target.url).host})\n`);
    const res = await pool.query<{ created_at: string }>(
      `select created_at::text from drizzle.__drizzle_migrations order by created_at`,
    );
    const appliedWhen = new Set(res.rows.map((r) => Number(r.created_at)));

    console.log(`journal entries: ${journal.entries.length}`);
    console.log(`applied rows:    ${res.rows.length}\n`);

    const pending = journal.entries.filter((e) => !appliedWhen.has(e.when));
    const knownWhen = new Set(journal.entries.map((e) => e.when));
    const unknown = [...appliedWhen].filter((w) => !knownWhen.has(w));

    console.log("last 5 journal entries and their state:");
    console.table(
      journal.entries.slice(-5).map((e) => ({
        tag: e.tag,
        when: new Date(e.when).toISOString(),
        applied: appliedWhen.has(e.when),
      })),
    );

    console.log(
      pending.length === 0
        ? "\nPENDING: none — the database is up to date with this checkout."
        : `\nPENDING (${pending.length}): ${pending.map((e) => e.tag).join(", ")}`,
    );
    if (unknown.length > 0) {
      console.log(
        `\nAPPLIED BUT NOT IN THIS CHECKOUT (${unknown.length}): ${unknown
          .map((w) => new Date(w).toISOString())
          .join(", ")}`,
      );
      console.log("→ another branch or session has migrated this database.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
