/**
 * Land — the substrate every other spatial thing references.
 *
 * Layer 2a, primitive P4 (docs/extension-model.md §4). Same rules as any
 * domain: `tenant_id`, FORCE RLS, isolation coverage. The separation that
 * matters is in `src/packs/`, where the code lives.
 *
 * TWO LEVELS OF PLACE, NOT THREE. A **parcel** is the legal unit — a deed or a
 * lease — and it is also the unit you haul between. A **zone** is the
 * management unit inside it: "North Pasture", "Bed 4". There is deliberately no
 * third level: a polywire strip has no persistent identity (the wire lands
 * somewhere different every time), so a strip is an AREA ON A GRAZING EVENT
 * rather than a geometry. That is what lets one model serve a strip grazer and
 * a fixed-paddock user with no branch, which ADR 0004 requires.
 *
 * INTENT AND FACT ARE SEPARATE, and conflating them is why most farm software
 * does one of them badly:
 *
 *   - **Intent** is `land_zone_uses` — "North Pasture is hay ground this year".
 *     Dated, because this year's corn field is next year's pasture and the
 *     history is what makes rotation reporting possible. It exists BEFORE
 *     anything happens; it is what you budget against.
 *   - **Fact** is occupancy — what was actually on the ground, and when. That
 *     is slice 1. `land` owns the table because rest is computed from it and a
 *     pack may not read another pack's tables, but `livestock` and `crops` are
 *     what write into it.
 *
 * Deliberately NOT here yet, each because nothing would read it:
 *
 *   - **Geometry** (GeoJSON in jsonb, containment and area in JS — settled, no
 *     PostGIS). Slice 2, with points and lines as well as polygons.
 *   - **Centroid** lat/long for weather. It is derivable from geometry, so it
 *     arrives with the slice that has geometry to derive it from rather than as
 *     two columns nobody fills in.
 *   - **Lease terms**, renewals and rent. `tenure` is here NOW because profit
 *     per acre computes differently on rented ground and retrofitting it means
 *     rewriting the report; the screens wait for a tenant who actually rents.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
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

/**
 * A parcel: the legal/tenure unit. A deed, a lease, a handshake.
 *
 * Changes over years rather than seasons, which is the practical difference
 * from a zone. It is also the unit of MIGRATION — the pilot farm winters cattle
 * on one parcel and trailers them to another for summer — so "which parcel" is
 * what makes a rest clock discontinuous rather than farm-wide.
 */
export const landParcels = pgTable(
  "land_parcels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * CLOSED SET, unlike `assets.kind`, and the difference is deliberate.
     *
     * A kind is vocabulary — words for the same shape, supplied by whoever
     * installs a profile. Tenure is not vocabulary: each value BOOKS
     * DIFFERENTLY. Rent on leased ground is an expense; a crop share is a
     * revenue split, not an expense at all, and the landlord taking a third of
     * the crop never appears as a payment. A fourth value with no defined
     * accounting behaviour would be worse than a refusal, so there is no
     * free-text escape here.
     *
     * "Handshake" ground is `leased` with no lease document — the arrangement
     * is informal, the accounting is not.
     */
    tenure: text("tenure").notNull().default("owned"),
    /**
     * Area, in ACRES, and the unit is baked into the column name on purpose.
     *
     * Something has to be canonical or a farm with one parcel in acres and one
     * in hectares cannot be totalled, and a unit column would make every
     * consumer convert before it could add. Acres is the canonical store;
     * `packConfig.land.areaUnit` is a DISPLAY and ENTRY unit, converted at the
     * edge in `src/packs/land/core/area.ts`. US-only geodata is confirmed
     * acceptable for this profile.
     *
     * Nullable, and its absence is a real state: plenty of ground has never
     * been surveyed and "unknown" must not read as zero — a zero would silently
     * divide by nothing in every per-acre figure. Four decimals is ~0.4 m².
     */
    areaAcres: numeric("area_acres", {
      precision: 12,
      scale: 4,
      mode: "number",
    }),
    /** Deed reference, lease number, county parcel ID. Free text — every county numbers differently. */
    identifier: text("identifier").notNull().default(""),
    /**
     * `active` or `retired`. Sold, or a lease that ended.
     *
     * A status, never a delete — ground that carried cost and revenue for six
     * years does not stop having done so when it is sold, and every journal
     * line tagged with it still has to report.
     */
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
    // Target for the composite FK from land_zones, and for anything a later
    // pack needs to hang off a parcel without losing tenant agreement.
    uniqueIndex("land_parcels_tenant_id_id_idx").on(t.tenantId, t.id),
    index("land_parcels_tenant_status_idx").on(t.tenantId, t.status),
    check("land_parcels_name_present", sql`length(btrim(${t.name})) > 0`),
    check(
      "land_parcels_tenure_valid",
      sql`${t.tenure} in ('owned', 'leased', 'crop_share')`,
    ),
    check(
      "land_parcels_status_valid",
      sql`${t.status} in ('active', 'retired')`,
    ),
    check(
      "land_parcels_area_positive",
      sql`${t.areaAcres} is null or ${t.areaAcres} > 0`,
    ),
  ],
);

