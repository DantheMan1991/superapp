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
 *   - **Reorder points and capacity** (slice 5).
 *   - **Commitments** — a pre-sold half is never inventory. It goes from a
 *     commitment against a live animal to delivered without ever sitting on a
 *     shelf, so it is not an item balance and does not belong here.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./platform";
import { assets } from "./assets";
import { billLines } from "./payables";
import { accounts } from "./ledger";

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
     * NO `onDelete` — i.e. RESTRICT. A composite FK's *bare* SET NULL would null
     * `tenant_id` too (`drizzle/0192`), and CASCADE would let deleting one lot
     * silently take a whole traceability chain with it.
     */
    parentLotId: uuid("parent_lot_id"),
    status: text("status").notNull().default("open"),
    openedOn: date("opened_on"),
    /**
     * **WHEN THIS BATCH STOPS BEING GOOD, and it is on the LOT rather than the
     * item because a batch expires and a kind of thing does not.** Two
     * deliveries of the same feed bought a month apart go off a month apart.
     *
     * Null is ordinary and covers two different situations the pack does not
     * try to tell apart: nobody has recorded a date, and the thing does not
     * expire at all. Baling twine and a chest freezer's worth of beef are both
     * honestly null, and a screen that demanded a date would be asking a
     * question with no answer.
     *
     * **FEFO — first EXPIRED, first out — is the useful order for perishables**,
     * not FIFO. Meat has a practical freezer life, eggs a sell-by, feed goes
     * mouldy in humidity, vaccines expire outright. It is a suggestion on a
     * screen and never an enforcement: the pack will not refuse to issue from a
     * later batch, because the person holding the scoop can see which bag is
     * open and this cannot.
     */
    expiresOn: date("expires_on"),
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
    // "What is going off soon" reads this way round, across every item at once.
    index("inventory_lots_tenant_expires_idx").on(t.tenantId, t.expiresOn),
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
    /**
     * **WHAT THIS MOVEMENT COST, AS A TOTAL — never a rate.**
     *
     * A delivery is "$340 for 12 bags", and that is the fact. A unit cost is
     * derived from it, which means storing one instead would bake a division
     * and its rounding into the record rather than into the report.
     *
     * Nullable, and null is ordinary: a transfer between freezers, a count
     * adjustment and every head event `livestock` writes carry no money at all.
     * Integer cents, the house convention.
     *
     * **THIS IS COST ACCUMULATION, NOT THE BOOKS.** No journal line is written
     * from this column in this slice. Financial presentation — inventory as an
     * asset, COGS at sale, versus inputs expensed when paid — is basis-dependent
     * and derived at read time through the lens ADR 0007 already established.
     * Two ledgers that must agree forever is the bug class that ADR exists to
     * refuse.
     */
    costCents: bigint("cost_cents", { mode: "number" }),
    /**
     * **WHICH LOT ATE IT.** The join that closes the livestock costing loop.
     *
     * `lot_id` above says where the quantity came FROM — a delivery of feed.
     * This says what consumed it — a pen of broilers. Both are inventory lots,
     * because a pen IS one: the design's "the LOT is the cost object, not the
     * item" is what makes "what did this pen cost" a query rather than a
     * feature.
     *
     * Null for anything not consumed by a lot: feed thrown away, stock sold,
     * a transfer. RESTRICT rather than CASCADE — deleting a pen must not
     * silently erase the record of what was fed to it.
     */
    issuedToLotId: uuid("issued_to_lot_id"),
    /**
     * **WHY THE QUANTITY CHANGED, when the kind does not already say.**
     *
     * An open taxonomy (P1) and, on an adjustment, the whole point of the row.
     * The design is blunt about what it is for: *reasons are a diagnostic rather
     * than a correction — sustained feed shrinkage is not an accounting problem,
     * it is a rodent problem.* A `spoilage` that happens once is a wasted bag;
     * the same reason four months running is a freezer that is not holding
     * temperature, and neither is visible if the reason lives in free text.
     *
     * Null for everything that explains itself. A receipt is a delivery, an
     * issue is feeding, and inventing a reason for them would be noise in the
     * column that has to stay readable.
     */
    reason: text("reason"),
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
    // "What did this pen cost" reads this way round.
    index("inventory_movements_tenant_consumer_idx").on(
      t.tenantId,
      t.issuedToLotId,
    ),
    // "Is the same thing going wrong every month" — the diagnostic the reason
    // column exists for, and it reads by reason and date rather than by item.
    index("inventory_movements_tenant_reason_idx").on(
      t.tenantId,
      t.reason,
      t.occurredOn,
    ),
    foreignKey({
      name: "inventory_movements_consumer_fk",
      columns: [t.tenantId, t.issuedToLotId],
      foreignColumns: [inventoryLots.tenantId, inventoryLots.id],
    }),
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
    // Money paid is never negative. A credit note is its own movement, not a
    // receipt that owes you something.
    check(
      "inventory_movements_cost_not_negative",
      sql`${t.costCents} is null or ${t.costCents} >= 0`,
    ),
    check(
      "inventory_movements_kind_format",
      sql`${t.movementKind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "inventory_movements_reason_format",
      sql`${t.reason} is null or ${t.reason} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
  ],
);

