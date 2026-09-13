import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { resetTellCooldown, type TellModel } from "../src/lib/tell-sources/model";
import {
  friendlyTellError,
  previewTold,
  proposeTold,
  recordTold,
} from "../src/lib/tell-sources/resolve";
import type { TellCtx } from "../src/lib/tell-sources/types";
import { createItem, movementKindsForLots } from "../src/packs/inventory/ops";
import { createParcel, createZone } from "../src/packs/land/ops";
import { summariseHead } from "../src/packs/livestock/core/herd";
import {
  createLivestockLot,
  listLivestockLots,
  startIndividual,
} from "../src/packs/livestock/ops";

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
// A fixed instant ON that day in the fixture's zone, so `ctx.now` and
// `ctx.today` agree. Anything that stamps a timestamp reads `now`.
const NOW = new Date("2026-09-09T15:00:00.000Z");

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
    now: NOW,
    timezone: "UTC",
    industry: "homestead-farm",
    today: TODAY,
  });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: OWNER });

  const propose = (sentence: string, entries: Array<{ action: string; fields: Record<string, unknown> }>) => {
    resetTellCooldown(tenantId, OWNER);
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
    /*
     * **THE WHOLE LIST, AND ON PURPOSE.** This fixture keeps `livestock`,
     * `inventory` and `land` switched on, so every source those modules have
     * contributes here — and asserting the exact set means **adding a source
     * cannot happen without somebody acknowledging that it changes what every
     * tenant is offered.** Slice B1 added three and this is where it showed.
     *
     * `land` has no source of its own; its rows are what make
     * `livestock.move` possible.
     */
    expect(proposal.actions.map((a) => a.slug).sort()).toEqual([
      "inventory.adjusted",
      "inventory.counted",
      "inventory.used",
      "livestock.check",
      "livestock.feed",
      "livestock.loss",
      "livestock.move",
    ]);
    /*
     * THE ANIMALS ARE SEARCHED, NOT LISTED. This asserted the opposite until
     * the menu was removed: every lot's name used to be written into the
     * model's prompt, which is what could not scale and what made "checked the
     * cows" match nothing. `find` replaces it, so there is deliberately no
     * list here to assert — a farm with three hundred pens now sends the same
     * prompt as one with three.
     */
    // NAMED, NOT POSITIONAL. This was `actions[0]` until inventory joined the
    // registry ahead of livestock and the first action stopped having a lot at
    // all — an index into a list whose order is a product decision.
    const check = proposal.actions.find((a) => a.slug === "livestock.check")!;
    const lotField = check.fields.find((f) => f.key === "lot")!;
    expect(lotField.choices).toBeUndefined();

    /*
     * NOTHING IN A PROPOSAL MAY BE A FUNCTION.
     *
     * The box is a client component, and handing React a function across that
     * boundary is "Functions cannot be passed directly to Client Components" —
     * a RUNTIME error that `tsc`, the linter, the build and three thousand
     * tests all waved through. The first sentence anybody typed failed, and it
     * was found by driving the app rather than by any of them.
     *
     * Asserted over the whole proposal rather than over `find` by name, so the
     * next function added to the contract cannot slip through the same hole.
     */
    const functionsIn = (value: unknown, path = ""): string[] => {
      if (typeof value === "function") return [path || "(root)"];
      if (Array.isArray(value)) {
        return value.flatMap((v, i) => functionsIn(v, `${path}[${i}]`));
      }
      if (value && typeof value === "object") {
        return Object.entries(value).flatMap(([k, v]) =>
          functionsIn(v, path ? `${path}.${k}` : k),
        );
      }
      return [];
    };
    expect(functionsIn(proposal)).toEqual([]);

    // The feed IS still listed, and on purpose: an item's name carries its
    // unit ("Grower crumble (lb)"), which is the difference between two bags
    // and two pounds. A short list nobody has to guess at is still the right
    // shape for it.
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

  /**
   * **A LOT IS A GROUP, AND THE SHORTLIST HAS TO SAY SO.** Bluebell read
   * "Cattle · 1 head" — the pen's own vocabulary applied to a cow, and no help
   * at all to the person or the model choosing between her and a pen of
   * twenty. Both are rows in `livestock_lots`, which is why nobody had
   * noticed. Runs LAST on purpose: it adds a second record, and the assertion
   * above counts them.
   */
  it("tells a named animal from a group, and never calls her a lot", async () => {
    const bluebell = await asOwner((tx) =>
      startIndividual(tx, ctx(), {
        newItemName: "Beef cattle",
        species: "cattle",
        name: "Bluebell",
        occurredOn: "2026-08-01",
      }),
    );

    // Neither a name nor a species word, so the search falls through to its
    // last pass and offers everything alive — which is the only way to see
    // both shapes described side by side.
    const proposal = await propose("checked the back pen, all quiet", [
      {
        action: "livestock.check",
        fields: { lot: "the back pen", state: "All fine", notes: "all quiet" },
      },
    ]);
    const offered = new Map(
      (proposal.cards[0].options?.lot ?? []).map((o) => [o.label, o.detail]),
    );
    expect(offered.get("Bluebell")).toBe("Cattle · one animal");
    expect(offered.get("Pen 2")).toBe(`Poultry · ${await headNow()} head`);

    // And the line read back afterwards is her name, never a word for a pen.
    const done = await recordTold(ctx(), [
      {
        actionSlug: "livestock.check",
        values: { ...proposal.cards[0].values, lot: bluebell.lot.id },
      },
    ]);
    expect(done.summaries).toEqual(["Bluebell — all quiet"]);
  });

  /**
   * **THE CARD SAYS “3” AND “PEN 2”, AND NEVER SAID “LEAVES 22”** (ADR 0054 §2).
   *
   * Which is the number somebody wants before pressing the button, and the one
   * that catches the commonest mistake: the right count against the wrong pen.
   * A misread pen is invisible in the fields and obvious in the arithmetic.
   */
  it("says what a card will do before it does it", async () => {
    const head = await headNow();
    expect(head).toBeGreaterThan(5);

    const preview = await previewTold(ctx(), "livestock.loss", {
      lot: lotId,
      head: 5,
      reason: "death",
      on: TODAY,
      notes: null,
    });

    expect(preview).not.toBeNull();
    expect(preview!.lines).toEqual([
      { label: "Pen 2 now", value: `${head} head` },
      { label: "died", value: "−5" },
      { label: "Pen 2 after this", value: `${head - 5} head` },
    ]);
    // Nothing wrong with it, so nothing said about it.
    expect(preview!.warning).toBeUndefined();
  });

  /**
   * A WARNING, NOT A REFUSAL. Inventory lets a lot go negative on purpose —
   * head counted wrong last week is a real thing and the ledger is what makes
   * it visible — so the preview says what will happen and lets somebody who
   * means it carry on.
   */
  it("warns when it would take a pen past what it has, and still allows it", async () => {
    const head = await headNow();
    const preview = await previewTold(ctx(), "livestock.loss", {
      lot: lotId,
      head: head + 3,
      reason: "cull",
      on: TODAY,
      notes: null,
    });

    expect(preview!.lines.at(-1)).toEqual({ label: "Pen 2 after this", value: "−3 head" });
    expect(preview!.warning).toBe("That is 3 more than Pen 2 is counted as having.");
  });

  it("says nothing rather than guessing at a card it cannot work out", async () => {
    // No lot picked: there is no arithmetic to do, and inventing one would be
    // the opposite of the point.
    expect(
      await previewTold(ctx(), "livestock.loss", {
        lot: null,
        head: 3,
        reason: "death",
        on: TODAY,
        notes: null,
      }),
    ).toBeNull();

    // An action that declares no preview is not a failure either.
    expect(
      await previewTold(ctx(), "livestock.check", {
        lot: lotId,
        on: TODAY,
        state: "normal",
        notes: null,
      }),
    ).toBeNull();
  });
});
