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
 * **Points and lines arrived in slice 2b** as `land_features` below — troughs,
 * gates, fences, waterlines, buried cable. A fence is not a boundary, so it is
 * its own table rather than a widened `geometry` column.
 *
 * Deliberately NOT here yet, each because nothing would read it:
 *
 *   - **Centroid** lat/long for weather. Still not a column, and now for a
 *     better reason than "later": it is DERIVED from `geometry` by
 *     `centroid()`, so storing it would be a second copy to keep in step with
 *     a boundary somebody redraws.
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
    /**
     * The boundary, as GeoJSON — a Polygon, or a MultiPolygon for ground split
     * by a road. **jsonb, not PostGIS**, settled in the Land category design:
     * containment is ray casting and area is spherical excess, both trivial for
     * a few hundred polygons, and 10x this farm is still a few hundred. The
     * math lives in `src/packs/land/core/geo.ts`.
     *
     * NULLABLE, and the ordinary state. Ground is usable in this pack with no
     * boundary at all — slice 0 shipped a year of paddock records without one —
     * so this must never become required by the back door.
     *
     * **NOT VALIDATED BY THE DATABASE.** jsonb has no shape constraint, so
     * every reader goes through `asBoundary`, which returns null for anything
     * it cannot read. A CHECK here could only test for a JSON object, which is
     * the part that was never in doubt.
     *
     * `area_acres` above stays the DECLARED figure and is not recomputed from
     * this. They disagree for real reasons — an easement, a creek, a deed
     * written loosely — and which one is right is the farmer's call. The screens
     * report the difference; nothing corrects it.
     */
    geometry: jsonb("geometry"),
    /** Deed reference, lease number, county parcel ID. Free text — every county numbers differently. */
    identifier: text("identifier").notNull().default(""),
    /**
     * How many days of rest this parcel's zones are AIMED at. Nullable, and
     * null is the ordinary state.
     *
     * READ THIS BEFORE ASSUMING IT CONTRADICTS THE DESIGN. Rest is an outcome
     * and is never configured: nothing schedules against this number, nothing
     * nags, and no write path consults it. It exists only so a report can draw
     * a line to compare the measured rest against — and it lives on the PARCEL
     * rather than the tenant because the rest clock is discontinuous across a
     * seasonal migration. A wintering parcel resting 100+ days and a summer
     * parcel on an 11-day cycle are both correct, and a single farm-wide target
     * would flag one of them wrong every time it was looked at.
     */
    restTargetDays: integer("rest_target_days"),
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
    check(
      "land_parcels_rest_target_positive",
      sql`${t.restTargetDays} is null or ${t.restTargetDays} > 0`,
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
    /**
     * The boundary, as GeoJSON — a Polygon, or a MultiPolygon for ground split
     * by a road. **jsonb, not PostGIS**, settled in the Land category design:
     * containment is ray casting and area is spherical excess, both trivial for
     * a few hundred polygons, and 10x this farm is still a few hundred. The
     * math lives in `src/packs/land/core/geo.ts`.
     *
     * NULLABLE, and the ordinary state. Ground is usable in this pack with no
     * boundary at all — slice 0 shipped a year of paddock records without one —
     * so this must never become required by the back door.
     *
     * **NOT VALIDATED BY THE DATABASE.** jsonb has no shape constraint, so
     * every reader goes through `asBoundary`, which returns null for anything
     * it cannot read. A CHECK here could only test for a JSON object, which is
     * the part that was never in doubt.
     *
     * `area_acres` above stays the DECLARED figure and is not recomputed from
     * this. They disagree for real reasons — an easement, a creek, a deed
     * written loosely — and which one is right is the farmer's call. The screens
     * report the difference; nothing corrects it.
     */
    geometry: jsonb("geometry"),
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
    // No `onDelete`, i.e. RESTRICT. A composite FK's *bare* SET NULL would null
    // `tenant_id` too (`drizzle/0192`), and CASCADE would let deleting a parcel
    // silently take its paddocks and their whole use history with it.
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

/**
 * What was actually on a zone, and when. **Fact, as opposed to the intent in
 * `land_zone_uses`.**
 *
 * WHY THIS TABLE IS IN `land` WHEN THE FACT BELONGS TO `livestock` AND `crops`.
 * Those packs ORIGINATE the record — land has no idea what a lot is and must
 * not grow one. But rest is computed FROM occupancy, and
 * docs/extension-model.md §4 forbids a pack reading another pack's tables. So
 * the table lives with the thing that reads it, and the packs that produce the
 * facts write in through `src/packs/land/ops.ts`. Land owns the place and the
 * clock; it stays ignorant of the occupant. Settled 2026-08-15.
 *
 * THE OCCUPANT IS DESCRIBED, NOT JOINED (primitive P3, the `work_item_links`
 * shape). `occupant_label` is a COPY of whatever the owning pack calls it,
 * exactly as `dimension_members.display_name` is a copy — because rendering a
 * rest report must never require a join into a pack that may not be installed.
 * An uninstalled pack's occupancy rows simply keep reporting.
 *
 * `area_acres` IS THE LOAD-BEARING FIELD, and it is what lets one model serve
 * both grazing styles with no branch (ADR 0004). A strip grazer records 0.4 of
 * a 10-acre paddock; a fixed-paddock user records the whole thing. A strip has
 * no persistent identity, so it is an AREA ON THIS EVENT rather than a
 * geometry. Null means the whole zone.
 */
export const landOccupancy = pgTable(
  "land_occupancy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    zoneId: uuid("zone_id").notNull(),
    /**
     * Which feature wrote this — `land` for a hand-entered record, `livestock`
     * once that pack exists. Not a foreign key to anything: a pack can be
     * switched off, and its history must not vanish when it is.
     */
    extensionSlug: text("extension_slug").notNull().default("land"),
    /**
     * Open taxonomy (P1): `manual`, `lot`, `planting`. FORMAT constrained,
     * values never, so a new occupant kind needs no migration to core.
     */
    occupantType: text("occupant_type").notNull().default("manual"),
    /** The owning pack's entity. Null for a hand-entered record, which is the day-one case. */
    occupantId: uuid("occupant_id"),
    /** What to call it on screen. A COPY — see the table comment. */
    occupantLabel: text("occupant_label").notNull(),
    startedOn: date("started_on").notNull(),
    /**
     * Inclusive last day, matching `land_zone_uses`. Null means STILL THERE,
     * and that is what makes a zone read as occupied rather than resting.
     *
     * **The rest clock starts at this date**, which is the one rule that serves
     * both grazing styles: rest is measured from the end of the last occupancy
     * in the zone, whatever shape the occupancy had.
     */
    endedOn: date("ended_on"),
    /** How much of the zone was used. Null means all of it. See the table comment. */
    areaAcres: numeric("area_acres", {
      precision: 12,
      scale: 4,
      mode: "number",
    }),
    /**
     * The structure the occupant is IN, while on this zone. A pen, a barn, a
     * chicken tractor, a greenhouse.
     *
     * **NULL IS A REAL AND COMMON ANSWER, not a missing one.** Cattle roam a
     * paddock with no structure at all; broilers live in a pen that sits on
     * the paddock. Both are ordinary, so the column is nullable and the UI must
     * never imply that a structure was forgotten.
     *
     * IT IS AN ASSET, which is why `land` declares `assets` in `requires`. The
     * design settled this before either pack was built: *"a chicken tractor is
     * an asset (depreciates, needs repair) that holds a lot and sits on a zone
     * with a location history."* A parallel structure table here would be that
     * same row a second time, without the depreciation or the service
     * schedule.
     *
     * On `land_occupancy` rather than on `livestock`, because it generalises:
     * a greenhouse holds a crop planting exactly as a pen holds a flock.
     */
    structureAssetId: uuid("structure_asset_id"),
    notes: text("notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("land_occupancy_tenant_id_id_idx").on(t.tenantId, t.id),
    // Covers both reads that matter: a zone's history, and finding the most
    // recent one to start the rest clock from.
    index("land_occupancy_tenant_zone_idx").on(t.tenantId, t.zoneId, t.startedOn),
    // How `livestock` will find its own rows without scanning the table.
    index("land_occupancy_tenant_occupant_idx").on(
      t.tenantId,
      t.extensionSlug,
      t.occupantId,
    ),
    // "What is in Pen 3" — the read that happens standing in front of it.
    index("land_occupancy_tenant_structure_idx").on(t.tenantId, t.structureAssetId),
    foreignKey({
      name: "land_occupancy_zone_fk",
      columns: [t.tenantId, t.zoneId],
      foreignColumns: [landZones.tenantId, landZones.id],
    }).onDelete("cascade"),
    // Composite, so a structure is always a same-tenant asset. NO onDelete:
    // a composite *bare* SET NULL would null `tenant_id` too (`drizzle/0192`),
    // and removing a pen should require dealing with what is recorded as being
    // in it.
    foreignKey({
      name: "land_occupancy_structure_fk",
      columns: [t.tenantId, t.structureAssetId],
      foreignColumns: [assets.tenantId, assets.id],
    }),
    check(
      "land_occupancy_occupant_type_format",
      sql`${t.occupantType} ~ '^[a-z][a-z0-9_]{0,62}$'`,
    ),
    check(
      "land_occupancy_label_present",
      sql`length(btrim(${t.occupantLabel})) > 0`,
    ),
    check(
      "land_occupancy_range_ordered",
      sql`${t.endedOn} is null or ${t.endedOn} >= ${t.startedOn}`,
    ),
    check(
      "land_occupancy_area_positive",
      sql`${t.areaAcres} is null or ${t.areaAcres} > 0`,
    ),
  ],
);

/**
 * A FEATURE: something on the ground that is not the ground itself.
 *
 * A fence, a gate, a trough, a waterline, a buried cable, a tree line, a barn.
 * **ONE TABLE FOR ALL THREE GEOMETRIES**, because they are one kind of thing —
 * something in a place, with a status — and splitting them into `land_points`
 * and `land_lines` would be two tables of the same nine columns whose only
 * difference is what `geometry` holds. `core/geo.ts` already reads all three.
 *
 * THE THING THIS TABLE DOES NOT HOLD IS THE POST. A fence is ONE row with a
 * post spacing in `attributes`, and its posts are rendered as ticks and counted
 * by dividing — never stored. The rule, from the site-plan design: **a thing
 * earns a row when somebody would say its name out loud, or when another record
 * points at it.** A gate and an energizer do; post #237 does not. Storing the
 * posts would make promoting one proposal a four-hundred-row transaction, and
 * every one of those rows could then disagree with the line it sits on.
 *
 * IT IS ATTACHED TO A PARCEL, NOT TO A ZONE, and that is not an omission. A
 * fence runs BETWEEN paddocks and a lane runs THROUGH them, so a zone_id would
 * force a choice that is wrong for the commonest features on any farm. Which
 * zones a feature touches is a spatial question with a spatial answer —
 * `pointInBoundary` and the geometry — and computing it beats storing a guess.
 */
export const landFeatures = pgTable(
  "land_features",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Composite FK, so a feature is always on same-tenant ground. */
    parcelId: uuid("parcel_id").notNull(),
    /**
     * Open taxonomy (P1): 'fence', 'gate', 'waterline', 'buried_electric',
     * 'tree_line' — and whatever a profile or a tenant needs. FORMAT is
     * constrained so the column stays queryable; VALUES deliberately are not.
     * Same arrangement as `assets.kind` and `land_zone_uses.use`.
     *
     * The pack's own list is in `src/packs/land/core/features.ts` and names no
     * industry (ADR 0004): `trough` and `energizer` are a farm profile's words,
     * contributed through `packConfig.land.featureKinds`, and an unrecognised
     * kind draws with the fallback style for its shape rather than being
     * refused.
     */
    kind: text("kind").notNull(),
    /**
     * Optional, and the emptiness is real rather than lazy. A gate is "the gate
     * at the top of the lane" and gets named; the third run of fence along the
     * road is just fence, and demanding a name for it would produce "Fence 3".
     * Screens fall back to the kind's label.
     */
    name: text("name").notNull().default(""),
    /**
     * `planned`, `built` or `removed`. **THE COLUMN THE WHOLE SLICE TURNS ON.**
     *
     * A proposal and a fact are the same shape, so the difference has to live
     * on the row rather than in a separate plans table that would duplicate the
     * geometry and then drift from it. Promotion is one UPDATE, which is what
     * makes the plan a record instead of a sketchpad.
     *
     * **A PLANNED FEATURE MUST NEVER ANSWER A QUESTION ABOUT WHAT EXISTS.** The
     * sharp case is not a report: it is the phone screen telling somebody
     * standing in a field that there is buried electric under them. A proposal
     * shown as a fact is the map lying about the ground.
     *
     * `removed` rather than a delete, the same rule that retires a sold parcel:
     * a fence that stood for nine years was real, and anything that ever
     * referred to it still has to render.
     */
    status: text("status").notNull().default("built"),
    /**
     * GeoJSON — Point, LineString, MultiLineString, Polygon or MultiPolygon.
     * **Wider than a parcel's `geometry`, which is always an area**, and read
     * through `asFeatureGeometry` rather than `asBoundary`.
     *
     * NULLABLE, and the state means "not drawn yet" rather than "nothing here".
     * A fence you have listed but not traced is a real row with a real name,
     * and it belongs in the list saying it needs drawing. Length renders as an
     * em dash, never as zero — `formatLength` enforces that.
     *
     * **NOT VALIDATED BY THE DATABASE**, same as the boundary columns: jsonb has
     * no shape constraint, so every reader goes through the total parser.
     */
    geometry: jsonb("geometry"),
    /**
     * What the pack knows about this kind of feature: wire count, which strands
     * are hot, post spacing, pipe diameter, burial depth.
     *
     * **A BAG RATHER THAN COLUMNS, BECAUSE THE KINDS ARE OPEN.** A fence has a
     * spacing and a strand count, a waterline has a diameter and a depth, and a
     * tree line has neither. Real columns for each would be a wide sparse table
     * that needs a migration every time a profile invents a kind — which is
     * exactly what the open taxonomy exists to avoid.
     *
     * DISTINCT FROM `metadata` BELOW, and the split is by owner: `attributes`
     * is the PACK's, written by its own forms and read by its own symbology and
     * takeoff; `metadata` is the P2 extension bag, for anything else. One bag
     * shared between them would make a tenant's stray key indistinguishable
     * from a field the pack computes from.
     */
    attributes: jsonb("attributes").notNull().default({}),
    /**
     * The feature that supplies this one. An energizer for a fence run, a well
     * for a waterline.
     *
     * **A POINTER, NOT A GRAPH.** It answers "what feeds this" and "show me
     * everything on the north energizer" — which are the questions people
     * actually ask — with one column and no traversal. Tracing a circuit
     * through junctions is a different feature and waits for somebody standing
     * in front of a dead fence wanting it.
     *
     * Self-referential and composite, so a feature can only be fed by a
     * same-tenant one. NO `onDelete`, i.e. RESTRICT: a composite *bare* SET NULL
     * would null `tenant_id` too (`drizzle/0192`), and removing an energizer
     * ought to require dealing with what is recorded as running off it.
     */
    fedById: uuid("fed_by_id"),
    /**
     * How thick to draw it, in screen pixels. Null means the kind's own weight.
     *
     * **A DRAWING PROPERTY, AND DELIBERATELY NOT IN `attributes`.** That bag
     * holds what is TRUE of a thing — three strands, buried thirty inches — and
     * the takeoff computes from it. A stroke weight is the one value that would
     * mean nothing on the ground, and it must never reach a materials list.
     *
     * Bounded by a CHECK rather than trusted: this arrives from a form, and a
     * line a thousand pixels wide would cover the parcel it is drawn on.
     */
    lineWidth: numeric("line_width", {
      precision: 4,
      scale: 2,
      mode: "number",
    }),
    notes: text("notes").notNull().default(""),
    /** P2 extension bag. See `attributes` above for why they are two columns. */
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("land_features_tenant_id_id_idx").on(t.tenantId, t.id),
    // The map's read: everything on this parcel, drawn at once.
    index("land_features_tenant_parcel_idx").on(t.tenantId, t.parcelId),
    // "Which fences are still only planned", and the list's default filter.
    index("land_features_tenant_status_idx").on(t.tenantId, t.status),
    // "How much fence do we have" — the takeoff's read, and the kind filter.
    index("land_features_tenant_kind_idx").on(t.tenantId, t.kind),
    // "Everything on the north energizer".
    index("land_features_tenant_fed_by_idx").on(t.tenantId, t.fedById),
    // RESTRICT, matching land_zones: deleting a parcel must not silently take
    // every fence, gate and waterline drawn on it.
    foreignKey({
      name: "land_features_parcel_fk",
      columns: [t.tenantId, t.parcelId],
      foreignColumns: [landParcels.tenantId, landParcels.id],
    }),
    foreignKey({
      name: "land_features_fed_by_fk",
      columns: [t.tenantId, t.fedById],
      foreignColumns: [t.tenantId, t.id],
    }),
    check("land_features_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,62}$'`),
    check(
      "land_features_status_valid",
      sql`${t.status} in ('planned', 'built', 'removed')`,
    ),
    // A feature cannot feed itself. The one-row cycle is the only one this
    // column can make on its own, and it is the one a fat finger makes.
    check("land_features_fed_by_not_self", sql`${t.fedById} is distinct from ${t.id}`),
    check(
      "land_features_line_width_range",
      sql`${t.lineWidth} is null or (${t.lineWidth} >= 0.5 and ${t.lineWidth} <= 12)`,
    ),
  ],
);

export type LandParcel = typeof landParcels.$inferSelect;
export type NewLandParcel = typeof landParcels.$inferInsert;
export type LandZone = typeof landZones.$inferSelect;
export type NewLandZone = typeof landZones.$inferInsert;
export type LandZoneUse = typeof landZoneUses.$inferSelect;
export type LandOccupancy = typeof landOccupancy.$inferSelect;
export type NewLandOccupancy = typeof landOccupancy.$inferInsert;
export type LandFeature = typeof landFeatures.$inferSelect;
export type NewLandFeature = typeof landFeatures.$inferInsert;
