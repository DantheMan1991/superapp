import { describe, expect, it } from "vitest";
import {
  costPerPersonHour,
  marketDayCost,
  nextPrice,
  priceHistory,
  priceOn,
  spreadAcrossChannels,
} from "../src/packs/retail/core/pricing";
import {
  CHANNEL_STATUSES,
  SLUG_FORMAT,
  channelKindsFrom,
  isValidSlug,
  slugLabel,
} from "../src/packs/retail/vocabulary";

/**
 * The pure half of `retail`. No database anywhere in this file.
 *
 * **A PRICE IS A TIMELINE, NOT A FIELD**, and almost everything here is about
 * the consequences of that: a price set ahead must not apply today, a price
 * removed must uncover the one before it, and "not priced here" must never come
 * back as zero.
 */

const row = (id: string, itemId: string, cents: number, from: string) => ({
  id,
  itemId,
  priceCents: cents,
  effectiveFrom: from,
});

describe("priceOn", () => {
  const rows = [
    row("a", "beef", 800, "2026-01-01"),
    row("b", "beef", 850, "2026-06-01"),
    row("c", "beef", 900, "2026-12-01"),
  ];

  it("takes the latest price that has actually started", () => {
    expect(priceOn(rows, "2026-08-20")?.priceCents).toBe(850);
    expect(priceOn(rows, "2026-05-31")?.priceCents).toBe(800);
    // The day a price starts, it applies. Inclusive, like every other date in
    // these packs.
    expect(priceOn(rows, "2026-06-01")?.priceCents).toBe(850);
  });

  it("IGNORES A PRICE SET FOR THE FUTURE", () => {
    /**
     * The point of dating them. A fold that took the newest row regardless
     * would apply next season's price the moment somebody typed it — which is
     * the failure that makes people stop entering things in advance.
     */
    expect(priceOn(rows, "2026-08-20")?.priceCents).not.toBe(900);
  });

  it("returns NULL rather than zero for an item nobody has priced", () => {
    // "Not priced here" is the ordinary state for most of the shelf — a farm
    // sells six of the forty things it holds. Zero is a real and different
    // answer: a sample, a giveaway, a loss leader.
    expect(priceOn([], "2026-08-20")).toBeNull();
    expect(priceOn(rows, "2025-12-31")).toBeNull();
  });

  it("treats free as a price, because it is one", () => {
    expect(priceOn([row("f", "eggs", 0, "2026-01-01")], "2026-08-20")?.priceCents).toBe(0);
  });
});

describe("nextPrice", () => {
  it("finds the soonest change ahead, so a screen can say it is coming", () => {
    const rows = [
      row("a", "beef", 800, "2026-01-01"),
      row("c", "beef", 900, "2026-12-01"),
      row("d", "beef", 950, "2027-06-01"),
    ];
    expect(nextPrice(rows, "2026-08-20")?.effectiveFrom).toBe("2026-12-01");
  });

  it("is null when nothing is queued", () => {
    // A price entered for the future and then forgotten is what this prevents.
    expect(nextPrice([row("a", "beef", 800, "2026-01-01")], "2026-08-20")).toBeNull();
  });
});

describe("priceHistory", () => {
  it("is newest first, and deterministic on a tie", () => {
    const rows = [
      row("a", "beef", 800, "2026-01-01"),
      row("b", "beef", 850, "2026-06-01"),
    ];
    expect(priceHistory(rows).map((r) => r.id)).toEqual(["b", "a"]);
    // Two rows cannot share a day through the write path — the unique index
    // refuses it — but a fold that reorders itself between renders is its own
    // small bug.
    const tied = [row("x", "beef", 800, "2026-01-01"), row("y", "beef", 810, "2026-01-01")];
    expect(priceHistory(tied)).toEqual(priceHistory(tied));
  });
});

