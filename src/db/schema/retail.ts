/**
 * Retail — where the business sells, what it charges there, and what a day of
 * selling cost to stand at.
 *
 * Layer 2a. Same rules as any domain: `tenant_id`, FORCE RLS, isolation
 * coverage.
 *
 * **THE ONE THING TO KNOW: A PRICE IS NOT A PROPERTY OF A THING.** The same
 * pound of ground beef is one price at a market stall, another at the farm gate,
 * and another again to a wholesaler — and none of them is *the* price. So price
 * lives on the pair (channel, item) and never on `inventory_items`, which is
 * what makes the wholesale seam nearly free later and what stops the first
 * second channel needing a migration.
 *
 * **NOTHING HERE STORES A TOTAL, A MARGIN OR A PROFIT.** Slice 0 records what a
 * selling day COST — the stall fee, the travel, the hours. What it made needs
 * sales, which is slice 1, and profit is the subtraction of the two at read
 * time. A `profit_cents` column would be a number that stopped agreeing with
 * its own inputs the first time a price was corrected.
 *
 * Deliberately NOT here yet, each because nothing would read it:
 *
 *   - **Payment settlements and fees** (slice 2), through a provider adapter.
 *     `payment_method` is recorded from slice 1 so that matching has something
 *     to match against, but no money is reconciled to a bank here.
 *   - **Commitments** — reservations, deposits, the hanging-weight invoice and
 *     the fulfilment point. Slice 3, with `production`. **A deposit is a
 *     liability, not revenue**, and it is the case where this farm's two
 *     required bases disagree about real money for months.
 *   - **Channel eligibility.** A sale line will validate a lot's eligibility
 *     against the channel and refuse a mismatch — but the stamp comes off a
 *     production run, and `production` does not stamp one until ITS slice 1.
 *     Building the column here first would be a guard with nothing to read.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
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
import { enterprises } from "./enterprises";
import { assets } from "./assets";
import { inventoryItems, inventoryLots, inventoryMovements } from "./inventory";

/**
 * **WHERE THE BUSINESS SELLS.** A stall at a named market, the farm gate, a
 * shop, a wholesale account.
 *
 * **A LIST FROM DAY ONE, EVEN WITH ONE ENTRY ON IT.** The pilot has exactly one
 * farmers market today and says more are coming; the design's own note is that
 * building the list now costs nothing and retrofitting it costs a migration plus
 * every price ever entered. The same argument decided the multi-entity work in
 * accounting.
 *
 * `channel_kind` is an open taxonomy (P1) and the profile supplies the
 * suggestions: a pack that knew what a farmers market was would know what
 * industry it was in.
 */
