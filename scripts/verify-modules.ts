import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import ws from "ws";
import { MODULES } from "./seed-catalogue";

/**
 * `npm run db:verify-modules` — prove a database's module registry matches the
 * code's.
 *
 * `npm run db:verify-modules -- --dev`    the Neon dev branch
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Because the `jobs` pack shipped to production with all six of its tables, RLS
 * enabled and forced on every one, `db:verify-rls` reporting 198 tables clean —
 * and **no row in `modules`**, so nobody could switch it on and nobody could see
 * it. Four PRs of work, fully deployed and completely invisible, and nothing
 * anywhere said so.
 *
 * The reason is structural rather than careless.
 * [ADR 0014](../docs/decisions/0014-migrations-are-applied-before-the-merge.md)
 * makes applying a migration a conscious pre-merge ritual with its own
 * verification step, and the seed has neither — so a new module's SCHEMA lands on
 * production reliably and its CATALOGUE ROW does not. `db:seed` had been run
 * against the dev branch only, because that is where the feature was being
 * driven.
 *
 * This is `verify-rls`'s sibling and deliberately so: same invocation, same
 * `--dev` flag, same exit code so it can gate a deploy, same premise that
 * "the command said it worked" is not evidence.
 *
 * ── WHAT IT DOES NOT CHECK ──────────────────────────────────────────────────
 *
 * **Whether any TENANT has a module switched on.** That is a business decision
 * made in the superadmin console, not a deploy step: a pack existing in the
 * catalogue and a client having bought it are different facts, and a check that
 * conflated them would nag forever about every pack nobody has sold yet.
 */

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
    // Same guard as scripts/migrate.ts and scripts/verify-rls.ts: if the "test"
    // database IS the app database, --dev would report on production while
    // claiming otherwise.
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
  console.log(`Module registry check — ${target.label} (${new URL(target.url).host})\n`);

  const { rows: live } = await pool.query<{
    id: string;
    status: string;
    category: string;
  }>(`select id, status, category from modules`);
  await pool.end();

  const liveById = new Map(live.map((r) => [r.id, r]));

  const missing = MODULES.filter((m) => !liveById.has(m.id));
  const drifted = MODULES.filter((m) => {
    const row = liveById.get(m.id);
    return row && (row.status !== m.status || row.category !== m.category);
  });
  /**
   * A row the code no longer defines is reported but is NOT a failure. Removing
   * a module from the catalogue is not something a seed does — tenants may still
   * have it enabled — so this is information, not a fault.
   */
  const extra = live.filter((r) => !MODULES.some((m) => m.id === r.id));

  console.log(
    `${MODULES.length} modules defined in code, ${live.length} in the database.`,
  );

  if (missing.length === 0 && drifted.length === 0) {
    console.log("✓ every module the code defines exists with the same status.");
  } else {
    if (missing.length > 0) {
      console.error(
        `\n✗ ${missing.length} module(s) MISSING from the database — nobody can switch these on:\n`,
      );
      for (const m of missing) console.error(`  - ${m.id} (${m.category}, ${m.status})`);
    }
    if (drifted.length > 0) {
      console.error(`\n✗ ${drifted.length} module(s) with a different status or category:\n`);
      for (const m of drifted) {
        const row = liveById.get(m.id)!;
        console.error(
          `  - ${m.id}: database has ${row.category}/${row.status}, code says ${m.category}/${m.status}`,
        );
      }
    }
    console.error("\nFix with:  npm run db:seed" + (process.argv.includes("--dev") ? " -- --dev" : ""));
  }

  if (extra.length > 0) {
    console.log(
      `\nNote: ${extra.length} row(s) in the database the code no longer defines — ` +
        `${extra.map((r) => r.id).join(", ")}. Not a fault; a seed never removes one.`,
    );
  }

  process.exit(missing.length + drifted.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
