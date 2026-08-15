import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../src/db";
import {
  LandError,
  PARCEL_DIMENSION,
  ZONE_DIMENSION,
  createParcel,
  createZone,
  currentUses,
  endZoneUse,
  getParcel,
  getZone,
  listParcels,
  listZoneUses,
  listZones,
  retireParcel,
  retireZone,
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

  it("refuses a staff write on every entity", async () => {
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

  it("stores area at the column's scale", async () => {
    const parcel = await asOwner((tx) =>
      createParcel(tx, ownerCtx(), { name: "Precise", areaAcres: 12.3456 }),
    );
    const fetched = await asOwner((tx) => getParcel(tx, tenantId, parcel.id));
    expect(fetched?.areaAcres).toBe(12.3456);
  });
});
