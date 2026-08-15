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
    // Description tracks what actually ships. Calendars, sharing, events,
    // attendees and links are in; recurrence, availability and the subscribe
    // feed follow, and get added here as they do.
    //
    // THE PLACEHOLDER THIS REPLACES READ "Jobs, appointments, calendar." and
    // FAILED the neutrality test in docs/extension-model.md §3 — §8 names "job"
    // as the worked example of a word that sounds generic and is not: it is
    // what electrical calls its work while plumbing says Service Call and a GC
    // says Project. A profile supplies that label; a core module's catalog copy
    // must not.
    //
    // What is here instead passes: a bookkeeping firm, a dental practice and a
    // plumbing contractor all recognise appointments, who is on them, and a
    // calendar that is private until shared.
    description:
      "The business's calendar — what is happening, when, and who is on it. Private until you share it.",
    category: "core",
    status: "available",
    sortOrder: 60,
  },
  {
    id: "work",
    name: "Work",
    // Passes the neutrality test in docs/extension-model.md §3: a bookkeeping
    // firm, a dental practice and a plumbing contractor all recognise work that
    // is on somebody and due on a day.
    //
    // "Jobs" and "Projects" would NOT pass, and §8 already carries the receipt —
    // "job" is what electrical calls its work while plumbing says Service Call
    // and a GC says Project. A profile supplies that label; core's catalog copy
    // must not.
    //
    // Description tracks what actually ships. Board, links and the daily digest
    // follow, and get added here as they do.
    description:
      "What has to be done, who it is on, and whether it is done yet — with a list for each part of the business.",
    category: "core",
    // `available` from slice 4 (2026-08-09): the module goes live once the
    // obligation it creates can reach a person. Until the digest could carry
    // it, work assigned to somebody was only visible to whoever opened the page.
    status: "available",
    sortOrder: 70,
  },

  // ---------------------------------------------------------------------
  // Layer 2a — capability packs. Same table, `category = 'pack'`
  // (ADR 0009), so enablement, nav, routing and the guard all work through
  // machinery that already exists.
  //
  // NONE OF THESE ARE SOLD INDIVIDUALLY. The SKU is the profile — a tenant
  // buys "Homestead Farm", not seven line items — so packs must never reach
  // a client-facing catalogue. There is no such page today, and if one is
  // ever built it filters on `category = 'core'`.
  //
  // All `coming_soon`: declared seams with a real dependency graph in
  // `src/packs/index.ts` and no renderer yet, exactly how `scheduling` and
  // `work` were carried before they shipped. Each flips to `available` when
  // its pack is built.
  //
  // Descriptions describe the CAPABILITY, never an industry — a pack that
  // names one has the boundary wrong. "Land", "Livestock" and "Crops" are
  // narrow capabilities, not industries: a cattle ranch, a market garden and
  // a vineyard compose different subsets of the same list.
  // ---------------------------------------------------------------------
  {
    id: "land",
    name: "Land",
    description:
      "Parcels and the zones inside them — what each area is for, what it costs, and what has been on it.",
    category: "pack",
    // `available` from slice 0 (2026-08-15): parcels, zones and dated zone use,
    // both levels synced as cost objects. Occupancy and rest follow in slice 1,
    // geometry in slice 2, and the description grows as they do.
    status: "available",
    sortOrder: 200,
  },
  {
    id: "assets",
    name: "Assets",
    description:
      "Anything owned with a cost, a working life, a place it lives and a service schedule.",
    category: "pack",
    // `available` from the first pack slice (2026-08-14): it renders, writes to
    // a pack-owned table under RLS, and syncs a cost object. Depreciation and
    // maintenance follow and get added to the description as they do.
    status: "available",
    sortOrder: 210,
  },
  {
    id: "inventory",
    name: "Inventory",
    description:
      "Quantities on hand, where they are, what they cost, and the lot each one came from.",
    category: "pack",
    status: "coming_soon",
    sortOrder: 220,
  },
  {
    id: "livestock",
    name: "Livestock",
    description:
      "Animals tracked as lots — health, movement, breeding and what each one has cost.",
    category: "pack",
    status: "coming_soon",
    sortOrder: 230,
  },
  {
    id: "crops",
    name: "Crops",
    description:
      "Plantings in beds — what went in when, how it is doing, and what came off it.",
    category: "pack",
    status: "coming_soon",
    sortOrder: 240,
  },
  {
    id: "production",
    name: "Production",
    description:
      "Turning inputs into outputs at a yield, with the cost carried through to what comes out.",
    category: "pack",
    status: "coming_soon",
    sortOrder: 250,
  },
  {
    id: "retail",
    name: "Retail",
    description:
      "Selling what you have — channels, price lists, orders and what actually moved.",
    category: "pack",
    status: "coming_soon",
    sortOrder: 260,
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
