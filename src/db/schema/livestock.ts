/**
 * Livestock — the biology on top of an inventory lot.
 *
 * Layer 2a, primitive P4. THIS PACK OWNS ALMOST NOTHING, and that is the point.
 * The design's slice 0 is "lots + head ledger + occupancy", and all three of
 * those already exist:
 *
 *   - the LOT and the HEAD LEDGER are `inventory`'s. Market animals ARE
 *     inventory, head is just a unit of measure, and the head ledger and the
 *     inventory ledger were always the same ledger.
 *   - OCCUPANCY is `land`'s, because rest is computed from it and a pack may
 *     not read another pack's tables.
 *
 * So what is left here is what neither of those could know: **what species it
 * is, when it was born, and what it is called.** Two tables. If that looks thin
 * for the largest pack in the profile, it is the pack model paying for itself —
 * this is the first real test of whether composing beats duplicating, and the
 * answer is two tables instead of six.
 *
 * Slice 1 adds a third, `livestock_daily_logs`, and it is the one thing no
 * neighbour could hold: **the fact that somebody looked.** A ledger records
 * what happened, and a day when nothing happened leaves it empty — which is
 * indistinguishable from a day nobody walked the pens. See the table's own
 * comment; that distinction is what the mortality denominator rests on.
 *
 * Deliberately NOT here, each with a reason rather than an omission:
 *
 *   - **A head count column.** The count is the balance of
 *     `inventory_movements`. A stored counter is a second source of truth that
 *     has to agree with its own history forever.
 *   - **Breeding stock.** A breeding animal is NOT inventory at all — it is a
 *     capital asset on the other side of the balance sheet, and moving between
 *     the two is an accounting event that must POST. That is where this pack
 *     stops being a tracking app, and it needs the posting machinery rather
 *     than a boolean. Slice 4.
 *   - **Breed as fractions**, inbreeding coefficients, sire performance, trait
 *     scores — genetics, slice 4. `breed` is free text until then, which is a
 *     deliberate placeholder and not the model: a single breed string thrown at
 *     a crossbred herd loses information irrecoverably, so nothing is allowed
 *     to compute on it.
 *   - **Health, withdrawal clocks, weights.** Slices 3 and 5. **Weights are why
 *     there is no FCR anywhere in this pack yet**: feed per head is answerable
 *     today, feed per pound of GAIN is not, and inventing a gain figure would
 *     produce the one number the broiler enterprise is judged on out of nothing.
 *   - **A feed quantity or a feed cost on the lot.** Slice 2 adds three tables
 *     for the shared-feeder ALLOCATION and not one number about feed, because
 *     what was fed is already `inventory_movements` — measured when a bag went
 *     to a named pen, allocated when a ton went into a bin serving fifteen.
 */