export const retailChannels = pgTable(
  "retail_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** What a person calls it: "Saturday market", "Farm store", "Elm Street". */
    name: text("name").notNull(),
    /** Open taxonomy (P1). Values come from the profile's `packConfig`. */
    channelKind: text("channel_kind").notNull().default("direct"),
    /**
     * Where it happens, as a person would say it. **Free text, and deliberately
     * not an asset**: the farm does not own the square its stall stands on, and
     * pointing at `assets` would be claiming it did. The market TRUCK is an
     * asset and a mobile inventory location, which is a different thing and is
     * slice 1's business.
     */
    location: text("location").notNull().default(""),
    /** `active` | `closed`. A closed channel keeps its prices and its history. */
    /**
     * **WHICH LINE OF BUSINESS THIS CHANNEL'S OWN COSTS BELONG TO, and only its
     * own costs.**
     *
     * Right for a single-purpose round — an egg run is entirely the egg
     * business — and deliberately left BLANK for a mixed stall. A stall selling
     * beef and chicken cannot attribute its stall fee to one of them, and doing
     * it anyway would be a confident wrong number. What each SALE earns is
     * attributed per line from the item sold; a mixed day's overheads stay
     * Unassigned until somebody decides how to split them, which is an
     * allocation and wants its own decision.
     *
     * Composite FK, no `onDelete`. See `inventory_items.enterprise_id`.
     */
    enterpriseId: uuid("enterprise_id"),
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
    uniqueIndex("retail_channels_tenant_id_id_idx").on(t.tenantId, t.id),
    index("retail_channels_tenant_status_idx").on(t.tenantId, t.status),
    index("retail_channels_tenant_kind_idx").on(t.tenantId, t.channelKind),
    check("retail_channels_name_present", sql`length(btrim(${t.name})) > 0`),
    check(
      "retail_channels_kind_format",
      sql`${t.channelKind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    foreignKey({
      name: "retail_channels_enterprise_fk",
      columns: [t.tenantId, t.enterpriseId],
      foreignColumns: [enterprises.tenantId, enterprises.id],
    }),
    index("retail_channels_tenant_enterprise_idx").on(t.tenantId, t.enterpriseId),
    check(
      "retail_channels_status_valid",
      sql`${t.status} in ('active', 'closed')`,
    ),
  ],
);

/**
 * **WHAT ONE ITEM COSTS IN ONE CHANNEL, FROM ONE DAY.**
 *
 * **EFFECTIVE-DATED ROWS, NOT AN EDITABLE PRICE.** Putting `price_cents` on a
 * pair and updating it in place would answer "what do I charge" and destroy
 * "what did I charge in June", which is the only version of the question a
 * margin report can ask. So a price change is a NEW ROW and the current price is
 * the latest one that has started — the same shape `retainer_allotments` uses to
 * freeze past months, and for the same reason.
 *
 * **There is no `effective_to`.** A price runs until the next one starts, and a
 * second column saying so is a second number that has to agree with the first
 * forever. The gap between two rows is not a fact anybody enters; it is
 * arithmetic.
 *
 * **The price is per the item's STOCKING UNIT**, and there is no unit column
 * here. `inventory` allows exactly one unit per item precisely so that every
 * number about it reads the same way, and a price denominated differently from
 * the balance would put the "is it bags or pounds" bug back into the one place
 * it costs real money.
 */
export const retailPrices = pgTable(
  "retail_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /** Per one stocking unit, in integer cents. The house convention. */
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    /**
     * **WHAT `price_cents` IS PER: `'unit'` or `'lb'`.**
     *
     * The comment above says the price is per the item's stocking unit and that
     * there is deliberately no unit column, *"because a price denominated
     * differently from the balance would put the 'is it bags or pounds' bug back
     * into the one place it costs real money."* **That rule was right about the
     * danger and it was about INFERENCE.** A catch-weight item genuinely has two
     * measures — a package is what leaves the truck and a pound is what the
     * customer pays for — and the ambiguity only bites when nothing says which.
     * This column says which, the sale line stamps both numbers explicitly, and
     * nothing anywhere is inferred. See
     * [ADR 0016](../../../docs/decisions/0016-a-catch-weight-item-is-stocked-in-packages.md).
     *
     * **A CLOSED SET, and defaulting to `'unit'` so every row written before
     * this column keeps its meaning byte for byte.** Closed for `PRICE_UNITS`'s
     * reason: a basis nothing implements has to be refused on the way in rather
     * than fall through to whichever branch happens to be last.
     *
     * **`'lb'` IS REFUSED FOR AN ITEM STOCKED BY MASS** (`setPrice`), where the
     * quantity already IS the weight and the two bases mean the same thing. It
     * is offered for anything counted — packages, head, dozens — which is where
     * they differ.
     */
    priceBasis: text("price_basis").notNull().default("unit"),
    /** The first day this price applies. */
    effectiveFrom: date("effective_from").notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("retail_prices_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * ONE PRICE PER ITEM PER CHANNEL PER DAY — two rows starting the same
     * morning is not a price change, it is a question about which one is real.
     *
     * It doubles as the lookup index: *what is this item's price here, and what
     * was it before* reads on exactly these columns in this order, so a second
     * non-unique copy of it would be an index the database maintains for
     * nothing.
     */
    uniqueIndex("retail_prices_unique_start_idx").on(
      t.tenantId,
      t.channelId,
      t.itemId,
      t.effectiveFrom,
    ),
    foreignKey({
      name: "retail_prices_channel_fk",
      columns: [t.tenantId, t.channelId],
      foreignColumns: [retailChannels.tenantId, retailChannels.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "retail_prices_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }),
    // Free is a real price — a sample, a giveaway, a loss leader. Negative is
    // not a price at all, it is a refund, and that is a sale's business.
    check("retail_prices_not_negative", sql`${t.priceCents} >= 0`),
    check(
      "retail_prices_basis_valid",
      sql`${t.priceBasis} in ('unit', 'lb')`,
    ),
  ],
);

/**
 * **A DAY OF SELLING, AND WHAT IT COST TO STAND THERE.**
 *
 * The design's argument, and it is the whole reason this exists before any sale
 * does:
 *
 * > With two or three markets a week, **one is usually a dud attended out of
 * > habit**, and two seasons of this data ends that argument.
 *
 * Profit per selling day is revenue less the stall fee, the travel and the hours
 * actually stood there — and three of those four are recordable today. **What it
 * made arrives with the till in slice 1**, and until then this answers the
 * cheaper half honestly rather than pretending to answer the whole thing.
 *
 * Run-like on purpose: the shape is deliberately the one `production_runs`
 * already established, because a market day and a bake day are the same kind of
 * object — a bounded event with a crew, hours and a cost.
 */
export const retailMarketDays = pgTable(
  "retail_market_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channelId: uuid("channel_id").notNull(),
    heldOn: date("held_on").notNull(),
    /** What the pitch cost. Null when there is no fee, which a farm gate has. */
    stallFeeCents: bigint("stall_fee_cents", { mode: "number" }),
    /**
     * What getting there and back cost.
     *
     * **CENTS RATHER THAN MILES, and that is a boundary decision.** Miles are
     * what a person knows, but turning them into money needs a rate — and a
     * mileage rate is an accounting policy with a tax consequence, which this
     * pack has no business owning. Recording the figure the farm would actually
     * claim keeps the policy where it belongs.
     */
    travelCents: bigint("travel_cents", { mode: "number" }),
    /**
     * Crew and hours stood at the stall. **Recorded and NOT costed**, exactly as
     * on a production run: hours become money only once somebody decides what an
     * hour is worth, and if own hours count as zero then every market looks
     * profitable and the dud is invisible — which is the argument this table was
     * built to settle.
     */
    crewSize: integer("crew_size"),
    hours: numeric("hours", { precision: 18, scale: 2, mode: "number" }),
    /**
     * What the weather did. FREE TEXT, and not a code: "rained until eleven" is
     * what explains a bad Saturday, and no enumeration this pack could invent
     * would carry it. `land` has a real weather seam designed for parcels; a
     * stall two towns over is not that.
     */
    weather: text("weather").notNull().default(""),
    /**
     * **THE TWO ENDS OF THE CASH TIN**, added with the till in slice 1.
     *
     * `opening_float_cents` is the change taken to the stall;
     * `cash_counted_cents` is what is in the tin at the end. The variance is
     * counted − (float + cash sales), folded at read time and never stored: a
     * stored variance would stop agreeing with its own inputs the first time a
     * sale was corrected.
     *
     * Both nullable, and null is not zero. A day nobody counted is a day nobody
     * counted; a till that genuinely balanced to nothing is a different fact,
     * and `core/till.ts` refuses to state a variance for the first.
     */
    openingFloatCents: bigint("opening_float_cents", { mode: "number" }),
    cashCountedCents: bigint("cash_counted_cents", { mode: "number" }),
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
    uniqueIndex("retail_market_days_tenant_id_id_idx").on(t.tenantId, t.id),
    index("retail_market_days_tenant_channel_idx").on(t.tenantId, t.channelId),
    index("retail_market_days_tenant_date_idx").on(t.tenantId, t.heldOn),
    foreignKey({
      name: "retail_market_days_channel_fk",
      columns: [t.tenantId, t.channelId],
      foreignColumns: [retailChannels.tenantId, retailChannels.id],
    }),
    // Deliberately NOT unique on (channel, day): a morning market and an evening
    // one at the same pitch are two days of standing there, and merging them
    // would hide the one that was not worth it.
    check(
      "retail_market_days_fee_not_negative",
      sql`${t.stallFeeCents} is null or ${t.stallFeeCents} >= 0`,
    ),
    check(
      "retail_market_days_travel_not_negative",
      sql`${t.travelCents} is null or ${t.travelCents} >= 0`,
    ),
    check(
      "retail_market_days_crew_positive",
      sql`${t.crewSize} is null or ${t.crewSize} > 0`,
    ),
    check(
      "retail_market_days_hours_positive",
      sql`${t.hours} is null or ${t.hours} > 0`,
    ),
    check(
      "retail_market_days_float_not_negative",
      sql`${t.openingFloatCents} is null or ${t.openingFloatCents} >= 0`,
    ),
    check(
      "retail_market_days_counted_not_negative",
      sql`${t.cashCountedCents} is null or ${t.cashCountedCents} >= 0`,
    ),
  ],
);

/**
 * **A SALE.** Somebody paid for something and took it away.
 *
 * **`client_ref` IS THE MOST IMPORTANT COLUMN IN THIS PACK, and it is here
 * before anything needs it.** A market stall often has no signal, so a till has
 * to be able to take a sale and post it later — which means posting is going to
 * be RETRIED, and a retry whose first attempt actually succeeded but whose
 * acknowledgement was lost would take the money twice. The till generates an id
 * before it ever reaches the network, and the unique index below makes replaying
 * a sale a no-op rather than a duplicate.
 *
 * That is a schema decision on purpose. The rest of offline — a service worker,
 * a local queue, flushing on reconnect — is client code that can be replaced at
 * will; **idempotent posting is the one part that cannot be retrofitted**
 * without a migration and a reconciliation of everything already taken.
 *
 * Null for a sale created on the server, which is what a farm-store till or a
 * back-office correction will be. Multiple nulls are fine: the index treats them
 * as distinct, which is exactly right here.
 *
 * **NO CUSTOMER COLUMN, and that is the design's own limit.** A cash customer at
 * a market stall is anonymous, and traceability is honest about ending at the
 * point of sale. Named buyers — halves, online orders, wholesale — arrive with
 * commitments in slice 3 and hang off the existing CRM party spine rather than a
 * customer model invented here.
 */
export const retailSales = pgTable(
  "retail_sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The till's own id for this sale, minted before it reached the network. */
    clientRef: text("client_ref"),
    channelId: uuid("channel_id").notNull(),
    /**
     * The selling day this belongs to. Null for a sale outside one — a farm gate
     * has no market day, and forcing one would invent a record nobody kept.
     */
    marketDayId: uuid("market_day_id"),
    /**
     * WHEN, to the minute. A date would be enough for the books and useless for
     * the question the design actually wants answered: *how much should I bring,
     * and had I run out by noon.*
     */
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    /**
     * Open taxonomy (P1): 'cash', 'card', 'other'. Recorded from slice 1 even
     * though only cash can be taken offline — **authorisation has to reach the
     * network, which is an OS-level fact rather than a provider limitation** —
     * because slice 2's settlement matching needs something to match against,
     * and a column added later cannot describe sales already taken.
     */
    paymentMethod: text("payment_method").notNull().default("cash"),
    /**
     * Where the stock came off. On the SALE rather than the line: one customer
     * at one stall is served from one truck, and putting it on each line would
     * invite a sale drawn from two places that no one meant.
     */
    locationAssetId: uuid("location_asset_id"),
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
    uniqueIndex("retail_sales_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * **WHAT MAKES A REPLAY SAFE.** Posting the same queued sale twice hits this
     * and does nothing, instead of taking the money twice.
     */
    uniqueIndex("retail_sales_client_ref_idx").on(t.tenantId, t.clientRef),
    index("retail_sales_tenant_day_idx").on(t.tenantId, t.marketDayId),
    index("retail_sales_tenant_channel_time_idx").on(
      t.tenantId,
      t.channelId,
      t.soldAt,
    ),
    foreignKey({
      name: "retail_sales_channel_fk",
      columns: [t.tenantId, t.channelId],
      foreignColumns: [retailChannels.tenantId, retailChannels.id],
    }),
    foreignKey({
      name: "retail_sales_market_day_fk",
      columns: [t.tenantId, t.marketDayId],
      foreignColumns: [retailMarketDays.tenantId, retailMarketDays.id],
    }),
    foreignKey({
      name: "retail_sales_location_fk",
      columns: [t.tenantId, t.locationAssetId],
      foreignColumns: [assets.tenantId, assets.id],
    }),
    check(
      "retail_sales_payment_format",
      sql`${t.paymentMethod} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
  ],
);

