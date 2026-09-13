import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { inventoryTellSource } from "../src/packs/inventory/tell/source";
import { createItem, onHandByItem, receiveStock } from "../src/packs/inventory/ops";
import type { TellAction, TellCtx, TellValues } from "../src/lib/tell-sources/types";

/**
 * TELLING STOCK WHAT HAPPENED (tell.md, slice B1).
 *
 * The case this file exists for is `inventory.counted`, where **what somebody
 * says and what gets written are different numbers**: the sentence carries a
 * TOTAL and the books move by the DIFFERENCE. Every other action in this
 * product records the figure it was given.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const TODAY = "2026-09-13";

d("telling stock what happened", () => {
  const STAMP = `tell-inv-${process.pid}`;
  const USER = `${STAMP}-user`;

  let tenantId = "";
  let itemId = "";

  const ctx = (): TellCtx => ({
    tenantId,
    userId: USER,
    role: "staff",
    now: new Date("2026-09-13T14:00:00.000Z"),
    timezone: "UTC",
    industry: "homestead-farm",
    today: TODAY,
  });
  /**
   * **THE ACTIONS RUN AS STAFF, AND THAT IS THE POINT.**
   *
   * ADR 0039 puts no role check in the slot: each action records through its
   * pack's own verb and that verb's level is the rule. `issueStock` and
   * `adjustStock` are member-level, so a farmhand can say these sentences —
   * which is the entire use case. Setting the stock up is a different matter:
   * `createItem` is owner-only, and the fixture has to say so or the suite
   * reports itself SKIPPED rather than failed, which is how this was nearly
   * missed.
   */
  const scoped = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "staff", userId: USER });
  const asOwner = <T,>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: USER });
  const ownerCtx = (): TellCtx => ({ ...ctx(), role: "owner" });

  const actions = () => scoped((tx) => inventoryTellSource.actions(tx, ctx()));
  const only = async (slug: string): Promise<TellAction> => {
    const found = (await actions()).find((a) => a.slug === slug);
    if (!found) throw new Error(`${slug} was not offered`);
    return found;
  };
  const preview = async (slug: string, values: TellValues) => {
    const action = await only(slug);
    return scoped((tx) => action.preview!(tx, ctx(), values));
  };
  const record = async (slug: string, values: TellValues) => {
    const action = await only(slug);
    return scoped((tx) => action.record(tx, ctx(), values));
  };
  const onHand = async () =>
    (await scoped((tx) => onHandByItem(tx, tenantId))).get(itemId) ?? 0;

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          clerkOrgId: `org_${STAMP}`,
          name: `Stock ${STAMP}`,
          slug: STAMP,
          industry: "homestead-farm",
        })
        .returning();
      tenantId = tenant.id;
      await tx
        .insert(schema.tenantModules)
        .values({ tenantId, moduleId: "inventory", enabled: true })
        .onConflictDoNothing();
    });

    await asOwner(async (tx) => {
      itemId = (
        await createItem(tx, ownerCtx(), {
          name: "Grower crumble",
          itemKind: "feed",
          stockingUnit: "lb",
        })
      ).id;
      await receiveStock(tx, ownerCtx(), {
        itemId,
        quantity: 100,
        occurredOn: "2026-09-01",
      });
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      await tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    });
  });

  it("offers what stock can be told, and nothing records itself", async () => {
    const list = await actions();
    expect(list.map((a) => a.slug).sort()).toEqual([
      "inventory.adjusted",
      "inventory.counted",
      "inventory.used",
    ]);
    // Every one moves a quantity, which fails ADR 0050's third test outright.
    expect(list.every((a) => a.unattended === undefined)).toBe(true);
    // And every one says what it will do, because every one moves something.
    expect(list.every((a) => typeof a.preview === "function")).toBe(true);
  });

  it("searches for the thing rather than listing everything", async () => {
    const used = await only("inventory.used");
    const what = used.fields.find((f) => f.key === "item")!;
    expect(what.choices).toBeUndefined();

    const found = async (said: string) =>
      (await scoped((tx) => what.find!(tx, ctx(), said))).map((c) => c.label);
    expect(await found("crumble")).toContain("Grower crumble");
    // Nothing matched is a question, never a dead end (ADR 0052).
    expect((await found("something else")).length).toBeGreaterThan(0);
  });

  /*
   * **THE FIGURES ARE READ, NOT ASSUMED.** Each of these starts from what is
   * actually on hand rather than from a number written here, because these
   * tests move stock and one of them changing by a different amount should not
   * cascade into five confusing failures in the ones after it.
   *
   * The unit is the pack's own word for it — `formatQuantity` renders "pounds",
   * not "lb", which is what a person reads everywhere else in Inventory.
   */
  it("takes stock out and says what it will leave", async () => {
    const before = await onHand();
    expect(before).toBe(100);

    const values = { item: itemId, quantity: 20, on: TODAY, notes: null };
    expect(await preview("inventory.used", values)).toEqual({
      lines: [
        { label: "Grower crumble now", value: "100 pounds" },
        { label: "used", value: "−20" },
        { label: "Grower crumble after this", value: "80 pounds" },
      ],
      warning: undefined,
    });

    const done = await record("inventory.used", values);
    expect(done.summary).toBe("20 pounds of Grower crumble used");
    expect(await onHand()).toBe(before - 20);
  });

  it("adds stock back when the reason is the one that adds", async () => {
    const before = await onHand();
    const values = { item: itemId, quantity: 5, reason: "found", on: TODAY, notes: null };

    const shown = await preview("inventory.adjusted", values);
    // The sign comes from the REASON, because nobody says "minus five turned up".
    expect(shown!.lines[1]).toEqual({ label: "Found", value: "+5" });

    await record("inventory.adjusted", values);
    expect(await onHand()).toBe(before + 5);
  });

  it("takes it away for every other reason", async () => {
    const before = await onHand();
    const values = { item: itemId, quantity: 5, reason: "spoilage", on: TODAY, notes: null };

    const shown = await preview("inventory.adjusted", values);
    expect(shown!.lines[1]).toEqual({ label: "Went off", value: "−5" });

    const done = await record("inventory.adjusted", values);
    expect(done.summary).toBe("5 pounds of Grower crumble — went off");
    expect(await onHand()).toBe(before - 5);
  });

  /**
   * **THE REASON THIS FILE EXISTS.** The sentence says a total; the books move
   * by the difference. A card showing what was SAID while writing something
   * else would be the most convincing wrong thing on the screen, which is why
   * `counted` was not built until slice A2 had shipped.
   */
  it("counts to a total and writes the difference", async () => {
    const before = await onHand();
    const counted = before + 8;

    const values = { item: itemId, counted, on: TODAY, notes: null };
    expect(await preview("inventory.counted", values)).toEqual({
      lines: [
        { label: "Grower crumble on the books", value: `${before} pounds` },
        { label: "counted", value: `${counted} pounds` },
        { label: "adding", value: "+8" },
      ],
    });

    const done = await record("inventory.counted", values);
    expect(done.summary).toBe(`Grower crumble counted at ${counted} pounds — +8`);
    // Landed exactly on what was counted, which is the only thing that matters.
    expect(await onHand()).toBe(counted);
  });

  it("counts down as readily as up", async () => {
    const before = await onHand();
    const counted = before - 18;

    const values = { item: itemId, counted, on: TODAY, notes: null };
    const shown = await preview("inventory.counted", values);
    expect(shown!.lines[2]).toEqual({ label: "taking off", value: "−18" });

    await record("inventory.counted", values);
    expect(await onHand()).toBe(counted);
  });

  /**
   * A count that MATCHES is a successful count and not a correction, so the
   * pack refuses it — in its own words, per ADR 0039's third rule. The preview
   * is what stops that being a surprise: it says so above the button rather
   * than explaining it afterwards.
   */
  it("says there is nothing to correct before refusing to correct nothing", async () => {
    const before = await onHand();
    const values = { item: itemId, counted: before, on: TODAY, notes: null };

    const shown = await preview("inventory.counted", values);
    expect(shown!.lines).toHaveLength(2);
    expect(shown!.warning).toBe(
      "That is what the books already say — there is nothing to correct.",
    );

    await expect(record("inventory.counted", values)).rejects.toThrow(
      "an adjustment of nothing is not a correction",
    );
    expect(await onHand()).toBe(before);
  });

  it("warns before taking stock past what is there, and still allows it", async () => {
    const before = await onHand();
    const values = { item: itemId, quantity: before + 20, on: TODAY, notes: null };

    const shown = await preview("inventory.used", values);
    expect(shown!.lines[2]).toEqual({
      label: "Grower crumble after this",
      value: "-20 pounds",
    });
    expect(shown!.warning).toBe("That is 20 pounds more than is counted as being there.");
  });
});
