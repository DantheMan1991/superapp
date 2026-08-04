import "dotenv/config";
import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import ws from "ws";
import * as schema from "../src/db/schema";

/**
 * Seeds the module registry. Idempotent — safe to re-run.
 * Real modules stay "coming_soon" (named, empty slots per the build brief);
 * only the Hello stub is available in Phase 1.
 */
const MODULES: (typeof schema.modules.$inferInsert)[] = [
  {
    id: "hello",
    name: "Hello Module",
    description:
      "Stub module that certifies activation, tenant scoping, and permissions end to end.",
    category: "system",
    status: "available",
    sortOrder: 0,
  },
  {
    id: "accounting",
    name: "Accounting",
    description:
      "Double-entry ledger, chart of accounts, journal entries, trial balance.",
    category: "core",
    status: "available",
    sortOrder: 10,
  },
  {
    id: "crm",
    // Description tracks what actually ships. Records and connections land
    // first; custom fields, pipelines, activity and follow-ups follow.
    //
    // Wording passes the neutrality test in docs/extension-model.md §3: a
    // bookkeeping firm, a dental practice and a plumbing contractor all have
    // customers, people and companies they deal with. Note what is ABSENT —
    // "lead" and "pipeline" are fine, but "job" is trade vocabulary a profile
    // supplies as a label, so it cannot appear in a core module's copy.
    name: "CRM",
    description:
      "Everyone the business deals with — companies, the people inside them, and where each one stands.",
    category: "core",
    status: "available",
    sortOrder: 20,
  },
  {
    id: "messaging",
    name: "Messaging",
    description: "Email/SMS with customers, templates, automated follow-ups.",
    category: "core",
    status: "coming_soon",
    sortOrder: 30,
  },
  {
    id: "marketing",
    name: "Marketing",
    description: "Content generation, review requests, lead nurture.",
    category: "core",
    status: "coming_soon",
    sortOrder: 40,
  },
  {
    id: "email",
    name: "Mail",
    // Description tracks what actually ships. Reading lands first; composing,
    // linking threads to business records, and rules follow.
    //
    // Wording passes the neutrality test in docs/extension-model.md §3: a
    // bookkeeping firm, a dental practice and a plumbing contractor would each
    // recognise "customer", "invoice" and "record" as their own. Note "job"
    // does NOT pass — §5 lists it as trade vocabulary that a profile supplies
    // as a label, so it cannot appear in a core module's copy.
    description:
      "Your business mailbox, read inside Yosher — every conversation beside the customer, invoice or record it belongs to.",
    category: "core",
    status: "available",
    sortOrder: 35,
  },
  {
    id: "documents",
    name: "Documents",
    // Description tracks what actually ships; sharing, templates and e-sign
    // land in later phases and get added here as they do.
    description:
      "Files for the whole business — folders, uploads, and owner-only areas.",
    category: "core",
    status: "available",
    sortOrder: 50,
  },
  {
    id: "scheduling",
    name: "Scheduling",
    description: "Jobs, appointments, calendar.",
    category: "core",
    status: "coming_soon",
    sortOrder: 60,
  },
];

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
