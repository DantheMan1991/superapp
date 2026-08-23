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
 *   - **Eligibility stamping and the exemption counter** (slice 1d). The
 *     CARCASS STAGE and CONDEMNATIONS landed in slice 1a — see
 *     `production_run_carcasses` below.
 *   - **The kill sheet as a DOCUMENT** — the photograph or the PDF, and the
 *     extraction that fills the carcass rows in from it (slice 1d). The rows
 *     had to exist before there was anywhere to extract into.
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
  boolean,
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
import { parties } from "./parties";
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
    /**
     * WHO DID IT, or null when this business did it itself.
     *
     * **THIS COLUMN IS THE PROCESSING PATH**, and the design is explicit that
     * the path belongs to the run: *"The same batch of birds may be processed
     * on-farm uninspected or sent out to a butcher, decided at booking.
     * Modelling the path on the animal or the species is wrong."* Null is not
     * missing data — it is the on-farm path, which is the whole other half of
     * the choice.
     *
     * No `ON DELETE` clause, so it is NO ACTION: **a plant that has processed
     * your animals cannot be deleted out from under the record.** The
     * establishment number and what it was inspected under are retained
     * records, and the design says so. (Not SET NULL, which would also need the
     * PG 15 column-list form on a composite FK — the bare one nulls `tenant_id`
     * too. See `production_bookings_run_fk`, and `drizzle/0192`.)
     */
    processorId: uuid("processor_id"),
    /**
     * How this run was inspected, STAMPED WHEN THE OUTPUTS LAND. Null while the
     * run is open.
     *
     * **STORED, AND IT IS THE SECOND DERIVED THING IN THIS TABLE THAT IS** —
     * `cost_basis` is the first, for the same reason. A processor's inspection
     * status can be corrected, lapse, or be upgraded, and re-deriving this
     * later would silently change what a lot of meat sitting in a freezer is
     * legally allowed to be sold as. What was true on the day is what governs
     * the meat, so it is written down on the day.
     *
     * Values are `INSPECTIONS` (`usda`, `state`, `custom_exempt`,
     * `uninspected`, `unknown`). A run with no processor stamps `uninspected`:
     * the farm did it itself, and nothing inspected it.
     */
    inspection: text("inspection"),
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
    foreignKey({
      name: "production_runs_processor_fk",
      columns: [t.tenantId, t.processorId],
      foreignColumns: [productionProcessors.tenantId, productionProcessors.id],
    }),
    check(
      "production_runs_inspection_valid",
      sql`${t.inspection} is null or ${t.inspection} in ('usda', 'state', 'custom_exempt', 'uninspected', 'unknown')`,
    ),
    // A finished run has to say how it was inspected, because that is what
    // decides where its meat may be sold. An open one has nothing to say yet.
    check(
      "production_runs_finished_states_inspection",
      sql`${t.status} <> 'complete' or ${t.inspection} is not null`,
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
 * THE KILL SHEET, LINE BY LINE — and the stage that was missing between the
 * animal and the box.
 *
 * Slice 0 could give one honest ratio, packaged over live, and said so: telling
 * **dressing percentage** (live → hanging) apart from **cutting yield**
 * (hanging → packaged) needs the carcass recorded as a stage of its own. This is
 * that stage. The two ratios a butcher actually argues about are folded from
 * these rows and, as ever, stored nowhere.
 *
 * **AND IT IS WHERE A CONDEMNATION GOES.** Slice 0 deferred condemnations here
 * for a reason that is really a reason about this table: a `condemned_head`
 * count on the run would make the head reconcile while making the yield wrong in
 * a NEW way, because the condemned animal's live weight is still in the
 * denominator and nothing short of PER-ANIMAL WEIGHTS can take it out.
 * `live_lb` on this row is those per-animal weights, and it is the only thing
 * that makes a condemnation-adjusted ratio honest rather than an average
 * subtracted from a total.
 *
 * **ONE LINE IS ONE DISPOSITION.** A sheet reading "100 birds, 3 condemned for
 * airsacculitis" is two rows, not one row with a count on it. That is what keeps
 * `hanging_lb` meaning one thing — a condemned carcass yields nothing sellable,
 * so a line that carries a hanging weight is a line that passed, and the CHECK
 * below says so. A partial condemnation (a bruised quarter trimmed, a liver
 * pulled) is NOT a third disposition: the carcass passed, and what did not come
 * off it is a byproduct that failed to materialise, which is slice 3's business.
 *
 * **A LINE IS NOT ALWAYS ONE ANIMAL.** `head_count` is 1 for a beef — where the
 * sheet really is per animal, with a tag on it — and 70 for a pen of broilers,
 * where no plant on earth weighs birds individually. Both shapes are the same
 * row, which is the same call `livestock` made when it decided an individual is
 * a lot of one.
 *
 * **TWO LIVE WEIGHTS ARE ALLOWED TO DISAGREE, AND THEY ARE NEVER SUMMED.** The
 * input row's `weight_lb` is what left the farm; `live_lb` here is what the
 * plant's scale said hours later. Cattle drop 3–5% on a trailer, so those two
 * numbers differ for a real reason — the same reason `land` reports a measured
 * acreage beside a declared one and never overwrites it. The fold prefers the
 * kill sheet where it is complete and falls back to the trailer ticket where it
 * is not, and the screen says which scale it used.
 */
export const productionRunCarcasses = pgTable(
  "production_run_carcasses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull(),
    /**
     * WHICH INPUT THESE CAME OUT OF, and it is REQUIRED.
     *
     * An input already requires a batch, so this makes the chain total:
     * carcass → input → movement → lot → every parent lot behind it. Inspected
     * meat is the case that needs it — "this package came from that pen" is the
     * one claim the whole chain exists to make — and a run that took two pens
     * needs it for a much more ordinary reason: a condemnation belongs to one of
     * them, and a sheet that cannot say which cannot tell you which pen has a
     * problem.
     */
    runInputId: uuid("run_input_id").notNull(),
    /**
     * The animal's identifier as the sheet gives it — an ear tag, a scale ticket
     * number, a carcass number. Empty for a batch line, because 70 broilers do
     * not have 70 identities and inventing them would be a worse record than
     * none.
     */
    tag: text("tag").notNull().default(""),
    /** How many animals this line covers. 1 for a beef, 70 for a pen. */
    headCount: integer("head_count").notNull().default(1),
    /**
     * TOTAL live weight for this line off the PLANT's scale, or null when the
     * plant did not weigh them. Not the farm's weight — that is on the input.
     *
     * This is the column condemnations were waiting for. Without it, taking a
     * condemned animal out of a denominator means subtracting an average, which
     * is precisely the unauditable fudge this pack refuses everywhere else.
     */
    liveLb: numeric("live_lb", { precision: 18, scale: 4, mode: "number" }),
    /**
     * TOTAL hanging (dressed) weight for this line, or null when it was not
     * weighed hot. **Must be null on a condemned line** — see the CHECK, and the
     * reason: a condemned carcass produces nothing sellable, and a weight
     * recorded against one is a number that will find its way into a numerator.
     */
    hangingLb: numeric("hanging_lb", {
      precision: 18,
      scale: 4,
      mode: "number",
    }),
    /** `passed` or `condemned`. CLOSED — see the header on why there is no third. */
    disposition: text("disposition").notNull().default("passed"),
    /**
     * Why it was condemned, in the plant's own words. FREE TEXT, because it is
     * another party's judgement and this app has no standing to reword it into a
     * taxonomy.
     *
     * **OPTIONAL, DELIBERATELY.** `inventory` made an adjustment's reason
     * required because the reason is the diagnostic and the farm is the one who
     * knows it. Here the farm is reading somebody else's paperwork, and a sheet
     * can be smudged, abbreviated or silent — so refusing to record the FACT of a
     * condemnation until somebody supplies a cause would trade a real number for
     * an invented one. That is the same call `livestock` made when it decided an
     * unknown withdrawal is not a zero. The screen counts the unstated ones
     * instead.
     */
    condemnReason: text("condemn_reason").notNull().default(""),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_run_carcasses_tenant_id_id_idx").on(t.tenantId, t.id),
    index("production_run_carcasses_tenant_run_idx").on(t.tenantId, t.runId),
    index("production_run_carcasses_tenant_input_idx").on(
      t.tenantId,
      t.runInputId,
    ),
    foreignKey({
      name: "production_run_carcasses_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [productionRuns.tenantId, productionRuns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "production_run_carcasses_input_fk",
      columns: [t.tenantId, t.runInputId],
      foreignColumns: [productionRunInputs.tenantId, productionRunInputs.id],
    }).onDelete("cascade"),
    check(
      "production_run_carcasses_head_positive",
      sql`${t.headCount} > 0`,
    ),
    check(
      "production_run_carcasses_live_positive",
      sql`${t.liveLb} is null or ${t.liveLb} > 0`,
    ),
    check(
      "production_run_carcasses_hanging_positive",
      sql`${t.hangingLb} is null or ${t.hangingLb} > 0`,
    ),
    check(
      "production_run_carcasses_disposition_valid",
      sql`${t.disposition} in ('passed', 'condemned')`,
    ),
    // A condemned carcass yields nothing sellable. Letting it carry a hanging
    // weight would put pounds nobody can sell into a cutting yield's
    // denominator — the ratio would read low and the reason would be invisible.
    check(
      "production_run_carcasses_condemned_unweighed",
      sql`${t.disposition} = 'passed' or ${t.hangingLb} is null`,
    ),
    // A reason belongs to a condemnation. On a passed line it would be a
    // sentence about something that did not happen.
    check(
      "production_run_carcasses_reason_when_condemned",
      sql`${t.disposition} = 'condemned' or length(btrim(${t.condemnReason})) = 0`,
    ),
  ],
);