/**
 * One thing sold, at the price it was actually charged at.
 *
 * **`unit_price_cents` IS STAMPED, NOT LOOKED UP.** The price list is where the
 * number comes FROM; what the customer paid is what goes here. Deriving it later
 * from `retail_prices` would mean a price change in October silently restating
 * what June's sales were worth — the same rule `inventory` applies to an issue's
 * cost, and the reason `retail_prices` is effective-dated rather than editable.
 *
 * It also has to be stamped because a market haggles: *two for twenty* is a real
 * transaction and the list price is not what happened.
 *
 * **THE LINE IS ALSO A STOCK ISSUE.** `inventory_movement_id` is NOT NULL —
 * selling something takes it off the truck, and a line without a movement would
 * be revenue with nothing behind it.
 */
export const retailSaleLines = pgTable(
  "retail_sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    saleId: uuid("sale_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /** Which batch left. Null for an item nobody tracks in batches. */
    lotId: uuid("lot_id"),
    /** Positive, in the item's stocking unit. */
    quantity: numeric("quantity", {
      precision: 18,
      scale: 4,
      mode: "number",
    }).notNull(),
    /**
     * What was actually charged, in cents, **per stocking unit — or per POUND
     * when `weight_lb` is set.**
     *
     * The denominator is named by a sibling column rather than inferred from
     * anything, which is the distinction `retail_prices.price_basis` explains at
     * length: the "bags or pounds" rule guards against a number whose unit
     * nobody stated, not against an item having two measures.
     */
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    /**
     * **WHAT WAS ON THE SCALE, when this line was sold by weight.**
     *
     * Null is ordinary and is the common case: a line sold by the package has
     * no weighing in it at all. Its presence is what switches the meaning of
     * `unit_price_cents` above and what makes `line_total_cents` required.
     *
     * **`quantity` STILL MEANS PACKAGES, and that is load-bearing.** It is the
     * number that issues the movement and the number the till counts the truck
     * down by. Three packages weighed together are one line: quantity 3,
     * weight 3.7, and one package off the truck for each of the three.
     *
     * **THIS IS THE ONLY PLACE THE REAL WEIGHT OF WHAT LEFT IS RECORDED.** It
     * deliberately does NOT feed back into `inventory`, whose pounds are a
     * batch average and are approximate by design — one figure is a shelf
     * estimate and the other is a transaction record, and they never reconcile.
     * See [ADR 0016](../../../docs/decisions/0016-a-catch-weight-item-is-stocked-in-packages.md).
     */
    weightLb: numeric("weight_lb", {
      precision: 18,
      scale: 4,
      mode: "number",
    }),
    /**
     * **THE MONEY, when it cannot be derived from quantity × price.**
     *
     * Null whenever it CAN be — which is every line sold by the package, and
     * every line written before this column existed. Not a stored duplicate of
     * an arithmetic result: *"a second column saying so is a second number that
     * has to agree with the first forever"*, which is the same reasoning that
     * keeps `retail_prices` from having an `effective_to`.
     *
     * It exists because 3 packages at 3.7 lb and $8.00 a pound is $29.60, and
     * $29.60 divided by three packages and rounded back up is $29.61. **A till
     * that is a cent wrong in front of the customer holding the note is the one
     * failure `core/till.ts` exists to prevent**, so the money for a weighed
     * line is recorded rather than reconstructed.
     */
    lineTotalCents: bigint("line_total_cents", { mode: "number" }),
    /** The issue that took it off the truck. */
    inventoryMovementId: uuid("inventory_movement_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("retail_sale_lines_tenant_id_id_idx").on(t.tenantId, t.id),
    index("retail_sale_lines_tenant_sale_idx").on(t.tenantId, t.saleId),
    index("retail_sale_lines_tenant_item_idx").on(t.tenantId, t.itemId),
    // ONE MOVEMENT IS ONE LINE, the same rule a production run input follows:
    // two lines against one issue would sell the same stock twice.
    uniqueIndex("retail_sale_lines_movement_idx").on(
      t.tenantId,
      t.inventoryMovementId,
    ),
    foreignKey({
      name: "retail_sale_lines_sale_fk",
      columns: [t.tenantId, t.saleId],
      foreignColumns: [retailSales.tenantId, retailSales.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "retail_sale_lines_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }),
    foreignKey({
      name: "retail_sale_lines_lot_fk",
      columns: [t.tenantId, t.lotId],
      foreignColumns: [inventoryLots.tenantId, inventoryLots.id],
    }),
    foreignKey({
      name: "retail_sale_lines_movement_fk",
      columns: [t.tenantId, t.inventoryMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
    }),
    check("retail_sale_lines_quantity_positive", sql`${t.quantity} > 0`),
    // Free is a real line — a sample, a make-good. Negative is a refund, and a
    // refund is its own sale rather than a line that owes money.
    check(
      "retail_sale_lines_price_not_negative",
      sql`${t.unitPriceCents} >= 0`,
    ),
    // A weighing of nothing is not a weighing. Null is how to say it was sold
    // by the package.
    check(
      "retail_sale_lines_weight_positive",
      sql`${t.weightLb} is null or ${t.weightLb} > 0`,
    ),
    check(
      "retail_sale_lines_total_not_negative",
      sql`${t.lineTotalCents} is null or ${t.lineTotalCents} >= 0`,
    ),
    /**
     * **A WEIGHED LINE MUST CARRY ITS OWN MONEY.** Without the total, the only
     * way back to what was charged is weight × rate re-rounded, which is the
     * cent that makes the receipt disagree with the till. Enforced here because
     * `lineTotalCents` in `core/till.ts` falls back to quantity × price when
     * the total is null, and a weighed line falling into that branch would be
     * silently priced per PACKAGE at a per-POUND rate.
     */
    check(
      "retail_sale_lines_weighed_has_total",
      sql`${t.weightLb} is null or ${t.lineTotalCents} is not null`,
    ),
  ],
);

/**
 * **SOLD OUT OF SOMETHING, AT A TIME.**
 *
 * The design is emphatic that this is the only route by which a lost-revenue
 * event ever enters the system:
 *
 * > Bring 30 dozen eggs, sell 30 dozen. In the sales data that is a perfect day.
 * > **It is a lost-revenue event** — nobody knows how many people wanted eggs at
 * > noon and found none.
 *
 * Nothing can infer it. A sale record cannot distinguish a stall that sold its
 * last dozen at closing time from one that ran dry at eleven and turned people
 * away for four hours, and the two are worth completely different amounts of
 * information about what to bring next week.
 *
 * **UNIQUE PER ITEM PER DAY.** Running out is one fact about one day, and a
 * double-tap should not become two of them.
 */
export const retailStockouts = pgTable(
  "retail_stockouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    marketDayId: uuid("market_day_id").notNull(),
    itemId: uuid("item_id").notNull(),
    /** When it ran out. The whole point — a date would say nothing. */
    noticedAt: timestamp("noticed_at", { withTimezone: true }).notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("retail_stockouts_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("retail_stockouts_unique_target_idx").on(
      t.tenantId,
      t.marketDayId,
      t.itemId,
    ),
    foreignKey({
      name: "retail_stockouts_market_day_fk",
      columns: [t.tenantId, t.marketDayId],
      foreignColumns: [retailMarketDays.tenantId, retailMarketDays.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "retail_stockouts_item_fk",
      columns: [t.tenantId, t.itemId],
      foreignColumns: [inventoryItems.tenantId, inventoryItems.id],
    }),
  ],
);

export type RetailChannel = typeof retailChannels.$inferSelect;
export type NewRetailChannel = typeof retailChannels.$inferInsert;
export type RetailPrice = typeof retailPrices.$inferSelect;
export type NewRetailPrice = typeof retailPrices.$inferInsert;
export type RetailMarketDay = typeof retailMarketDays.$inferSelect;
export type NewRetailMarketDay = typeof retailMarketDays.$inferInsert;
export type RetailSale = typeof retailSales.$inferSelect;
export type NewRetailSale = typeof retailSales.$inferInsert;
export type RetailSaleLine = typeof retailSaleLines.$inferSelect;
export type NewRetailSaleLine = typeof retailSaleLines.$inferInsert;
export type RetailStockout = typeof retailStockouts.$inferSelect;
export type NewRetailStockout = typeof retailStockouts.$inferInsert;