import { sql } from "drizzle-orm";
import {
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
import { inventoryLots, inventoryMovements } from "./inventory";

/**
 * The biology extension on an inventory lot. One row per lot, always.
 *
 * **Every animal record is a lot, and an individual is a lot of one.** The
 * pilot forces both shapes at once — 10 named cows, 6 pigs as a group, 50
 * layers as a flock, 1,000 broilers as ~14 pens — and modelling individuals and
 * groups as two entities would give every downstream table two code paths and a
 * polymorphic target. As lots there is one target, and "promote the pigs to
 * individuals when the slaughter date is booked" is a SPLIT rather than a
 * migration between models. Most livestock software fails exactly here.
 */
export const livestockLots = pgTable(
  "livestock_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /**
     * The spine. UNIQUE per tenant, so this is strictly a 1:1 extension and
     * there can never be two biologies for one lot.
     *
     * CASCADE: the extension has no meaning without the lot it describes.
     */
    inventoryLotId: uuid("inventory_lot_id").notNull(),
    /**
     * Open taxonomy (P1): 'cattle', 'swine', 'poultry', and whatever a profile
     * supplies. The homestead-farm profile lists three in `packConfig`, which is
     * where the suggestions come from — the pack itself names no species,
     * because a pack that knows what a broiler is has the boundary wrong.
     */
    species: text("species").notNull(),
    /**
     * 'male' | 'female' | 'mixed'. Nullable, and `mixed` is the honest answer
     * for a straight-run batch of chicks rather than a missing value.
     */
    sex: text("sex"),
    /**
     * FREE TEXT, and temporarily so. Homestead cattle are deliberately
     * crossbred for hybrid vigour, so "½ Angus, ¼ Hereford, ¼ Simmental" is the
     * real answer and a single string throws it away irrecoverably. Slice 4
     * replaces this with composition fractions computed from parents; until
     * then nothing is allowed to COMPUTE on this column, only display it.
     */
    breed: text("breed").notNull().default(""),
    /** Hatched, farrowed, calved. Null for stock bought at unknown age. */
    bornOn: date("born_on"),
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
    uniqueIndex("livestock_lots_tenant_id_id_idx").on(t.tenantId, t.id),
    // 1:1 with the spine, enforced rather than assumed.
    uniqueIndex("livestock_lots_tenant_inventory_lot_idx").on(
      t.tenantId,
      t.inventoryLotId,
    ),
    index("livestock_lots_tenant_species_idx").on(t.tenantId, t.species),
    foreignKey({
      name: "livestock_lots_inventory_lot_fk",
      columns: [t.tenantId, t.inventoryLotId],
      foreignColumns: [inventoryLots.tenantId, inventoryLots.id],
    }).onDelete("cascade"),
    check(
      "livestock_lots_species_format",
      sql`${t.species} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "livestock_lots_sex_valid",
      sql`${t.sex} is null or ${t.sex} in ('male', 'female', 'mixed')`,
    ),
  ],
);

/**
 * What an animal is CALLED — and there is never only one answer.
 *
 * A visual tag, possibly an EID/RFID button, possibly an official metal tag.
 * **Tags are lost and replaced while the official ID must persist**, and
 * electronic-ID requirements for interstate movement have been tightening. So:
 * many identifiers per lot, each typed and DATE-RANGED, rather than a column
 * that gets overwritten the first time a tag comes out in a fence.
 *
 * The official one is what carries the traceability chain onto processor
 * paperwork, which is why losing the history would be more than untidy.
 */
export const livestockIdentifiers = pgTable(
  "livestock_identifiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    livestockLotId: uuid("livestock_lot_id").notNull(),
    /**
     * Open taxonomy (P1): 'visual', 'eid', 'official', 'tattoo', 'name'.
     * Format constrained, values never.
     */
    identifierKind: text("identifier_kind").notNull(),
    value: text("value").notNull(),
    appliedOn: date("applied_on"),
    /** Inclusive last day it was on the animal. Null means still current. */
    removedOn: date("removed_on"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("livestock_identifiers_tenant_id_id_idx").on(t.tenantId, t.id),
    index("livestock_identifiers_tenant_lot_idx").on(t.tenantId, t.livestockLotId),
    // Finding an animal BY its tag is the read that happens in a chute, and it
    // is the one that has to be fast.
    index("livestock_identifiers_tenant_value_idx").on(t.tenantId, t.value),
    foreignKey({
      name: "livestock_identifiers_lot_fk",
      columns: [t.tenantId, t.livestockLotId],
      foreignColumns: [livestockLots.tenantId, livestockLots.id],
    }).onDelete("cascade"),
    check(
      "livestock_identifiers_kind_format",
      sql`${t.identifierKind} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "livestock_identifiers_value_present",
      sql`length(btrim(${t.value})) > 0`,
    ),
    check(
      "livestock_identifiers_range_ordered",
      sql`${t.removedOn} is null or ${t.appliedOn} is null or ${t.removedOn} >= ${t.appliedOn}`,
    ),
  ],
);

/**
 * SOMEBODY LOOKED AT THESE ANIMALS TODAY.
 *
 * The whole table exists for one distinction: **"zero died" and "didn't check"
 * are different facts.** Mortality is the number the broiler enterprise is
 * judged on, and its denominator is only trustworthy if the days nothing
 * happened are recorded as days nothing happened rather than as silence. A
 * ledger cannot carry that — `inventory_movements.quantity` is CHECKed
 * non-zero, and rightly so, because a zero-quantity movement is not an event.
 *
 * So the row IS the check. Its presence means a person looked on that date; its
 * absence means nobody did. There is no `checked` boolean, because a row saying
 * `checked = false` would be a record of an absence, which is what absence
 * already is.
 *
 * **What is deliberately NOT a column here: the deaths.** Losses recorded
 * during a round are `inventory_movements` like every other head event, joined
 * to this by lot and date. Land's rule — *anything derivable from a record
 * already being made must never become a second data entry* — applies to
 * storage as well as to forms: a `deaths` column here would be a second number
 * that has to agree with the ledger forever, and the first time they disagreed
 * nobody would know which was right.
 */