/**
 * A PLACE THAT DOES THE WORK THIS FARM DOES NOT DO ITSELF, and everything the
 * app needs to choose between two of them.
 *
 * **IT IS A ROLE ON A PARTY, NOT A NEW CONTACT MODEL.** `party_id` points at the
 * shared identity spine, the same one `customers` and `vendors` hang off. A
 * plant that both processes your animals and invoices you is ONE party holding
 * two role rows — the arrangement `parties` exists for — and the design this
 * pack was sliced from settles it in a line: *"A processor is a vendor — the
 * party spine already holds it, no new contact model."* Everything here is what
 * a party row cannot say.
 *
 * **THE PACK STILL DOES NOT KNOW WHAT A BUTCHER IS.** `processor` is a declared
 * label (`src/packs/index.ts`), so a farm reads "Butcher" and a bakery sending
 * dough to a co-packer reads something else. What each one HANDLES is not
 * enumerated here either — it comes from the installed profile's
 * `packConfig.production.processorHandles`, the same arrangement `runKinds`
 * uses, because a pack carrying a list of species would know what industry it
 * was in (ADR 0004).
 *
 * **INSPECTION IS NOT A BADGE; IT DECIDES WHERE THE MEAT MAY BE SOLD.** The
 * design is explicit that finished stock inherits a market eligibility from how
 * it was processed, and that `retail` must refuse to list a lot into a channel
 * that is not legal for it. This column is where that fact enters the system.
 * It is deliberately NOT a boolean: "not inspected" and "nobody has said yet"
 * are different states, and a boolean would quietly turn the second into the
 * first on the very screen a legal question gets answered from. `unknown` is the
 * default for that reason.
 *
 * **THE RATING IS SOMEBODY'S OPINION AND IS STORED AS ONE.** `rating` and
 * `good_at` are what a person thinks, entered by hand, and they are the only
 * assessment that works on day one. What the app can COMPUTE about a processor —
 * dressing percentage, condemnation rate, turnaround — is a ratio over runs that
 * already exist and is therefore never stored, by the same rule that keeps a
 * yield out of every other table in this file. The two must never be merged into
 * one number: the design warns that yield varies by animal as well as by plant,
 * so a computed figure is evidence about a processor, not a verdict on one.
 */
