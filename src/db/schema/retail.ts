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
 *   - **Sales, sale lines, the till and the truck** (slice 1). A market day is
 *     the container; what was sold at it is the next slice, and the design's
 *     offline problem is already solved by the truck being a mobile inventory
 *     location rather than by anything in this pack.
 *   - **Stockouts** — *"sold out of X at time Y"*, the only route by which a
 *     lost-revenue event ever enters the system. It belongs with the till that
 *     records the sales it is the absence of. Slice 1.
 *   - **Payment settlements and fees** (slice 2), through a provider adapter.
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
import { inventoryItems } from "./inventory";

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
  ],
);

export type RetailChannel = typeof retailChannels.$inferSelect;
export type NewRetailChannel = typeof retailChannels.$inferInsert;
export type RetailPrice = typeof retailPrices.$inferSelect;
export type NewRetailPrice = typeof retailPrices.$inferInsert;
export type RetailMarketDay = typeof retailMarketDays.$inferSelect;
export type NewRetailMarketDay = typeof retailMarketDays.$inferInsert;
