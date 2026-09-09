import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { resetTellCooldown, type TellModel } from "../src/lib/tell-sources/model";
import {
  friendlyTellError,
  proposeTold,
  recordTold,
} from "../src/lib/tell-sources/resolve";
import type { TellCtx } from "../src/lib/tell-sources/types";
import { createItem, movementKindsForLots } from "../src/packs/inventory/ops";
import { createParcel, createZone } from "../src/packs/land/ops";
import { summariseHead } from "../src/packs/livestock/core/herd";
import { createLivestockLot, listLivestockLots } from "../src/packs/livestock/ops";

/**
 * Telling it what happened (ADR 0039), as a member through real RLS with the
 * model replaced by a function that answers what a test says the sentence
 * held.
 *
 * What this file certifies: a tenant is offered only the actions its own rows
 * can support; a proposal writes nothing; confirming one records through the
 * pack's own verb so the head count moves and the daily round shows it; the
 * pack's refusal arrives in the pack's words with the card named; and two
 * things told together are all-or-none.
 */
const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const TODAY = "2026-09-09";

const model =
  (entries: Array<{ action: string; fields: Record<string, unknown> }>): TellModel =>
  async () => ({ entries });

d("telling it what happened", () => {
  const STAMP = `tell-${process.pid}`;
  const OWNER = `${STAMP}-owner`;

  let tenantId: string;
  let lotId: string;
  let inventoryLotId: string;
  let zoneId: string;
  let feedItemId: string;

  const ctx = (): TellCtx => ({
    tenantId,
    userId: OWNER,
    role: "owner",
    today: TODAY,
  });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const propose = (sentence: string, entries: Array<{ action: string; fields: Record<string, unknown> }>) => {
    resetTellCooldown(tenantId);
    return proposeTold(ctx(), sentence, model(entries));
  };
  const failing = async (work: () => Promise<unknown>): Promise<string> => {
    try {
      await work();
    } catch (err) {
      return friendlyTellError(err);
    }
    throw new Error("expected a refusal");
  };
  const headNow = async () =>
    asOwner(async (tx) => {
      const movements = await movementKindsForLots(tx, tenantId, [inventoryLotId]);
      return summariseHead(movements.get(inventoryLotId) ?? []).balance;
    });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Tell Farm", slug: STAMP, industry: "homestead-farm" })
        .returning();
      tenantId = tenant.id;
      await tx
        .insert(schema.tenantModules)
        .values([
          { tenantId, moduleId: "livestock", enabled: true },
          { tenantId, moduleId: "inventory", enabled: true },
          { tenantId, moduleId: "land", enabled: true },
        ])
        .onConflictDoNothing();
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("offers nothing until there are animals to talk about", async () => {
    expect(await failing(() => propose("three chicks dead", []))).toBe(
      "There is nothing here to tell yet.",
    );
  });

  it("offers the actions this farm's own rows can support", async () => {
    await asOwner(async (tx) => {
      const created = await createLivestockLot(tx, ctx(), {
        newItemName: "Broiler chicks",
        code: "Pen 2",
        species: "poultry",
        head: 25,
        arrivedOn: "2026-08-01",
      });
      lotId = created.lot.id;
      inventoryLotId = created.inventoryLotId;
      feedItemId = (
        await createItem(tx, ctx(), { name: "Grower crumble", itemKind: "feed", stockingUnit: "lb" })
      ).id;
      const parcel = await createParcel(tx, ctx(), { name: "Home place" });
      zoneId = (await createZone(tx, ctx(), { parcelId: parcel.id, name: "Creek field" })).id;
    });

    const proposal = await propose("nothing much", []);
    expect(proposal.actions.map((a) => a.slug).sort()).toEqual([
      "livestock.check",
      "livestock.feed",
      "livestock.loss",
      "livestock.move",
    ]);
    // The pen is offered by name, and the feed by name and unit.
    const lotField = proposal.actions[0].fields.find((f) => f.key === "lot")!;
    expect(lotField.choices?.map((c) => c.label)).toEqual(["Pen 2"]);
    const feed = proposal.actions.find((a) => a.slug === "livestock.feed")!;
    expect(feed.fields.find((f) => f.key === "item")!.choices?.[0].label).toBe(
      "Grower crumble (lb)",
    );
    expect(proposal.cards).toEqual([]);
  });

  it("a proposal writes nothing, and confirming it moves the head count", async () => {
    const before = await headNow();
    expect(before).toBe(25);

    const proposal = await propose("three chicks dead in pen two, water was frozen", [
      {
        action: "livestock.loss",
        fields: { lot: "Pen 2", head: 3, reason: "Died", notes: "water was frozen" },
      },
    ]);
    expect(proposal.cards).toHaveLength(1);
    expect(proposal.cards[0].values).toMatchObject({
      lot: lotId,
      head: 3,
      reason: "death",
      // The sentence gave no day, and the field falls back to the farm's today.
      on: TODAY,
      notes: "water was frozen",
    });
    expect(await headNow()).toBe(25);

    const done = await recordTold(ctx(), [
      { actionSlug: "livestock.loss", values: proposal.cards[0].values },
    ]);
    expect(done.summaries).toEqual(["3 head — died — from Pen 2"]);
    expect(await headNow()).toBe(22);

    // Recorded through the pack's own verb, so the daily round has it too.
    const log = await asOwner((tx) =>
      tx.query.livestockDailyLogs.findMany({
        where: and(
          eq(schema.livestockDailyLogs.tenantId, tenantId),
          eq(schema.livestockDailyLogs.livestockLotId, lotId),
        ),
      }),
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ loggedOn: TODAY, status: "attention" });
  });

  it("keeps what it could not place, and will not record it until somebody picks", async () => {
    const proposal = await propose("moved them to the back paddock", [
      { action: "livestock.move", fields: { lot: "Pen 2", zone: "the back paddock" } },
    ]);
    expect(proposal.cards[0].values.zone).toBeNull();
    expect(proposal.cards[0].hints.zone).toBe("the back paddock");

    expect(
      await failing(() =>
        recordTold(ctx(), [
          { actionSlug: "livestock.move", values: proposal.cards[0].values },
        ]),
      ),
    ).toBe("Moved somewhere: Where to is missing.");

    // Picked, it records through the pack's verb.
    const done = await recordTold(ctx(), [
      {
        actionSlug: "livestock.move",
        values: { ...proposal.cards[0].values, zone: zoneId },
      },
    ]);
    expect(done.summaries).toEqual(["Pen 2 moved to Creek field"]);
  });

  it("a composed pack's refusal is the refusal, and two things told together are all or none", async () => {
    const head = await headNow();
    const message = await failing(() =>
      recordTold(ctx(), [
        // This one is fine, and comes first on purpose.
        {
          actionSlug: "livestock.loss",
          values: { lot: lotId, head: 1, reason: "death", on: TODAY, notes: null },
        },
        // Inventory refuses a feed of nothing, and its words arrive as they are.
        {
          actionSlug: "livestock.feed",
          values: { lot: lotId, item: feedItemId, quantity: 0, on: TODAY },
        },
      ]),
    );
    expect(message).toBe("Fed them: an issue has to be a positive quantity");
    // Neither landed: the loss that came first is not in the books either.
    expect(await headNow()).toBe(head);
    const lots = await asOwner((tx) => listLivestockLots(tx, tenantId));
    expect(lots).toHaveLength(1);
  });
});