export const productionProcessors = pgTable(
  "production_processors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The identity behind this processor. One processor row per party. */
    partyId: uuid("party_id").notNull(),
    /**
     * `usda` | `state` | `custom_exempt` | `uninspected` | `unknown`.
     *
     * `custom_exempt` is its own value rather than a flavour of uninspected
     * because it is a real legal category with real consequences: the meat is
     * inspected for the owner and may not be resold, which is precisely the
     * distinction a sales channel has to make.
     */
    inspection: text("inspection").notNull().default("unknown"),
    /**
     * The USDA establishment number. Empty when there is none or nobody has
     * asked. It is a RETAINED RECORD — it goes on the label and it is what a
     * traceback follows — so it lives in a column rather than in notes.
     */
    establishmentNumber: text("establishment_number").notNull().default(""),
    /**
     * `unknown` | `no` | `yes` — will they put YOUR label on the package.
     *
     * Three states for the same reason `inspection` has five: a farm that has
     * not asked is not a farm that has been told no, and this is the question
     * that decides whether a brand can exist at all.
     */
    customLabelling: text("custom_labelling").notNull().default("unknown"),
    /** What they said about labelling, in their words. */
    labellingNotes: text("labelling_notes").notNull().default(""),
    /**
     * HOW FAR AHEAD THEY BOOK, in days. Null when nobody has asked.
     *
     * The design calls slaughter dates the scarce resource and puts the figure
     * at six to twelve months. It is on the processor rather than on a booking
     * because it is a property of the plant, and it is what makes "you should be
     * booking now" answerable before there is anything to book.
     */
    leadTimeDays: integer("lead_time_days"),
    /** 1–5, or null when nobody has formed a view yet. */
    rating: integer("rating"),
    /** What they are good at, in the farm's own words. Never derived. */
    goodAt: text("good_at").notNull().default(""),
    notes: text("notes").notNull().default(""),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_processors_tenant_id_id_idx").on(t.tenantId, t.id),
    // One processor row per party. A second would be two opinions about the
    // same plant, and nothing could say which was current.
    uniqueIndex("production_processors_tenant_party_idx").on(
      t.tenantId,
      t.partyId,
    ),
    index("production_processors_tenant_idx").on(t.tenantId),
    foreignKey({
      name: "production_processors_party_fk",
      columns: [t.tenantId, t.partyId],
      foreignColumns: [parties.tenantId, parties.id],
    }).onDelete("cascade"),
    check(
      "production_processors_inspection_valid",
      sql`${t.inspection} in ('usda', 'state', 'custom_exempt', 'uninspected', 'unknown')`,
    ),
    check(
      "production_processors_labelling_valid",
      sql`${t.customLabelling} in ('unknown', 'no', 'yes')`,
    ),
    check(
      "production_processors_rating_range",
      sql`${t.rating} is null or (${t.rating} >= 1 and ${t.rating} <= 5)`,
    ),
    check(
      "production_processors_lead_time_positive",
      sql`${t.leadTimeDays} is null or ${t.leadTimeDays} > 0`,
    ),
  ],
);

