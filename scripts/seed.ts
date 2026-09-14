import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import ws from "ws";
import { configureNeonForLocalProxy } from "./lib/neon-local";
import * as schema from "../src/db/schema";
import { MODULES } from "./seed-catalogue";


/**
 * `npm run db:seed` seeds the app's own database.
 * `npm run db:seed -- --dev` seeds the Neon dev branch instead.
 *
 * The flag mirrors scripts/migrate.ts exactly, and exists for the same reason:
 * a new module's registry row has to reach BOTH databases, and without this the
 * only way to target the branch is to edit .env or splice a connection string
 * through the shell — which is how a dotenv banner once ended up inside a URL.
 * The dev branch is also where the preview and the isolation suite run, so a
 * module seeded only on production is one nobody can look at before shipping.
 */
function resolveTarget(): { url: string; label: string } | null {
  if (process.argv.includes("--dev")) {
    const url =
      process.env.TEST_DATABASE_URL_OWNER || process.env.TEST_DATABASE_URL;
    if (!url) {
      console.error("--dev needs TEST_DATABASE_URL_OWNER (or TEST_DATABASE_URL) set.");
      return null;
    }
    // The same guard migrate.ts applies: if the "test" database IS the app's
    // database, --dev is silently seeding production while claiming otherwise.
    if (url === process.env.DATABASE_URL || url === process.env.DATABASE_URL_OWNER) {
      console.error(
        "REFUSING: TEST_DATABASE_URL_OWNER points at the same database as DATABASE_URL.",
      );
      return null;
    }
    return { url, label: "dev branch" };
  }
  const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
  if (!url) return null;
  return { url, label: "app database" };
}

async function main() {
  const target = resolveTarget();
  if (!target) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const url = target.url;
  if (!globalThis.WebSocket) {
    neonConfig.webSocketConstructor = ws;
  }
  // A no-op unless NEON_LOCAL_PROXY is set, which only CI does. Every script
  // that opens its OWN Neon pool needs this line — the first CI run failed
  // because `migrate.ts` did not have it, and this is the same shape.
  configureNeonForLocalProxy();
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  await db.transaction(async (tx) => {
    // Seed runs as trusted system code; RLS requires an explicit context.
    await tx.execute(sql`select set_config('app.role', 'superadmin', true)`);
    for (const mod of MODULES) {
      await tx
        .insert(schema.modules)
        .values(mod)
        .onConflictDoUpdate({
          target: schema.modules.id,
          set: {
            name: mod.name,
            description: mod.description,
            category: mod.category,
            status: mod.status,
            sortOrder: mod.sortOrder,
          },
        });
    }
  });

  // Host only. The connection string carries the password and must never be
  // printed, logged, or pasted into a transcript.
  console.log(
    `Seeded ${MODULES.length} modules into the ${target.label} (${new URL(url).host}).`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