export const livestockDailyLogs = pgTable(
  "livestock_daily_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    livestockLotId: uuid("livestock_lot_id").notNull(),
    /** The day that was checked, in the tenant's timezone. */
    loggedOn: date("logged_on").notNull(),
    /**
     * `normal` | `attention`. CLOSED, and only two, because a third would be a
     * severity scale nobody calibrates the same way twice. The notes carry what
     * was seen; this carries whether it needs a person.
     */
    status: text("status").notNull().default("normal"),
    notes: text("notes").notNull().default(""),
    /**
     * Clerk user id of whoever walked the pens. Not an FK — the platform has no
     * users table, and the audit log already carries the same convention.
     */
    recordedBy: text("recorded_by").notNull().default(""),
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
    uniqueIndex("livestock_daily_logs_tenant_id_id_idx").on(t.tenantId, t.id),
    /**
     * ONE CHECK PER LOT PER DAY, enforced. Checking twice is not two facts, and
     * the "all normal" round has to be safe to tap after entering an exception
     * — which it is only because this constraint lets the round insert
     * `ON CONFLICT DO NOTHING` and leave the exception standing.
     */
    uniqueIndex("livestock_daily_logs_tenant_lot_day_idx").on(
      t.tenantId,
      t.livestockLotId,
      t.loggedOn,
    ),
    // "What did we look at today", and "what has this lot's week looked like" —
    // the two reads the log screen makes, one per index.
    index("livestock_daily_logs_tenant_day_idx").on(t.tenantId, t.loggedOn),
    foreignKey({
      name: "livestock_daily_logs_lot_fk",
      columns: [t.tenantId, t.livestockLotId],
      foreignColumns: [livestockLots.tenantId, livestockLots.id],
    }).onDelete("cascade"),
    check(
      "livestock_daily_logs_status_valid",
      sql`${t.status} in ('normal', 'attention')`,
    ),
  ],
);

/**
 * A SHARED FEEDER — a bin, a bulk bag, a trough that serves several pens.
 *
 * **THE ALLOCATION SEAM, and the design calls it the single largest consequence
 * of the 10x target.** At 1x a bag of feed goes to a pen and somebody knows
 * which pen: that is a direct issue, `inventory_movements.issued_to_lot_id`, and
 * it needs nothing here. At 10x feed arrives by the ton into a bin serving ~15
 * pens, and no one will ever know which bird ate which pound. The cost must then
 * be **allocated by head × days on feed rather than assigned**, and both paths
 * have to exist at once because a farm runs bagged starter and bulk grower in
 * the same season.
 *
 * What that means for this table: it holds the FEEDER, not the feed. There is no
 * quantity here, no cost, and no balance — a draw from the bin is an ordinary
 * `inventory` issue and stays the only record of what left. This is the thing
 * the issue was drawn FOR.
 *
 * Deliberately NOT an asset. A storage location is an asset and a bin often is
 * one, but a feeding group is a set of animals sharing a cost, which is a
 * livestock fact: two bins feeding one flock are one group, and one bin split
 * between the broilers and the layers is two.
 */
export const livestockFeedGroups = pgTable(
  "livestock_feed_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** What a person calls it: "Broiler bin", "North trough". */
    name: text("name").notNull(),
    /** `active` | `closed`. Closed keeps reporting; it just stops being offered. */
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
    uniqueIndex("livestock_feed_groups_tenant_id_id_idx").on(t.tenantId, t.id),
    index("livestock_feed_groups_tenant_status_idx").on(t.tenantId, t.status),
    check(
      "livestock_feed_groups_status_valid",
      sql`${t.status} in ('active', 'closed')`,
    ),
    check(
      "livestock_feed_groups_name_present",
      sql`length(btrim(${t.name})) > 0`,
    ),
  ],
);

