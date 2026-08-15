/**
 * Assets — anything the business owns that has a cost, a working life, a place
 * it lives and a service schedule.
 *
 * THE FIRST PACK-OWNED TABLE (Layer 2a, primitive P4 in
 * docs/extension-model.md §4). It lives in `src/db/schema/` like every other
 * domain, because the barrel is what `drizzle({ schema })` reads and a pack's
 * tables are not special to Postgres — the separation that matters is in
 * `src/packs/`, where the CODE lives. Same rules as any tenant table:
 * `tenant_id`, FORCE RLS, isolation coverage.
 *
 * THE ONE THING TO KNOW: **`kind` is an open taxonomy, not an enum.** A
 * building, a tractor, a chest freezer and a fence are one shape — a thing
 * owned, with a cost, a life, a location and an upkeep bill — and the words
 * for them are supplied by whatever profile is installed. Splitting them into
 * `buildings` and `equipment` would be three tables of the same six columns,
 * and the fourth kind would need a fourth. See extension-model.md §3: core
 * owns the mechanism, packs own the vocabulary.
 *
 * Deliberately NOT here yet, each with a reader-shaped reason:
 *
 *   - **Depreciation** (method, life, salvage, in-service date). Slice 1. It
 *     posts to the ledger, and a column that only a future posting routine
 *     would read is the speculative build this codebase avoids.
 *   - **Maintenance schedules and meter readings.** Slice 2, with the surface
 *     that emits work items.
 *   - **Occupancy** — where a MOBILE asset is over time. A chicken tractor's
 *     location is a time series, not a column, and it shares its shape with
 *     livestock lot occupancy. It gets a table when the pack that needs it
 *     exists, not before.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * Open taxonomy (P1): 'building', 'equipment', 'vehicle', 'infrastructure',
     * 'fixture' — and whatever a future profile needs. FORMAT is constrained so
     * the column stays queryable; VALUES deliberately are not, so a new kind
     * never needs a migration to core. Same arrangement as
     * `documents.doc_kind` and `mail_links.entity_type`.
     */
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    /** Serial, VIN, plate, asset tag. Free text — every kind numbers differently. */
    identifier: text("identifier").notNull().default(""),
    /**
     * text + CHECK, never a pgEnum. documents.md paid for that lesson twice: a
     * new enum value needs its own migration file, alone, because it cannot be
     * used in the transaction that adds it.
     */
    status: text("status").notNull().default("active"),
    acquiredOn: date("acquired_on"),
    /**
     * Nullable on purpose. Plenty of what a business owns arrived without an
     * invoice — inherited, built on site, or bought before anyone was counting
     * — and forcing a zero would make "cost unknown" indistinguishable from
     * "cost nothing", which is exactly the distinction depreciation needs.
     */
    acquisitionCostCents: bigint("acquisition_cost_cents", { mode: "number" }),
    disposedOn: date("disposed_on"),
    /**
     * Containment: a freezer sits in a garage, a garage sits on the property.
     * Composite FK, so a parent is always a same-tenant row.
     *
     * NO `onDelete` — i.e. RESTRICT. A composite FK's SET NULL would null every
     * referencing column including `tenant_id`, which is NOT NULL, so it is not
     * available here. Removing a container therefore requires re-parenting what
     * is inside it first, which is the honest order of operations anyway.
     */
    parentId: uuid("parent_id"),
    notes: text("notes").notNull().default(""),
    /** P2 extension bag: `NOT NULL DEFAULT '{}'` so `metadata->>'x'` is always safe. */
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Target for the composite self-FK below, and for any future pack table
    // that needs to point at an asset without losing tenant agreement.
    uniqueIndex("assets_tenant_id_id_idx").on(t.tenantId, t.id),
    index("assets_tenant_kind_idx").on(t.tenantId, t.kind),
    index("assets_tenant_status_idx").on(t.tenantId, t.status),
    index("assets_tenant_parent_idx").on(t.tenantId, t.parentId),
    foreignKey({
      name: "assets_parent_fk",
      columns: [t.tenantId, t.parentId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check(
      "assets_status_valid",
      sql`${t.status} in ('active', 'disposed')`,
    ),
    // Format only — the value set is open by design (see `kind` above).
    check("assets_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check("assets_name_present", sql`length(btrim(${t.name})) > 0`),
    check(
      "assets_cost_nonnegative",
      sql`${t.acquisitionCostCents} is null or ${t.acquisitionCostCents} >= 0`,
    ),
    // A row cannot contain itself. Deeper cycles are prevented in the pack's
    // write path, which walks the chain — a CHECK cannot see other rows.
    check("assets_parent_not_self", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  ],
);

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