/**
 * A zone: the management unit. A paddock, a bed, a field, a woodlot.
 *
 * Changes seasonally, which is why its USE is a dated history in its own table
 * rather than a column here. A zone with a `use` column would lose the fact
 * that made rotation reporting possible the first time somebody edited it.
 */
export const landZones = pgTable(
  "land_zones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Composite FK, so a zone is always inside a same-tenant parcel. */
    parcelId: uuid("parcel_id").notNull(),
    name: text("name").notNull(),
    /** Acres, same canonical unit and same nullable-means-unknown rule as the parcel. */
    areaAcres: numeric("area_acres", {
      precision: 12,
      scale: 4,
      mode: "number",
    }),
    status: text("status").notNull().default("active"),
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
    uniqueIndex("land_zones_tenant_id_id_idx").on(t.tenantId, t.id),
    index("land_zones_tenant_parcel_idx").on(t.tenantId, t.parcelId),
    index("land_zones_tenant_status_idx").on(t.tenantId, t.status),
    // No `onDelete`, i.e. RESTRICT. A composite FK's SET NULL would null
    // `tenant_id` too, and CASCADE would let deleting a parcel silently take
    // its paddocks and their whole use history with it.
    foreignKey({
      name: "land_zones_parcel_fk",
      columns: [t.tenantId, t.parcelId],
      foreignColumns: [landParcels.tenantId, landParcels.id],
    }),
    check("land_zones_name_present", sql`length(btrim(${t.name})) > 0`),
    check("land_zones_status_valid", sql`${t.status} in ('active', 'retired')`),
    check(
      "land_zones_area_positive",
      sql`${t.areaAcres} is null or ${t.areaAcres} > 0`,
    ),
  ],
);

/**
 * What a zone is FOR, over a date range. Dated intent, never a column.
 *
 * `ended_on` IS INCLUSIVE — the last day the use applied. A use that starts and
 * ends on the same day is one day long. This is stated loudly because the
 * repo has been bitten by an exclusive bound before (`after` on Stalwart), and
 * because the ops layer closes a superseded use by setting `ended_on` to the
 * day BEFORE the new one starts, which only reads correctly if the bound is
 * inclusive.
 *
 * `ended_on = null` means current. There is at most one open use per zone;
 * `startZoneUse` closes the previous one in the same transaction.
 */
export const landZoneUses = pgTable(
  "land_zone_uses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    zoneId: uuid("zone_id").notNull(),
    /**
     * Open taxonomy (P1): 'pasture', 'hay', 'crop', 'garden', 'woodlot',
     * 'lane' — and whatever a profile or a tenant needs. FORMAT is constrained
     * so the column stays queryable; VALUES deliberately are not, so a new use
     * never needs a migration to core. Same arrangement as `assets.kind`.
     */
    use: text("use").notNull(),
    /**
     * Whether ground under this use is expected to earn.
     *
     * A woodlot, a house site, a yard and a lane carry tax and interest and
     * return nothing, and including them makes every farm look broken. It is a
     * COLUMN rather than a lookup against the use because the taxonomy is open:
     * the pack cannot know whether a use it has never heard of is productive,
     * and guessing would be a closed set wearing an open column's clothes.
     * `src/packs/land/vocabulary.ts` supplies a default for the uses it knows.
     */
    isProductive: boolean("is_productive").notNull().default(true),
    startedOn: date("started_on").notNull(),
    /** Inclusive last day. Null means current — see the table comment. */
    endedOn: date("ended_on"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("land_zone_uses_tenant_id_id_idx").on(t.tenantId, t.id),
    index("land_zone_uses_tenant_zone_idx").on(t.tenantId, t.zoneId, t.startedOn),
    // CASCADE here, unlike the zone→parcel FK: a use has no meaning without
    // its zone, and a zone can only be deleted when nothing points at it.
    foreignKey({
      name: "land_zone_uses_zone_fk",
      columns: [t.tenantId, t.zoneId],
      foreignColumns: [landZones.tenantId, landZones.id],
    }).onDelete("cascade"),
    check("land_zone_uses_use_format", sql`${t.use} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check(
      "land_zone_uses_range_ordered",
      sql`${t.endedOn} is null or ${t.endedOn} >= ${t.startedOn}`,
    ),
  ],
);

export type LandParcel = typeof landParcels.$inferSelect;
export type NewLandParcel = typeof landParcels.$inferInsert;
export type LandZone = typeof landZones.$inferSelect;
export type NewLandZone = typeof landZones.$inferInsert;
export type LandZoneUse = typeof landZoneUses.$inferSelect;
