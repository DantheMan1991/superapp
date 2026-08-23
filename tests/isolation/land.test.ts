import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `land` RLS — parcels, zones and dated zone use.
 *
 * As with `assets`, the point of this file is that there is nothing special in
 * it. A capability pack's tables get exactly the treatment a core module's do:
 * tenant_id, FORCE RLS, default-deny with no context, and no cross-tenant read,
 * write or enumeration.
 *
 * It also certifies the two composite FKs, which are what this pack has that a
 * flat list of places does not. `land_zones_parcel_fk` and
 * `land_zone_uses_zone_fk` are both (tenant_id, x) → (tenant_id, id), so a
 * zone on another tenant's parcel — and a use on another tenant's zone — are
 * UNREPRESENTABLE rather than merely refused by application code. They fail
 * even under `withSystem`, where RLS is not watching.
 *
 * Fixtures are built under `withSystem` on purpose: this suite certifies what
 * the DATABASE enforces, and routing setup through `src/packs/land/ops.ts`
 * would let a bug in that file make these tests agree with it. The consequence
 * is that the pack's dimension-sync guarantees are NOT covered here — they
 * live in tests/land-ops.test.ts, and a pack needs both files.
 */
d("land tables (RLS)", () => {
  const STAMP = `iso-land-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`; // staff in tenant A
  const OTHER = `${STAMP}-other`; // owner of tenant B

  let tenantA: string;
  let tenantB: string;
  let homeA: string; // parcel in tenant A
  let northA: string; // zone on homeA
  let useA: string; // zone use on northA
  let leasedB: string; // parcel in tenant B
  let zoneB: string; // zone in tenant B

  const asStaff = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "staff", userId: MATE });
  const asOwner = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantA, fn, { role: "owner", userId: OWNER });
  const asOtherTenant = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantB, fn, { role: "owner", userId: OTHER });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const tenants = await tx
        .insert(schema.tenants)
        .values([
          { clerkOrgId: `${STAMP}-a`, name: "Land A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Land B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const home = await tx
        .insert(schema.landParcels)
        .values({
          tenantId: tenantA,
          name: "Home Farm",
          tenure: "owned",
          areaAcres: 120,
        })
        .returning();
      homeA = home[0].id;

      const north = await tx
        .insert(schema.landZones)
        .values({
          tenantId: tenantA,
          parcelId: homeA,
          name: "North Pasture",
          areaAcres: 10,
        })
        .returning();
      northA = north[0].id;

      const use = await tx
        .insert(schema.landZoneUses)
        .values({
          tenantId: tenantA,
          zoneId: northA,
          use: "pasture",
          startedOn: "2026-04-01",
        })
        .returning();
      useA = use[0].id;

      const leased = await tx
        .insert(schema.landParcels)
        .values({ tenantId: tenantB, name: "River Bottom", tenure: "leased" })
        .returning();
      leasedB = leased[0].id;

      const other = await tx
        .insert(schema.landZones)
        .values({ tenantId: tenantB, parcelId: leasedB, name: "Field 1" })
        .returning();
      zoneB = other[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
      await tx
        .delete(schema.profiles)
        .where(inArray(schema.profiles.clerkUserId, [OWNER, MATE, OTHER]));
    });
  });

  // ---- parcels ---------------------------------------------------------

  it("a tenant sees only its own parcels", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.landParcels));
    expect(mine.map((p) => p.name)).toEqual(["Home Farm"]);
    expect(mine.map((p) => p.id)).not.toContain(leasedB);

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.landParcels),
    );
    expect(theirs.map((p) => p.name)).toEqual(["River Bottom"]);
  });

  it("cannot read another tenant's parcel even by id", async () => {
    const found = await asOwner((tx) =>
      tx
        .select()
        .from(schema.landParcels)
        .where(eq(schema.landParcels.id, leasedB)),
    );
    expect(found).toHaveLength(0);
  });

  it("cannot update another tenant's parcel", async () => {
    const updated = await asOwner((tx) =>
      tx
        .update(schema.landParcels)
        .set({ name: "Stolen" })
        .where(eq(schema.landParcels.id, leasedB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const actual = await withSystem((tx) =>
      tx
        .select()
        .from(schema.landParcels)
        .where(eq(schema.landParcels.id, leasedB)),
    );
    expect(actual[0].name).toBe("River Bottom");
  });

  it("cannot delete another tenant's parcel", async () => {
    const deleted = await asOwner((tx) =>
      tx
        .delete(schema.landParcels)
        .where(eq(schema.landParcels.id, leasedB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("cannot insert a parcel stamped with another tenant", async () => {
    // WITH CHECK, not USING: the row would be invisible afterwards, but the
    // policy has to refuse it outright or a tenant could write into another's
    // data and simply not be able to read it back.
    await expect(
      asOwner((tx) =>
        tx
          .insert(schema.landParcels)
          .values({ tenantId: tenantB, name: "Smuggled" }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a parcel into another tenant", async () => {
    // THROWS rather than returning zero rows: the row IS visible, and it is the
    // new values that leave the tenant, so WITH CHECK refuses with 42501. Not
    // seeing a row and not being allowed to export one are different outcomes.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.landParcels)
          .set({ tenantId: tenantB })
          .where(eq(schema.landParcels.id, homeA)),
      ),
    ).rejects.toThrow();

    const stillMine = await withSystem((tx) =>
      tx
        .select()
        .from(schema.landParcels)
        .where(eq(schema.landParcels.id, homeA)),
    );
    expect(stillMine[0].tenantId).toBe(tenantA);
  });

  // ---- zones -----------------------------------------------------------

  it("a tenant sees only its own zones", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.landZones));
    expect(mine.map((z) => z.name)).toEqual(["North Pasture"]);
    expect(mine.map((z) => z.id)).not.toContain(zoneB);
  });

  it("cannot read, update or delete another tenant's zone", async () => {
    expect(
      await asOwner((tx) =>
        tx.select().from(schema.landZones).where(eq(schema.landZones.id, zoneB)),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.landZones)
          .set({ name: "Stolen" })
          .where(eq(schema.landZones.id, zoneB))
          .returning(),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.landZones)
          .where(eq(schema.landZones.id, zoneB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("cannot put a zone on another tenant's parcel", async () => {
    // The composite FK (tenant_id, parcel_id) → (tenant_id, id) makes this
    // unrepresentable rather than merely forbidden, so it fails even here
    // under withSystem, where RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.landZones)
          .values({ tenantId: tenantA, parcelId: leasedB, name: "Trespass" }),
      ),
    ).rejects.toThrow();
  });

  // ---- zone uses -------------------------------------------------------

  it("a tenant sees only its own zone uses", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.landZoneUses));
    expect(mine.map((u) => u.use)).toEqual(["pasture"]);

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.landZoneUses),
    );
    expect(theirs).toHaveLength(0);
  });

  it("cannot read another tenant's use history even by id", async () => {
    const found = await asOtherTenant((tx) =>
      tx
        .select()
        .from(schema.landZoneUses)
        .where(eq(schema.landZoneUses.id, useA)),
    );
    expect(found).toHaveLength(0);
  });

  it("cannot attach a use to another tenant's zone", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.landZoneUses).values({
          tenantId: tenantA,
          zoneId: zoneB,
          use: "hay",
          startedOn: "2026-04-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("the use history is protected in its own right, not by its zone's policy", async () => {
    // land_zone_uses carries no meaning of its own beyond its zone, and it
    // would have been tempting to let the composite FK keep it honest. FORCE
    // RLS on the child is what makes "no context, no rows" true for the
    // history as well as for the zone.
    await expect(
      asOtherTenant((tx) =>
        tx.insert(schema.landZoneUses).values({
          tenantId: tenantA,
          zoneId: northA,
          use: "crop",
          startedOn: "2026-04-01",
        }),
      ),
    ).rejects.toThrow();
  });

  // ---- occupancy -------------------------------------------------------

  it("a tenant sees only its own occupancy", async () => {
    await withSystem(async (tx) => {
      await tx.insert(schema.landOccupancy).values([
        {
          tenantId: tenantA,
          zoneId: northA,
          occupantLabel: "Cow herd",
          startedOn: "2026-08-01",
        },
        {
          tenantId: tenantB,
          zoneId: zoneB,
          occupantLabel: "Their sheep",
          startedOn: "2026-08-01",
        },
      ]);
    });

    const mine = await asOwner((tx) => tx.select().from(schema.landOccupancy));
    expect(mine.map((o) => o.occupantLabel)).toEqual(["Cow herd"]);

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.landOccupancy),
    );
    expect(theirs.map((o) => o.occupantLabel)).toEqual(["Their sheep"]);
  });

  it("cannot put occupancy on another tenant's zone", async () => {
    // The composite FK makes it unrepresentable, so it fails even here under
    // withSystem where RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.landOccupancy).values({
          tenantId: tenantA,
          zoneId: zoneB,
          occupantLabel: "Trespass",
          startedOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot write occupancy into another tenant", async () => {
    await expect(
      asOtherTenant((tx) =>
        tx.insert(schema.landOccupancy).values({
          tenantId: tenantA,
          zoneId: northA,
          occupantLabel: "Smuggled",
          startedOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses an occupancy range that ends before it starts", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.landOccupancy).values({
          tenantId: tenantA,
          zoneId: northA,
          occupantLabel: "Backwards",
          startedOn: "2026-08-10",
          endedOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a blank occupant label", async () => {
    // The label is what a rest report renders, and it is a copy rather than a
    // join — so a blank one is a row nobody can read.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.landOccupancy).values({
          tenantId: tenantA,
          zoneId: northA,
          occupantLabel: "   ",
          startedOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a rest target of zero", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.landParcels)
          .set({ restTargetDays: 0 })
          .where(eq(schema.landParcels.id, homeA)),
      ),
    ).rejects.toThrow();
  });

  // ---- shared ----------------------------------------------------------

  it("staff see the same land as an owner — RLS is tenancy, not role", async () => {
    // Who may WRITE is gated in the pack's action layer (owner-only). RLS
    // answers only whose rows these are, so whoever is sent to move a fence can
    // still find the paddock. See drizzle/0133_land_rls.sql.
    expect(
      (await asStaff((tx) => tx.select().from(schema.landParcels))).map(
        (p) => p.name,
      ),
    ).toEqual(["Home Farm"]);
    expect(
      (await asStaff((tx) => tx.select().from(schema.landZones))).map(
        (z) => z.name,
      ),
    ).toEqual(["North Pasture"]);
    expect(
      await asStaff((tx) => tx.select().from(schema.landZoneUses)),
    ).toHaveLength(1);
  });

  it("is default-deny on all three tables with no tenant context at all", async () => {
    // FORCE ROW LEVEL SECURITY: not even the connection's own role escapes.
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.landParcels)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.landZones)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.landZoneUses)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.landOccupancy)),
    ).toHaveLength(0);
  });

  it("refuses a zone use range that ends before it starts", async () => {
    // The CHECK behind the inclusive `ended_on` bound. Without it, a
    // superseding write with a bad date would produce a range that no report
    // could interpret.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.landZoneUses).values({
          tenantId: tenantA,
          zoneId: northA,
          use: "hay",
          startedOn: "2026-04-01",
          endedOn: "2026-03-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a zero or negative area", async () => {
    // Nobody owns zero acres. The column is nullable precisely so that
    // "unknown" has somewhere to live that is not a number.
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.landParcels)
          .values({ tenantId: tenantA, name: "Nothing", areaAcres: 0 }),
      ),
    ).rejects.toThrow();
  });
});
