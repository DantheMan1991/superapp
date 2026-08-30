import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import { takeoffFor, totalsOf } from "../src/packs/land/core/takeoff";
import {
  asBoundary,
  asFeatureGeometry,
  boundaryAreaAcres,
  geometryLengthM,
  type Boundary,
  type FeatureGeometry,
} from "../src/packs/land/core/geo";
import {
  LandError,
  PARCEL_DIMENSION,
  ZONE_DIMENSION,
  combineParcels,
  completedStayDays,
  activateZone,
  addPlanItem,
  createFeature,
  createPlan,
  deletePlan,
  createParcel,
  createZone,
  currentUses,
  deleteFeature,
  deleteOccupancy,
  getFeature,
  getPlan,
  layoutPaddocks,
  listFeatures,
  listPlanItems,
  saveTakeoff,
  setFeaturePlan,
  setFeatureGeometry,
  setFeatureStatus,
  updateFeature,
  endOccupancy,
  endZoneUse,
  listOccupancy,
  listStructures,
  moveOccupant,
  restByZone,
  startOccupancy,
  getParcel,
  getZone,
  listParcels,
  listZoneUses,
  listZones,
  retireParcel,
  retireZone,
  setParcelBoundary,
  setZoneBoundary,
  zoneAtPoint,
  startZoneUse,
  updateParcel,
  updateZone,
  usesByZone,
  zoneCountsByParcel,
  type LandCtx,
} from "../src/packs/land/ops";

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

/**
 * The ops behind the `land` pack.
 *
 * `tests/isolation/land.test.ts` deliberately builds its fixtures under
 * `withSystem`, because that suite certifies what the DATABASE enforces and
 * routing setup through this file would let a bug here make those tests agree
 * with it. The consequence — the same one `assets` found the hard way — is that
 * the pack's CENTRAL CLAIM, that a parcel and a zone become cost objects, is
 * covered by nothing except this file.
 *
 * Tested at the op rather than through the action, because an action's other
 * half is `requireTenant()` and a Clerk session, and what is worth certifying
 * here is the rules rather than the framework.
 */
