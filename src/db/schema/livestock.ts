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
 *   - **Health, withdrawal clocks, weights, feed.** Slices 2, 3 and 5.
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
import { inventoryLots } from "./inventory";

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

export type LivestockLot = typeof livestockLots.$inferSelect;
export type NewLivestockLot = typeof livestockLots.$inferInsert;
export type LivestockIdentifier = typeof livestockIdentifiers.$inferSelect;
