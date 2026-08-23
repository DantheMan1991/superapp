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
  let partyA: string;
  let partyB: string;
  let processorA: string;
  let processorB: string;
  let handleA: string;
  let priceItemA: string;
  let orderA: string;
  let orderB: string;
  let orderLineA: string;
  let bookingA: string;
  let bookingB: string;

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

      // ---- the processor directory ----
      const parties = await tx
        .insert(schema.parties)
        .values([
          {
            tenantId: tenantA,
            kind: "organization",
            displayName: "A Packing Co",
          },
          {
            tenantId: tenantB,
            kind: "organization",
            displayName: "B Packing Co",
          },
        ])
        .returning();
      partyA = parties[0].id;
      partyB = parties[1].id;

      const processors = await tx
        .insert(schema.productionProcessors)
        .values([
          {
            tenantId: tenantA,
            partyId: partyA,
            inspection: "usda",
            establishmentNumber: "EST 38",
            rating: 4,
            goodAt: "sausage",
          },
          {
            tenantId: tenantB,
            partyId: partyB,
            inspection: "custom_exempt",
            establishmentNumber: "EST 99",
          },
        ])
        .returning();
      processorA = processors[0].id;
      processorB = processors[1].id;

      const handles = await tx
        .insert(schema.productionProcessorHandles)
        .values([
          {
            tenantId: tenantA,
            processorId: processorA,
            kind: "cattle",
            killFeeCents: 9500,
          },
          {
            tenantId: tenantB,
            processorId: processorB,
            kind: "poultry",
            killFeeCents: 400,
          },
        ])
        .returning();
      handleA = handles[0].id;

      const priceItems = await tx
        .insert(schema.productionProcessorPriceItems)
        .values([
          {
            tenantId: tenantA,
            processorId: processorA,
            kind: "cattle",
            category: "cutting",
            label: "Cut and wrap",
            priceCents: 90,
            unit: "hanging_lb",
          },
          {
            tenantId: tenantB,
            processorId: processorB,
            kind: "poultry",
            category: "cutting",
            label: "Quartered",
            priceCents: 105,
            unit: "head",
          },
        ])
        .returning();
      priceItemA = priceItems[0].id;

      await tx.insert(schema.productionProcessorCuts).values([
        { tenantId: tenantA, processorId: processorA, name: "Bone-in ribeye" },
        { tenantId: tenantB, processorId: processorB, name: "Whole bird" },
      ]);

      const bookings = await tx
        .insert(schema.productionBookings)
        .values([
          {
            tenantId: tenantA,
            processorId: processorA,
            bookedFor: "2026-10-14",
            kind: "cattle",
            headCount: 4,
            status: "confirmed",
            depositCents: 20000,
            reference: "A-REF",
          },
          {
            tenantId: tenantB,
            processorId: processorB,
            bookedFor: "2026-10-15",
            kind: "poultry",
            headCount: 200,
            reference: "B-REF",
          },
        ])
        .returning();
      bookingA = bookings[0].id;
      bookingB = bookings[1].id;

      const orders = await tx
        .insert(schema.productionOrders)
        .values([
          {
            tenantId: tenantA,
            processorId: processorA,
            runId: runA,
            title: "Retained half",
            kind: "cattle",
            headCount: 1,
          },
          {
            tenantId: tenantB,
            processorId: processorB,
            bookingId: bookingB,
            title: "Their birds",
          },
        ])
        .returning();
      orderA = orders[0].id;
      orderB = orders[1].id;

      const orderLines = await tx
        .insert(schema.productionOrderLines)
        .values([
          {
            tenantId: tenantA,
            orderId: orderA,
            priceItemId: priceItemA,
            category: "cutting",
            label: "Cut and wrap",
            unitPriceCents: 90,
            unit: "hanging_lb",
          },
          {
            tenantId: tenantB,
            orderId: orderB,
            category: "cutting",
            label: "Quartered",
            unitPriceCents: 105,
            unit: "head",
          },
        ])
        .returning();
      orderLineA = orderLines[0].id;
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

  // ---- the processor directory ------------------------------------------

  /**
   * WHAT A LEAKED ROW HERE WOULD GIVE AWAY IS NOT A WEIGHT, and that is why
   * these tables get the same treatment as the traceability chain above. They
   * hold one farm's NEGOTIATED PRICES from a named local plant, beside its
   * candid private opinion of a business it has to keep working with. Handing
   * that to a neighbouring farm is commercially harmful in a way a leaked
   * hanging weight is not.
   */
  it("shows a tenant only its own processors, prices and cuts", async () => {
    const mine = await asStaff((tx) =>
      tx.select().from(schema.productionProcessors),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].establishmentNumber).toBe("EST 38");
    expect(mine[0].goodAt).toBe("sausage");

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.productionProcessors),
    );
    expect(theirs).toHaveLength(1);
    expect(theirs[0].establishmentNumber).toBe("EST 99");

    // The price is the row worth naming separately: it is the one a competitor
    // would actually want.
    const myFees = await asStaff((tx) =>
      tx.select().from(schema.productionProcessorHandles),
    );
    expect(myFees.map((h) => h.killFeeCents)).toEqual([9500]);
    const theirFees = await asOtherTenant((tx) =>
      tx.select().from(schema.productionProcessorHandles),
    );
    expect(theirFees.map((h) => h.killFeeCents)).toEqual([400]);

    const myCuts = await asStaff((tx) =>
      tx.select().from(schema.productionProcessorCuts),
    );
    expect(myCuts.map((c) => c.name)).toEqual(["Bone-in ribeye"]);
  });

  it("cannot see another tenant's rate sheet, line by line", async () => {
    // **A WORSE LEAK THAN THE HANDLE ROW IT CAME OUT OF.** A handle carried one
    // fee; this carries the whole sheet with the plant's own words on it, which
    // is exactly the document a farm should not be able to read over its
    // neighbour's shoulder.
    const mine = await asStaff((tx) =>
      tx.select().from(schema.productionProcessorPriceItems),
    );
    expect(mine.map((i) => i.label)).toEqual(["Cut and wrap"]);
    expect(mine.map((i) => i.priceCents)).toEqual([90]);

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.productionProcessorPriceItems),
    );
    expect(theirs.map((i) => i.label)).toEqual(["Quartered"]);
  });

  it("cannot hang a price item off another tenant's processor", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionProcessorPriceItems).values({
          tenantId: tenantA,
          processorId: processorB,
          kind: "cattle",
          label: "Slaughter",
          unit: "head",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot price one named thing twice for the same animal", async () => {
    // Two prices for one option, with nothing to say which is current — the
    // rule the handle's unique index states, at the finer grain the itemised
    // sheet needs. Quartered and eight-piece are two LABELS; quartered twice is
    // a contradiction.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionProcessorPriceItems).values({
          tenantId: tenantA,
          processorId: processorA,
          kind: "cattle",
          label: "Cut and wrap",
          unit: "hanging_lb",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a price with no unit the app knows about", async () => {
    // **THE CONSTRAINT THIS TABLE EXISTS FOR.** A figure whose unit the app
    // cannot interpret is the exact ambiguity that made a per-bird cutting rate
    // indistinguishable from a per-pound one, and it would render on screen as
    // a bare number with a slug after it.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionProcessorPriceItems)
          .set({ unit: "per_animal_ish" })
          .where(eq(schema.productionProcessorPriceItems.id, priceItemA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses a negative price and a negative minimum", async () => {
    for (const patch of [{ priceCents: -1 }, { minimumCents: -1 }]) {
      await expect(
        withSystem((tx) =>
          tx
            .update(schema.productionProcessorPriceItems)
            .set(patch)
            .where(eq(schema.productionProcessorPriceItems.id, priceItemA)),
        ),
      ).rejects.toThrow();
    }
  });

  it("refuses a price for something unnamed", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionProcessorPriceItems)
          .set({ label: "   " })
          .where(eq(schema.productionProcessorPriceItems.id, priceItemA)),
      ),
    ).rejects.toThrow();
  });

  it("cannot see another tenant's cut sheet, or the lines on it", async () => {
    // **A NARROWER LEAK THAN THE RATE SHEET'S AND WORSE IN ONE RESPECT.** A
    // line says what one named customer asked for on one date, at a price that
    // farm negotiated — somebody else's terms and somebody else's customer in
    // the same row.
    const mine = await asStaff((tx) =>
      tx.select().from(schema.productionOrders),
    );
    expect(mine.map((o) => o.title)).toEqual(["Retained half"]);
    const myLines = await asStaff((tx) =>
      tx.select().from(schema.productionOrderLines),
    );
    expect(myLines.map((l) => l.label)).toEqual(["Cut and wrap"]);
    expect(myLines.map((l) => l.unitPriceCents)).toEqual([90]);

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.productionOrders),
    );
    expect(theirs.map((o) => o.title)).toEqual(["Their birds"]);
  });

  it("cannot hang a cut sheet off another tenant's processor, run or date", async () => {
    for (const values of [
      { processorId: processorB, runId: runA },
      { processorId: processorA, runId: runB },
      { processorId: processorA, bookingId: bookingB },
    ]) {
      await expect(
        withSystem((tx) =>
          tx.insert(schema.productionOrders).values({
            tenantId: tenantA,
            ...values,
          }),
        ),
      ).rejects.toThrow();
    }
  });

  it("cannot put a line on another tenant's sheet", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionOrderLines).values({
          tenantId: tenantA,
          orderId: orderB,
          label: "Brisket",
        }),
      ),
    ).rejects.toThrow();
  });

  it("REFUSES A SHEET ATTACHED TO NEITHER A DATE NOR A RUN", async () => {
    // A sheet for a day that does not exist. The ops layer says it in words;
    // the CHECK is what makes it true of every path to the table.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionOrders).values({
          tenantId: tenantA,
          processorId: processorA,
        }),
      ),
    ).rejects.toThrow();
  });

  it("REFUSES A PRICE ON A LINE THAT DOES NOT SAY WHAT IT IS PER", async () => {
    // The itemised rate sheet's central rule, arriving on the order that quotes
    // from it: $1.05 with nothing saying whether it is a bird or a pound is the
    // exact ambiguity the price items table was built to end.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionOrderLines).values({
          tenantId: tenantA,
          orderId: orderA,
          label: "Cutting",
          unitPriceCents: 105,
        }),
      ),
    ).rejects.toThrow();
    // The reverse IS allowed — "per package, they never said what it costs".
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionOrderLines).values({
          tenantId: tenantA,
          orderId: orderA,
          label: "Vacuum pack",
          unit: "package",
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("refuses a nought quantity, which is not a line", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionOrderLines)
          .set({ quantity: 0 })
          .where(eq(schema.productionOrderLines.id, orderLineA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses a negative processing fee — a plant does not pay you to cut", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionRuns)
          .set({ processingFeeCents: -1 })
          .where(eq(schema.productionRuns.id, runA)),
      ),
    ).rejects.toThrow();
  });

  it("cannot read, update or delete another tenant's processor", async () => {
    const seen = await asOwner((tx) =>
      tx
        .select()
        .from(schema.productionProcessors)
        .where(eq(schema.productionProcessors.id, processorB)),
    );
    expect(seen).toHaveLength(0);

    const updated = await asOwner((tx) =>
      tx
        .update(schema.productionProcessors)
        .set({ rating: 1 })
        .where(eq(schema.productionProcessors.id, processorB))
        .returning(),
    );
    expect(updated).toHaveLength(0);

    const deleted = await asOwner((tx) =>
      tx
        .delete(schema.productionProcessors)
        .where(eq(schema.productionProcessors.id, processorB))
        .returning(),
    );
    expect(deleted).toHaveLength(0);
  });

  it("CANNOT ATTACH A PROCESSOR TO ANOTHER TENANT'S PARTY", async () => {
    // The composite FK. A processor is a role on the identity spine, so this is
    // the insert that would make one farm's directory point at another farm's
    // contact — and it fails even under withSystem, where RLS is not watching.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionProcessors).values({
          tenantId: tenantA,
          partyId: partyB,
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot hang a price or a cut off another tenant's processor", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionProcessorHandles).values({
          tenantId: tenantA,
          processorId: processorB,
          kind: "cattle",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionProcessorCuts).values({
          tenantId: tenantA,
          processorId: processorB,
          name: "Brisket",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot quote one kind twice at the same processor", async () => {
    // Two prices for one animal, with nothing to say which is current. The ops
    // layer turns a repeat into a correction; the index is what makes that true
    // of every path to the table.
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionProcessorHandles).values({
          tenantId: tenantA,
          processorId: processorA,
          kind: "cattle",
        }),
      ),
    ).rejects.toThrow();
  });

  it("refuses a negative per-head cutting fee", async () => {
    // The column a real rate sheet proved was missing. Same rule as the other
    // two fees: a plant does not pay you to cut.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionProcessorHandles)
          .set({ cutFeeCentsPerHead: -1 })
          .where(eq(schema.productionProcessorHandles.id, handleA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses a processor rated outside 1 to 5, and a negative fee", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionProcessors)
          .set({ rating: 6 })
          .where(eq(schema.productionProcessors.id, processorA)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionProcessorHandles)
          .set({ killFeeCents: -1 })
          .where(eq(schema.productionProcessorHandles.id, handleA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses an inspection status nothing in the app knows about", async () => {
    // The column decides where meat may legally be sold. A value the app cannot
    // interpret would render as a blank badge on the screen that answers that
    // question, so the database refuses it rather than the form alone.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionProcessors)
          .set({ inspection: "probably_fine" })
          .where(eq(schema.productionProcessors.id, processorA)),
      ),
    ).rejects.toThrow();
  });

  it("cannot move a processor into another tenant", async () => {
    // THROWS rather than returning zero rows, for the same reason the run does:
    // the row is visible to this tenant, so USING passes and it is the NEW
    // values that leave — which WITH CHECK refuses with 42501. Written the other
    // way round first, and the suite said so.
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.productionProcessors)
          .set({ tenantId: tenantB })
          .where(eq(schema.productionProcessors.id, processorA)),
      ),
    ).rejects.toThrow();
  });

  // ---- booked dates ------------------------------------------------------

  /**
   * **THE COMMERCIALLY SHARPEST TABLE IN THIS PACK.** A booking says which
   * plant a named farm is using, ON WHICH MORNING, for how many head, and what
   * it paid to hold the slot. Slaughter dates are the scarce resource — the
   * design says plants book six to twelve months ahead — so a competitor who
   * could read this would know which mornings to ring for and how much of the
   * season a neighbour has already taken.
   */
  it("shows a tenant only its own dates, head and deposits", async () => {
    const mine = await asStaff((tx) =>
      tx.select().from(schema.productionBookings),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].reference).toBe("A-REF");
    expect(mine[0].depositCents).toBe(20000);

    const theirs = await asOtherTenant((tx) =>
      tx.select().from(schema.productionBookings),
    );
    expect(theirs.map((b) => b.reference)).toEqual(["B-REF"]);
  });

  it("cannot read, move or cancel another tenant's date", async () => {
    expect(
      await asOwner((tx) =>
        tx
          .select()
          .from(schema.productionBookings)
          .where(eq(schema.productionBookings.id, bookingB)),
      ),
    ).toHaveLength(0);

    // Moving somebody else's slaughter date would be the worst available
    // outcome of a leak, not merely an information one.
    expect(
      await asOwner((tx) =>
        tx
          .update(schema.productionBookings)
          .set({ bookedFor: "2026-12-01" })
          .where(eq(schema.productionBookings.id, bookingB))
          .returning(),
      ),
    ).toHaveLength(0);

    expect(
      await asOwner((tx) =>
        tx
          .delete(schema.productionBookings)
          .where(eq(schema.productionBookings.id, bookingB))
          .returning(),
      ),
    ).toHaveLength(0);
  });

  it("CANNOT BOOK A DATE WITH ANOTHER TENANT'S PROCESSOR", async () => {
    await expect(
      withSystem((tx) =>
        tx.insert(schema.productionBookings).values({
          tenantId: tenantA,
          processorId: processorB,
          bookedFor: "2026-10-20",
        }),
      ),
    ).rejects.toThrow();
  });

  it("cannot point a booking at another tenant's run", async () => {
    // The composite FK. This is the join that will later say which processor
    // did a given run, so a cross-tenant one would attribute one farm's yield
    // to another farm's plant.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionBookings)
          .set({ runId: runB })
          .where(eq(schema.productionBookings.id, bookingA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses a cancelled date that claims it became a run", async () => {
    // A contradiction rather than an unusual arrangement, and the CHECK is what
    // makes the ops layer's refusal true of every path to the table.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionBookings)
          .set({ status: "cancelled", runId: runA })
          .where(eq(schema.productionBookings.id, bookingA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses a standing nothing in the app knows, and a date for no head", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionBookings)
          .set({ status: "probably" })
          .where(eq(schema.productionBookings.id, bookingA)),
      ),
    ).rejects.toThrow();
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionBookings)
          .set({ headCount: 0 })
          .where(eq(schema.productionBookings.id, bookingA)),
      ),
    ).rejects.toThrow();
  });

  it("a linked booking does not block deleting the run, or the tenant", async () => {
    /**
     * CASCADE, and this test is here because the first attempt was `SET NULL`
     * and it did not work — **a composite foreign key's `ON DELETE SET NULL`
     * nulls EVERY referencing column, `tenant_id` included, and that column is
     * `NOT NULL`.** So the delete failed outright rather than clearing the link,
     * which is a trap worth a test rather than only a comment.
     *
     * The reason CASCADE is also the RIGHT answer, not just the working one:
     * nothing in this app deletes a run, so the only path that removes one is
     * deleting the tenant — where the booking is being deleted anyway. The
     * elegant argument for SET NULL was defending a state nothing can reach.
     */
    await withSystem(async (tx) => {
      const [run] = await tx
        .insert(schema.productionRuns)
        .values({
          tenantId: tenantA,
          code: "A-DISPOSABLE",
          startedOn: "2026-10-14",
        })
        .returning();
      const [booking] = await tx
        .insert(schema.productionBookings)
        .values({
          tenantId: tenantA,
          processorId: processorA,
          bookedFor: "2026-10-14",
          runId: run.id,
        })
        .returning();

      await tx
        .delete(schema.productionRuns)
        .where(eq(schema.productionRuns.id, run.id));

      const after = await tx.query.productionBookings.findFirst({
        where: eq(schema.productionBookings.id, booking.id),
      });
      expect(after).toBeUndefined();
    });
  });

  it("cannot move a booking into another tenant", async () => {
    await expect(
      asOwner((tx) =>
        tx
          .update(schema.productionBookings)
          .set({ tenantId: tenantB })
          .where(eq(schema.productionBookings.id, bookingA)),
      ),
    ).rejects.toThrow();
  });

  // ---- the processing path ----------------------------------------------

  it("CANNOT SAY ANOTHER TENANT'S PLANT PROCESSED THIS FARM'S RUN", async () => {
    /**
     * The composite FK, and it guards more than a name. `production_runs.
     * processor_id` IS the processing path, and the inspection stamped from it
     * decides where the meat may legally be sold. A cross-tenant one would let
     * one farm's uninspected run inherit another farm's USDA establishment.
     */
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionRuns)
          .set({ processorId: processorB })
          .where(eq(schema.productionRuns.id, runA)),
      ),
    ).rejects.toThrow();
  });

  it("refuses an inspection nothing in the app knows", async () => {
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionRuns)
          .set({ inspection: "probably_fine" })
          .where(eq(schema.productionRuns.id, runA)),
      ),
    ).rejects.toThrow();
  });

  it("REFUSES TO FINISH A RUN WITHOUT SAYING HOW IT WAS INSPECTED", async () => {
    // The CHECK, and it is the one that keeps the eligibility answerable for
    // every finished run rather than most of them. A complete run with a null
    // inspection is a box of meat nothing can say the legal status of.
    await expect(
      withSystem((tx) =>
        tx
          .update(schema.productionRuns)
          .set({ status: "complete", inspection: null })
          .where(eq(schema.productionRuns.id, runA)),
      ),
    ).rejects.toThrow();

    // The same update WITH an inspection is fine — proving the refusal is about
    // the missing value and not about finishing a run at all.
    await withSystem(async (tx) => {
      await tx
        .update(schema.productionRuns)
        .set({ status: "complete", inspection: "uninspected" })
        .where(eq(schema.productionRuns.id, runA));
      await tx
        .update(schema.productionRuns)
        .set({ status: "in_progress", inspection: null })
        .where(eq(schema.productionRuns.id, runA));
    });
  });

  it("is default-deny on all eight tables with no tenant context", async () => {
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
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionProcessors),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionProcessorHandles),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionProcessorCuts),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionProcessorPriceItems),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionOrders),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionOrderLines),
      ),
    ).toHaveLength(0);
    expect(
      await withTenant(nowhere, (tx) =>
        tx.select().from(schema.productionBookings),
      ),
    ).toHaveLength(0);
  });
});
