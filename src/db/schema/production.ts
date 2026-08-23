/**
 * Production — inputs consumed + labour → outputs produced, at a yield, with
 * cost rolled through.
 *
 * Layer 2a. Same rules as any domain: `tenant_id`, FORCE RLS, isolation
 * coverage.
 *
 * **THE ONE THING TO KNOW: A RUN OWNS NO QUANTITY AND NO MONEY.** What went in
 * and what came out are `inventory_movements`, exactly as a shared-feeder draw
 * is in `livestock`. These three tables hold the JOIN and the one fact the
 * ledger cannot know — **the weight on the scale**. A pen is 210 head and a
 * steer is 1 head; neither number is a weight, and the ratio between the weight
 * that went in and the weight that came out is the whole reason this pack
 * exists.
 *
 * **THE YIELD IS NEVER A COLUMN.** A steer goes in at 1,150 lb live and hangs at
 * 690. That is 60%, it is different for the next steer, and it is different
 * again at the next plant. Storing it — as a factor on a unit, as a percentage
 * on a run, as anything at all — would put an unauditable fudge in the books and
 * make every carcass quietly wrong. `inventory`'s own units file says so, and
 * this pack is where the alternative lives: measure it per run, fold it at read
 * time, and refuse to state one when the weights are not all there.
 *
 * Deliberately NOT here yet, each because nothing would read it:
 *
 *   - **Cut sheets and recipes** (slices 1 and 2). A run is one shared model;
 *     the TEMPLATES that seed it stay separate, because a cut sheet specifies
 *     treatment and a recipe specifies quantities.
 *   - **Eligibility stamping, the exemption counter and kill-sheet capture**
 *     (slice 1) — including CONDEMNATIONS, which is where delivered head stops
 *     equalling sellable carcasses. See docs/modules/production.md.
 *   - **Byproducts at net realisable value and costed internal transfers**
 *     (slice 3). Slice 0 rolls the whole input cost across every output by one
 *     stated basis; crediting the tallow at NRV first is a later refinement of
 *     the same roll.
 *   - **Labels** (slice 4), **processor and throughput comparison** (slice 5).
 *   - **Commitments.** A pre-sold half is never inventory and never an output
 *     lot: it goes from a commitment against a live animal to delivered without
 *     sitting on a shelf. `inventory` slice 4, with `retail`.
 */
import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
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
import { inventoryItems, inventoryLots, inventoryMovements } from "./inventory";

/**
 * ONE PASS OF TURNING THINGS INTO OTHER THINGS: a processing day, a bake, a
 * milling. What went in, when, where, and who did it.
 *
 * **Two acts, not one**, and the gap between them is the point. STARTING a run
 * takes the inputs out of stock — the animals leave the farm, the flour leaves
 * the bin — and from that moment their accumulated cost is held by the run and
 * is on no shelf anywhere. COMPLETING it lands the outputs in `inventory` with
 * that cost split across them. The design calls the gap **work in progress**,
 * and notes that every accounting system models it and no farm app does.
 *
 * `run_kind` is an open taxonomy (P1) and the profile supplies the suggestions:
 * a pack that knew what "butcher" meant would know what industry it was in.
 */