/**
 * **A PHYSICAL COUNT: what is actually on the shelf, against what the ledger
 * thought.**
 *
 * The design's line is that *the record and reality will disagree, and counting
 * is how that is discovered.* Everything else in this pack is derived from
 * events; this is the one place a human walks into a freezer and reports a fact
 * the ledger had no way to know.
 *
 * **Two acts, like a production run, and for the same reason.** Counting a
 * freezer takes an hour and is done a shelf at a time, so the lines are recorded
 * as they are found and POSTING is a separate, deliberate act that writes the
 * variances into the ledger in one transaction. A count half-posted would leave
 * some shelves reconciled and others not, with nothing to say which.
 *
 * **A count NEVER edits a movement.** It writes new ones. That is the rule the
 * whole ledger rests on: what happened, happened, and a disagreement is another
 * event rather than a rewrite of an old one.
 */
export const inventoryCounts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    countedOn: date("counted_on").notNull(),
    /**
     * The place being counted. **Null means everywhere**, which is the honest
     * answer for a small operation counting the whole barn in one go, and is
     * different from counting a named freezer and finding it empty.
     */
    locationAssetId: uuid("location_asset_id"),
    /** `draft` while the shelves are being walked; `posted` once the variances are in the ledger. */
    status: text("status").notNull().default("draft"),
    /** Who walked it. Free text, like a run's crew: not everyone has a login. */
    countedBy: text("counted_by").notNull().default(""),
    postedOn: date("posted_on"),
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
    uniqueIndex("inventory_counts_tenant_id_id_idx").on(t.tenantId, t.id),
    index("inventory_counts_tenant_status_idx").on(t.tenantId, t.status),
    index("inventory_counts_tenant_date_idx").on(t.tenantId, t.countedOn),
    foreignKey({
      name: "inventory_counts_location_fk",
      columns: [t.tenantId, t.locationAssetId],
      foreignColumns: [assets.tenantId, assets.id],
    }),
    check(
      "inventory_counts_status_valid",
      sql`${t.status} in ('draft', 'posted')`,
    ),
    // Posted means BOTH: a status with no date, or a date with no status, is a
    // half-finished post.
    check(
      "inventory_counts_posted_together",
      sql`(${t.status} = 'posted') = (${t.postedOn} is not null)`,
    ),
    check(
      "inventory_counts_posted_after_counted",
      sql`${t.postedOn} is null or ${t.postedOn} >= ${t.countedOn}`,
    ),
  ],
);

/**
 * One line of a count: this batch of this item, in this place, and how much of
 * it is actually there.
 *
 * **`expected_quantity` IS STORED, and it is the only stored derivation in this
 * pack.** Everything else is folded because a fold can never disagree with its
 * inputs — but what the ledger THOUGHT was on the shelf at the moment somebody
 * counted it is a historical fact that the fold stops being able to reproduce
 * the instant anybody backdates a movement. Recomputing it later would silently
 * restate a variance that was already posted, which is exactly the second-set-of-
 * numbers problem the ledger exists to avoid. Same reasoning as
 * `production_runs.cost_basis`.
 *
 * **Zero is a real count and null is not.** A shelf walked and found empty is
 * `counted_quantity = 0` and posts a variance; a line nobody got to is a line
 * that does not exist. That is why the column is NOT NULL and why lines are
 * added rather than pre-generated for every item.
 */