/**
 * WHAT ONE PROCESSOR WILL TAKE, and what it charges to take it.
 *
 * **THIS IS THE ROW THAT ANSWERS "SOME DO ONLY POULTRY".** A plant that kills
 * birds and a plant that kills everything differ by how many of these rows they
 * have, not by a column on the processor — which is what lets "who can take
 * eight hogs in October" be a query rather than a reading exercise.
 *
 * **PRICE LIVES HERE, PER KIND, BECAUSE THAT IS HOW PLANTS QUOTE.** A kill fee
 * is per head and cut-and-wrap is per pound of hanging weight, and both differ
 * by species at the same plant. A single price on the processor would have to
 * pick one animal and be wrong about the others.
 *
 * **THE FEES ARE A QUOTE, NOT A LEDGER ENTRY.** Nothing here posts. What the
 * farm actually paid is a bill in `payables` against the same party; this is
 * what it expected to pay. Kept apart on purpose, so that "they charged more
 * than they quoted" stays a question the data can answer instead of one it has
 * already overwritten.
 */
export const productionProcessorHandles = pgTable(
  "production_processor_handles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processorId: uuid("processor_id").notNull(),
    /**
     * What kind of animal or material. A slug, from the profile's
     * `processorHandles` where it lists one and typed by the tenant where it
     * does not — the format check is the only thing here with an opinion.
     */
    kind: text("kind").notNull(),
    /** Head per day they can take, or null when nobody has asked. */
    capacityPerDay: integer("capacity_per_day"),
    /** Slaughter fee per head, in cents. Null when unquoted. */
    killFeeCents: integer("kill_fee_cents"),
    /** Cut and wrap, in cents per pound of hanging weight. Null when unquoted. */
    cutWrapCentsPerLb: integer("cut_wrap_cents_per_lb"),
    /** Anything those two numbers cannot carry — minimums, extras. */
    priceNotes: text("price_notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_processor_handles_tenant_id_id_idx").on(
      t.tenantId,
      t.id,
    ),
    // One row per kind per processor. Two would be two prices for one animal.
    uniqueIndex("production_processor_handles_unique_idx").on(
      t.tenantId,
      t.processorId,
      t.kind,
    ),
    index("production_processor_handles_kind_idx").on(t.tenantId, t.kind),
    foreignKey({
      name: "production_processor_handles_processor_fk",
      columns: [t.tenantId, t.processorId],
      foreignColumns: [productionProcessors.tenantId, productionProcessors.id],
    }).onDelete("cascade"),
    check(
      "production_processor_handles_kind_format",
      sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "production_processor_handles_capacity_positive",
      sql`${t.capacityPerDay} is null or ${t.capacityPerDay} > 0`,
    ),
    check(
      "production_processor_handles_kill_fee_nonneg",
      sql`${t.killFeeCents} is null or ${t.killFeeCents} >= 0`,
    ),
    check(
      "production_processor_handles_cut_wrap_nonneg",
      sql`${t.cutWrapCentsPerLb} is null or ${t.cutWrapCentsPerLb} >= 0`,
    ),
  ],
);

