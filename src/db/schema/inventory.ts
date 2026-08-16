/**
 * Inventory — what the business holds, where it is, and which lot it came from.
 *
 * Layer 2a, primitive P4. Same rules as any domain: `tenant_id`, FORCE RLS,
 * isolation coverage.
 *
 * THE ONE THING TO KNOW: **this pack owns the lot spine, and a livestock lot is
 * an inventory lot.** That is not a convenience — it falls out of the
 * capital-asset distinction settled in the Livestock design. Market animals
 * (steers, broilers, feeder pigs) ARE inventory; breeding stock is a capital
 * asset on the other side of the balance sheet. So `livestock` declares
 * `inventory` in `requires` rather than the reverse, and the breeding-herd to
 * market-herd transfer becomes literally what it is in the books: a movement
 * between inventory and fixed assets.
 *
 * **Head is just a unit of measure.** "70 head" is a quantity exactly as
 * "500 lb" is, so the head ledger and the inventory ledger were always the same
 * ledger and `livestock` needs no parallel counter.
 *
 * **NOTHING WRITES A BALANCE COLUMN.** Movements are events and the balance is
 * their sum — the ledger pattern, applied to stock. It reconciles, split and
 * merge stop being special cases, and the traceability trail IS the model
 * rather than an addition to it. Same reasoning as accumulated depreciation
 * being read from the journal in `assets`.
 *
 * Deliberately NOT here yet, each because nothing would read it:
 *
 *   - **Cost and valuation.** Slice 3, and basis-aware: ADR 0007 already
 *     derives cash basis at read time and explicitly rejected a second stored
 *     ledger. Inventory valuation is the same problem and gets the same answer.
 *   - **Expiry / FEFO** (slice 2), **reorder points and capacity** (slice 5).
 *   - **Commitments** — a pre-sold half is never inventory. It goes from a
 *     commitment against a live animal to delivered without ever sitting on a
 *     shelf, so it is not an item balance and does not belong here.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { assets } from "./assets";

/**
 * A thing the business holds a quantity of: feed, cartons, eggs, ground beef.
 *
 * An item is a KIND of thing. How much of it exists is the movement ledger's
 * answer, and which particular batch is the lot's.
 */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * Open taxonomy (P1): 'feed', 'supply', 'produce', 'meat', 'egg',
     * 'livestock'. FORMAT constrained, values never — same arrangement as
     * `assets.kind` and `land_zone_uses.use`, so a new kind needs no migration.
     */
    itemKind: text("item_kind").notNull().default("supply"),
    /**
     * THE UNIT THE BALANCE IS KEPT IN, and the only one.
     *
     * Buy feed in bags, keep the balance in pounds. A purchase unit below is an
     * entry convenience converted at the edge; it is never a second balance.
     * This single rule removes the "is my number in bags or pounds" bug class.
     */
    stockingUnit: text("stocking_unit").notNull(),
    /**
     * What it is bought in, when that differs. Null means it is bought in the
     * stocking unit.
     */
    purchaseUnit: text("purchase_unit"),
    /**
     * How many stocking units one purchase unit is — 50, for a 50 lb bag.
     *
     * ITEM-SPECIFIC ON PURPOSE. "1 bag" means nothing in general, and a flat of
     * eggs is THIRTY, not twelve. Null falls back to an exact global conversion
     * when the two units share a dimension, and to nothing when they do not.
     */
    purchaseUnitQty: numeric("purchase_unit_qty", {
      precision: 18,
      scale: 4,
      mode: "number",
    }),
    /**
     * 'frozen' | 'refrigerated' | 'dry' | 'ambient', or null when it does not
     * matter. Open format, because the walk-in that holds eggs, aging beef and
     * fresh product is not a cold freezer and somebody will need a word for
     * whatever they have.
     */
    storageRequirement: text("storage_requirement"),
    status: text("status").notNull().default("active"),
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
    uniqueIndex("inventory_items_tenant_id_id_idx").on(t.tenantId, t.id),
    index("inventory_items_tenant_kind_idx").on(t.tenantId, t.itemKind),
    index("inventory_items_tenant_status_idx").on(t.tenantId, t.status),
    check("inventory_items_name_present", sql`length(btrim(${t.name})) > 0`),
    check(
      "inventory_items_kind_format",
      sql`${t.itemKind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "inventory_items_status_valid",
      sql`${t.status} in ('active', 'archived')`,
    ),
    check(
      "inventory_items_stocking_unit_present",
      sql`length(btrim(${t.stockingUnit})) > 0`,
    ),
    // A purchase quantity without a purchase unit is a half-edited row, and a
    // zero or negative one would make a receipt convert to nothing.
    check(
      "inventory_items_purchase_unit_complete",
      sql`${t.purchaseUnitQty} is null or (${t.purchaseUnit} is not null and ${t.purchaseUnitQty} > 0)`,
    ),
  ],
);

/**
 * A LOT: a particular batch of an item, with lineage.
 *
 * **THE SPINE, and the reason `livestock` requires this pack.** Every animal
 * record is a lot and an individual is a lot of one — 10 named cows, 6 pigs as
 * a group, 50 layers as a flock, 1,000 broilers as ~14 pens are all the same
 * shape. Modelling individuals and groups as two entities would give every
 * downstream table two code paths and a polymorphic target.
 *
 * **LINEAGE IS DEMANDED BY TWO UNRELATED FORCES**, which is what makes it
 * convincing rather than merely tidy: batch-and-pen management on one side,
 * inspected-meat traceability on the other. One mechanism serves both. A batch
 * of chicks arrives as one purchase, splits across pens, may consolidate as
 * birds grow, and leaves for processing on different dates — so **split creates
 * children and merge creates a parent**, and they are the only operations that
 * change cardinality.
 *
 * Traceability has an honest limit worth stating where somebody will read it:
 * the chain is complete up to the point of sale, and beyond it only for named
 * customers. At a cash market stall the buyer is unknown.
 */
export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    /** What a person calls it: "B-2026-04-15", "Pen 3", "#47". */
    code: text("code").notNull(),
    /**
     * Where this lot came from, and it decides how cost behaves later:
     * `purchased` has an invoice, `raised` has no purchase basis at all and
     * only accumulated production cost, `produced` comes out of a run.
     * Recorded now because slice 3 cannot infer it retroactively.
     */
    source: text("source").notNull().default("purchased"),
    /**
     * Lineage. Composite self-FK, so a parent is always a same-tenant row.
     *
     * NO `onDelete` — i.e. RESTRICT. A composite FK's SET NULL would null
     * `tenant_id` too, and CASCADE would let deleting one lot silently take a
     * whole traceability chain with it.
     */
    parentLotId: uuid("parent_lot_id"),
    status: text("status").notNull().default("open"),
    openedOn: date("opened_on"),
    notes: text("notes").notNull().default(""),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_lots_tenant_id_id_idx").on(t.tenantId, t.id),
    index("inventory_lots_tenant_item_idx").on(t.tenantId, t.itemId),
    index("inventory_lots_tenant_parent_idx").on(t.tenantId, t.parentLotId),
    index("inventory_lots_tenant_status_idx").on(t.tenantId, t.status),
    foreignKey({
      name: "inventory_lots_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }),
    foreignKey({
      name: "inventory_lots_parent_fk",
      columns: [t.tenantId, t.parentLotId],
      foreignColumns: [t.tenantId, t.id],
    }),
    check("inventory_lots_code_present", sql`length(btrim(${t.code})) > 0`),
    check(
      "inventory_lots_source_valid",
      sql`${t.source} in ('purchased', 'raised', 'produced')`,
    ),
    check("inventory_lots_status_valid", sql`${t.status} in ('open', 'closed')`),
    // A lot cannot descend from itself. Longer loops are refused in the pack's
    // write path, which walks the chain — a CHECK cannot see other rows.
    check(
      "inventory_lots_parent_not_self",
      sql`${t.parentLotId} is null or ${t.parentLotId} <> ${t.id}`,
    ),
  ],
);

/**
 * THE LEDGER. Every quantity change is a row here and the balance is their sum.
 *
 * Nothing writes an on-hand column. What that buys, and why it is not merely
 * tidy:
 *
 *   - **It reconciles.** A count can never silently disagree with its own
 *     history — exactly the property needed when a processor's paperwork has to
 *     match the farm's records for inspected meat.
 *   - **Split and merge stop being special.** A split is a movement out of one
 *     lot and into another, and it balances.
 *   - **Mortality rate, shrinkage and yield are queries**, not stored fields.
 *
 * `quantity` is SIGNED and always in the item's stocking unit. A receipt is
 * positive, an issue negative, and a transfer is two rows so that both sides of
 * the move are visible at each location.
 */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    /**
     * Null for an item nobody tracks in batches — cartons and baling twine do
     * not need lineage. Required in practice for anything whose traceability
     * matters, which the pack enforces per item rather than in the column.
     */
    lotId: uuid("lot_id"),
    /**
     * WHERE IT IS, and locations are ASSETS — a chest freezer in a garage on a
     * parcel. Nothing new is invented, which is why this pack declares `assets`
     * in `requires`. Null means the location is unknown, which is honest for a
     * farm that has never counted anything.
     */
    locationAssetId: uuid("location_asset_id"),
    /**
     * Signed, in the item's stocking unit. Never zero — a movement of nothing
     * is not an event, and allowing it would put meaningless rows in the one
     * table that has to reconcile.
     */
    quantity: numeric("quantity", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    /**
     * Open taxonomy (P1): 'receipt', 'issue', 'transfer_in', 'transfer_out',
     * 'split_out', 'split_in', 'adjustment', 'placement', 'death'. Format
     * constrained so a later slice or a later pack adds a reason without a
     * migration to core.
     */
    movementKind: text("movement_kind").notNull(),
    occurredOn: date("occurred_on").notNull(),
    /** Which feature wrote it. `livestock` will pass its own; not a foreign key. */
    extensionSlug: text("extension_slug").notNull().default("inventory"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_movements_tenant_id_id_idx").on(t.tenantId, t.id),
    // The balance query: everything for an item, grouped by lot and location.
    index("inventory_movements_tenant_item_idx").on(
      t.tenantId,
      t.itemId,
      t.occurredOn,
    ),
    index("inventory_movements_tenant_lot_idx").on(t.tenantId, t.lotId),
    // "Which freezer has the ribeyes" — the day-one screen reads this way round.
    index("inventory_movements_tenant_location_idx").on(
      t.tenantId,
      t.locationAssetId,
    ),
    foreignKey({
      name: "inventory_movements_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }),
    foreignKey({
      name: "inventory_movements_lot_fk",
      columns: [t.tenantId, t.lotId],
      foreignColumns: [inventoryLots.tenantId, inventoryLots.id],
    }),
    // Composite, so stock can only ever sit in a location this tenant owns.
    foreignKey({
      name: "inventory_movements_location_fk",
      columns: [t.tenantId, t.locationAssetId],
      foreignColumns: [assets.tenantId, assets.id],
    }),
    check("inventory_movements_quantity_nonzero", sql`${t.quantity} <> 0`),
    check(
      "inventory_movements_kind_format",
      sql`${t.movementKind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
  ],
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
export type InventoryLot = typeof inventoryLots.$inferSelect;
export type NewInventoryLot = typeof inventoryLots.$inferInsert;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;