describe("spreadAcrossChannels", () => {
  it("shows the same item's price side by side, dearest first", () => {
    /**
     * The comparison is the point: $9 at a stall and $7 at the gate is a
     * decision somebody made, and seeing them together is how they find out
     * whether they still mean it.
     */
    const rows = [
      { ...row("a", "beef", 900, "2026-01-01"), channelId: "market" },
      { ...row("b", "beef", 700, "2026-01-01"), channelId: "gate" },
    ];
    expect(spreadAcrossChannels(rows, "2026-08-20")).toEqual([
      { channelId: "market", priceCents: 900 },
      { channelId: "gate", priceCents: 700 },
    ]);
  });

  it("leaves out a channel that does not price it, rather than showing zero", () => {
    const rows = [
      { ...row("a", "beef", 900, "2026-01-01"), channelId: "market" },
      // Set for next year — this channel has no price TODAY.
      { ...row("b", "beef", 700, "2027-01-01"), channelId: "gate" },
    ];
    expect(spreadAcrossChannels(rows, "2026-08-20")).toEqual([
      { channelId: "market", priceCents: 900 },
    ]);
  });
});

describe("marketDayCost", () => {
  it("adds the money that actually left, and keeps the hours out of it", () => {
    /**
     * **THE WHOLE ARGUMENT FOR THE TABLE.** The design wants it to settle which
     * market is a dud attended out of habit — and if own hours count as zero,
     * every market is profitable and the dud is invisible. So person-hours come
     * back BESIDE the money, never folded into it.
     */
    const cost = marketDayCost({
      stallFeeCents: 3_500,
      travelCents: 1_800,
      crewSize: 2,
      hours: 5,
    });
    expect(cost.outOfPocketCents).toBe(5_300);
    expect(cost.personHours).toBe(10);
    expect(cost.unrecorded).toBe(false);
  });

  it("tells NOTHING RECORDED apart from a real zero", () => {
    // A farm gate with no fee and no journey genuinely cost nothing to stand
    // at. A day nobody entered figures for did not.
    const nothing = marketDayCost({
      stallFeeCents: null,
      travelCents: null,
      crewSize: null,
      hours: null,
    });
    expect(nothing.outOfPocketCents).toBe(0);
    expect(nothing.unrecorded).toBe(true);

    const free = marketDayCost({
      stallFeeCents: 0,
      travelCents: 0,
      crewSize: 1,
      hours: 3,
    });
    expect(free.outOfPocketCents).toBe(0);
    expect(free.unrecorded).toBe(false);
  });

  it("needs both halves before it will state person-hours", () => {
    expect(
      marketDayCost({
        stallFeeCents: 100,
        travelCents: null,
        crewSize: 2,
        hours: null,
      }).personHours,
    ).toBeNull();
    expect(
      marketDayCost({
        stallFeeCents: 100,
        travelCents: null,
        crewSize: null,
        hours: 4,
      }).personHours,
    ).toBeNull();
  });
});

describe("costPerPersonHour", () => {
  it("compares a four-hour market with a two-hour one", () => {
    const cost = marketDayCost({
      stallFeeCents: 3_500,
      travelCents: 1_800,
      crewSize: 2,
      hours: 5,
    });
    // $53.00 over ten person-hours.
    expect(costPerPersonHour(cost)).toBe(530);
  });

  it("refuses rather than dividing by hours nobody recorded", () => {
    // "Free" and "not known" are different facts and only one is ever true —
    // the rule every fold in these packs follows.
    const cost = marketDayCost({
      stallFeeCents: 3_500,
      travelCents: null,
      crewSize: null,
      hours: null,
    });
    expect(costPerPersonHour(cost)).toBeNull();
  });
});

describe("vocabulary", () => {
  it("mirrors the CHECK constraint on channel_kind", () => {
    expect(SLUG_FORMAT.source).toBe("^[a-z][a-z0-9_]{0,62}$");
    expect(isValidSlug("farmers_market")).toBe(true);
    expect(isValidSlug("Farmers Market")).toBe(false);
  });

  it("keeps a channel in exactly two states", () => {
    expect([...CHANNEL_STATUSES]).toEqual(["active", "closed"]);
  });

  it("reads channel kinds from the profile and never invents one", () => {
    // A pack that knew what a farmers market was would know what industry it
    // was in. Anything unreadable is an empty list and a free-text field.
    expect(channelKindsFrom({ channelKinds: ["farmers_market"] })).toEqual([
      "farmers_market",
    ]);
    expect(channelKindsFrom(undefined)).toEqual([]);
    expect(channelKindsFrom({ channelKinds: "farmers_market" })).toEqual([]);
  });

  it("turns a slug into words", () => {
    expect(slugLabel("farmers_market")).toBe("Farmers market");
  });
});
