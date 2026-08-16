import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `livestock` RLS — the biology extension and the identifiers.
 *
 * Two tables, because the lot and the head ledger are `inventory`'s and
 * occupancy is `land`'s, and each of those is certified in its own file. What
 * is left to prove here is that the extension cannot straddle a tenant
 * boundary: a biology row on another tenant's inventory lot, and a tag on
 * another tenant's animal, are both UNREPRESENTABLE rather than merely refused.
 *
 * `livestock_identifiers` gets its own policy pair rather than leaning on its
 * lot's, because it carries the official tag that puts a traceability chain
 * onto a processor's paperwork.
 */
d("livestock tables (RLS)", () => {
  const STAMP = `iso-ls-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let lotA: string;
  let invLotB: string;
  let lotB: string;

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
          { clerkOrgId: `${STAMP}-a`, name: "LS A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "LS B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const items = await tx
        .insert(schema.inventoryItems)
        .values([
          { tenantId: tenantA, name: "Chicks", stockingUnit: "head" },
          { tenantId: tenantB, name: "Their chicks", stockingUnit: "head" },
        ])
        .returning();

      const invLots = await tx
        .insert(schema.inventoryLots)
        .values([
          { tenantId: tenantA, itemId: items[0].id, code: "A-1" },
          { tenantId: tenantB, itemId: items[1].id, code: "B-1" },
        ])
        .returning();
      invLotB = invLots[1].id;

      const lots = await tx
        .insert(schema.livestockLots)
        .values([
          {
            tenantId: tenantA,
            inventoryLotId: invLots[0].id,
            species: "poultry",
          },
          { tenantId: tenantB, inventoryLotId: invLots[1].id, species: "cattle" },
        ])
        .returning();
      lotA = lots[0].id;
      lotB = lots[1].id;

      await tx.insert(schema.livestockIdentifiers).values([
        {
          tenantId: tenantA,
          livestockLotId: lotA,
          identifierKind: "visual",
          value: "47",
        },
        {
          tenantId: tenantB,
          livestockLotId: lotB,
          identifierKind: "official",
          value: "THEIRS-1",
        },
      ]);
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

  it("a tenant sees only its own animal lots", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.livestockLots));
    expect(mine.map((l) => l.species)).toEqual(["poultry"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.livestockLots),
    );
    expect(theirs.map((l) => l.species)).toEqual(["cattle"]);
  });

  it("cannot read or change another tenant's lot", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.livestockLots)
          .where(eq(schema.livestockLots.id, lotB)),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.livestockLots)
          .set({ breed: "Stolen" })
          .where(eq(schema.livestockLots.id, lotB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("cannot attach biology to another tenant's inventory lot", async () => {
    // The composite FK makes it unrepresentable, so it fails even here under
    // withSystem where RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockLots).values({
          tenantId: tenantA,
          inventoryLotId: invLotB,
          species: "poultry",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a SECOND biology row for the same inventory lot", async () => {
    // The extension is strictly 1:1. Two biologies for one lot would make
    // "what species is this" ambiguous, and the unique index is what stops it.
    const mine = await withSystem((tx) =>
      tx
        .select()
        .from(schema.livestockLots)
        .where(eq(schema.livestockLots.id, lotA)),
    );
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockLots).values({
          tenantId: tenantA,
          inventoryLotId: mine[0].inventoryLotId,
          species: "swine",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot tag another tenant's animal", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockIdentifiers).values({
          tenantId: tenantA,
          livestockLotId: lotB,
          identifierKind: "visual",
          value: "TRESPASS",
        }),
      ),
    ).rejects.toThrow();
  });

  it("identifiers are protected in their own right", async () => {
    // They carry the official tag that reaches a processor's paperwork, so
    // "no context, no rows" has to be true of this table by itself.
    const mine = await asOwner((tx) =>
      tx.select().from(schema.livestockIdentifiers),
    );
    expect(mine.map((i) => i.value)).toEqual(["47"]);
    await expect(
      asOtherTenant((tx) =>
        tx.insert(schema.livestockIdentifiers).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          identifierKind: "visual",
          value: "SMUGGLED",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a blank tag value and an invented sex", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockIdentifiers).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          identifierKind: "visual",
          value: "   ",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.livestockLots)
          .set({ sex: "unknown" })
          .where(eq(schema.livestockLots.id, lotA)),
      ),
    ).rejects.toThrow();
  });

  it("staff see the same animals as an owner", async () => {
    expect(
      await asStaff((tx) => tx.select().from(schema.livestockLots)),
    ).toHaveLength(1);
    expect(
      await asStaff((tx) => tx.select().from(schema.livestockIdentifiers)),
    ).toHaveLength(1);
  });

  it("is default-deny with no tenant context", async () => {
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.livestockLots)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.livestockIdentifiers),
      ),
    ).toHaveLength(0);
  });
});