/**
 * A CUT THIS PROCESSOR WILL PRODUCE.
 *
 * **FREE TEXT, AND THAT IS NOT LAZINESS.** "Bone-in ribeye", "breakfast links",
 * "osso buco" — cut names are a trade's prose and every plant's list differs. A
 * taxonomy here would be this pack asserting what meat is, and the first cut
 * nobody anticipated would become a migration.
 *
 * **`kind` IS OPTIONAL AND MEANS "ONLY FOR THIS ANIMAL".** Empty says the cut is
 * offered generally; a value narrows it, because a plant that will make sausage
 * out of pork and not out of beef is an ordinary fact and the alternative is a
 * note nobody can query.
 *
 * This is CAPABILITY, not instruction. What the farm actually asked for on a
 * given animal is the cut sheet — the design calls it "the recipe", notes it is
 * often the customer's choice on a half-beef sale, and it is a later slice.
 * Keeping them apart matters: this list is what a plant CAN do, and it stays
 * true between runs.
 */
export const productionProcessorCuts = pgTable(
  "production_processor_cuts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processorId: uuid("processor_id").notNull(),
    /** Which animal this cut is for. Empty means "any". */
    kind: text("kind").notNull().default(""),
    /** The cut, as the plant names it. */
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_processor_cuts_tenant_id_id_idx").on(
      t.tenantId,
      t.id,
    ),
    index("production_processor_cuts_processor_idx").on(
      t.tenantId,
      t.processorId,
    ),
    foreignKey({
      name: "production_processor_cuts_processor_fk",
      columns: [t.tenantId, t.processorId],
      foreignColumns: [productionProcessors.tenantId, productionProcessors.id],
    }).onDelete("cascade"),
    check(
      "production_processor_cuts_name_present",
      sql`length(btrim(${t.name})) > 0`,
    ),
    check(
      "production_processor_cuts_kind_format",
      sql`${t.kind} = '' or ${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
  ],
);

/**
 * A DATE HELD WITH A PROCESSOR — the scarce resource, and the one this pack was
 * told is the loudest unmet need in small livestock production.
 *
 * **IT IS NOT A DATE COLUMN ON AN ANIMAL, AND THE DESIGN SAYS SO IN THOSE
 * WORDS.** Plants book six to twelve months ahead, deposits are involved, and
 * losing a date is expensive — you do not get another one in October. A column
 * on a pen could not hold a deposit, could not survive the pen being split
 * across two dates, and could not exist at all before the animals do, which is
 * exactly when the date has to be booked.
 *
 * **A BOOKING IS A PLAN; A RUN IS THE FACT.** `run_id` is what the booking
 * BECAME, and it is null until the day happens. That split is what makes the
 * most useful thing here derivable rather than stored: **a booking whose date
 * has passed with no run and no cancellation is the farm having lost track of a
 * kill day**, and nothing has to remember to set a flag for it to show up. It is
 * the shape `notifications.md` requires — an obligation that self-clears the
 * moment somebody records what happened.
 *
 * So there is no `delivered` or `completed` status, deliberately. A status
 * somebody must remember to advance is a second answer to a question `run_id`
 * already answers, and the two would disagree within a season.
 *
 * **`run_id` IS ALSO THE FIRST THING THAT SAYS WHICH PROCESSOR DID A RUN.**
 * Slice 1b could record what a plant charges and what the farm thinks of it but
 * could not compute a single measured figure about it, because nothing joined a
 * run to a plant. Booking → run is that join, for every run that came from a
 * booking. Slice 1d puts the processing path on the run itself and makes it
 * total; until then a measured comparison covers booked runs only, and any
 * screen showing one has to say which.
 *
 * **MANY BOOKINGS MAY POINT AT ONE RUN**, and that is not an oversight: two
 * bookings at the same plant on the same morning — a beef and four hogs — are
 * one processing day. What must not happen is a CANCELLED booking claiming a
 * run, which is a contradiction rather than an unusual arrangement, and the
 * CHECK below refuses it.
 */
export const productionBookings = pgTable(
  "production_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    processorId: uuid("processor_id").notNull(),
    /**
     * The day they will take them. A DATE and not a timestamp: a plant gives
     * you a day, and the hour it turns out to be is not a fact the farm holds
     * when the booking is made.
     */
    bookedFor: date("booked_for").notNull(),
    /**
     * What is going. Empty when nobody has said — which is a real state for a
     * date held speculatively, and the reason this is not NOT NULL with a
     * default that would invent an animal.
     */
    kind: text("kind").notNull().default(""),
    /** How many head are promised. Null when the date is held loosely. */
    headCount: integer("head_count"),
    /**
     * `held` | `confirmed` | `cancelled`. CLOSED, and three is the whole set.
     *
     * `held` is a date pencilled in; `confirmed` is one the plant and the farm
     * both stand behind, usually because money moved. There is no fourth state
     * for "it happened" — see the header.
     */
    status: text("status").notNull().default("held"),
    /** The plant's own booking reference, as they gave it. */
    reference: text("reference").notNull().default(""),
    /**
     * What was put down to hold it, in cents, and when.
     *
     * **THIS IS THE MONEY AT RISK, WHICH IS WHY LOSING A DATE COSTS SOMETHING.**
     * Null is not zero here either: a date held on a phone call with nothing
     * paid is an ordinary arrangement, and a `$0.00` would say the deposit was
     * waived rather than that nobody asked.
     */
    depositCents: integer("deposit_cents"),
    depositPaidOn: date("deposit_paid_on"),
    /** The run this became. Null until the day happens. */
    runId: uuid("run_id"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("production_bookings_tenant_id_id_idx").on(t.tenantId, t.id),
    // The query the whole slice exists for: what is coming up, and what went by
    // without anybody saying what happened.
    index("production_bookings_tenant_date_idx").on(t.tenantId, t.bookedFor),
    index("production_bookings_tenant_processor_idx").on(
      t.tenantId,
      t.processorId,
    ),
    foreignKey({
      name: "production_bookings_processor_fk",
      columns: [t.tenantId, t.processorId],
      foreignColumns: [productionProcessors.tenantId, productionProcessors.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "production_bookings_run_fk",
      columns: [t.tenantId, t.runId],
      foreignColumns: [productionRuns.tenantId, productionRuns.id],
      /**
       * CASCADE, matching every other reference to a run in this pack.
       *
       * **`SET NULL` WAS TRIED FIRST AND IS NOT EXPRESSIBLE HERE — a gotcha
       * worth carrying.** On a COMPOSITE foreign key, `ON DELETE SET NULL`
       * nulls *every* referencing column, `tenant_id` included, and that column
       * is `NOT NULL`. So the delete does not null the link, it fails outright.
       * (Postgres 15 added `SET NULL (run_id)` to name the column; drizzle's
       * `onDelete` takes an action, not a column list, so reaching for it would
       * mean hand-writing this constraint and keeping the generator away from
       * it forever.)
       *
       * The argument for `SET NULL` — that a booking should outlive the run it
       * became, because it records a date held and a deposit paid — is defending
       * a state nothing can reach: **nothing in this app deletes a run.** The
       * only path that removes one is deleting the tenant, where the booking is
       * being deleted anyway. A guard against an impossible state is the thing
       * this pack removed once already.
       */
    }).onDelete("cascade"),
    check(
      "production_bookings_status_valid",
      sql`${t.status} in ('held', 'confirmed', 'cancelled')`,
    ),
    check(
      "production_bookings_head_positive",
      sql`${t.headCount} is null or ${t.headCount} > 0`,
    ),
    check(
      "production_bookings_deposit_nonneg",
      sql`${t.depositCents} is null or ${t.depositCents} >= 0`,
    ),
    check(
      "production_bookings_kind_format",
      sql`${t.kind} = '' or ${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    // A cancelled date cannot have become a processing day.
    check(
      "production_bookings_cancelled_has_no_run",
      sql`${t.status} <> 'cancelled' or ${t.runId} is null`,
    ),
  ],
);