export const productionRuns = pgTable(
  "production_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** What a person calls it: "Kill day 2026-08-20", "Batch 12". */
    code: text("code").notNull(),
    /** Open taxonomy (P1). Values come from the profile's `packConfig`. */
    runKind: text("run_kind").notNull().default("run"),
    /** `in_progress` while the cost is held here; `complete` once it has landed. */
    status: text("status").notNull().default("in_progress"),
    startedOn: date("started_on").notNull(),
    /** Null until the outputs land. Set in the same transaction as they do. */
    completedOn: date("completed_on"),
    /**
     * Where it happened — the farm's own kitchen, a shared commercial kitchen,
     * a processing plant. An asset, because a place IS one; null when nobody
     * has said.
     */
    locationAssetId: uuid("location_asset_id"),
    /**
     * Who did it. FREE TEXT, and not a list of user accounts: a processing day
     * is 2–3 people and at least one of them is a neighbour who does not have a
     * login. Recording a name that means something to the farm beats recording
     * nothing.
     */
    performedBy: text("performed_by").notNull().default(""),
    /**
     * Crew and hours, recorded PER DAY rather than per bird — the design's own
     * rule, and the third use of the same allocator when slice 3 spreads them.
     *
     * **NOTHING COSTS THEM IN THIS SLICE.** Labour hours become money only once
     * somebody decides what an hour is worth, and the on-farm-versus-processor
     * comparison runs straight into the unpaid-labour problem: if own hours
     * count as zero, on-farm processing always wins on paper and never on
     * Sunday evening. Recorded now because it is free to record and impossible
     * to reconstruct later; costed in slice 3, compared in slice 5.
     */
    crewSize: integer("crew_size"),
    labourHours: numeric("labour_hours", {
      precision: 18,
      scale: 2,
      mode: "number",
    }),
    /**
     * How the input cost was actually split across the outputs — `weight`,
     * `quantity`, or `none` when it could not be split at all.
     *
     * **STORED, AND IT IS THE ONE DERIVED THING HERE THAT IS.** The rule that
     * picks a basis may change; a run completed under the old one must keep
     * explaining itself, and re-deriving the label from today's rule would make
     * a historical run describe a split it never had.
     */
    costBasis: text("cost_basis"),
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
    uniqueIndex("production_runs_tenant_id_id_idx").on(t.tenantId, t.id),
    index("production_runs_tenant_status_idx").on(t.tenantId, t.status),
    index("production_runs_tenant_started_idx").on(t.tenantId, t.startedOn),
    index("production_runs_tenant_kind_idx").on(t.tenantId, t.runKind),
    foreignKey({
      name: "production_runs_location_fk",
      columns: [t.tenantId, t.locationAssetId],
      foreignColumns: [assets.tenantId, assets.id],
    }),
    check("production_runs_code_present", sql`length(btrim(${t.code})) > 0`),
    check(
      "production_runs_kind_format",
      sql`${t.runKind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "production_runs_status_valid",
      sql`${t.status} in ('in_progress', 'complete')`,
    ),
    check(
      "production_runs_basis_valid",
      sql`${t.costBasis} is null or ${t.costBasis} in ('weight', 'quantity', 'none')`,
    ),
    // A run cannot finish before it started. Same day is ordinary — a farm kill
    // day starts and ends on a Saturday.
    check(
      "production_runs_completed_after_started",
      sql`${t.completedOn} is null or ${t.completedOn} >= ${t.startedOn}`,
    ),
    check(
      "production_runs_crew_positive",
      sql`${t.crewSize} is null or ${t.crewSize} > 0`,
    ),
    check(
      "production_runs_hours_positive",
      sql`${t.labourHours} is null or ${t.labourHours} > 0`,
    ),
  ],
);

/**
 * WHAT WENT IN. **A join, not a second ledger** — the same shape, and the same
 * reasoning, as `livestock_feed_draws`.
 *
 * The quantity, the item, the batch and the stamped cost all live on the
 * `inventory_movements` row this points at, and only there. If a later slice is
 * tempted to put a quantity or a total here, that is the second ledger the
 * whole pack model exists to avoid.
 *
 * What this row adds is `weight_lb`, which the ledger genuinely cannot hold: a
 * pen leaves at 210 head and 862 lb, and only one of those is a quantity.
 */
export const productionRunInputs = pgTable(
  "production_run_inputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull(),
    /**
     * The movement that took it out of stock. **Whose ledger it is depends on
     * what it was**: ordinary stock leaves through `inventory.issueStock`, head
     * leaves through `livestock.removeHead`, and both write here — because they
     * are both rows in the one ledger, and neither pack keeps a second one.
     */
    inventoryMovementId: uuid("inventory_movement_id").notNull(),
    /**
     * TOTAL live weight for this row, in pounds, or null when nobody weighed
     * it. **Not the quantity.** For an item stocked by mass it is redundant and
     * is left null — the movement already says 50 lb of flour — and the read
     * folds the quantity in instead. For head, packages and anything else
     * counted, this is the only place the weight can be.
     *
     * Pounds in the column name for the reason `livestock_weights` gives: a
     * column called `weight` that means different things per tenant is exactly
     * the bug the one-stocking-unit rule exists to prevent.
     */
    weightLb: numeric("weight_lb", {
      precision: 18,
      scale: 4,
      mode: "number",
    }),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_run_inputs_tenant_id_id_idx").on(t.tenantId, t.id),
    index("production_run_inputs_tenant_run_idx").on(t.tenantId, t.runId),
    // ONE MOVEMENT IS ONE INPUT. Two rows against the same movement would put
    // one cost into two runs — the same reason a feed draw is unique per
    // movement.
    uniqueIndex("production_run_inputs_movement_idx").on(
      t.tenantId,
      t.inventoryMovementId,
    ),
    foreignKey({
      name: "production_run_inputs_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [productionRuns.tenantId, productionRuns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "production_run_inputs_movement_fk",
      columns: [t.tenantId, t.inventoryMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
    }),
    check(
      "production_run_inputs_weight_positive",
      sql`${t.weightLb} is null or ${t.weightLb} > 0`,
    ),
  ],
);

/**
 * WHAT CAME OUT, and the one place in this pack that holds a quantity before
 * the ledger does.
 *
 * **That is deliberate and it is what WIP means here.** Boxes come off the line
 * one at a time, and the cost split across them cannot be known until they have
 * all come off — so each is recorded against the run first, and completing the
 * run lands every one of them in `inventory` in a single transaction with its
 * share of the input cost stamped on the receipt.
 *
 * Once `inventory_movement_id` is set the row is FROZEN: the movement is the
 * fact from then on, and editing this row would make it disagree with the
 * ledger it created.
 */
export const productionRunOutputs = pgTable(
  "production_run_outputs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /** Positive, in the item's stocking unit. */
    quantity: numeric("quantity", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    /**
     * Same rule as the input side: total pounds, null when the item is stocked
     * by mass (the quantity already is the weight) and required in practice for
     * anything counted, because without it there is no yield to state.
     */
    weightLb: numeric("weight_lb", {
      precision: 18,
      scale: 4,
      mode: "number",
    }),
    /**
     * What the batch will be called when it lands. Defaulted from the run's own
     * code, because a run IS a batch as far as traceability is concerned and
     * making somebody name it twice is how it ends up named inconsistently.
     */
    lotCode: text("lot_code").notNull(),
    /** The batch it landed in. Null until the run is completed. */
    lotId: uuid("lot_id"),
    /** The receipt that put it on the shelf. Null until the run is completed. */
    inventoryMovementId: uuid("inventory_movement_id"),
    /** Which freezer, barn or shelf it goes to. */
    locationAssetId: uuid("location_asset_id"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_run_outputs_tenant_id_id_idx").on(t.tenantId, t.id),
    index("production_run_outputs_tenant_run_idx").on(t.tenantId, t.runId),
    index("production_run_outputs_tenant_item_idx").on(t.tenantId, t.itemId),
    foreignKey({
      name: "production_run_outputs_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [productionRuns.tenantId, productionRuns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "production_run_outputs_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }),
    foreignKey({
      name: "production_run_outputs_lot_fk",
      columns: [t.tenantId, t.lotId],
      foreignColumns: [inventoryLots.tenantId, inventoryLots.id],
    }),
    foreignKey({
      name: "production_run_outputs_movement_fk",
      columns: [t.tenantId, t.inventoryMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
    }),
    foreignKey({
      name: "production_run_outputs_location_fk",
      columns: [t.tenantId, t.locationAssetId],
      foreignColumns: [assets.tenantId, assets.id],
    }),
    check("production_run_outputs_quantity_positive", sql`${t.quantity} > 0`),
    check(
      "production_run_outputs_weight_positive",
      sql`${t.weightLb} is null or ${t.weightLb} > 0`,
    ),
    check(
      "production_run_outputs_lot_code_present",
      sql`length(btrim(${t.lotCode})) > 0`,
    ),
    // Landed means BOTH. A movement without the lot it created, or a lot with
    // nothing that put stock in it, is a half-finished completion.
    check(
      "production_run_outputs_landed_together",
      sql`(${t.lotId} is null) = (${t.inventoryMovementId} is null)`,
    ),
  ],
);

/**
 * Deliberately absent, and worth saying where somebody will look for it: a
 * `cost_cents` column on either side. The input's cost is stamped on its
 * movement when the stock leaves; the output's is stamped on its receipt when
 * it lands. Both are `inventory`'s, both are events, and a copy here would be
 * a second number that has to agree with the ledger forever.
 */

export type ProductionRun = typeof productionRuns.$inferSelect;
export type NewProductionRun = typeof productionRuns.$inferInsert;
export type ProductionRunInput = typeof productionRunInputs.$inferSelect;
export type NewProductionRunInput = typeof productionRunInputs.$inferInsert;
export type ProductionRunOutput = typeof productionRunOutputs.$inferSelect;
export type NewProductionRunOutput = typeof productionRunOutputs.$inferInsert;
