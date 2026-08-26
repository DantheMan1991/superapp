/**
 * **THE ENTERPRISE SPINE.** One row per line of business a tenant runs:
 * Broilers, Beef, Pigs, Eggs, Produce.
 *
 * **AN ENTERPRISE IS A DIMENSION, NOT AN ENTITY, and that question is already
 * settled elsewhere.** `accounting/core/balances.ts` states the test:
 *
 * > A trial balance HAS to balance within an entity — that is the test ADR 0010
 * > uses to tell an entity from a dimension in the first place.
 *
 * Broilers do not keep their own books. So this mirrors into
 * `dimension_members` as `dimension_type = 'enterprise'`, exactly as a parcel,
 * a lot and an asset already do, and every report that can group by a dimension
 * gains it for free — including the P&L, whose picker is built from whatever
 * types exist rather than from a list in code.
 *
 * ── WHY IT IS AT LAYER 0 AND NOT INSIDE A PACK ───────────────────────────────
 *
 * The party spine's reasoning transfers word for word: *a tenant can buy
 * Accounting without CRM, so accounting can never reference a `crm_*` table.*
 * An enterprise is named by `inventory` (an item), `livestock` (a pen),
 * `production` (a run) and `retail` (a channel). Putting the table in any one of
 * those makes the other three depend on a pack they do not require, and a farm
 * running only `livestock` would have no enterprises at all.
 *
 * One table, one writer (`src/lib/enterprises/`), the same arrangement
 * `parties` has.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 *
 * **No parent, so no hierarchy.** "Poultry → Broilers → Spring flock" is a tree,
 * a tree needs a rolled-up report, and the founder's own list folds layers INTO
 * eggs rather than nesting them (2026-08-26). A flat list is what was asked for
 * and `kind` carries the only grouping anybody wanted.
 *
 * **No budget, no target, no share-of-overhead.** Splitting a mixed market
 * stall's fee across the enterprises that sold there is a real and defensible
 * allocation — and allocations are their own topic with their own decision to
 * make. Unassigned is the honest answer until then, and the P&L already renders
 * a column for it.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

export const enterprises = pgTable(
  "enterprises",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** What a person calls it: "Broilers", "Beef", "Eggs". */
    name: text("name").notNull(),
    /**
     * The stable handle, unique per tenant.
     *
     * **IT EXISTS SO A RENAME IS FREE.** The display name is copied into
     * `dimension_members` and re-copied on every rename; the slug is what a
     * profile's seed data, an import and a future URL can hold onto while
     * somebody changes "Broilers" to "Meat birds". Derived from the name on
     * creation and never re-derived after, for the same reason.
     */
    slug: text("slug").notNull(),
    /**
     * Open taxonomy (P1): 'livestock', 'crop', 'other'. FORMAT constrained,
     * values never — the arrangement `inventory_items.kind` and `assets.kind`
     * both use, so a farm with a woodlot or a guest cottage needs no migration.
     *
     * It is the ONLY grouping this table carries, and it is deliberately weak:
     * see the header on why there is no parent.
     */
    kind: text("kind").notNull().default("other"),
    status: text("status").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    /** P2 extension bag: `NOT NULL DEFAULT '{}'` so `metadata->>'x'` is safe. */
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The target every pack's composite FK will point at, so an item can only
    // ever name an enterprise belonging to its own tenant.
    uniqueIndex("enterprises_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("enterprises_tenant_slug_idx").on(t.tenantId, t.slug),
    index("enterprises_tenant_status_idx").on(t.tenantId, t.status),
    check("enterprises_name_present", sql`length(btrim(${t.name})) > 0`),
    check(
      "enterprises_slug_format",
      sql`${t.slug} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check("enterprises_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check(
      "enterprises_status_valid",
      sql`${t.status} in ('active', 'archived')`,
    ),
  ],
);

export type Enterprise = typeof enterprises.$inferSelect;
export type NewEnterprise = typeof enterprises.$inferInsert;
