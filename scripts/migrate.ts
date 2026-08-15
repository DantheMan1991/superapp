import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { configureNeonForLocalProxy } from "./lib/neon-local";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import ws from "ws";

/**
 * `npm run db:migrate` migrates the app's own database.
 * `npm run db:migrate -- --dev` migrates the Neon dev branch instead.
 *
 * The flag exists because docs/security.md §8 requires every migration to run
 * against BOTH databases, and the dev branch is where the isolation suite runs
 * (S11). Without it the only way to target the branch is to edit .env or splice
 * a connection string through the shell — and the shell route is how a
 * dotenv banner once ended up inside a URL. Selecting it here is safer and
 * makes "run it on both" a two-command habit rather than a manual edit.
 */
function resolveTarget(): { url: string; label: string } | null {
  const wantsDev = process.argv.includes("--dev");
  if (wantsDev) {
    const url = process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error("--dev needs TEST_DATABASE_URL_OWNER (or TEST_DATABASE_URL) set.");
      return null;
    }
    // The same guard tests/setup/database-guard.ts applies: if the "test"
    // database is the app's database, --dev is silently migrating production
    // while claiming otherwise. Refuse rather than proceed.
    if (url === process.env.DATABASE_URL || url === process.env.DATABASE_URL_OWNER) {
      console.error(
        "REFUSING: TEST_DATABASE_URL_OWNER points at the same database as DATABASE_URL.",
      );
      return null;
    }
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    return null;
  }
  return { url, label: "app database" };
}

async function main() {
  // Migrations run as the database owner; the app itself runs as app_user
  // (no RLS bypass) — see scripts/create-app-role.ts.
  const target = resolveTarget();
  if (!target) {
    process.exit(1);
  }
  if (!globalThis.WebSocket) {
    neonConfig.webSocketConstructor = ws;
  }
  // A no-op unless NEON_LOCAL_PROXY is set, which only CI does. Without it this
  // script tries to open a SECURE WebSocket to a plain Postgres container and
  // fails with an ErrorEvent carrying no message at all — which is exactly how
  // it failed the first time this ran.
  if (configureNeonForLocalProxy()) {
    console.log("Using the local WebSocket proxy.");
  }
  const pool = new Pool({ connectionString: target.url });
  const db = drizzle(pool);
  // Host only. The connection string carries the password and must never be
  // printed, logged, or pasted into a transcript.
  console.log(
    `Running migrations against the ${target.label} (${new URL(target.url).host})…`,
  );
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