d("land ops", () => {
  const STAMP = `landops-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const STAFF = `${STAMP}-staff`;

  let tenantId: string;

  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const ownerCtx = (): LandCtx => ({ tenantId, userId: OWNER, role: "owner" });
  const staffCtx = (): LandCtx => ({ tenantId, userId: STAFF, role: "staff" });

  /** A fresh parcel, so tests never depend on each other's rows. */
  const newParcel = (name: string, area: number | null = 100) =>
    asOwner((tx) => createParcel(tx, ownerCtx(), { name, areaAcres: area }));

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const rows = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `${STAMP}-org`,
          name: "Land Ops",
          slug: `${STAMP}-slug`,
        })
        .returning();
      tenantId = rows[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  const membersOf = (dimensionType: string) =>
    asOwner((tx) =>
      tx.query.dimensionMembers.findMany({
        where: and(
          eq(schema.dimensionMembers.tenantId, tenantId),
          eq(schema.dimensionMembers.dimensionType, dimensionType),
        ),
      }),
    );

  // ---- the claim the whole pack rests on -------------------------------

  it("creating a parcel makes it a cost object in the same transaction", async () => {
    const parcel = await newParcel("Home Farm");
    const members = await membersOf(PARCEL_DIMENSION);
    const member = members.find((m) => m.packEntityId === parcel.id);
    expect(member).toBeDefined();
    expect(member?.displayName).toBe("Home Farm");
    expect(member?.isActive).toBe(true);
  });

  it("creates a zone WITH its outline, in one act", async () => {
    // Before 2026-08-29 creating a paddock and giving it a shape were two steps
    // in two places — and once the zone page lost its map there was no second
    // step at all for one created by hand. It could only be given a shape by
    // pasting GeoJSON.
    const parcel = await newParcel("Drawn At Birth");
    const outline: Boundary = {
      type: "Polygon",
      coordinates: [
        [
          [-82.48, 40.4],
          [-82.479, 40.4],
          [-82.479, 40.401],
          [-82.48, 40.401],
          [-82.48, 40.4],
        ],
      ],
    };
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), {
        parcelId: parcel.id,
        name: "Walked It",
        geometry: outline,
      }),
    );
    expect(asBoundary(zone.geometry)).not.toBeNull();
    // **THE DRAWN ACREAGE IS THE RECORDED ACREAGE** — the layout's rule, and
    // the one place this pack departs from declared-versus-computed.
    expect(zone.areaAcres).toBeCloseTo(boundaryAreaAcres(outline), 3);
  });

  it("lets a typed acreage win over the drawn one", async () => {
    // Somebody typing a figure means it; the drawing only fills a gap.
    const parcel = await newParcel("Typed Wins");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), {
        parcelId: parcel.id,
        name: "Says Ten",
        areaAcres: 10,
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-82.48, 40.4],
              [-82.479, 40.4],
              [-82.479, 40.401],
              [-82.48, 40.4],
            ],
          ],
        },
      }),
    );
    expect(zone.areaAcres).toBe(10);
  });

  it("refuses an outline it cannot read, in the parser's own words", async () => {
    const parcel = await newParcel("Bad Outline");
    await expect(
      asOwner((tx) =>
        createZone(tx, ownerCtx(), {
          parcelId: parcel.id,
          name: "Nonsense",
          geometry: { type: "LineString", coordinates: [[-82.48, 40.4]] },
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_GEOMETRY" });
  });

  it("creating a zone makes it a SEPARATE kind of cost object", async () => {
    // Two dimension types, not one. Rent attaches to the deed; mowing attaches
    // to the paddock, and a report about paddocks must not carry deed rows.
    const parcel = await newParcel("Two Types");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), {
        parcelId: parcel.id,
        name: "North Pasture",
        areaAcres: 10,
      }),
    );

    const zoneMembers = await membersOf(ZONE_DIMENSION);
    const parcelMembers = await membersOf(PARCEL_DIMENSION);
    expect(zoneMembers.some((m) => m.packEntityId === zone.id)).toBe(true);
    expect(parcelMembers.some((m) => m.packEntityId === zone.id)).toBe(false);
    expect(zoneMembers.some((m) => m.packEntityId === parcel.id)).toBe(false);
  });

  it("a failed parcel write rolls its cost object back", async () => {
    let created: string | undefined;
    await expect(
      asOwner(async (tx) => {
        const parcel = await createParcel(tx, ownerCtx(), {
          name: "Doomed",
          areaAcres: 5,
        });
        created = parcel.id;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(created).toBeDefined();
    const members = await membersOf(PARCEL_DIMENSION);
    // The whole reason ops take a Tx: a cost object must never point at a row
    // that was rolled back.
    expect(members.some((m) => m.packEntityId === created)).toBe(false);
  });

  it("renaming a parcel renames its cost object", async () => {
    const parcel = await newParcel("Old Name");
    await asOwner((tx) =>
      updateParcel(tx, ownerCtx(), parcel.id, { name: "New Name" }),
    );
    const members = await membersOf(PARCEL_DIMENSION);
    expect(
      members.find((m) => m.packEntityId === parcel.id)?.displayName,
    ).toBe("New Name");
  });

  it("renaming a zone renames its cost object", async () => {
    const parcel = await newParcel("Rename Zone");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Paddock 1" }),
    );
    await asOwner((tx) =>
      updateZone(tx, ownerCtx(), zone.id, { name: "Paddock One" }),
    );
    const members = await membersOf(ZONE_DIMENSION);
    expect(members.find((m) => m.packEntityId === zone.id)?.displayName).toBe(
      "Paddock One",
    );
  });

  it("an update that does not touch the name leaves the cost object alone", async () => {
    const parcel = await newParcel("Untouched");
    await asOwner((tx) =>
      updateParcel(tx, ownerCtx(), parcel.id, { notes: "gate is stiff" }),
    );
    const members = await membersOf(PARCEL_DIMENSION);
    expect(
      members.find((m) => m.packEntityId === parcel.id)?.displayName,
    ).toBe("Untouched");
  });

  // ---- role ------------------------------------------------------------

  it("refuses a staff write on every entity the FARM is made of", async () => {
    // Land's shape is a decision — a parcel is a deed, a zone is a fence, a
    // use is what the ground is for this season. None of it is a chore, and
    // all of it carries a cost object. See src/lib/packs/authorize.ts.
    const parcel = await newParcel("Owner Only");
    await expect(
      asOwner((tx) =>
        createParcel(tx, staffCtx(), { name: "Nope", areaAcres: 1 }),
      ),
    ).rejects.toThrow(LandError);
    await expect(
      asOwner((tx) =>
        createZone(tx, staffCtx(), { parcelId: parcel.id, name: "Nope" }),
      ),
    ).rejects.toThrow(LandError);
    await expect(
      asOwner((tx) =>
        updateParcel(tx, staffCtx(), parcel.id, { name: "Nope" }),
      ),
    ).rejects.toThrow(LandError);
    await expect(
      asOwner((tx) => retireParcel(tx, staffCtx(), parcel.id)),
    ).rejects.toThrow(LandError);
  });

  // ---- validation ------------------------------------------------------

  it("refuses a tenure it has no accounting behaviour for", async () => {
    await expect(
      asOwner((tx) =>
        createParcel(tx, ownerCtx(), { name: "Handshake", tenure: "handshake" }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_TENURE" });
  });

  it("refuses a zone on a parcel that does not exist", async () => {
    await expect(
      asOwner((tx) =>
        createZone(tx, ownerCtx(), {
          parcelId: "00000000-0000-0000-0000-000000000000",
          name: "Orphan",
        }),
      ),
    ).rejects.toMatchObject({ code: "PARCEL_INVALID" });
  });

  it("refuses a malformed use", async () => {
    const parcel = await newParcel("Bad Use");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    await expect(
      asOwner((tx) =>
        startZoneUse(tx, ownerCtx(), zone.id, {
          use: "Hay Ground",
          startedOn: "2026-04-01",
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_USE" });
  });

  it("accepts a use nobody anticipated, because the taxonomy is open", async () => {
    const parcel = await newParcel("Open Taxonomy");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    const use = await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "silvopasture",
        startedOn: "2026-04-01",
      }),
    );
    expect(use.use).toBe("silvopasture");
    // Unknown uses default to productive — leaving real ground out of a
    // per-acre figure is a quieter error than counting a lane in.
    expect(use.isProductive).toBe(true);
  });

  // ---- the use timeline ------------------------------------------------

  it("a new use closes the previous one the day BEFORE it starts", async () => {
    const parcel = await newParcel("Timeline");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "North" }),
    );

    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "crop",
        startedOn: "2025-04-01",
      }),
    );
    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "pasture",
        startedOn: "2026-04-01",
      }),
    );

    const history = await asOwner((tx) =>
      listZoneUses(tx, tenantId, zone.id),
    );
    expect(history).toHaveLength(2);
    const [newest, oldest] = history;
    expect(newest.use).toBe("pasture");
    expect(newest.endedOn).toBeNull();
    expect(oldest.use).toBe("crop");
    // `ended_on` is INCLUSIVE, so the ranges abut with no gap and no overlap.
    // An exclusive bound here would leave 2026-03-31 belonging to nothing.
    expect(oldest.endedOn).toBe("2026-03-31");
  });

  it("a correction replaces a use that never elapsed instead of closing it", async () => {
    const parcel = await newParcel("Correction");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Bed 4" }),
    );

    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "hay",
        startedOn: "2026-05-01",
      }),
    );
    // Same day, entered by mistake minutes ago. Closing it would need an
    // ended_on before its own started_on, which the range CHECK rightly
    // refuses — and there is no history to lose.
    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "garden",
        startedOn: "2026-05-01",
      }),
    );

    const history = await asOwner((tx) => listZoneUses(tx, tenantId, zone.id));
    expect(history).toHaveLength(1);
    expect(history[0].use).toBe("garden");
    expect(history[0].endedOn).toBeNull();
  });

  it("a use starting AFTER an open one supersedes it rather than being deleted", async () => {
    const parcel = await newParcel("Forward");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "South" }),
    );
    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "pasture",
        startedOn: "2026-05-01",
      }),
    );
    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "hay",
        startedOn: "2026-05-02",
      }),
    );
    const history = await asOwner((tx) => listZoneUses(tx, tenantId, zone.id));
    expect(history).toHaveLength(2);
    expect(history[1].endedOn).toBe("2026-05-01");
  });

  it("carries the productive default of a known use, and takes an override", async () => {
    const parcel = await newParcel("Productive");
    const lane = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Lane" }),
    );
    const wood = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Woodlot" }),
    );

    const laneUse = await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), lane.id, {
        use: "lane",
        startedOn: "2026-01-01",
      }),
    );
    expect(laneUse.isProductive).toBe(false);

    const woodUse = await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), wood.id, {
        use: "woodlot",
        startedOn: "2026-01-01",
        isProductive: false,
      }),
    );
    // The tenant is allowed to disagree with the pack's default.
    expect(woodUse.isProductive).toBe(false);
  });

  it("gives at most one current use per zone", async () => {
    const parcel = await newParcel("Current");
    const a = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "A" }),
    );
    const b = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "B" }),
    );
    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), a.id, {
        use: "crop",
        startedOn: "2025-04-01",
      }),
    );
    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), a.id, {
        use: "pasture",
        startedOn: "2026-04-01",
      }),
    );

    const map = await asOwner((tx) => currentUses(tx, tenantId, [a.id, b.id]));
    expect(map.get(a.id)?.use).toBe("pasture");
    // A zone with no declared use is absent, not defaulted to something.
    expect(map.has(b.id)).toBe(false);
  });

  it("returns nothing for an empty zone list without querying", async () => {
    const map = await asOwner((tx) => currentUses(tx, tenantId, []));
    expect(map.size).toBe(0);
    const history = await asOwner((tx) => usesByZone(tx, tenantId, []));
    expect(history.size).toBe(0);
  });

  it("ends a use without starting another", async () => {
    const parcel = await newParcel("Ended");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Fallow" }),
    );
    const use = await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "crop",
        startedOn: "2026-04-01",
      }),
    );
    await asOwner((tx) =>
      endZoneUse(tx, ownerCtx(), use.id, "2026-10-31"),
    );
    const map = await asOwner((tx) => currentUses(tx, tenantId, [zone.id]));
    expect(map.has(zone.id)).toBe(false);
  });

  it("refuses to end a use before it started", async () => {
    const parcel = await newParcel("Backwards");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    const use = await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "crop",
        startedOn: "2026-04-01",
      }),
    );
    await expect(
      asOwner((tx) => endZoneUse(tx, ownerCtx(), use.id, "2026-03-01")),
    ).rejects.toMatchObject({ code: "DATE_ORDER" });
  });

  // ---- retirement ------------------------------------------------------

  it("retiring a parcel retires its zones and archives every cost object", async () => {
    const parcel = await newParcel("Sold Ground");
    const one = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "One" }),
    );
    const two = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Two" }),
    );

    const result = await asOwner((tx) =>
      retireParcel(tx, ownerCtx(), parcel.id),
    );
    expect(result.zonesRetired).toBe(2);
    expect(result.parcel.status).toBe("retired");

    const zones = await asOwner((tx) =>
      listZones(tx, tenantId, { parcelId: parcel.id }),
    );
    expect(zones.every((z) => z.status === "retired")).toBe(true);

    // ARCHIVED, NOT DELETED. An archived member stops being taggable while
    // every existing tag keeps reporting — ground that cost money for six
    // years does not stop having done so when it is sold.
    const parcelMembers = await membersOf(PARCEL_DIMENSION);
    const zoneMembers = await membersOf(ZONE_DIMENSION);
    expect(
      parcelMembers.find((m) => m.packEntityId === parcel.id)?.isActive,
    ).toBe(false);
    for (const id of [one.id, two.id]) {
      expect(zoneMembers.find((m) => m.packEntityId === id)?.isActive).toBe(
        false,
      );
    }
    // The rows are still there. Retirement is a status, never a delete.
    expect(await asOwner((tx) => getParcel(tx, tenantId, parcel.id))).not.toBeNull();
    expect(await asOwner((tx) => getZone(tx, tenantId, one.id))).not.toBeNull();
  });

  it("retiring a zone closes whatever it was currently for", async () => {
    const parcel = await newParcel("Close Use");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Gone" }),
    );
    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "pasture",
        startedOn: "2026-04-01",
      }),
    );

    await asOwner((tx) =>
      retireZone(tx, ownerCtx(), zone.id, "2026-08-15"),
    );

    const history = await asOwner((tx) => listZoneUses(tx, tenantId, zone.id));
    expect(history[0].endedOn).toBe("2026-08-15");
  });

  it("retiring a zone on the day its use started does not break the range CHECK", async () => {
    // The awkward one: a paddock created and retired the same day would need
    // an ended_on before its own started_on. The use is left open rather than
    // failing the whole retirement over a date nobody cares about.
    const parcel = await newParcel("Same Day");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Brief" }),
    );
    await asOwner((tx) =>
      startZoneUse(tx, ownerCtx(), zone.id, {
        use: "pasture",
        startedOn: "2026-09-01",
      }),
    );

    const zoneRow = await asOwner((tx) =>
      retireZone(tx, ownerCtx(), zone.id, "2026-08-15"),
    );
    expect(zoneRow.status).toBe("retired");
  });

  it("retiring a parcel with no zones is not an error", async () => {
    const parcel = await newParcel("Bare");
    const result = await asOwner((tx) =>
      retireParcel(tx, ownerCtx(), parcel.id),
    );
    expect(result.zonesRetired).toBe(0);
  });

  // ---- moving and listing ----------------------------------------------

  it("moves a zone between parcels", async () => {
    const from = await newParcel("From");
    const to = await newParcel("To");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: from.id, name: "Mover" }),
    );
    const moved = await asOwner((tx) =>
      updateZone(tx, ownerCtx(), zone.id, { parcelId: to.id }),
    );
    expect(moved.parcelId).toBe(to.id);
  });

  it("refuses to move a zone onto a parcel that does not exist", async () => {
    const parcel = await newParcel("Stay Put");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Fixed" }),
    );
    await expect(
      asOwner((tx) =>
        updateZone(tx, ownerCtx(), zone.id, {
          parcelId: "00000000-0000-0000-0000-000000000000",
        }),
      ),
    ).rejects.toMatchObject({ code: "PARCEL_INVALID" });
  });

  it("counts only active zones per parcel", async () => {
    const parcel = await newParcel("Counted");
    const keep = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Keep" }),
    );
    const drop = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Drop" }),
    );
    expect(
      (await asOwner((tx) => zoneCountsByParcel(tx, tenantId))).get(parcel.id),
    ).toBe(2);

    await asOwner((tx) => retireZone(tx, ownerCtx(), drop.id));
    expect(
      (await asOwner((tx) => zoneCountsByParcel(tx, tenantId))).get(parcel.id),
    ).toBe(1);
    expect(keep.status).toBe("active");
  });

  it("filters parcels by status", async () => {
    const parcel = await newParcel("Filterable");
    await asOwner((tx) => retireParcel(tx, ownerCtx(), parcel.id));
    const active = await asOwner((tx) =>
      listParcels(tx, tenantId, { status: "active" }),
    );
    expect(active.some((p) => p.id === parcel.id)).toBe(false);
    const all = await asOwner((tx) => listParcels(tx, tenantId));
    expect(all.some((p) => p.id === parcel.id)).toBe(true);
  });

  it("keeps an unmeasured area as null rather than defaulting it to zero", async () => {
    const parcel = await newParcel("Unmeasured", null);
    const fetched = await asOwner((tx) => getParcel(tx, tenantId, parcel.id));
    expect(fetched?.areaAcres).toBeNull();
  });

  // ---- occupancy -------------------------------------------------------

  it("records a stay a person typed, before any pack exists to write one", async () => {
    // The day-one case, and the reason slice 1 is usable before `livestock`.
    const parcel = await newParcel("Occupied");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Paddock 1" }),
    );
    const stay = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-01",
      }),
    );
    expect(stay.extensionSlug).toBe("land");
    expect(stay.occupantType).toBe("manual");
    expect(stay.occupantId).toBeNull();
    expect(stay.endedOn).toBeNull();
    // Null means the whole zone — the fixed-paddock case.
    expect(stay.areaAcres).toBeNull();
  });

  it("takes the shape another pack will write", async () => {
    // `livestock` passes its own slug, type and entity id through the same op.
    // Land never learns what a lot is.
    const parcel = await newParcel("Pack Written");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Paddock 2" }),
    );
    const lotId = "11111111-2222-3333-4444-555555555555";
    const stay = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Lot 14 — 68 broilers",
        startedOn: "2026-08-01",
        extensionSlug: "livestock",
        occupantType: "lot",
        occupantId: lotId,
      }),
    );
    expect(stay.extensionSlug).toBe("livestock");
    expect(stay.occupantId).toBe(lotId);
    // The label is a COPY, so a rest report never needs a join into a pack
    // that may not be installed.
    expect(stay.occupantLabel).toBe("Lot 14 — 68 broilers");
  });

  it("records a strip as an area on the stay, not as a place", async () => {
    const parcel = await newParcel("Strip");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), {
        parcelId: parcel.id,
        name: "North",
        areaAcres: 10,
      }),
    );
    const stay = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-01",
        endedOn: "2026-08-01",
        areaAcres: 0.4,
      }),
    );
    expect(stay.areaAcres).toBe(0.4);
    // No new zone was created for the strip. That is the whole point.
    expect(
      await asOwner((tx) => listZones(tx, tenantId, { parcelId: parcel.id })),
    ).toHaveLength(1);
  });

  it("ALLOWS several occupants on one zone at the same time", async () => {
    // Corrected 2026-08-15. This first refused a second open stay on a zone,
    // reasoning that two would make rest unanswerable. Both halves were wrong:
    // `zoneRest` takes the LATEST end date across every span, and a paddock
    // really does carry several occupants at once — the pilot runs multiple
    // chicken tractors on one paddock, and the eggmobile follows the cattle
    // onto ground they are still grazing.
    const parcel = await newParcel("Shared Ground");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Busy" }),
    );
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-01",
        occupantType: "lot",
        occupantId: "11111111-1111-1111-1111-111111111111",
      }),
    );
    const second = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Layer flock",
        startedOn: "2026-08-05",
        occupantType: "lot",
        occupantId: "22222222-2222-2222-2222-222222222222",
      }),
    );
    expect(second.occupantLabel).toBe("Layer flock");

    // And the zone reads as occupied, once, rather than being confused by two.
    const rest = await asOwner((tx) =>
      restByZone(tx, tenantId, [zone.id], "2026-08-15"),
    );
    expect(rest.get(zone.id)?.status).toBe("occupied");
  });

  it("refuses the SAME occupant being put somewhere twice", async () => {
    // That is a data mistake rather than a farming arrangement: a lot cannot be
    // on two paddocks at once, and recording it means the first move was never
    // closed.
    const parcel = await newParcel("Double Booked");
    const a = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "A" }),
    );
    const b = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "B" }),
    );
    const lotId = "33333333-3333-3333-3333-333333333333";
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), a.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-01",
        extensionSlug: "livestock",
        occupantType: "lot",
        occupantId: lotId,
      }),
    );
    await expect(
      asOwner((tx) =>
        startOccupancy(tx, ownerCtx(), b.id, {
          occupantLabel: "Cow herd",
          startedOn: "2026-08-05",
          extensionSlug: "livestock",
          occupantType: "lot",
          occupantId: lotId,
        }),
      ),
    ).rejects.toMatchObject({ code: "ALREADY_OCCUPIED" });
  });

  it("exempts hand-entered records, which have no identity to compare", async () => {
    // A typed name is not an identity, and a wrong record can simply be
    // removed. Refusing here would block the day-one manual path for no gain.
    const parcel = await newParcel("Manual Twice");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-01",
      }),
    );
    const second = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-02",
      }),
    );
    expect(second.id).toBeTruthy();
  });

  it("allows a CLOSED stay alongside an open one", async () => {
    // A paddock really can carry two things in a week — the eggmobile
    // following the herd is the pilot's own example. Only an OPEN second stay
    // is refused, and only because the rest clock could not read it.
    const parcel = await newParcel("Two Species");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Shared" }),
    );
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-01",
      }),
    );
    const second = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Layer flock",
        startedOn: "2026-08-03",
        endedOn: "2026-08-04",
      }),
    );
    expect(second.endedOn).toBe("2026-08-04");
  });

  it("refuses a stay that ends before it starts", async () => {
    const parcel = await newParcel("Backwards Stay");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    await expect(
      asOwner((tx) =>
        startOccupancy(tx, ownerCtx(), zone.id, {
          occupantLabel: "Cow herd",
          startedOn: "2026-08-10",
          endedOn: "2026-08-01",
        }),
      ),
    ).rejects.toMatchObject({ code: "DATE_ORDER" });
  });

  it("moving off is what starts the rest clock", async () => {
    const parcel = await newParcel("Rest Clock");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Rested" }),
    );
    const stay = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-01",
      }),
    );

    let rest = await asOwner((tx) =>
      restByZone(tx, tenantId, [zone.id], "2026-08-15"),
    );
    expect(rest.get(zone.id)?.status).toBe("occupied");

    await asOwner((tx) => endOccupancy(tx, ownerCtx(), stay.id, "2026-08-05"));

    rest = await asOwner((tx) =>
      restByZone(tx, tenantId, [zone.id], "2026-08-15"),
    );
    expect(rest.get(zone.id)?.status).toBe("resting");
    expect(rest.get(zone.id)?.restDays).toBe(10);
    expect(rest.get(zone.id)?.grazingDays).toBe(5);
  });

  it("reports a zone with no history as never grazed, not as rested", async () => {
    const parcel = await newParcel("Untouched Ground");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Fresh" }),
    );
    const rest = await asOwner((tx) =>
      restByZone(tx, tenantId, [zone.id], "2026-08-15"),
    );
    expect(rest.get(zone.id)?.status).toBe("never_grazed");
    expect(rest.get(zone.id)?.restDays).toBeNull();
  });

  it("refuses to end a stay before it started", async () => {
    const parcel = await newParcel("End Order");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    const stay = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Cow herd",
        startedOn: "2026-08-10",
      }),
    );
    await expect(
      asOwner((tx) => endOccupancy(tx, ownerCtx(), stay.id, "2026-08-01")),
    ).rejects.toMatchObject({ code: "DATE_ORDER" });
  });

  it("deletes a stay entered by mistake, and frees the zone", async () => {
    const parcel = await newParcel("Mistake");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    const stay = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Wrong herd",
        startedOn: "2026-08-01",
      }),
    );
    await asOwner((tx) => deleteOccupancy(tx, ownerCtx(), stay.id));
    expect(
      await asOwner((tx) => listOccupancy(tx, tenantId, zone.id)),
    ).toHaveLength(0);
    // And the open-stay guard no longer fires.
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Right herd",
        startedOn: "2026-08-01",
      }),
    );
  });

  it("lets STAFF move animals on and off, because that is the chore", async () => {
    // Settled 2026-08-15, reversing the slice-0 rule. Moving the herd to the
    // next paddock is the single most frequent act on a rotational farm, and
    // the person doing it is holding a reel of polywire, not the chequebook.
    // Rest days are computed from these rows, so a rule that stops the hand
    // recording them stops the whole page from meaning anything.
    const parcel = await newParcel("Occupancy Role");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    const stay = await asOwner((tx) =>
      startOccupancy(tx, staffCtx(), zone.id, {
        occupantLabel: "The herd",
        startedOn: "2026-08-01",
      }),
    );
    await asOwner((tx) => endOccupancy(tx, staffCtx(), stay.id, "2026-08-03"));
    await asOwner((tx) => deleteOccupancy(tx, staffCtx(), stay.id));

    // But the fence itself is still the owner's.
    await expect(
      asOwner((tx) =>
        createZone(tx, staffCtx(), { parcelId: parcel.id, name: "Nope" }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("collects completed stay lengths per parcel, ignoring open ones", async () => {
    const parcel = await newParcel("Stay Days");
    const a = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "A" }),
    );
    const b = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "B" }),
    );
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), a.id, {
        occupantLabel: "Herd",
        startedOn: "2026-08-01",
        endedOn: "2026-08-01",
      }),
    );
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), b.id, {
        occupantLabel: "Herd",
        startedOn: "2026-08-02",
        endedOn: "2026-08-03",
      }),
    );
    // Still standing there: it has no length yet.
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), a.id, {
        occupantLabel: "Herd",
        startedOn: "2026-08-10",
      }),
    );
    // Recorded ahead, and already given an end date. It has a length on paper
    // and nobody has grazed it — feeding that into the rotation formula would
    // report a graze length the farm has never done.
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), b.id, {
        occupantLabel: "Herd",
        startedOn: "2026-09-01",
        endedOn: "2026-09-09",
      }),
    );

    const days = await asOwner((tx) =>
      completedStayDays(tx, tenantId, parcel.id, "2026-08-15"),
    );
    expect(days.sort()).toEqual([1, 2]);
  });

  it("keeps the rest target as a plain number with no behaviour attached", async () => {
    // It exists only so a report can draw a comparison line. Nothing in the
    // write path consults it, which is what keeps "rest is an outcome" true.
    const parcel = await asOwner((tx) =>
      createParcel(tx, ownerCtx(), { name: "Targeted", restTargetDays: 21 }),
    );
    expect(parcel.restTargetDays).toBe(21);
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    // A stay far short of the target is accepted without complaint.
    const stay = await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Herd",
        startedOn: "2026-08-01",
        endedOn: "2026-08-02",
      }),
    );
    expect(stay.id).toBeTruthy();
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Herd again, two days later",
        startedOn: "2026-08-04",
        endedOn: "2026-08-05",
      }),
    );
  });

  it("cascades occupancy when a zone is deleted, but retiring keeps it", async () => {
    const parcel = await newParcel("Cascade");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), zone.id, {
        occupantLabel: "Herd",
        startedOn: "2026-08-01",
        endedOn: "2026-08-02",
      }),
    );
    // Retirement is a status, so the history survives it — which is what makes
    // "every cost recorded against it keeps reporting" true.
    await asOwner((tx) => retireZone(tx, ownerCtx(), zone.id));
    expect(
      await asOwner((tx) => listOccupancy(tx, tenantId, zone.id)),
    ).toHaveLength(1);
  });

  it("stores area at the column's scale", async () => {
    const parcel = await asOwner((tx) =>
      createParcel(tx, ownerCtx(), { name: "Precise", areaAcres: 12.3456 }),
    );
    const fetched = await asOwner((tx) => getParcel(tx, tenantId, parcel.id));
    expect(fetched?.areaAcres).toBe(12.3456);
  });

  // ---- moving ------------------------------------------------------------

  /** A herd that is somewhere, ready to be moved off it. */
  async function herdOn(
    label: string,
    startedOn: string,
  ): Promise<{ from: string; to: string; occupantId: string }> {
    const parcel = await newParcel(`Move ${label}`);
    const [from, to] = await Promise.all([
      asOwner((tx) => createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "A" })),
      asOwner((tx) => createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "B" })),
    ]);
    const occupantId = randomUUID();
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), from.id, {
        occupantLabel: label,
        startedOn,
        extensionSlug: "livestock",
        occupantType: "lot",
        occupantId,
      }),
    );
    return { from: from.id, to: to.id, occupantId };
  }

  const moveTo = (zoneId: string, occupantId: string, label: string, on: string) =>
    asOwner((tx) =>
      moveOccupant(tx, staffCtx(), zoneId, {
        occupantLabel: label,
        startedOn: on,
        extensionSlug: "livestock",
        occupantType: "lot",
        occupantId,
      }),
    );

  it("takes them off the old paddock the DAY BEFORE, not the same day", async () => {
    // The property the whole change turns on. On A from the 1st, moved to B on
    // the 10th: A gets nine days, B starts on the 10th. Closing A on the 10th
    // would count that day's grazing twice and inflate every rotation figure
    // downstream — and nothing on the page would look wrong.
    const { from, to, occupantId } = await herdOn("Herd", "2026-04-01");
    const result = await moveTo(to, occupantId, "Herd", "2026-04-10");

    expect(result.movedOff).toEqual({ zoneId: from, endedOn: "2026-04-09" });

    const [oldStays, newStays] = await Promise.all([
      asOwner((tx) => listOccupancy(tx, tenantId, from)),
      asOwner((tx) => listOccupancy(tx, tenantId, to)),
    ]);
    expect(oldStays).toHaveLength(1);
    expect(oldStays[0].endedOn).toBe("2026-04-09");
    expect(newStays[0].startedOn).toBe("2026-04-10");
    expect(newStays[0].endedOn).toBeNull();

    // And the rest clock is running on the ground they left, which is the
    // number the move exists to produce.
    const rest = await asOwner((tx) => restByZone(tx, tenantId, [from], "2026-04-15"));
    expect(rest.get(from)?.status).toBe("resting");
    expect(rest.get(from)?.grazingDays).toBe(9);
  });

  it("moves them when they are nowhere, and says so", async () => {
    const parcel = await newParcel("Move fresh");
    const zone = await asOwner((tx) =>
      createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "Z" }),
    );
    const result = await moveTo(zone.id, randomUUID(), "New herd", "2026-04-01");
    expect(result.movedOff).toBeNull();
    expect(result.occupancy.startedOn).toBe("2026-04-01");
  });

  it("gives a one-day stay when they are moved the day they arrived", async () => {
    // Clamped rather than refused. A same-day move is a correction or a real
    // twice-in-a-day rotation, and refusing would put the user back in the
    // five-click hole this function exists to close. The old stay cannot end
    // before it began, so one day is the honest record at day granularity.
    const { from, occupantId, to } = await herdOn("Same day", "2026-04-01");
    const result = await moveTo(to, occupantId, "Same day", "2026-04-01");
    expect(result.movedOff?.endedOn).toBe("2026-04-01");

    const stays = await asOwner((tx) => listOccupancy(tx, tenantId, from));
    expect(stays[0].startedOn).toBe("2026-04-01");
    expect(stays[0].endedOn).toBe("2026-04-01");
  });

  it("refuses moving them onto the ground they are already on", async () => {
    // Changing the strip size or the pen is an EDIT of the stay they are on.
    // Closing and reopening would invent a break in ground they never left,
    // and the rest clock would show a gap that did not happen.
    const { from, occupantId } = await herdOn("Already", "2026-04-01");
    await expect(moveTo(from, occupantId, "Already", "2026-04-10")).rejects.toMatchObject(
      { code: "ALREADY_THERE" },
    );
  });

  it("refuses a move dated before they arrived where they are", async () => {
    // A mis-keyed year far more often than a real correction, and silently
    // reordering two stays would be worse than refusing.
    const { to, occupantId } = await herdOn("Backwards", "2026-04-10");
    await expect(
      moveTo(to, occupantId, "Backwards", "2026-04-01"),
    ).rejects.toMatchObject({ code: "DATE_ORDER" });
  });

  it("does not displace anything when recording a stay that already ended", async () => {
    // Writing up last month's grazing must not take them off the paddock they
    // are standing on today. This is the same condition `startOccupancy`'s own
    // guard uses, so the two cannot drift apart.
    const { from, to, occupantId } = await herdOn("Historic", "2026-04-01");
    const result = await asOwner((tx) =>
      moveOccupant(tx, staffCtx(), to, {
        occupantLabel: "Historic",
        startedOn: "2026-03-01",
        endedOn: "2026-03-05",
        extensionSlug: "livestock",
        occupantType: "lot",
        occupantId,
      }),
    );
    expect(result.movedOff).toBeNull();

    const stays = await asOwner((tx) => listOccupancy(tx, tenantId, from));
    expect(stays[0].endedOn).toBeNull();
  });

  it("does not let a move recorded ahead stop a paddock's rest clock", async () => {
    // The exact sequence that found this on production: rotate a herd off,
    // then record the next arrival with a forward "On" date. The paddock they
    // LEFT is resting; the one they are going to has not been used yet.
    const parcel = await newParcel("Booked ahead");
    const [from, to] = await Promise.all([
      asOwner((tx) => createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "A" })),
      asOwner((tx) => createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "B" })),
    ]);
    const occupantId = randomUUID();
    await asOwner((tx) =>
      startOccupancy(tx, ownerCtx(), from.id, {
        occupantLabel: "Herd",
        startedOn: "2026-08-01",
        extensionSlug: "livestock",
        occupantType: "lot",
        occupantId,
      }),
    );
    await asOwner((tx) =>
      moveOccupant(tx, staffCtx(), to.id, {
        occupantLabel: "Herd",
        startedOn: "2026-08-20",
        extensionSlug: "livestock",
        occupantType: "lot",
        occupantId,
      }),
    );

    const rest = await asOwner((tx) =>
      restByZone(tx, tenantId, [from.id, to.id], "2026-08-15"),
    );
    // The move closed A on the 19th, but that has not arrived: on the 15th
    // the herd is still on A, and A is not resting.
    expect(rest.get(from.id)?.status).toBe("occupied");
    expect(rest.get(from.id)?.grazingDays).toBe(15);
    // And B is untouched ground, not a paddock with a herd on it.
    expect(rest.get(to.id)?.status).toBe("never_grazed");
    expect(rest.get(to.id)?.stays).toBe(0);

    // Come the 20th, both flip — from the same two rows, with nothing entered.
    const later = await asOwner((tx) =>
      restByZone(tx, tenantId, [from.id, to.id], "2026-08-20"),
    );
    expect(later.get(from.id)?.status).toBe("resting");
    expect(later.get(from.id)?.restingSince).toBe("2026-08-19");
    expect(later.get(to.id)?.status).toBe("occupied");
  });

  // ---- structures --------------------------------------------------------

  it("offers only assets of the kinds that can hold something", async () => {
    // This shipped unfiltered. Driving it on production put "Chest freezer"
    // and "Tractor" in a picker headed "In a pen or barn", which is the kind of
    // thing no amount of green tests was ever going to say out loud.
    await withSystem(async (tx) => {
      await tx.insert(schema.assets).values([
        { tenantId, kind: "building", name: "S-Barn" },
        { tenantId, kind: "equipment", name: "S-Chest freezer" },
        { tenantId, kind: "vehicle", name: "S-Tractor" },
        { tenantId, kind: "chicken_tractor", name: "S-Eggmobile" },
        { tenantId, kind: "building", name: "S-Disposed", status: "disposed" },
      ]);
    });

    const neutral = await asOwner((tx) =>
      listStructures(tx, tenantId, ["building", "infrastructure"]),
    );
    const names = neutral.map((s) => s.name).filter((n) => n.startsWith("S-"));
    expect(names).toEqual(["S-Barn"]);

    // A profile widens it without land knowing what a chicken tractor is.
    const farm = await asOwner((tx) =>
      listStructures(tx, tenantId, ["building", "chicken_tractor"]),
    );
    expect(farm.map((s) => s.name).filter((n) => n.startsWith("S-"))).toEqual([
      "S-Barn",
      "S-Eggmobile",
    ]);

    // An empty list is a configured answer, and must not mean "no filter".
    expect(await asOwner((tx) => listStructures(tx, tenantId, []))).toEqual([]);
  });

  // ---- boundaries (slice 2a.0) -------------------------------------------

  describe("boundaries", () => {
    /** ≈ 234.6 acres at 40°N — the same box the pure suite measures. */
    const paddock = {
      type: "Polygon",
      coordinates: [
        [
          [-96.0, 40.0],
          [-95.99, 40.0],
          [-95.99, 40.01],
          [-96.0, 40.01],
          [-96.0, 40.0],
        ],
      ],
    };

    it("stores a boundary WITHOUT touching the declared acreage", async () => {
      // The point of keeping both. The declared figure is the deed's and is
      // what the rent and the tax are based on; overwriting it with a traced
      // one would destroy the more authoritative number with the newer one.
      const parcel = await newParcel("Boundary Farm", 240);
      const saved = await asOwner((tx) =>
        setParcelBoundary(tx, ownerCtx(), parcel.id, paddock),
      );
      expect(saved.areaAcres).toBe(240);
      expect(saved.geometry).not.toBeNull();

      const boundary = asBoundary(saved.geometry);
      expect(boundary).not.toBeNull();
      expect(boundaryAreaAcres(boundary!)).toBeCloseTo(234.56, 0);
    });

    it("takes a Feature or a string, because that is what people paste", async () => {
      const parcel = await newParcel("Pasted Farm");
      const saved = await asOwner((tx) =>
        setParcelBoundary(
          tx,
          ownerCtx(),
          parcel.id,
          JSON.stringify({ type: "Feature", geometry: paddock }),
        ),
      );
      // Whatever went in, a bare geometry comes out — the shape every reader
      // in the pack expects.
      expect((saved.geometry as { type: string }).type).toBe("Polygon");
    });

    it("refuses a shape it cannot use, with the reason", async () => {
      // The rule lives in the ops layer rather than the action, so the next
      // caller cannot get past it.
      const parcel = await newParcel("Refused Farm");
      await expect(
        asOwner((tx) =>
          setParcelBoundary(tx, ownerCtx(), parcel.id, {
            type: "LineString",
            coordinates: [
              [-96, 40],
              [-95.99, 40],
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_GEOMETRY" });

      const after = await asOwner((tx) => getParcel(tx, tenantId, parcel.id));
      expect(after?.geometry).toBeNull();
    });

    it("clears a boundary, because a wrong one is worse than none", async () => {
      const parcel = await newParcel("Cleared Farm");
      await asOwner((tx) => setParcelBoundary(tx, ownerCtx(), parcel.id, paddock));
      const cleared = await asOwner((tx) =>
        setParcelBoundary(tx, ownerCtx(), parcel.id, null),
      );
      expect(cleared.geometry).toBeNull();
    });

    it("is a DECISION, so staff cannot redraw the farm", async () => {
      const parcel = await newParcel("Staffed Farm");
      await expect(
        asOwner((tx) => setParcelBoundary(tx, staffCtx(), parcel.id, paddock)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("refuses a boundary for something that does not exist", async () => {
      await expect(
        asOwner((tx) => setZoneBoundary(tx, ownerCtx(), randomUUID(), paddock)),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("finds which zone a point is standing in", async () => {
      // The 10x data-entry win, and the read the column exists for.
      const parcel = await newParcel("Point Farm");
      const north = await asOwner((tx) =>
        createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "P-North" }),
      );
      const south = await asOwner((tx) =>
        createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "P-South" }),
      );
      await asOwner((tx) => setZoneBoundary(tx, ownerCtx(), north.id, paddock));
      await asOwner((tx) =>
        setZoneBoundary(tx, ownerCtx(), south.id, {
          type: "Polygon",
          coordinates: [
            [
              [-96.0, 39.98],
              [-95.99, 39.98],
              [-95.99, 39.99],
              [-96.0, 39.99],
              [-96.0, 39.98],
            ],
          ],
        }),
      );

      const found = await asOwner((tx) =>
        zoneAtPoint(tx, tenantId, [-95.995, 40.005]),
      );
      expect(found?.id).toBe(north.id);

      // Ground nobody has drawn is not a match, and neither is open country.
      expect(
        await asOwner((tx) => zoneAtPoint(tx, tenantId, [-100, 45])),
      ).toBeNull();
    });

    it("returns the SMALLEST zone containing the point", async () => {
      // Zones legitimately overlap — a strip inside a paddock, a paddock inside
      // a parcel-sized zone — and the most specific answer is what somebody
      // standing on it means.
      const parcel = await newParcel("Nested Farm");
      const big = await asOwner((tx) =>
        createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "N-Whole" }),
      );
      const strip = await asOwner((tx) =>
        createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "N-Strip" }),
      );
      await asOwner((tx) =>
        setZoneBoundary(tx, ownerCtx(), big.id, {
          type: "Polygon",
          coordinates: [
            [
              [-97.0, 41.0],
              [-96.9, 41.0],
              [-96.9, 41.1],
              [-97.0, 41.1],
              [-97.0, 41.0],
            ],
          ],
        }),
      );
      await asOwner((tx) =>
        setZoneBoundary(tx, ownerCtx(), strip.id, {
          type: "Polygon",
          coordinates: [
            [
              [-96.96, 41.04],
              [-96.94, 41.04],
              [-96.94, 41.06],
              [-96.96, 41.06],
              [-96.96, 41.04],
            ],
          ],
        }),
      );

      const found = await asOwner((tx) =>
        zoneAtPoint(tx, tenantId, [-96.95, 41.05]),
      );
      expect(found?.name).toBe("N-Strip");
    });

    it("returns the SMALLEST zone when they overlap, which is the specific answer", async () => {
      // A strip inside a paddock is the ordinary overlap: both contain the
      // point, and somebody standing on it means the strip. Returning the
      // larger one would pre-fill the wrong paddock on the move dialog, which
      // is worse than pre-filling nothing.
      const parcel = await newParcel("Overlap Farm");
      const whole = await asOwner((tx) =>
        createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "O-Whole" }),
      );
      const strip = await asOwner((tx) =>
        createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "O-Strip" }),
      );
      await asOwner((tx) =>
        setZoneBoundary(tx, ownerCtx(), whole.id, {
          type: "Polygon",
          coordinates: [
            [
              [-97.5, 42.0],
              [-97.4, 42.0],
              [-97.4, 42.1],
              [-97.5, 42.1],
              [-97.5, 42.0],
            ],
          ],
        }),
      );
      await asOwner((tx) =>
        setZoneBoundary(tx, ownerCtx(), strip.id, {
          type: "Polygon",
          coordinates: [
            [
              [-97.47, 42.04],
              [-97.46, 42.04],
              [-97.46, 42.06],
              [-97.47, 42.06],
              [-97.47, 42.04],
            ],
          ],
        }),
      );

      const found = await asOwner((tx) =>
        zoneAtPoint(tx, tenantId, [-97.465, 42.05]),
      );
      expect(found?.name).toBe("O-Strip");

      // And a point inside only the larger one still answers with it.
      const outside = await asOwner((tx) =>
        zoneAtPoint(tx, tenantId, [-97.42, 42.02]),
      );
      expect(outside?.name).toBe("O-Whole");
    });

    it("answers NULL off the mapped ground rather than guessing the nearest", async () => {
      // "Not inside any paddock" is a fact the person can act on — trace the
      // boundary. A nearest-match would quietly put animals on the wrong
      // ground, and the rest clock is computed from that record.
      const found = await asOwner((tx) => zoneAtPoint(tx, tenantId, [0, 0]));
      expect(found).toBeNull();
    });

    it("ignores a zone with no boundary drawn", async () => {
      // Most zones have none for most of this pack's life, and a zone without
      // geometry must never match a point — it has no ground to be inside of.
      const parcel = await newParcel("Unmapped Farm");
      await asOwner((tx) =>
        createZone(tx, ownerCtx(), { parcelId: parcel.id, name: "U-Nothing" }),
      );
      const found = await asOwner((tx) =>
        zoneAtPoint(tx, tenantId, [-97.465, 42.05]),
      );
      expect(found?.name).not.toBe("U-Nothing");
    });

  });

  describe("combining parcels", () => {
    const square = (west: number, south: number) => ({
      type: "Polygon" as const,
      coordinates: [
        [
          [west, south],
          [west + 0.01, south],
          [west + 0.01, south + 0.01],
          [west, south + 0.01],
          [west, south],
        ],
      ],
    });

    it("absorbs into a survivor that keeps its id and its history", async () => {
      // **TWO DEEDS, ONE BLOCK OF GROUND.** The survivor keeps its id, so every
      // journal line already tagged to it follows the combined parcel — which
      // is why this absorbs rather than creating a third parcel.
      const keep = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), {
          name: "Paige North",
          areaAcres: 4.12,
          identifier: "4900588001",
        }),
      );
      const gone = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), {
          name: "Paige South",
          areaAcres: 4.12,
          identifier: "4900588002",
        }),
      );
      await asOwner((tx) => setParcelBoundary(tx, ownerCtx(), keep.id, square(-82.5, 40.4)));
      await asOwner((tx) => setParcelBoundary(tx, ownerCtx(), gone.id, square(-82.49, 40.4)));

      const result = await asOwner((tx) =>
        combineParcels(tx, ownerCtx(), {
          survivorId: keep.id,
          absorbedIds: [gone.id],
          name: "Paige Farm",
        }),
      );

      expect(result.parcel.id).toBe(keep.id);
      expect(result.parcel.name).toBe("Paige Farm");
      expect(result.absorbed).toBe(1);
      // Both numbers survive: the county still bills these separately and
      // always will.
      expect(result.parcel.identifier).toBe("4900588001 + 4900588002");
      // Declared acreage adds up.
      expect(result.parcel.areaAcres).toBe(8.24);

      // The geometry is a MultiPolygon of both, NOT a dissolved union — which
      // is also the only correct answer for parcels that do not touch.
      const boundary = asBoundary(result.parcel.geometry);
      expect(boundary?.type).toBe("MultiPolygon");
      expect(boundary?.type === "MultiPolygon" && boundary.coordinates).toHaveLength(2);

      const absorbed = await asOwner((tx) => getParcel(tx, tenantId, gone.id));
      expect(absorbed?.status).toBe("retired");
    });

    it("MOVES the paddocks across rather than retiring them with their parcel", async () => {
      // The sharpest trap in this operation: `retireParcel` retires a parcel's
      // zones, so a paddock that stayed behind would be silently lost ground.
      const keep = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), { name: "Keep Side" }),
      );
      const gone = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), { name: "Gone Side" }),
      );
      const paddock = await asOwner((tx) =>
        createZone(tx, ownerCtx(), { parcelId: gone.id, name: "Travelling Paddock" }),
      );

      const result = await asOwner((tx) =>
        combineParcels(tx, ownerCtx(), { survivorId: keep.id, absorbedIds: [gone.id] }),
      );
      expect(result.zonesMoved).toBe(1);

      const moved = await asOwner((tx) => getZone(tx, tenantId, paddock.id));
      expect(moved?.parcelId).toBe(keep.id);
      expect(moved?.status).toBe("active");
    });

    it("refuses to state an area when one part has never been measured", async () => {
      // `totalArea`'s rule: an unknown poisons the sum. Storing 4.12 for a
      // combined parcel whose other half is unmeasured would put a confidently
      // wrong divisor into every per-acre figure.
      const keep = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), { name: "Measured", areaAcres: 4.12 }),
      );
      const gone = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), { name: "Unmeasured" }),
      );
      const result = await asOwner((tx) =>
        combineParcels(tx, ownerCtx(), { survivorId: keep.id, absorbedIds: [gone.id] }),
      );
      expect(result.parcel.areaAcres).toBeNull();
    });

    it("needs at least two, and ignores the survivor listed twice", async () => {
      const only = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), { name: "Alone" }),
      );
      await expect(
        asOwner((tx) =>
          combineParcels(tx, ownerCtx(), {
            survivorId: only.id,
            absorbedIds: [only.id],
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_COMBINE" });
    });

    it("refuses to absorb ground that is already retired", async () => {
      // It would resurrect it sideways, without going through the un-retire
      // this pack does not have.
      const keep = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), { name: "Live Ground" }),
      );
      const dead = await asOwner((tx) =>
        createParcel(tx, ownerCtx(), { name: "Sold Ground" }),
      );
      await asOwner((tx) => retireParcel(tx, ownerCtx(), dead.id));
      await expect(
        asOwner((tx) =>
          combineParcels(tx, ownerCtx(), { survivorId: keep.id, absorbedIds: [dead.id] }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_COMBINE" });
    });

    it("is the owner's decision, not a chore", async () => {
      const a = await asOwner((tx) => createParcel(tx, ownerCtx(), { name: "A side" }));
      const b = await asOwner((tx) => createParcel(tx, ownerCtx(), { name: "B side" }));
      await expect(
        asOwner((tx) =>
          combineParcels(tx, staffCtx(), { survivorId: a.id, absorbedIds: [b.id] }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  // ---- features (slice 2b.0) -------------------------------------------

  describe("features", () => {
    const fenceLine = {
      type: "LineString",
      coordinates: [
        [-82.5, 40.4],
        [-82.5, 40.401],
      ],
    };

    it("is a CHORE, not a decision — staff may draw what they built", async () => {
      // The deliberate difference from parcels and zones. A feature syncs no
      // dimension member, so `requireOwnerRole` never forces the owner line,
      // and the person who knows where the waterline went is not the owner.
      const parcel = await newParcel("Staff Draws");
      const feature = await asOwner((tx) =>
        createFeature(tx, staffCtx(), {
          parcelId: parcel.id,
          kind: "waterline",
          name: "To the barn",
          geometry: fenceLine,
        }),
      );
      expect(feature.kind).toBe("waterline");
      expect(feature.status).toBe("built");
    });

    it("does NOT become a cost object — land owns where, assets owns cost", async () => {
      const parcel = await newParcel("No Dimension");
      const feature = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), { parcelId: parcel.id, kind: "fence" }),
      );
      const members = await membersOf(ZONE_DIMENSION);
      const parcels = await membersOf(PARCEL_DIMENSION);
      expect(members.map((m) => m.packEntityId)).not.toContain(feature.id);
      expect(parcels.map((m) => m.packEntityId)).not.toContain(feature.id);
    });

    it("defaults to built, because tracing what is there is the common act", async () => {
      const parcel = await newParcel("Default Status");
      const feature = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), { parcelId: parcel.id, kind: "fence" }),
      );
      expect(feature.status).toBe("built");
    });

    it("takes a feature with NO geometry, which means not drawn yet", async () => {
      const parcel = await newParcel("Undrawn");
      const feature = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "fence",
          name: "South line",
        }),
      );
      expect(feature.geometry).toBeNull();
    });

    it("PROMOTES a proposal in one act, keeping the id and the geometry", async () => {
      // The act the status column exists for. Nothing is redrawn, so nothing
      // can be redrawn differently — which is what makes the plan a record.
      const parcel = await newParcel("Promotion");
      const planned = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "fence",
          status: "planned",
          geometry: fenceLine,
          attributes: { wire_count: 3, hot: true },
        }),
      );

      const built = await asOwner((tx) =>
        setFeatureStatus(tx, staffCtx(), planned.id, "built"),
      );
      expect(built.id).toBe(planned.id);
      expect(built.status).toBe("built");
      expect(built.geometry).toEqual(planned.geometry);
      expect(built.attributes).toEqual({ wire_count: 3, hot: true });
    });

    it("refuses a status it does not know", async () => {
      const parcel = await newParcel("Bad Status");
      const feature = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), { parcelId: parcel.id, kind: "fence" }),
      );
      await expect(
        asOwner((tx) => setFeatureStatus(tx, ownerCtx(), feature.id, "proposed")),
      ).rejects.toMatchObject({ code: "INVALID_STATUS" });
    });

    it("measures a redrawn line rather than trusting what was sent", async () => {
      const parcel = await newParcel("Redraw");
      const feature = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), { parcelId: parcel.id, kind: "fence" }),
      );
      const drawn = await asOwner((tx) =>
        setFeatureGeometry(tx, staffCtx(), feature.id, fenceLine),
      );
      const geometry = asFeatureGeometry(drawn.geometry);
      expect(geometry).not.toBeNull();
      // ~111 m: a thousandth of a degree of latitude.
      expect(geometryLengthM(geometry!)).toBeGreaterThan(110);
      expect(geometryLengthM(geometry!)).toBeLessThan(112);
    });

    it("refuses a one-point line with the parser's own words", async () => {
      const parcel = await newParcel("Stub Line");
      await expect(
        asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: parcel.id,
            kind: "fence",
            geometry: { type: "LineString", coordinates: [[-82.5, 40.4]] },
          }),
        ),
      ).rejects.toMatchObject({ code: "INVALID_GEOMETRY" });
    });

    it("refuses a feature on a parcel that does not exist", async () => {
      await expect(
        asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: randomUUID(),
            kind: "fence",
          }),
        ),
      ).rejects.toMatchObject({ code: "PARCEL_INVALID" });
    });

    describe("the attribute bag", () => {
      it("keeps scalars and drops a cleared field rather than storing blank", async () => {
        const parcel = await newParcel("Attributes");
        const feature = await asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: parcel.id,
            kind: "fence",
            attributes: {
              wire_count: 3,
              hot: true,
              note: "  spaced 8ft  ",
              cleared: "   ",
            },
          }),
        );
        expect(feature.attributes).toEqual({
          wire_count: 3,
          hot: true,
          note: "spaced 8ft",
        });
      });

      it("REPLACES the bag rather than merging, so a detail can be removed", async () => {
        const parcel = await newParcel("Replace Bag");
        const feature = await asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: parcel.id,
            kind: "fence",
            attributes: { wire_count: 3, hot: true },
          }),
        );
        const updated = await asOwner((tx) =>
          updateFeature(tx, ownerCtx(), feature.id, {
            attributes: { wire_count: 5 },
          }),
        );
        expect(updated.attributes).toEqual({ wire_count: 5 });
      });

      it("refuses a nested document, which no reader here would understand", async () => {
        const parcel = await newParcel("Nested");
        await expect(
          asOwner((tx) =>
            createFeature(tx, ownerCtx(), {
              parcelId: parcel.id,
              kind: "fence",
              attributes: { spec: { gauge: 12 } as unknown as string },
            }),
          ),
        ).rejects.toMatchObject({ code: "INVALID_ATTRIBUTES" });
      });

      it("refuses a key that would not be queryable in jsonb", async () => {
        const parcel = await newParcel("Bad Key");
        await expect(
          asOwner((tx) =>
            createFeature(tx, ownerCtx(), {
              parcelId: parcel.id,
              kind: "fence",
              attributes: { "Wire Count": 3 },
            }),
          ),
        ).rejects.toMatchObject({ code: "INVALID_ATTRIBUTES" });
      });
    });

    describe("what feeds what", () => {
      it("points a fence at its energizer", async () => {
        const parcel = await newParcel("Energized");
        const charger = await asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: parcel.id,
            kind: "energizer",
            name: "Barn charger",
          }),
        );
        const fence = await asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: parcel.id,
            kind: "fence",
            fedById: charger.id,
          }),
        );
        expect(fence.fedById).toBe(charger.id);

        // The read the column exists for: everything on one energizer, with no
        // traversal and no graph.
        const onCharger = await asOwner((tx) =>
          listFeatures(tx, tenantId, { parcelId: parcel.id }),
        );
        expect(onCharger.filter((f) => f.fedById === charger.id)).toHaveLength(1);
      });

      it("refuses a source that has been removed", async () => {
        const parcel = await newParcel("Pulled Charger");
        const charger = await asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: parcel.id,
            kind: "energizer",
            status: "removed",
          }),
        );
        await expect(
          asOwner((tx) =>
            createFeature(tx, ownerCtx(), {
              parcelId: parcel.id,
              kind: "fence",
              fedById: charger.id,
            }),
          ),
        ).rejects.toMatchObject({ code: "INVALID_FEED" });
      });

      it("refuses a source that does not exist", async () => {
        const parcel = await newParcel("Ghost Charger");
        await expect(
          asOwner((tx) =>
            createFeature(tx, ownerCtx(), {
              parcelId: parcel.id,
              kind: "fence",
              fedById: randomUUID(),
            }),
          ),
        ).rejects.toMatchObject({ code: "INVALID_FEED" });
      });

      it("refuses to delete something other features run off", async () => {
        // The FK would refuse anyway. This exists so the person gets a sentence
        // rather than a constraint violation.
        const parcel = await newParcel("Still Feeding");
        const charger = await asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: parcel.id,
            kind: "energizer",
          }),
        );
        await asOwner((tx) =>
          createFeature(tx, ownerCtx(), {
            parcelId: parcel.id,
            kind: "fence",
            fedById: charger.id,
          }),
        );
        await expect(
          asOwner((tx) => deleteFeature(tx, ownerCtx(), charger.id)),
        ).rejects.toMatchObject({ code: "INVALID_FEED" });
      });
    });

    it("DELETES a mistake, which is not the same act as marking it removed", async () => {
      // `removed` means it was there and is not any more. A delete means it was
      // never there — a stray double click, a trough on the wrong parcel.
      const parcel = await newParcel("Mistake");
      const feature = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), { parcelId: parcel.id, kind: "fence" }),
      );
      await asOwner((tx) => deleteFeature(tx, staffCtx(), feature.id));
      expect(
        await asOwner((tx) => getFeature(tx, tenantId, feature.id)),
      ).toBeNull();

      const removed = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "fence",
          status: "removed",
        }),
      );
      expect(
        await asOwner((tx) => getFeature(tx, tenantId, removed.id)),
      ).not.toBeNull();
    });

    it("lists by kind then name, so a plan reads as a legend", async () => {
      const parcel = await newParcel("Legend Order");
      await asOwner(async (tx) => {
        await createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "waterline",
          name: "To barn",
        });
        await createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "fence",
          name: "South",
        });
        await createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "fence",
          name: "North",
        });
      });
      const listed = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id }),
      );
      expect(listed.map((f) => `${f.kind}:${f.name}`)).toEqual([
        "fence:North",
        "fence:South",
        "waterline:To barn",
      ]);
    });

    it("filters by status, which is how the map hides what was pulled out", async () => {
      const parcel = await newParcel("Status Filter");
      await asOwner(async (tx) => {
        await createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "fence",
          status: "built",
        });
        await createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "fence",
          status: "planned",
        });
      });
      const planned = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id, status: "planned" }),
      );
      expect(planned).toHaveLength(1);
      expect(planned[0].status).toBe("planned");
    });
  });

  // ---- paddock layout (slice 2b.2) --------------------------------------

  describe("laying out paddocks", () => {
    const FIELD: Boundary = {
      type: "Polygon",
      coordinates: [
        [
          [-82.48, 40.4],
          [-82.47526, 40.4],
          [-82.47526, 40.40361],
          [-82.48, 40.40361],
          [-82.48, 40.4],
        ],
      ],
    };
    const LANE: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [-82.4798, 40.4],
        [-82.4798, 40.40361],
      ],
    };

    /** A parcel with a boundary and a lane drawn on it, ready to divide. */
    async function fieldWithLane(name: string) {
      const parcel = await newParcel(name);
      await asOwner((tx) => setParcelBoundary(tx, ownerCtx(), parcel.id, FIELD));
      const lane = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "lane",
          name: "Centre lane",
          geometry: LANE,
        }),
      );
      return { parcel, lane };
    }

    it("creates the paddocks AND their fences in one act", async () => {
      const { parcel, lane } = await fieldWithLane("Four Up");
      const result = await asOwner((tx) =>
        layoutPaddocks(tx, ownerCtx(), {
          parcelId: parcel.id,
          laneFeatureId: lane.id,
          count: 4,
        }),
      );

      expect(result.zoneIds).toHaveLength(4);
      expect(result.warnings).toEqual([]);

      const zones = await asOwner((tx) =>
        listZones(tx, tenantId, { parcelId: parcel.id }),
      );
      expect(zones).toHaveLength(4);

      /**
       * Four paddocks off a CENTRAL lane is two either side, so: one dividing
       * fence per side, plus the alley's two sides. The field's own perimeter
       * is already there and is not drawn.
       *
       * **NO FENCE CROSSES THE LANE**, which is the whole point of the
       * corridor — the previous version drew three dividers straight through
       * the walkway.
       */
      const features = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id }),
      );
      const fences = features.filter((f) => f.kind === "fence");
      expect(fences).toHaveLength(4);
      expect(fences.filter((f) => /division/.test(f.name))).toHaveLength(2);
      expect(fences.filter((f) => /lane fence/.test(f.name))).toHaveLength(2);
      expect(features.filter((f) => f.kind === "gate")).toHaveLength(4);

      const laneLon = LANE.coordinates[0][0];
      for (const fence of fences.filter((f) => /division/.test(f.name))) {
        const lons = (
          fence.geometry as { coordinates: number[][] }
        ).coordinates.map((c) => c[0]);
        const crosses = Math.min(...lons) < laneLon && Math.max(...lons) > laneLon;
        expect(crosses).toBe(false);
      }
    });

    it("makes everything PLANNED, because none of it is built yet", async () => {
      const { parcel, lane } = await fieldWithLane("All Planned");
      await asOwner((tx) =>
        layoutPaddocks(tx, ownerCtx(), {
          parcelId: parcel.id,
          laneFeatureId: lane.id,
          count: 3,
        }),
      );

      const zones = await asOwner((tx) =>
        listZones(tx, tenantId, { parcelId: parcel.id }),
      );
      expect(zones.every((z) => z.status === "planned")).toBe(true);

      const features = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id }),
      );
      // The lane itself was drawn as built; everything the layout made is not.
      expect(
        features.filter((f) => f.kind !== "lane").every((f) => f.status === "planned"),
      ).toBe(true);
    });

    it("does NOT make a cost object out of unfenced ground", async () => {
      // The whole reason `planned` exists on a zone. A dimension member for
      // ground with no fence round it puts empty columns in every report.
      const { parcel, lane } = await fieldWithLane("No Dimension Yet");
      const result = await asOwner((tx) =>
        layoutPaddocks(tx, ownerCtx(), {
          parcelId: parcel.id,
          laneFeatureId: lane.id,
          count: 2,
        }),
      );
      const members = await membersOf(ZONE_DIMENSION);
      for (const zoneId of result.zoneIds) {
        expect(members.map((m) => m.packEntityId)).not.toContain(zoneId);
      }
    });

    it("records the DRAWN acreage as the paddock's acreage", async () => {
      // The one place this pack's declared-versus-computed rule is deliberately
      // NOT applied. A parcel has a deed to disagree with; a paddock has no
      // external source, so the drawing IS the record.
      const { parcel, lane } = await fieldWithLane("Acreage");
      await asOwner((tx) =>
        layoutPaddocks(tx, ownerCtx(), {
          parcelId: parcel.id,
          laneFeatureId: lane.id,
          count: 4,
        }),
      );
      const zones = await asOwner((tx) =>
        listZones(tx, tenantId, { parcelId: parcel.id }),
      );
      for (const zone of zones) {
        expect(zone.areaAcres).not.toBeNull();
        const drawn = boundaryAreaAcres(asBoundary(zone.geometry)!);
        expect(zone.areaAcres!).toBeCloseTo(drawn, 3);
      }
      // They add back up to the field MINUS the lane's own corridor, which is
      // ground the cows walk down rather than graze.
      const total = zones.reduce((sum, z) => sum + (z.areaAcres ?? 0), 0);
      expect(total).toBeLessThan(boundaryAreaAcres(FIELD));
      expect(total).toBeGreaterThan(boundaryAreaAcres(FIELD) - 1);
    });

    it("names them off a prefix so a farm can have more than one set", async () => {
      const { parcel, lane } = await fieldWithLane("Named");
      await asOwner((tx) =>
        layoutPaddocks(tx, ownerCtx(), {
          parcelId: parcel.id,
          laneFeatureId: lane.id,
          count: 4,
          namePrefix: "North",
        }),
      );
      const zones = await asOwner((tx) =>
        listZones(tx, tenantId, { parcelId: parcel.id }),
      );
      expect(zones.map((z) => z.name).sort()).toEqual([
        "North 1",
        "North 2",
        "North 3",
        "North 4",
      ]);
    });

    it("rounds an odd count up across two sides, and says the real number", async () => {
      // Three paddocks either side of a lane is not three. The dialog's button
      // reads the count back off the same function, so what it offers is what
      // it builds — but the rounding is worth knowing about here too.
      const { parcel, lane } = await fieldWithLane("Odd");
      const result = await asOwner((tx) =>
        layoutPaddocks(tx, ownerCtx(), {
          parcelId: parcel.id,
          laneFeatureId: lane.id,
          count: 3,
        }),
      );
      expect(result.zoneIds).toHaveLength(4);
    });

    it("puts paddocks on ONE side when asked, and says what it left out", async () => {
      const { parcel, lane } = await fieldWithLane("One Side");
      const result = await asOwner((tx) =>
        layoutPaddocks(tx, ownerCtx(), {
          parcelId: parcel.id,
          laneFeatureId: lane.id,
          count: 4,
          placement: "edge",
        }),
      );
      expect(result.zoneIds).toHaveLength(4);
      // One run of lane fence, not two: the far side of an edge lane is the
      // perimeter that is already there.
      const features = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id }),
      );
      expect(
        features.filter((f) => /lane fence/.test(f.name)),
      ).toHaveLength(1);
      expect(result.warnings.some((w) => /far side of the lane/.test(w))).toBe(
        true,
      );
    });

    it("is a DECISION, not a chore — staff cannot lay out paddocks", async () => {
      const { parcel, lane } = await fieldWithLane("Owner Only");
      await expect(
        asOwner((tx) =>
          layoutPaddocks(tx, staffCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 3,
          }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("refuses ground with no boundary, in words a person can act on", async () => {
      const parcel = await newParcel("Untraced");
      const lane = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "lane",
          geometry: LANE,
        }),
      );
      await expect(
        asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 3,
          }),
        ),
      ).rejects.toMatchObject({ code: "LAYOUT_INVALID" });
    });

    it("refuses a lane that has not been drawn", async () => {
      const parcel = await newParcel("Undrawn Lane");
      await asOwner((tx) => setParcelBoundary(tx, ownerCtx(), parcel.id, FIELD));
      const lane = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), { parcelId: parcel.id, kind: "lane" }),
      );
      await expect(
        asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 3,
          }),
        ),
      ).rejects.toMatchObject({ code: "LAYOUT_INVALID" });
    });

    describe("a planned paddock is not ground you can use", () => {
      it("REFUSES OCCUPANCY, which is the guard `planned` had to add", async () => {
        // Every other read already filtered on `active`; this one never looked
        // at status at all, and would have fed the rest clock from a paddock
        // whose fence nobody has built.
        const { parcel, lane } = await fieldWithLane("No Cows Yet");
        const result = await asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 2,
          }),
        );
        await expect(
          asOwner((tx) =>
            startOccupancy(tx, ownerCtx(), result.zoneIds[0], {
              occupantLabel: "The herd",
              startedOn: "2026-08-29",
            }),
          ),
        ).rejects.toMatchObject({ code: "LAYOUT_INVALID" });
      });

      it("is not the answer to which paddock am I standing in", async () => {
        const { parcel, lane } = await fieldWithLane("Not Here");
        await asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 2,
          }),
        );
        // Dead centre of the field, which is inside one of the planned strips.
        const found = await asOwner((tx) =>
          zoneAtPoint(tx, tenantId, [-82.4776, 40.4018]),
        );
        expect(found).toBeNull();
      });
    });

    describe("activating one", () => {
      it("makes it a cost object at the moment it becomes real", async () => {
        const { parcel, lane } = await fieldWithLane("Built It");
        const result = await asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 2,
          }),
        );
        const zone = await asOwner((tx) =>
          activateZone(tx, ownerCtx(), result.zoneIds[0]),
        );
        expect(zone.status).toBe("active");

        const members = await membersOf(ZONE_DIMENSION);
        const member = members.find((m) => m.packEntityId === zone.id);
        expect(member).toBeDefined();
        expect(member?.displayName).toBe(zone.name);
      });

      it("lets the cows on once it is real", async () => {
        const { parcel, lane } = await fieldWithLane("Cows Now");
        const result = await asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 2,
          }),
        );
        await asOwner((tx) => activateZone(tx, ownerCtx(), result.zoneIds[0]));
        const stay = await asOwner((tx) =>
          startOccupancy(tx, ownerCtx(), result.zoneIds[0], {
            occupantLabel: "The herd",
            startedOn: "2026-08-29",
          }),
        );
        expect(stay.zoneId).toBe(result.zoneIds[0]);
      });

      it("is idempotent, because two people can walk a fence in together", async () => {
        const { parcel, lane } = await fieldWithLane("Twice");
        const result = await asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 2,
          }),
        );
        await asOwner((tx) => activateZone(tx, ownerCtx(), result.zoneIds[0]));
        const again = await asOwner((tx) =>
          activateZone(tx, ownerCtx(), result.zoneIds[0]),
        );
        expect(again.status).toBe("active");
      });

      it("refuses to resurrect retired ground this way", async () => {
        const { parcel, lane } = await fieldWithLane("Retired");
        const result = await asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 2,
          }),
        );
        await asOwner((tx) => activateZone(tx, ownerCtx(), result.zoneIds[0]));
        await asOwner((tx) => retireZone(tx, ownerCtx(), result.zoneIds[0]));
        await expect(
          asOwner((tx) => activateZone(tx, ownerCtx(), result.zoneIds[0])),
        ).rejects.toMatchObject({ code: "LAYOUT_INVALID" });
      });

      it("is the owner's call", async () => {
        const { parcel, lane } = await fieldWithLane("Owner Activates");
        const result = await asOwner((tx) =>
          layoutPaddocks(tx, ownerCtx(), {
            parcelId: parcel.id,
            laneFeatureId: lane.id,
            count: 2,
          }),
        );
        await expect(
          asOwner((tx) => activateZone(tx, staffCtx(), result.zoneIds[0])),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    });
  });

  // ---- plans and the takeoff (slice 2b.4) -------------------------------

  describe("plans", () => {
    const FIELD2: Boundary = {
      type: "Polygon",
      coordinates: [
        [
          [-82.48, 40.4],
          [-82.47526, 40.4],
          [-82.47526, 40.40361],
          [-82.48, 40.40361],
          [-82.48, 40.4],
        ],
      ],
    };
    const LANE2: FeatureGeometry = {
      type: "LineString",
      coordinates: [
        [-82.47763, 40.4],
        [-82.47763, 40.40361],
      ],
    };

    async function laidOut(name: string) {
      const parcel = await newParcel(name);
      await asOwner((tx) => setParcelBoundary(tx, ownerCtx(), parcel.id, FIELD2));
      const lane = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "lane",
          name: "Centre",
          geometry: LANE2,
        }),
      );
      const result = await asOwner((tx) =>
        layoutPaddocks(tx, ownerCtx(), {
          parcelId: parcel.id,
          laneFeatureId: lane.id,
          count: 4,
          namePrefix: "North",
        }),
      );
      return { parcel, lane, result };
    }

    it("LAYING OUT MAKES A PLAN, and everything it drew belongs to it", async () => {
      // A plan is a named set of proposals costed together, and dividing a
      // field is exactly that. Making somebody create one and then attach
      // twelve features would be asking them to restate what the app knows.
      const { parcel, result } = await laidOut("Plan From Layout");
      expect(result.planId).toBeTruthy();

      const plan = await asOwner((tx) => getPlan(tx, tenantId, result.planId));
      expect(plan?.name).toBe("North");
      expect(plan?.takenOffAt).toBeNull();

      const features = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id }),
      );
      const inPlan = features.filter((f) => f.planId === result.planId);
      // Every fence and gate it drew — but NOT the lane, which was there first.
      expect(inPlan).toHaveLength(result.featureIds.length);
      expect(inPlan.some((f) => f.kind === "lane")).toBe(false);
    });

    it("computes a takeoff off the plan's own features", async () => {
      const { parcel, result } = await laidOut("Counted");
      const features = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id }),
      );
      const mine = features
        .filter((f) => f.planId === result.planId)
        .map((f) => ({
          id: f.id,
          name: f.name,
          kind: f.kind,
          geometry: asFeatureGeometry(f.geometry),
          attributes: {} as Record<string, string | number | boolean>,
        }));

      const { lines, notes } = takeoffFor(mine, "foot");
      // Four gates, and every fence contributes its own footage.
      expect(
        totalsOf(lines).find((t) => t.material === "gate")?.quantity,
      ).toBe(4);
      expect(totalsOf(lines).find((t) => t.material === "fence")).toBeDefined();
      // Nothing has a post spacing yet, so it says so rather than guessing.
      expect(notes.some((n) => n.message.includes("post_spacing"))).toBe(true);
    });

    it("SAVES A SNAPSHOT, and the drawing may drift from it afterwards", async () => {
      const { result } = await laidOut("Snapshot");
      const source = result.featureIds[0];
      await asOwner((tx) =>
        saveTakeoff(tx, ownerCtx(), result.planId, [
          { material: "post", label: "Posts", quantity: 156, unit: "each", sourceFeatureId: source },
          { material: "wire", label: "Wire", quantity: 1240, unit: "ft", sourceFeatureId: source },
        ]),
      );

      const plan = await asOwner((tx) => getPlan(tx, tenantId, result.planId));
      expect(plan?.takenOffAt).not.toBeNull();

      const items = await asOwner((tx) =>
        listPlanItems(tx, tenantId, result.planId),
      );
      expect(items.map((i) => i.material).sort()).toEqual(["post", "wire"]);
      expect(items.find((i) => i.material === "wire")?.quantity).toBe(1240);
    });

    it("keeps HAND-ADDED lines when the list is taken off again", async () => {
      // Insulators and a bag of staples are not in the geometry, and no amount
      // of redrawing the fence tells us anything about them.
      const { result } = await laidOut("Hand Lines");
      const source = result.featureIds[0];
      await asOwner((tx) =>
        saveTakeoff(tx, ownerCtx(), result.planId, [
          { material: "post", label: "Posts", quantity: 100, unit: "each", sourceFeatureId: source },
        ]),
      );
      await asOwner((tx) =>
        addPlanItem(tx, ownerCtx(), result.planId, {
          material: "insulator",
          label: "Insulators",
          quantity: 300,
          unit: "each",
        }),
      );

      await asOwner((tx) =>
        saveTakeoff(tx, ownerCtx(), result.planId, [
          { material: "post", label: "Posts", quantity: 120, unit: "each", sourceFeatureId: source },
        ]),
      );

      const items = await asOwner((tx) =>
        listPlanItems(tx, tenantId, result.planId),
      );
      expect(items.find((i) => i.material === "insulator")?.quantity).toBe(300);
      // …and the counted line was replaced, not doubled.
      expect(items.filter((i) => i.material === "post")).toHaveLength(1);
      expect(items.find((i) => i.material === "post")?.quantity).toBe(120);
    });

    it("REFUSES a counted line that names no feature", async () => {
      // Otherwise it would survive every re-take and quietly double the order.
      // Hand-added lines go through addPlanItem, which is the unambiguous path.
      const { result } = await laidOut("Sourceless");
      await expect(
        asOwner((tx) =>
          saveTakeoff(tx, ownerCtx(), result.planId, [
            { material: "post", label: "Posts", quantity: 10, unit: "each" },
          ]),
        ),
      ).rejects.toMatchObject({ code: "LAYOUT_INVALID" });
    });

    it("takes a price somebody typed, and leaves it null when nobody did", async () => {
      const { result } = await laidOut("Priced");
      const item = await asOwner((tx) =>
        addPlanItem(tx, ownerCtx(), result.planId, {
          material: "post",
          label: "Posts",
          quantity: 156,
          unit: "each",
          unitCost: 4.25,
        }),
      );
      expect(item.unitCost).toBe(4.25);

      const free = await asOwner((tx) =>
        addPlanItem(tx, ownerCtx(), result.planId, {
          material: "wire",
          label: "Wire",
          quantity: 10,
          unit: "ft",
        }),
      );
      // Null, not zero: zero is a thing that is free.
      expect(free.unitCost).toBeNull();
    });

    it("refuses a material name the column would not take", async () => {
      const { result } = await laidOut("Bad Material");
      await expect(
        asOwner((tx) =>
          addPlanItem(tx, ownerCtx(), result.planId, {
            material: "Barbed Wire",
            label: "Wire",
            quantity: 10,
            unit: "ft",
          }),
        ),
      ).rejects.toMatchObject({ code: "LAYOUT_INVALID" });
    });

    it("refuses a quantity of nothing, and a negative price", async () => {
      const { result } = await laidOut("Bad Numbers");
      await expect(
        asOwner((tx) =>
          addPlanItem(tx, ownerCtx(), result.planId, {
            material: "post",
            label: "Posts",
            quantity: 0,
            unit: "each",
          }),
        ),
      ).rejects.toMatchObject({ code: "LAYOUT_INVALID" });

      await expect(
        asOwner((tx) =>
          addPlanItem(tx, ownerCtx(), result.planId, {
            material: "post",
            label: "Posts",
            quantity: 5,
            unit: "each",
            unitCost: -1,
          }),
        ),
      ).rejects.toMatchObject({ code: "LAYOUT_INVALID" });
    });

    it("DELETING A PLAN LEAVES ITS FEATURES STANDING", async () => {
      // Deciding not to proceed with a proposal is not deciding that the fence
      // you already built as part of it never happened.
      const { parcel, result } = await laidOut("Abandoned");
      const before = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id }),
      );
      await asOwner((tx) => deletePlan(tx, ownerCtx(), result.planId));

      const after = await asOwner((tx) =>
        listFeatures(tx, tenantId, { parcelId: parcel.id }),
      );
      expect(after).toHaveLength(before.length);
      expect(after.every((f) => f.planId === null)).toBe(true);
      expect(await asOwner((tx) => getPlan(tx, tenantId, result.planId))).toBeNull();
    });

    it("is the owner's call, not a chore", async () => {
      const { parcel } = await laidOut("Owner Only Plans");
      await expect(
        asOwner((tx) =>
          createPlan(tx, staffCtx(), { parcelId: parcel.id, name: "Theirs" }),
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("moves features in and out of a plan", async () => {
      const { parcel, result } = await laidOut("Moving");
      const loose = await asOwner((tx) =>
        createFeature(tx, ownerCtx(), {
          parcelId: parcel.id,
          kind: "fence",
          name: "Extra",
          geometry: LANE2,
        }),
      );
      expect(loose.planId).toBeNull();

      await asOwner((tx) =>
        setFeaturePlan(tx, ownerCtx(), [loose.id], result.planId),
      );
      expect(
        (await asOwner((tx) => getFeature(tx, tenantId, loose.id)))?.planId,
      ).toBe(result.planId);

      await asOwner((tx) => setFeaturePlan(tx, ownerCtx(), [loose.id], null));
      expect(
        (await asOwner((tx) => getFeature(tx, tenantId, loose.id)))?.planId,
      ).toBeNull();
    });
  });
});
