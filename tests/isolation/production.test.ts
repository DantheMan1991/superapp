import "dotenv/config";
import { afterAll, beforeAll, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema, type Tx } from "../../src/db";
import { d } from "./_shared";

/**
 * `production` RLS — the run, both ends of what it joins, and the carcass
 * between them.
 *
 * **THESE ROWS ARE HALF A TRACEABILITY CHAIN.** An input names the batch of
 * animals that went in; an output names the batch of meat that came out; a
 * carcass row is the animal in between, with its tag on it. Together they are
 * what says this package came from that pen, and that claim ends up on a
 * processor's paperwork. `inventory_movements` is FORCEd in its own right for
 * exactly that reason, and these are the other end of the same chain.
 *
 * So what has to be UNREPRESENTABLE rather than merely refused: a run input
 * pointing at another tenant's movement, an output landing in another tenant's
 * batch, a carcass attributed to another tenant's pen, and a run happening in
 * another tenant's building. All four are composite FKs, which is why they fail
 * even under `withSystem` where RLS is not watching.
 *
 * The carcass CHECKs are certified here too, at the level they are enforced. The
 * ops layer refuses a condemned carcass with a hanging weight in words a person
 * can read; the constraint is what makes that true of every path to the table,
 * including this one.
 */
d("production tables (RLS)", () => {
  const STAMP = `iso-prod-${process.pid}`;
  const OWNER = `${STAMP}-owner`;
  const MATE = `${STAMP}-mate`;
  const OTHER = `${STAMP}-other`;

  let tenantA: string;
  let tenantB: string;
  let runA: string;
  let runB: string;
  let itemA: string;
  let itemB: string;
  let lotA: string;
  let lotB: string;
  let movementA: string;
  let movementB: string;
  let assetB: string;
  let inputA: string;
  let inputB: string;
  let outputA: string;
  let carcassA: string;

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
          { clerkOrgId: `${STAMP}-a`, name: "Prod A", slug: `${STAMP}-a` },
          { clerkOrgId: `${STAMP}-b`, name: "Prod B", slug: `${STAMP}-b` },
        ])
        .returning();
      tenantA = tenants[0].id;
      tenantB = tenants[1].id;

      const assets = await tx
        .insert(schema.assets)
        .values([
          { tenantId: tenantA, kind: "building", name: "A kitchen" },
          { tenantId: tenantB, kind: "building", name: "B kitchen" },
        ])
        .returning();
      assetB = assets[1].id;

      const items = await tx
        .insert(schema.inventoryItems)
        .values([
          { tenantId: tenantA, name: "A flour", stockingUnit: "lb" },
          { tenantId: tenantB, name: "B flour", stockingUnit: "lb" },
        ])
        .returning();
      itemA = items[0].id;
      itemB = items[1].id;

      const lots = await tx
        .insert(schema.inventoryLots)
        .values([
          { tenantId: tenantA, itemId: itemA, code: "A-LOT" },
          { tenantId: tenantB, itemId: itemB, code: "B-LOT" },
        ])
        .returning();
      lotA = lots[0].id;
      lotB = lots[1].id;

      const movements = await tx
        .insert(schema.inventoryMovements)
        .values([
          {
            tenantId: tenantA,
            itemId: itemA,
            lotId: lotA,
            quantity: -50,
            movementKind: "issue",
            occurredOn: "2026-08-20",
            costCents: 3000,
          },
          {
            tenantId: tenantB,
            itemId: itemB,
            lotId: lotB,
            quantity: -50,
            movementKind: "issue",
            occurredOn: "2026-08-20",
            costCents: 3000,
          },
        ])
        .returning();
      movementA = movements[0].id;
      movementB = movements[1].id;

      const runs = await tx
        .insert(schema.productionRuns)
        .values([
          {
            tenantId: tenantA,
            code: "A-RUN",
            runKind: "baking",
            startedOn: "2026-08-20",
          },
          {
            tenantId: tenantB,
            code: "B-RUN",
            runKind: "baking",
            startedOn: "2026-08-20",
          },
        ])
        .returning();
      runA = runs[0].id;
      runB = runs[1].id;

      const inputs = await tx
        .insert(schema.productionRunInputs)
        .values([
          {
            tenantId: tenantA,
            runId: runA,
            inventoryMovementId: movementA,
            weightLb: 50,
          },
          {
            tenantId: tenantB,
            runId: runB,
            inventoryMovementId: movementB,
            weightLb: 50,
          },
        ])
        .returning();
      inputA = inputs[0].id;
      inputB = inputs[1].id;

      const outputs = await tx
        .insert(schema.productionRunOutputs)
        .values([
          {
            tenantId: tenantA,
            runId: runA,
            itemId: itemA,
            quantity: 60,
            lotCode: "A-RUN",
          },
          {
            tenantId: tenantB,
            runId: runB,
            itemId: itemB,
            quantity: 60,
            lotCode: "B-RUN",
          },
        ])
        .returning();
      outputA = outputs[0].id;

      const carcasses = await tx
        .insert(schema.productionRunCarcasses)
        .values([
          {
            tenantId: tenantA,
            runId: runA,
            runInputId: inputA,
            tag: "A-114",
            headCount: 1,
            liveLb: 1120,
            hangingLb: 690,
          },
          {
            tenantId: tenantB,
            runId: runB,
            runInputId: inputB,
            tag: "B-114",
            headCount: 1,
            liveLb: 1100,
            hangingLb: 680,
          },
        ])
        .returning();
      carcassA = carcasses[0].id;
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantA));
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantB));
    });
  });

  // ---- runs -------------------------------------------------------------

  it("a tenant sees only its own runs", async () => {
    const mine = await asOwner((tx) => tx.select().from(schema.productionRuns));
    expect(mine.map((r) => r.code)).toEqual(["A-RUN"]);
    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.productionRuns),
    );
    expect(theirs.map((r) => r.code)).toEqual(["B-RUN"]);
  });

  it("cannot read, update or delete another tenant's run", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.productionRuns)
          .where(eq(schema.productionRuns.id, runB)),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.productionRuns)
          .set({ code: "STOLEN" })
          .where(eq(schema.productionRuns.id, runB))
          .returning(),
      ),
    ).toHaveLength(0);
    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.productionRuns)
          .where(eq(schema.productionRuns.id, runB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("cannot move a run into another tenant", async () => {
    // THROWS rather than returning zero rows: the row is visible and it is the
    // new values that leave the tenant, so WITH CHECK refuses with 42501.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.productionRuns)
          .set({ tenantId: tenantB })
          .where(eq(schema.productionRuns.id, runA)),
      ),
    ).rejects.toThrow();
  });

  it("cannot hold a run in another tenant's building", async () => {
    // The composite FK makes it unrepresentable, so it fails even here under
    // withSystem where RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRuns).values({
          tenantId: tenantA,
          code: "TRESPASS",
          startedOn: "2026-08-20",
          locationAssetId: assetB,
        }),
      ),
    ).rejects.toThrow();
  });

  // ---- inputs -----------------------------------------------------------

  it("a tenant sees only its own run inputs", async () => {
    const mine = await asStaff((tx) =>
      tx.select().from(schema.productionRunInputs),
    );
    expect(mine.map((i) => i.id)).toEqual([inputA]);
  });

  it("CANNOT ATTRIBUTE ANOTHER TENANT'S STOCK TO THIS FARM'S RUN", async () => {
    /**
     * The one that matters most in this file. An input row is what says the
     * animals in this carcass came from that pen — the single claim the whole
     * traceability chain exists to make truthfully.
     */
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunInputs).values({
          tenantId: tenantA,
          runId: runA,
          inventoryMovementId: movementB,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot put an input on another tenant's run", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunInputs).values({
          tenantId: tenantA,
          runId: runB,
          inventoryMovementId: movementA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot use one movement as an input twice", async () => {
    // Two rows against the same movement would put one cost into two runs —
    // the same reason a feed draw is unique per movement.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunInputs).values({
          tenantId: tenantA,
          runId: runA,
          inventoryMovementId: movementA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move an input into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.productionRunInputs)
          .set({ tenantId: tenantB })
          .where(eq(schema.productionRunInputs.id, inputA)),
      ),
    ).rejects.toThrow();
  });

  // ---- outputs ----------------------------------------------------------

  it("a tenant sees only its own run outputs", async () => {
    const mine = await asStaff((tx) =>
      tx.select().from(schema.productionRunOutputs),
    );
    expect(mine.map((o) => o.lotCode)).toEqual(["A-RUN"]);
  });

  it("cannot land an output in another tenant's batch", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunOutputs).values({
          tenantId: tenantA,
          runId: runA,
          itemId: itemA,
          quantity: 10,
          lotCode: "TRESPASS",
          lotId: lotB,
          inventoryMovementId: movementA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot make an output of another tenant's item", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunOutputs).values({
          tenantId: tenantA,
          runId: runA,
          itemId: itemB,
          quantity: 10,
          lotCode: "TRESPASS",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a half-landed output", async () => {
    // Landed means BOTH the batch and the receipt. A movement with no lot is a
    // completion that stopped in the middle.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunOutputs).values({
          tenantId: tenantA,
          runId: runA,
          itemId: itemA,
          quantity: 10,
          lotCode: "HALF",
          inventoryMovementId: movementA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move an output into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.productionRunOutputs)
          .set({ tenantId: tenantB })
          .where(eq(schema.productionRunOutputs.id, outputA)),
      ),
    ).rejects.toThrow();
  });

  // ---- default deny -----------------------------------------------------

  // ---- the kill sheet ---------------------------------------------------

  /**
   * **THE LAST LINK IN THE CHAIN, AND THE ONE THAT NAMES AN ANIMAL.** An input
   * says a pen went in and an output says boxes came out; a carcass row is what
   * sits between them, carrying a tag, a weight and — when a plant condemned it
   * — the reason. A row visible across a boundary would attribute one farm's
   * condemnation to another farm's animals, which is worse than an ordinary
   * leak: a condemnation is a statement about whether meat was fit to sell.
   */
  it("shows a tenant only its own kill sheet", async () => {
    const mine = await asStaff((tx) =>
      tx.select().from(schema.productionRunCarcasses),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].tag).toBe("A-114");

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.productionRunCarcasses),
    );
    expect(theirs).toHaveLength(1);
    expect(theirs[0].tag).toBe("B-114");
  });

  it("cannot hang a carcass off another tenant's run", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunCarcasses).values({
          tenantId: tenantA,
          runId: runB,
          runInputId: inputA,
          headCount: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot attribute a carcass to another tenant's input", async () => {
    // The composite FK, and it is the one that matters most here: this is the
    // row that says which pen the animal came out of.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunCarcasses).values({
          tenantId: tenantA,
          runId: runA,
          runInputId: inputB,
          headCount: 1,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a condemned carcass carrying a hanging weight", async () => {
    // The CHECK is the backstop under the ops guard. A condemned carcass yields
    // nothing sellable, so pounds against one would find their way into a
    // numerator that only sellable meat belongs in.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunCarcasses).values({
          tenantId: tenantA,
          runId: runA,
          runInputId: inputA,
          headCount: 1,
          disposition: "condemned",
          hangingLb: 690,
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a cause on a carcass that passed", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunCarcasses).values({
          tenantId: tenantA,
          runId: runA,
          runInputId: inputA,
          headCount: 1,
          condemnReason: "bruising",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a line covering no head", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionRunCarcasses).values({
          tenantId: tenantA,
          runId: runA,
          runInputId: inputA,
          headCount: 0,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a carcass into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.productionRunCarcasses)
          .set({ tenantId: tenantB })
          .where(eq(schema.productionRunCarcasses.id, carcassA)),
      ),
    ).rejects.toThrow();
  });

  it("is default-deny on all four tables with no tenant context", async () => {
    // FORCE ROW LEVEL SECURITY: an unknown tenant sees nothing, even for the
    // connection's own role. The backstop the whole shell rests on.
    const nowhere = "00000000-0000-0000-0000-000000000000";
    expect(
      await withTenant(nowhere, (tx) => tx.select().from(schema.productionRuns)),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionRunInputs),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionRunOutputs),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionRunCarcasses),
      ),
    ).toHaveLength(0);
  });
});