/**
 * Deliberately absent, and worth saying where somebody will look for it: a
 * `cost_cents` column on either side. The input's cost is stamped on its
 * movement when the stock leaves; the output's is stamped on its receipt when
 * it lands. Both are `inventory`'s, both are events, and a copy here would be
 * a second number that has to agree with the ledger forever.
 *
 * Absent for the same class of reason on the carcass table: a dressing
 * percentage, a cutting yield, or a condemnation RATE. Every one of those is a
 * ratio over the weights already here, and the rule this pack was built on is
 * that a yield is never stored in any form.
 */

export type ProductionRun = typeof productionRuns.$inferSelect;
export type NewProductionRun = typeof productionRuns.$inferInsert;
export type ProductionRunInput = typeof productionRunInputs.$inferSelect;
export type NewProductionRunInput = typeof productionRunInputs.$inferInsert;
export type ProductionRunOutput = typeof productionRunOutputs.$inferSelect;
export type NewProductionRunOutput = typeof productionRunOutputs.$inferInsert;
export type ProductionRunCarcass = typeof productionRunCarcasses.$inferSelect;
export type NewProductionRunCarcass =
  typeof productionRunCarcasses.$inferInsert;
export type ProductionProcessor = typeof productionProcessors.$inferSelect;
export type NewProductionProcessor = typeof productionProcessors.$inferInsert;
export type ProductionProcessorHandle =
  typeof productionProcessorHandles.$inferSelect;
export type NewProductionProcessorHandle =
  typeof productionProcessorHandles.$inferInsert;
export type ProductionProcessorCut =
  typeof productionProcessorCuts.$inferSelect;
export type NewProductionProcessorCut =
  typeof productionProcessorCuts.$inferInsert;
export type ProductionBooking = typeof productionBookings.$inferSelect;
export type NewProductionBooking = typeof productionBookings.$inferInsert;