/**
 * Which lots eat from a feeder, and BETWEEN WHICH DATES.
 *
 * **The dates are the whole reason this is a table rather than a column.** Head
 * on hand is already recorded — the head ledger says how many birds stood in a
 * pen on any day — so head is never re-entered here, following land's rule that
 * anything derivable from a record already being made must not become a second
 * data entry. What the ledger cannot know is *when a pen went onto that bin*: a
 * batch brooded on bagged starter for two weeks before moving to bulk grower has
 * head standing the whole time and is only on the bin for part of it.
 *
 * Date-ranged like `livestock_identifiers` and `land_occupancy`, and for the
 * same reason: an ended membership is history that a report over last season
 * still has to see. `ended_on` is the INCLUSIVE last day, matching land.
 */
export const livestockFeedGroupMembers = pgTable(
  "livestock_feed_group_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    feedGroupId: uuid("feed_group_id").notNull(),
    livestockLotId: uuid("livestock_lot_id").notNull(),
    startedOn: date("started_on").notNull(),
    /** Inclusive last day on the feeder. Null means they are still on it. */
    endedOn: date("ended_on"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("livestock_feed_group_members_tenant_id_id_idx").on(
      t.tenantId,
      t.id,
    ),
    index("livestock_feed_group_members_tenant_group_idx").on(
      t.tenantId,
      t.feedGroupId,
    ),
    index("livestock_feed_group_members_tenant_lot_idx").on(
      t.tenantId,
      t.livestockLotId,
    ),
    foreignKey({
      name: "livestock_feed_group_members_group_fk",
      columns: [t.tenantId, t.feedGroupId],
      foreignColumns: [livestockFeedGroups.tenantId, livestockFeedGroups.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "livestock_feed_group_members_lot_fk",
      columns: [t.tenantId, t.livestockLotId],
      foreignColumns: [livestockLots.tenantId, livestockLots.id],
    }).onDelete("cascade"),
    check(
      "livestock_feed_group_members_range_ordered",
      sql`${t.endedOn} is null or ${t.endedOn} >= ${t.startedOn}`,
    ),
  ],
);

/**
 * A DRAW: this movement out of stock was feed taken for that feeder.
 *
 * **A JOIN, NOT A SECOND LEDGER, and that distinction is the point.** The
 * quantity, the cost, the item, the date and the batch all live where they
 * already live — one row in `inventory_movements`, stamped at the average when
 * it happened exactly as a direct issue is. This table adds the one fact
 * inventory could not hold without knowing what a feeding group is: which
 * feeder the issue was drawn for.
 *
 * That is the same shape `livestock_lots` uses on the spine — inventory owns the
 * quantity, livestock owns what it means — and it is why allocated cost can
 * never disagree with the ledger it came from. Nothing here is summed; the
 * allocation is a fold at read time in `core/feed.ts`.
 *
 * UNIQUE per movement: a draw belongs to one feeder or none. Two would put the
 * same cost in two pots and quietly double the farm's feed bill.
 */
export const livestockFeedDraws = pgTable(
  "livestock_feed_draws",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    feedGroupId: uuid("feed_group_id").notNull(),
    /**
     * The issue this draw is. CASCADE, because the association describes that
     * movement and means nothing without it — though movements are corrected by
     * another movement rather than deleted, so this should never fire.
     */
    inventoryMovementId: uuid("inventory_movement_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("livestock_feed_draws_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("livestock_feed_draws_tenant_movement_idx").on(
      t.tenantId,
      t.inventoryMovementId,
    ),
    index("livestock_feed_draws_tenant_group_idx").on(t.tenantId, t.feedGroupId),
    foreignKey({
      name: "livestock_feed_draws_group_fk",
      columns: [t.tenantId, t.feedGroupId],
      foreignColumns: [livestockFeedGroups.tenantId, livestockFeedGroups.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "livestock_feed_draws_movement_fk",
      columns: [t.tenantId, t.inventoryMovementId],
      foreignColumns: [inventoryMovements.tenantId, inventoryMovements.id],
    }).onDelete("cascade"),
  ],
);

export type LivestockLot = typeof livestockLots.$inferSelect;
export type NewLivestockLot = typeof livestockLots.$inferInsert;
export type LivestockIdentifier = typeof livestockIdentifiers.$inferSelect;
export type LivestockDailyLog = typeof livestockDailyLogs.$inferSelect;
export type LivestockFeedGroup = typeof livestockFeedGroups.$inferSelect;
export type LivestockFeedGroupMember =
  typeof livestockFeedGroupMembers.$inferSelect;
export type LivestockFeedDraw = typeof livestockFeedDraws.$inferSelect;
