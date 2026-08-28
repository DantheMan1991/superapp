import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `livestock` RLS — the biology extension and the identifiers.
 *
 * Three tables, because the lot and the head ledger are `inventory`'s and
 * occupancy is `land`'s, and each of those is certified in its own file. What
 * is left to prove here is that the extension cannot straddle a tenant
 * boundary: a biology row on another tenant's inventory lot, a tag on another
 * tenant's animal, and a daily check claiming somebody walked another tenant's
 * pens are all UNREPRESENTABLE rather than merely refused.
 *
 * `livestock_identifiers` gets its own policy pair rather than leaning on its
 * lot's, because it carries the official tag that puts a traceability chain
 * onto a processor's paperwork.
 *
 * Slice 4a adds `livestock_breed_parts` and the dam/sire columns. The PARENT
 * columns are the ones worth staring at: a composition is a fold that takes
 * half of each parent, so a cross-tenant parent would not merely be visible —
 * it would be half of what this farm's animals are made of.
 */
d("livestock tables (RLS)", () => {
  const STAMP = `iso-ls-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let lotA: string;
  let invLotA: string;
  let invLotB: string;
  let lotB: string;
  let feederA: string;
  let feederB: string;
  let movementA: string;
  let herdA: string;
  let herdB: string;
  let movementB: string;

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
      invLotA = invLots[0].id;
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

      await tx.insert(schema.livestockDailyLogs).values([
        {
          tenantId: tenantA,
          livestockLotId: lots[0].id,
          loggedOn: "2026-08-18",
          notes: "Ours",
        },
        {
          tenantId: tenantB,
          livestockLotId: lots[1].id,
          loggedOn: "2026-08-18",
          notes: "Theirs",
        },
      ]);

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

      // Slice 2. A feeder each side, one lot on each, and one draw each — an
      // ordinary `inventory_movements` issue with nobody named, which is what
      // makes its cost allocated rather than measured.
      const feeders = await tx
        .insert(schema.livestockFeedGroups)
        .values([
          { tenantId: tenantA, name: "Our bin" },
          { tenantId: tenantB, name: "Their bin" },
        ])
        .returning();
      feederA = feeders[0].id;
      feederB = feeders[1].id;

      await tx.insert(schema.livestockFeedGroupMembers).values([
        {
          tenantId: tenantA,
          feedGroupId: feederA,
          livestockLotId: lotA,
          startedOn: "2026-08-01",
        },
        {
          tenantId: tenantB,
          feedGroupId: feederB,
          livestockLotId: lotB,
          startedOn: "2026-08-01",
        },
      ]);

      const movements = await tx
        .insert(schema.inventoryMovements)
        .values([
          {
            tenantId: tenantA,
            itemId: items[0].id,
            lotId: invLotA,
            quantity: -20,
            movementKind: "issue",
            occurredOn: "2026-08-10",
            costCents: 1000,
            extensionSlug: "livestock",
          },
          {
            tenantId: tenantB,
            itemId: items[1].id,
            lotId: invLotB,
            quantity: -20,
            movementKind: "issue",
            occurredOn: "2026-08-10",
            costCents: 9999,
            extensionSlug: "livestock",
          },
        ])
        .returning();
      movementA = movements[0].id;
      movementB = movements[1].id;

      await tx.insert(schema.livestockTreatments).values([
        {
          tenantId: tenantA,
          livestockLotId: lots[0].id,
          treatedOn: '2026-08-01',
          product: 'Ours',
          route: 'water',
          meatWithdrawalDays: 10,
        },
        {
          tenantId: tenantB,
          livestockLotId: lots[1].id,
          treatedOn: '2026-08-01',
          product: 'Theirs',
          route: 'injection',
          meatWithdrawalDays: 21,
        },
      ]);

      await tx.insert(schema.livestockWeights).values([
        {
          tenantId: tenantA,
          livestockLotId: lots[0].id,
          weighedOn: '2026-08-19',
          method: 'sample',
          sampleSize: 10,
          sampleWeightLb: 62.5,
          notes: 'Ours',
        },
        {
          tenantId: tenantB,
          livestockLotId: lots[1].id,
          weighedOn: '2026-08-19',
          method: 'scale',
          sampleSize: 1,
          sampleWeightLb: 1150,
          notes: 'Theirs',
        },
      ]);

      // Slice 7. A herd each side, with our own animal in ours — enough for
      // the cross-tenant membership writes below to have something to fail at.
      const herds = await tx
        .insert(schema.livestockGroups)
        .values([
          { tenantId: tenantA, name: "Our herd" },
          { tenantId: tenantB, name: "Their herd" },
        ])
        .returning();
      herdA = herds[0].id;
      herdB = herds[1].id;
      await tx.insert(schema.livestockGroupMembers).values({
        tenantId: tenantA,
        livestockGroupId: herdA,
        livestockLotId: lotA,
        startedOn: "2026-08-01",
      });

      // Slice 4a. One stated breed each side, so the RLS reads below have
      // something to fail to see.
      await tx.insert(schema.livestockBreedParts).values([
        { tenantId: tenantA, livestockLotId: lotA, breed: "angus", parts: 1 },
        { tenantId: tenantB, livestockLotId: lotB, breed: "hereford", parts: 1 },
      ]);

      await tx.insert(schema.livestockFeedDraws).values([
        {
          tenantId: tenantA,
          feedGroupId: feederA,
          inventoryMovementId: movementA,
        },
        {
          tenantId: tenantB,
          feedGroupId: feederB,
          inventoryMovementId: movementB,
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
          .set({ notes: "Stolen" })
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
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.livestockDailyLogs),
      ),
    ).toHaveLength(0);
  });

  it("a tenant sees only its own daily checks", async () => {
    // The check is the claim that somebody walked the pens, and the mortality
    // denominator rests on it. Another tenant's rounds must not be readable,
    // countable, or contributory to anything here.
    const mine = await asStaff((tx) => tx.select().from(schema.livestockDailyLogs));
    expect(mine.map((l) => l.notes)).toEqual(["Ours"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.livestockDailyLogs),
    );
    expect(theirs.map((l) => l.notes)).toEqual(["Theirs"]);
  });

  it("cannot record a check against another tenant's animals", async () => {
    // Unrepresentable rather than refused: the composite FK makes the row
    // impossible even under `withSystem`, where RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockDailyLogs).values({
          tenantId: tenantA,
          livestockLotId: lotB,
          loggedOn: "2026-08-19",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a SECOND check on the same lot on the same day", async () => {
    // One look is one fact. The unique index is also what lets the one-tap
    // round insert ON CONFLICT DO NOTHING and leave an exception standing.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockDailyLogs).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          loggedOn: "2026-08-18",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a staff member can write a check, because the round is a chore", async () => {
    // RLS answers only "whose rows are these". That the round is member-wide
    // is the whole reason slice 1 is usable by whoever is in the pens.
    const rows = await asStaff((tx) =>
      tx
        .insert(schema.livestockDailyLogs)
        .values({
          tenantId: tenantA,
          livestockLotId: lotA,
          loggedOn: "2026-08-19",
          recordedBy: MATE,
        })
        .returning(),
    );
    expect(rows).toHaveLength(1);
  });
  // ---- slice 2: the feed tables ------------------------------------------

  it("a tenant sees only its own feeders", async () => {
    const mine = await asStaff((tx) =>
      tx.select().from(schema.livestockFeedGroups),
    );
    expect(mine.map((g) => g.name)).toEqual(["Our bin"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.livestockFeedGroups),
    );
    expect(theirs.map((g) => g.name)).toEqual(["Their bin"]);
  });

  it("cannot put another tenant's animals on our feeder", async () => {
    // Unrepresentable rather than refused: the composite FK makes the row
    // impossible even under `withSystem`, where RLS is not watching. Without
    // this, another tenant's head count could dilute our allocation basis.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockFeedGroupMembers).values({
          tenantId: tenantA,
          feedGroupId: feederA,
          livestockLotId: lotB,
          startedOn: "2026-08-19",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot put our animals on another tenant's feeder", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockFeedGroupMembers).values({
          tenantId: tenantA,
          feedGroupId: feederB,
          livestockLotId: lotA,
          startedOn: "2026-08-19",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a membership that ends before it starts", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockFeedGroupMembers).values({
          tenantId: tenantA,
          feedGroupId: feederA,
          livestockLotId: lotA,
          startedOn: "2026-08-19",
          endedOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("memberships and draws are protected in their own right", async () => {
    const mine = await asOwner((tx) =>
      tx.select().from(schema.livestockFeedGroupMembers),
    );
    expect(mine.every((m) => m.tenantId === tenantA)).toBe(true);
    expect(mine).toHaveLength(1);
    const theirDraws = await asOtherTenant((tx) =>
      tx.select().from(schema.livestockFeedDraws),
    );
    expect(theirDraws.every((d) => d.tenantId === tenantB)).toBe(true);
    expect(theirDraws).toHaveLength(1);
  });

  it("A DRAW CANNOT NAME ANOTHER TENANT'S MOVEMENT", async () => {
    // The draw carries no money of its own — the cost is on the movement it
    // points at. A cross-tenant pointer would put another farm's feed bill into
    // this farm's allocation, and the composite FK is what forbids it.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockFeedDraws).values({
          tenantId: tenantA,
          feedGroupId: feederA,
          inventoryMovementId: movementB,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a SECOND draw row for the same movement", async () => {
    // Two rows would put the same cost in two pots and double the farm's feed
    // bill without changing a single ledger entry.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockFeedDraws).values({
          tenantId: tenantA,
          feedGroupId: feederA,
          inventoryMovementId: movementA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a feeder with a blank name", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .insert(schema.livestockFeedGroups)
          .values({ tenantId: tenantA, name: "   " }),
      ),
    ).rejects.toThrow();
  });

  it("a staff member can put a lot on a feeder and record a draw", async () => {
    // Both are chores done by whoever moved the birds and opened the bin. RLS
    // answers only "whose rows are these"; the pack's action layer is what keeps
    // CREATING a feeder with the owner.
    const rows = await asStaff((tx) =>
      tx
        .insert(schema.livestockFeedGroupMembers)
        .values({
          tenantId: tenantA,
          feedGroupId: feederA,
          livestockLotId: lotA,
          startedOn: "2026-08-20",
        })
        .returning(),
    );
    expect(rows).toHaveLength(1);
  });

  it("the feed tables are default-deny with no tenant context", async () => {
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.livestockFeedGroups),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.livestockFeedDraws),
      ),
    ).toHaveLength(0);
  });
  // ---- slice 5: weights ---------------------------------------------------

  it("a tenant sees only its own weighings", async () => {
    // These rows are the DENOMINATOR of the only number the broiler enterprise
    // is judged on. A leak here would not merely expose data, it would let
    // another farm's scale readings into this farm's feed conversion.
    const mine = await asStaff((tx) => tx.select().from(schema.livestockWeights));
    expect(mine.map((w) => w.notes)).toEqual(["Ours"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.livestockWeights),
    );
    expect(theirs.map((w) => w.notes)).toEqual(["Theirs"]);
  });

  it("cannot weigh another tenant's animals", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockWeights).values({
          tenantId: tenantA,
          livestockLotId: lotB,
          weighedOn: "2026-08-20",
          method: "sample",
          sampleSize: 10,
          sampleWeightLb: 40,
        }),
      ),
    ).rejects.toThrow();
  });

  it("REFUSES A WEIGHING THAT MEASURED NOTHING", async () => {
    // Neither a scale reading nor a tape reading. A row like that is a record
    // that somebody thought about weighing.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockWeights).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          weighedOn: "2026-08-20",
          method: "visual",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a sample of nobody, and a weight of nothing", async () => {
    // A sample size of zero would make the average a division by zero rather
    // than an unknown; a zero weight reads as a dead-weight answer.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockWeights).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          weighedOn: "2026-08-20",
          method: "sample",
          sampleSize: 0,
          sampleWeightLb: 40,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockWeights).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          weighedOn: "2026-08-20",
          method: "scale",
          sampleSize: 1,
          sampleWeightLb: 0,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses an invented method format", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockWeights).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          weighedOn: "2026-08-20",
          method: "Guessed It",
          sampleWeightLb: 40,
        }),
      ),
    ).rejects.toThrow();
  });

  it("a staff member can weigh, because catching birds is a chore", async () => {
    const rows = await asStaff((tx) =>
      tx
        .insert(schema.livestockWeights)
        .values({
          tenantId: tenantA,
          livestockLotId: lotA,
          weighedOn: "2026-08-21",
          method: "sample",
          sampleSize: 10,
          sampleWeightLb: 62.5,
          recordedBy: MATE,
        })
        .returning(),
    );
    expect(rows).toHaveLength(1);
  });

  it("weighings are default-deny with no tenant context", async () => {
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.livestockWeights),
      ),
    ).toHaveLength(0);
  });
  // ---- slice 3: treatments ------------------------------------------------

  it("a tenant sees only its own treatments", async () => {
    // These rows decide whether meat and milk can lawfully be sold. A leak in
    // one direction puts this farm's animals under a withdrawal that does not
    // apply; a leak in the other makes a treated lot read as clear.
    const mine = await asStaff((tx) =>
      tx.select().from(schema.livestockTreatments),
    );
    expect(mine.map((t) => t.product)).toEqual(["Ours"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.livestockTreatments),
    );
    expect(theirs.map((t) => t.product)).toEqual(["Theirs"]);
  });

  it("cannot treat another tenant's animals", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockTreatments).values({
          tenantId: tenantA,
          livestockLotId: lotB,
          treatedOn: "2026-08-20",
          product: "Penicillin G",
          route: "injection",
          meatWithdrawalDays: 10,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a withdrawal clock running backwards", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockTreatments).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          treatedOn: "2026-08-20",
          product: "Penicillin G",
          route: "injection",
          meatWithdrawalDays: -1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a nameless product and an invented source", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockTreatments).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          treatedOn: "2026-08-20",
          product: "   ",
          route: "water",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockTreatments).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          treatedOn: "2026-08-20",
          product: "X",
          route: "water",
          withdrawalSource: "i_reckon",
        }),
      ),
    ).rejects.toThrow();
  });

  it("a staff member can record a treatment, because they gave it", async () => {
    const rows = await asStaff((tx) =>
      tx
        .insert(schema.livestockTreatments)
        .values({
          tenantId: tenantA,
          livestockLotId: lotA,
          treatedOn: "2026-08-21",
          product: "Penicillin G",
          route: "injection",
          meatWithdrawalDays: 10,
          recordedBy: MATE,
        })
        .returning(),
    );
    expect(rows).toHaveLength(1);
  });

  it("treatments are default-deny with no tenant context", async () => {
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.livestockTreatments),
      ),
    ).toHaveLength(0);
  });

  // ------------------------------------------------- slice 4a: breeding ---
  //
  // Two claims, and the second is the one that would be missed. A breed
  // composition leaking across tenants is ordinary data leakage; a PARENT
  // leaking is arithmetic — `resolveComposition` folds a parent into half the
  // animal, so a row from another farm would silently change what this farm's
  // cattle are made of.

  it("a tenant sees only its own breeding", async () => {
    const mine = await asOwner((tx) =>
      tx.select().from(schema.livestockBreedParts),
    );
    expect(mine.map((p) => p.breed)).toEqual(["angus"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.livestockBreedParts),
    );
    expect(theirs.map((p) => p.breed)).toEqual(["hereford"]);
  });

  it("CANNOT NAME ANOTHER TENANT'S ANIMAL AS A PARENT", async () => {
    // The composite FK makes it unrepresentable, so it fails even here under
    // withSystem where RLS is not watching. This is the one that matters: a
    // cross-tenant dam would be half of this animal's breeding.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.livestockLots)
          .set({ damLotId: lotB })
          .where(eq(schema.livestockLots.id, lotA)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.livestockLots)
          .set({ sireLotId: lotB })
          .where(eq(schema.livestockLots.id, lotA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses an animal that is its own parent", async () => {
    // The one-step loop, stopped by a CHECK. Longer ones are the write path's
    // job — a CHECK cannot see other rows.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.livestockLots)
          .set({ damLotId: lotA })
          .where(eq(schema.livestockLots.id, lotA)),
      ),
    ).rejects.toThrow();
  });

  it("cannot state breeding for another tenant's animal", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockBreedParts).values({
          tenantId: tenantA,
          livestockLotId: lotB,
          breed: "stolen",
          parts: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a breed that is not a slug, and a share of nothing", async () => {
    await expect(
      asOwner((tx) =>
        tx.insert(schema.livestockBreedParts).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          breed: "Red Angus",
          parts: 1,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) =>
        tx.insert(schema.livestockBreedParts).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          breed: "simmental",
          parts: 0,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses the same breed twice on one animal", async () => {
    // Two rows for Angus would be one fact written twice, and which one the
    // fold used would be arbitrary.
    await expect(
      asOwner((tx) =>
        tx.insert(schema.livestockBreedParts).values({
          tenantId: tenantA,
          livestockLotId: lotA,
          breed: "angus",
          parts: 3,
        }),
      ),
    ).rejects.toThrow();
  });


  // ---- herds: a set of animals somebody created and put lots into ----------

  it("a tenant sees only its own herds", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.livestockGroups));
    expect(mine.map((g) => g.name)).toEqual(["Our herd"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.livestockGroups),
    );
    expect(theirs.map((g) => g.name)).toEqual(["Their herd"]);
  });

  it("CANNOT PUT ANOTHER TENANT'S ANIMAL IN OUR HERD", async () => {
    // The composite FK makes it unrepresentable, so it fails under withSystem
    // where RLS is not watching. This is the one that would MOVE ANIMALS:
    // `moveGroupToZone` writes land_occupancy for every member it finds.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockGroupMembers).values({
          tenantId: tenantA,
          livestockGroupId: herdA,
          livestockLotId: lotB,
          startedOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot put our animal in another tenant's herd", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.livestockGroupMembers).values({
          tenantId: tenantA,
          livestockGroupId: herdB,
          livestockLotId: lotA,
          startedOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("ONE OPEN MEMBERSHIP PER ANIMAL, ACROSS ALL HERDS", async () => {
    // A cow is not in two herds. Making that unrepresentable is what lets
    // "move her to the other herd" be one act rather than a question about
    // which of two answers is current.
    const [second] = await asOwner((tx) =>
      tx
        .insert(schema.livestockGroups)
        .values({ tenantId: tenantA, name: "Second herd" })
        .returning(),
    );
    await expect(
      asOwner((tx) =>
        tx.insert(schema.livestockGroupMembers).values({
          tenantId: tenantA,
          livestockGroupId: second.id,
          livestockLotId: lotA,
          startedOn: "2026-08-02",
        }),
      ),
    ).rejects.toThrow();

    // A CLOSED one is fine — that is exactly what a history looks like.
    const ok = await asOwner((tx) =>
      tx
        .insert(schema.livestockGroupMembers)
        .values({
          tenantId: tenantA,
          livestockGroupId: second.id,
          livestockLotId: lotA,
          startedOn: "2026-07-01",
          endedOn: "2026-07-31",
        })
        .returning(),
    );
    expect(ok).toHaveLength(1);
  });

  it("refuses a membership that ends before it starts", async () => {
    await expect(
      asOwner((tx) =>
        tx.insert(schema.livestockGroupMembers).values({
          tenantId: tenantA,
          livestockGroupId: herdA,
          livestockLotId: lotA,
          startedOn: "2026-08-10",
          endedOn: "2026-08-01",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a herd with a blank name and an invented status", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .insert(schema.livestockGroups)
          .values({ tenantId: tenantA, name: "   " }),
      ),
    ).rejects.toThrow();
    await expect(
      asOwner((tx) =>
        tx
          .insert(schema.livestockGroups)
          .values({ tenantId: tenantA, name: "Odd", status: "retired" }),
      ),
    ).rejects.toThrow();
  });

  it("a staff member can move animals between herds, because it is a chore", async () => {
    const rows = await asStaff((tx) =>
      tx
        .insert(schema.livestockGroupMembers)
        .values({
          tenantId: tenantA,
          livestockGroupId: herdA,
          livestockLotId: lotA,
          startedOn: "2026-06-01",
          endedOn: "2026-06-30",
        })
        .returning(),
    );
    expect(rows).toHaveLength(1);
  });

  it("herds are default-deny with no tenant context", async () => {
    const nowhere = "00000000-0000-0000-0000-000000000000";
    const seen = await withTenant(nowhere, async (tx) => [
      await tx.select().from(schema.livestockGroups),
      await tx.select().from(schema.livestockGroupMembers),
    ]);
    for (const rows of seen) expect(rows).toHaveLength(0);
  });

  it("breeding is default-deny with no tenant context", async () => {
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.livestockBreedParts),
      ),
    ).toHaveLength(0);
  });
});