export const inventoryCountLines = pgTable(
  "inventory_count_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    countId: uuid("count_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /**
     * Which batch was counted. Null for an item nobody tracks in batches — the
     * same rule the ledger itself follows.
     */
    lotId: uuid("lot_id"),
    /** What is actually there, in the item's stocking unit. Zero is a real answer. */
    countedQuantity: numeric("counted_quantity", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    /** What the ledger thought, stamped at POST time. Null until then. */
    expectedQuantity: numeric("expected_quantity", {
      precision: 18,
      scale: 4,
      mode: "number",
    }),
    /** The adjustment this line wrote. Null until posted, and null when there was no variance. */
    inventoryMovementId: uuid("inventory_movement_id"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_count_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("inventory_count_lines_tenant_count_idx").on(t.tenantId, t.countId),
    // ONE LINE PER BATCH PER COUNT. Counting the same shelf twice in one walk
    // and getting two answers is a question for the person holding the
    // clipboard, not two variances for the ledger to average.
    /**
     * ONE LINE PER BATCH PER COUNT.
     *
     * **It does NOT hold for a line with no lot, and the ops layer is what
     * closes that.** Postgres treats two nulls as distinct, so an item nobody
     * tracks in batches could be counted twice by the database's reckoning;
     * `NULLS NOT DISTINCT` would fix it and this drizzle version cannot emit it,
     * and hand-writing the index in a custom migration would drift the snapshot
     * — which this repo has paid for before. `recordCountLine` upserts on the
     * same key instead, including the null case.
     */
    uniqueIndex("inventory_count_lines_unique_target_idx").on(
      t.tenantId,
      t.countId,
      t.itemId,
      t.lotId,
    ),
    foreignKey({
      name: "inventory_count_lines_count_fk",
      columns: [t.tenantId, t.countId],
      foreignColumns: [inventoryCounts.tenantId, inventoryCounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "inventory_count_lines_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }),
    foreignKey({
      name: "inventory_count_lines_lot_fk",
      columns: [t.tenantId, t.lotId],
      foreignColumns: [inventoryLots.tenantId, inventoryLots.id],
    }),
    foreignKey({
      name: "inventory_count_lines_movement_fk",
      columns: [t.tenantId, t.inventoryMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
    }),
    // A count of a negative amount is not a count. Somebody who means "the
    // ledger is 10 too high" records the count they took, not the difference.
    check(
      "inventory_count_lines_counted_not_negative",
      sql`${t.countedQuantity} >= 0`,
    ),
  ],
);

/**
 * **WHICH STOCK RECEIPT A BILL LINE IS SETTLING.**
 * [ADR 0012](../../../docs/decisions/0012-what-capitalises-stock.md) §A.2.
 *
 * The receipt capitalises (`Dr 1300 / Cr 2050 Goods Received Not Invoiced`) and
 * the bill line CLEARS that account rather than capitalising a second time. This
 * table is what says how much of which bill line clears which receipt.
 *
 * **AN ITEM LINK WOULD NOT HAVE BEEN ENOUGH, and an earlier draft of the ADR
 * thought it was.** One item can have three unbilled receipts at three ticket
 * prices across two lots; one invoice can cover two of them; one receipt can be
 * part-invoiced. Without a matched quantity against a specific movement, nothing
 * can clear the right GRNI balance, know which lot a supplied cost belongs to,
 * or attribute a price variance to anything.
 *
 * It also answers the **bill-first** case: a bill approved before its stock
 * arrives debits GRNI with no allocation, and the later receipt allocates
 * against it instead of adding an unmatched credit. Without the table the two
 * amounts net to zero in the account while remaining unmatched in the records,
 * which reads as reconciled and is not.
 *
 * **NOT `..._receipt_allocations`.** "Receipts" already means the scanned
 * document inbox at `/dashboard/m/accounting/receipts`, which has its own email
 * intake address, so the name has to say `stock`.
 */
export const billLineStockAllocations = pgTable(
  "bill_line_stock_allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * CASCADE, and it is load-bearing rather than tidiness: `updateBillDraft`
     * DELETES AND RE-INSERTS every line of a draft, so a bill line's id does not
     * survive an edit. Without the cascade this table would accumulate rows
     * pointing at lines that no longer exist. `line_dimensions` carries the same
     * cascade for the same reason.
     */
    billLineId: uuid("bill_line_id").notNull(),
    /** The `receipt` movement being settled. No cascade — see below. */
    inventoryMovementId: uuid("inventory_movement_id").notNull(),
    /** How much of the receipt this line covers, in the item's stocking unit. */
    quantityMatched: numeric("quantity_matched", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    /**
     * What the delivery ticket said, for this quantity. Stamped at match time
     * and never re-derived — it is what the receipt claimed when somebody
     * reconciled it, and a later correction must not restate a variance that has
     * already posted. Same rule as a count line's `expected_quantity`.
     */
    receiptCostCents: bigint("receipt_cost_cents", { mode: "number" }).notNull(),
    /** What the invoice says, for this quantity. The difference is the variance. */
    invoiceCostCents: bigint("invoice_cost_cents", { mode: "number" }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("bill_line_stock_allocations_tenant_id_id_idx").on(
      t.tenantId,
      t.id,
    ),
    /**
     * One bill line settles a given receipt once. A second match against the
     * same pair is a correction to the first, not a second settlement — and
     * without this a double-submitted match would clear GRNI twice.
     */
    uniqueIndex("bill_line_stock_allocations_pair_idx").on(
      t.tenantId,
      t.billLineId,
      t.inventoryMovementId,
    ),
    // "What is still unmatched against this receipt" — the GRNI reconciliation.
    index("bill_line_stock_allocations_movement_idx").on(
      t.tenantId,
      t.inventoryMovementId,
    ),
    foreignKey({
      name: "bill_line_stock_allocations_line_fk",
      columns: [t.tenantId, t.billLineId],
      foreignColumns: [billLines.tenantId, billLines.id],
    }).onDelete("cascade"),
    /**
     * NO cascade. A movement is never deleted in this pack — a disagreement is
     * another event — and if one ever were, erasing the record that a bill had
     * settled it would hide the money rather than surface it.
     */
    foreignKey({
      name: "bill_line_stock_allocations_movement_fk",
      columns: [t.tenantId, t.inventoryMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
    }),
    check(
      "bill_line_stock_allocations_quantity_positive",
      sql`${t.quantityMatched} > 0`,
    ),
  ],
);

/**
 * **A CORRECTION TO WHAT A BATCH COST. APPENDED, NEVER AN EDIT.**
 * [ADR 0012](../../../docs/decisions/0012-what-capitalises-stock.md) §A.4.
 *
 * A delivery ticket can overstate, understate, omit the freight or use the
 * wrong unit, and until this table a stamped cost was final. The rule the
 * correction obeys is the one at the top of `packs/inventory/core/costing.ts`:
 * **cost is a ledger, not a column** — so a disagreement about what something
 * cost is another row, exactly as a disagreement about how much of it there is
 * is another movement.
 *
 * **IT IS NOT A MOVEMENT, and the database settled that rather than taste.**
 * `inventory_movements` carries two CHECKs a pure-money correction cannot
 * satisfy: `quantity <> 0` rules out a row that moves nothing, and
 * `cost_cents >= 0` rules out a correction downwards. Relaxing either would
 * weaken a constraint that protects the quantity ledger for every other caller,
 * to admit rows that are not quantities.
 *
 * **THE SPLIT IS STORED, and that is the whole reason two money columns exist
 * where one would do.** A correction lands partly on stock still on the shelf
 * — which raises what that batch is carried at — and partly on stock already
 * issued, which has to be expensed because capitalising it would put cost back
 * on the balance sheet for feed that has been eaten. The proportion is what the
 * ledger BELIEVED at the moment somebody corrected it; recomputing it later
 * would let a movement backdated tomorrow restate a posting that already
 * happened. Same rule, and the same reason, as a count line's
 * `expected_quantity`.
 *
 * `quantity_on_hand` and `quantity_received` are kept beside the split so the
 * proportion can be READ rather than reverse-engineered out of two cent
 * figures — the number a person is owed when they ask why $60 became $36 and
 * $24.
 */
export const inventoryCostAdjustments = pgTable(
  "inventory_cost_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull(),
    /**
     * **KEYED TO THE LOT, and NOT NULL.** A correction is about what a
     * particular batch cost — which delivery was mis-ticketed — and there is no
     * such thing as correcting the cost of "feed in general". Stock held outside
     * a batch is valued at the item average, which has no single receipt to
     * correct.
     */
    lotId: uuid("lot_id").notNull(),
    /** The date the correction belongs to. What a valuation `asOf` filters on. */
    occurredOn: date("occurred_on").notNull(),
    /**
     * **SIGNED, and that is the point.** A ticket overstates as easily as it
     * understates, and a correction that can only go up is not a correction.
     */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** The part that lands on stock still on hand. Raises the batch's carrying value. */
    onHandCents: bigint("on_hand_cents", { mode: "number" }).notNull(),
    /** The part that lands on stock already issued. Expensed, never carried. */
    issuedCents: bigint("issued_cents", { mode: "number" }).notNull(),
    /** What the ledger believed was standing in the batch when this was written. */
    quantityOnHand: numeric("quantity_on_hand", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    /** Everything that had ever come INTO the batch — the split's denominator. */
    quantityReceived: numeric("quantity_received", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    /** Why. Open taxonomy, same shape as a movement's — see `COST_ADJUSTMENT_REASONS`. */
    reason: text("reason").notNull(),
    notes: text("notes").notNull().default(""),
    /** Who said so. The ADR asks for date, reason AND author on the record itself. */
    createdByClerkUserId: text("created_by_clerk_user_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_cost_adjustments_tenant_id_id_idx").on(
      t.tenantId,
      t.id,
    ),
    // The fold: every correction against these batches, as of a date.
    index("inventory_cost_adjustments_tenant_lot_idx").on(
      t.tenantId,
      t.lotId,
      t.occurredOn,
    ),
    // The item average reads this way round — it needs every batch's at once.
    index("inventory_cost_adjustments_tenant_item_idx").on(
      t.tenantId,
      t.itemId,
      t.occurredOn,
    ),
    foreignKey({
      name: "inventory_cost_adjustments_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }),
    /**
     * NO cascade. A correction is a record that somebody re-stated what a batch
     * cost, and deleting the batch would not make that untrue — the same
     * reasoning that keeps `bill_line_stock_allocations` off cascade.
     */
    foreignKey({
      name: "inventory_cost_adjustments_lot_fk",
      columns: [t.tenantId, t.lotId],
      foreignColumns: [inventoryLots.tenantId, inventoryLots.id],
    }),
    // A correction of nothing is not a correction. Mirrors the movement ledger's
    // `quantity <> 0`, for the column that carries the meaning here.
    check("inventory_cost_adjustments_amount_nonzero", sql`${t.amountCents} <> 0`),
    /**
     * **THE SPLIT MUST ACCOUNT FOR THE WHOLE CORRECTION.** The two halves are
     * derived at write time and then stored, so this is what stops a later
     * caller storing halves that do not add up — which would leave the ledger
     * and the batch's carrying value permanently apart by the difference, with
     * nothing to say by how much.
     */
    check(
      "inventory_cost_adjustments_split_sums",
      sql`${t.onHandCents} + ${t.issuedCents} = ${t.amountCents}`,
    ),
    check(
      "inventory_cost_adjustments_reason_format",
      sql`${t.reason} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
  ],
);

/**
 * **WHICH RECORDED EVENT RELEASES A CATEGORY'S COST.**
 * [ADR 0013](../../../docs/decisions/0013-inventory-tax-treatment.md) §A.1.
 *
 * **THIS IS A LIST OF MOMENTS THE LEDGER CAN DATE, NOT A LIST OF TAX
 * TREATMENTS**, and the difference is the whole design. A list of treatments
 * would be a reading of the regulations, maintained by people who cannot read
 * them, and every gap in it would be invisible. A list of dates is checkable by
 * looking at the ledger: each value below names a column that already exists.
 *
 * - `consumed` — the `issue` movement's date. **The default and today's
 *   behaviour**, so a tenant that never touches this is unaffected.
 * - `billed` — `bills.bill_date`.
 * - `paid` — `bill_payments.payment_date`, reached from the receipt through
 *   `bill_line_stock_allocations`.
 * - `sold` — the movement a `retail_sale_lines` row names.
 * - `later_of_paid_and_consumed`, `later_of_paid_and_sold` — the max of two of
 *   the above. Computed, stored nowhere.
 *
 * **A RULE THE SOFTWARE CANNOT DATE MUST BE REFUSED RATHER THAN APPROXIMATED.**
 * If an election needs a moment that is not on this list, the answer is another
 * observable event, not the nearest of these.
 */
export const inventoryTimingRule = pgEnum("inventory_timing_rule", [
  "consumed",
  "billed",
  "paid",
  "sold",
  "later_of_paid_and_consumed",
  "later_of_paid_and_sold",
]);

/**
 * **WHERE AN ACCOUNTANT'S DECISION GETS RECORDED**, per category of thing the
 * business holds. ADR 0013 §A.2 and §A.5.
 *
 * **IT IS A RECORD, NOT A PREFERENCE**, which is why it carries who decided and
 * when. The alternative is that a tax election lives in a developer's assumption
 * or in somebody's memory of an email. `decided_by` is free text for the same
 * reason `inventory_counts.counted_by` is: the accountant does not have a login
 * here.
 *
 * **KEYED ON `item_kind`, WHICH ALREADY EXISTED.** An earlier draft of ADR 0013
 * made this one setting for a whole business, in the same document that says
 * merchandise held for resale behaves differently from feed. A farm that buys
 * feed and also runs a market stall has both cases inside one set of books.
 * `inventory_items.item_kind` is an open, indexed taxonomy and is already how
 * the expense account resolves, so one row answers both questions and one
 * resolution order serves both.
 *
 * **`item_kind` NULL IS THE TENANT'S DEFAULT**, and the unique index does not
 * hold for it — Postgres treats two nulls as distinct. Same limitation, same
 * remedy and the same reason as `inventory_count_lines`: `NULLS NOT DISTINCT`
 * would fix it, this drizzle version cannot emit it, and hand-writing the index
 * would drift the snapshot. `setInventoryTaxRule` selects then updates,
 * including the null case.
 *
 * **NOTHING APPLIES THESE YET.** Stage 1 records the decision and resolves it;
 * the report lens that acts on anything other than `consumed` is the next
 * slice. The action refuses to store a rule the lens cannot honour, so there is
 * no way to end up with a setting that claims to change a report and does not.
 */
export const inventoryTaxTreatments = pgTable(
  "inventory_tax_treatments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Open taxonomy, matching `inventory_items.item_kind`. NULL = the default. */
    itemKind: text("item_kind"),
    timingRule: inventoryTimingRule("timing_rule").notNull().default("consumed"),
    /**
     * What a substituting rule releases cost TO. Null falls through to the next
     * step of the resolution order. "Everything to cost of goods" balances and
     * is useless at return time, which is why this is per category.
     */
    expenseAccountId: uuid("expense_account_id"),
    /** Who said so. Free text: the accountant has no login here. */
    decidedBy: text("decided_by").notNull().default(""),
    decidedOn: date("decided_on"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_tax_treatments_tenant_id_id_idx").on(t.tenantId, t.id),
    // ONE RULE PER CATEGORY. See the note above for why this does not hold for
    // the tenant default, and what closes it instead.
    uniqueIndex("inventory_tax_treatments_tenant_kind_idx").on(
      t.tenantId,
      t.itemKind,
    ),
    foreignKey({
      name: "inventory_tax_treatments_account_fk",
      columns: [t.tenantId, t.expenseAccountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }),
    check(
      "inventory_tax_treatments_kind_format",
      sql`${t.itemKind} is null or ${t.itemKind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
  ],
);

export type InventoryItem = typeof inventoryItems.$inferSelect;
export type NewInventoryItem = typeof inventoryItems.$inferInsert;
export type InventoryLot = typeof inventoryLots.$inferSelect;
export type NewInventoryLot = typeof inventoryLots.$inferInsert;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type NewInventoryMovement = typeof inventoryMovements.$inferInsert;
export type InventoryCount = typeof inventoryCounts.$inferSelect;
export type NewInventoryCount = typeof inventoryCounts.$inferInsert;
export type InventoryCountLine = typeof inventoryCountLines.$inferSelect;
export type NewInventoryCountLine = typeof inventoryCountLines.$inferInsert;
export type BillLineStockAllocation =
  typeof billLineStockAllocations.$inferSelect;
export type NewBillLineStockAllocation =
  typeof billLineStockAllocations.$inferInsert;
export type InventoryTaxTreatment =
  typeof inventoryTaxTreatments.$inferSelect;
export type NewInventoryTaxTreatment =
  typeof inventoryTaxTreatments.$inferInsert;
export type InventoryCostAdjustment =
  typeof inventoryCostAdjustments.$inferSelect;
export type NewInventoryCostAdjustment =
  typeof inventoryCostAdjustments.$inferInsert;
