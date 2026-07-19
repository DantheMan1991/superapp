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
    description: "Transactions, receipt capture, invoicing, AR tracking, reporting.",
    category: "core",
    status: "coming_soon",
    sortOrder: 10,
  },
  {
    id: "crm",
    name: "CRM",
    description: "Your customers and leads — pipeline, contacts, follow-ups.",
    category: "core",
    status: "coming_soon",
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
    id: "documents",
    name: "Documents",
    description: "Templates, generation, storage, e-sign.",
    category: "core",
    status: "coming_soon",
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  if (!globalThis.WebSocket) {
    neonConfig.webSocketConstructor = ws;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

  console.log(`Seeded ${MODULES.length} modules.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
