import { describe, expect, it } from "vitest";
import {
  FCR_NEEDS_WEIGHTS,
  allocateCents,
  allocateQuantity,
  daysOnFeed,
  earliestSpanStart,
  feedReportRows,
  formatQuantities,
  headDays,
  headOnDays,
  mergeQuantities,
  provenanceOf,
  unpricedNote,
  type FeedLotInput,
} from "../src/packs/livestock/core/feed";

/**
 * Livestock slice 2 — feed, and the allocation seam.
 *
 * What is worth certifying here is not that arithmetic adds up. It is the three
 * claims the design makes about this number and that a bug would quietly break:
 *
 *   1. **The basis is head × days, and head comes from the ledger.** Nobody
 *      types "birds on feed" anywhere, so if the running balance is wrong the
 *      whole allocation is wrong and nothing else would notice.
 *   2. **The pieces sum exactly to the pot.** An allocated feed bill that does
 *      not add back up to the delivery is checked once and never trusted again.
 *   3. **Nothing is silently dropped.** Cost drawn for a feeder no lot was on is
 *      reported as unallocated rather than vanishing, and feed with no price is
 *      counted rather than treated as free.
 */

describe("headOnDays", () => {
  it("carries the opening balance in from before the window", () => {
    // 200 placed a week before the window starts. The window must not begin at
    // zero and quietly halve every share.
    const head = headOnDays(
      [
        { occurredOn: "2026-08-01", quantity: 200 },
        { occurredOn: "2026-08-12", quantity: -3 },
      ],
      "2026-08-10",
      "2026-08-13",
    );
    expect(head).toEqual([200, 200, 197, 197]);
  });

  it("ignores movements after the window", () => {
    const head = headOnDays(
      [
        { occurredOn: "2026-08-10", quantity: 50 },
        { occurredOn: "2026-08-20", quantity: 50 },
      ],
      "2026-08-10",
      "2026-08-11",
    );
    expect(head).toEqual([50, 50]);
  });

  it("CLAMPS A NEGATIVE BALANCE TO ZERO", () => {
    // Inventory allows negative stock on purpose — Tuesday's issue entered
    // before Monday's delivery. As an allocation WEIGHT it would hand a pen a
    // negative share of the feed bill, which is not a temporarily wrong number.
    const head = headOnDays(
      [{ occurredOn: "2026-08-10", quantity: -5 }],
      "2026-08-10",
      "2026-08-11",
    );
    expect(head).toEqual([0, 0]);
  });

  it("returns nothing for a window that ends before it starts", () => {
    expect(headOnDays([], "2026-08-11", "2026-08-10")).toEqual([]);
  });
});

describe("headDays and daysOnFeed", () => {
  const movements = [{ occurredOn: "2026-08-01", quantity: 100 }];

  it("counts only the days the lot was on the feeder", () => {
    // On the bin for three of the five days in the window.
    expect(
      headDays(
        movements,
        [{ startedOn: "2026-08-10", endedOn: "2026-08-12" }],
        "2026-08-08",
        "2026-08-12",
      ),
    ).toBe(300);
  });

  it("treats the end date as INCLUSIVE, like land's occupancy", () => {
    expect(
      daysOnFeed([{ startedOn: "2026-08-10", endedOn: "2026-08-10" }], "2026-08-01", "2026-08-31"),
    ).toBe(1);
  });

  it("runs to the end of the window while the membership is open", () => {
    expect(
      daysOnFeed([{ startedOn: "2026-08-10", endedOn: null }], "2026-08-08", "2026-08-12"),
    ).toBe(3);
  });

  it("gives an empty pen no weight even while it is on the feeder", () => {
    // A membership left open on a batch that has gone must not dilute everyone
    // else's share with zeros that look like presence.
    expect(
      headDays(
        [
          { occurredOn: "2026-08-01", quantity: 100 },
          { occurredOn: "2026-08-09", quantity: -100 },
        ],
        [{ startedOn: "2026-08-01", endedOn: null }],
        "2026-08-10",
        "2026-08-12",
      ),
    ).toBe(0);
  });

  it("is zero with no membership at all", () => {
    expect(headDays(movements, [], "2026-08-01", "2026-08-31")).toBe(0);
  });

  it("finds the earliest span, which is where the day walk starts", () => {
    expect(
      earliestSpanStart([
        { startedOn: "2026-08-10", endedOn: null },
        { startedOn: "2026-07-02", endedOn: "2026-07-30" },
      ]),
    ).toBe("2026-07-02");
    expect(earliestSpanStart([])).toBeNull();
  });
});

describe("allocateCents", () => {
  it("splits by basis", () => {
    const split = allocateCents(1000, [
      { key: "a", basis: 300 },
      { key: "b", basis: 100 },
    ]);
    expect(split.get("a")).toBe(750);
    expect(split.get("b")).toBe(250);
  });

  it("THE PIECES SUM EXACTLY TO THE POT, however awkward the split", () => {
    // 100 cents over three equal pens is 33.33 each, and the remainder is real
    // money that has to land somewhere rather than evaporate.
    const split = allocateCents(100, [
      { key: "a", basis: 1 },
      { key: "b", basis: 1 },
      { key: "c", basis: 1 },
    ]);
    const total = [...split.values()].reduce((sum, v) => sum + v, 0);
    expect(total).toBe(100);
    expect([...split.values()].sort()).toEqual([33, 33, 34]);
  });

  it("is deterministic on a tie, so two runs of the report agree", () => {
    const once = allocateCents(100, [
      { key: "b", basis: 1 },
      { key: "a", basis: 1 },
      { key: "c", basis: 1 },
    ]);
    const twice = allocateCents(100, [
      { key: "a", basis: 1 },
      { key: "c", basis: 1 },
      { key: "b", basis: 1 },
    ]);
    expect([...once.entries()].sort()).toEqual([...twice.entries()].sort());
  });

  it("allocates NOTHING when nothing has any basis", () => {
    // The caller reports the pot as unallocated. Spreading it evenly across
    // pens that were not there would be inventing a fact.
    expect(allocateCents(5000, []).size).toBe(0);
    expect(allocateCents(5000, [{ key: "a", basis: 0 }]).size).toBe(0);
  });

  it("ignores shares with no basis rather than giving them a cent", () => {
    const split = allocateCents(100, [
      { key: "a", basis: 10 },
      { key: "empty", basis: 0 },
    ]);
    expect(split.get("a")).toBe(100);
    expect(split.has("empty")).toBe(false);
  });
});

describe("allocateQuantity", () => {
  it("splits pro rata to four places, matching the ledger's precision", () => {
    const split = allocateQuantity(100, [
      { key: "a", basis: 2 },
      { key: "b", basis: 1 },
    ]);
    expect(split.get("a")).toBe(66.6667);
    expect(split.get("b")).toBe(33.3333);
  });
});

describe("mergeQuantities", () => {
  it("KEEPS UNITS APART — there is no factor between pounds and gallons", () => {
    expect(
      mergeQuantities([
        { unit: "lb", quantity: 400 },
        { unit: "gal", quantity: 12 },
        { unit: "lb", quantity: 1000 },
      ]),
    ).toEqual([
      { unit: "gal", quantity: 12 },
      { unit: "lb", quantity: 1400 },
    ]);
  });

  it("drops nothing-quantities rather than showing 0 lb", () => {
    expect(mergeQuantities([{ unit: "lb", quantity: 0 }])).toEqual([]);
  });

  it("formats an em dash when nothing was fed", () => {
    expect(formatQuantities([])).toBe("—");
    expect(formatQuantities([{ unit: "lb", quantity: 1400 }])).toBe("1,400 lb");
  });

  it("does not claim to know a pen's intake to the gram", () => {
    // An allocated quantity carries the full precision of the division. The
    // screen read "521.569 lb", which is a share rendered as a measurement.
    expect(formatQuantities([{ unit: "lb", quantity: 521.5686 }])).toBe(
      "521.57 lb",
    );
  });
});

describe("provenance", () => {
  it("tells measured, allocated and both apart", () => {
    expect(provenanceOf(0, 0)).toBe("none");
    expect(provenanceOf(100, 0)).toBe("measured");
    expect(provenanceOf(0, 100)).toBe("allocated");
    // The ordinary case: brooded on bagged starter, finished on bulk grower.
    expect(provenanceOf(100, 100)).toBe("mixed");
  });
});

describe("feedReportRows", () => {
  const base: FeedLotInput = {
    lotId: "l1",
    code: "B-1",
    species: "poultry",
    ageDays: 49,
    head: 190,
    intake: 200,
    startedOn: "2026-06-01",
    measuredCents: 20_000,
    measuredQuantities: [{ unit: "lb", quantity: 800 }],
    allocatedCents: 0,
    allocatedQuantities: [],
    unpricedMovements: 0,
  };

  it("divides by head placed as well as by head standing", () => {
    const [row] = feedReportRows([base]);
    expect(row.totalCents).toBe(20_000);
    // 200 cents a head at today's count of 190, 100 a head over the 200 placed.
    expect(row.centsPerHead).toBe(105);
    expect(row.centsPerHeadPlaced).toBe(100);
  });

  it("returns null rather than zero when there is nothing to divide by", () => {
    const [row] = feedReportRows([{ ...base, head: 0, intake: 0 }]);
    expect(row.centsPerHead).toBeNull();
    expect(row.centsPerHeadPlaced).toBeNull();
  });

  it("SAYS NOTHING rather than $0.00 a head for a lot nothing was fed to", () => {
    // Found by looking at the screen. "$0.00 a head" reads as "feeding this
    // batch cost nothing", which is the same lie `mortalityRate` refuses when it
    // returns null instead of 0% for a pen no chick has been placed in.
    const [row] = feedReportRows([
      { ...base, measuredCents: 0, measuredQuantities: [] },
    ]);
    expect(row.provenance).toBe("none");
    expect(row.centsPerHead).toBeNull();
    expect(row.centsPerHeadPlaced).toBeNull();
  });

  it("adds the two halves and labels the result", () => {
    const [row] = feedReportRows([
      {
        ...base,
        allocatedCents: 5_000,
        allocatedQuantities: [{ unit: "lb", quantity: 200 }],
      },
    ]);
    expect(row.totalCents).toBe(25_000);
    expect(row.provenance).toBe("mixed");
    expect(row.quantities).toEqual([{ unit: "lb", quantity: 1000 }]);
  });

  it("COMPARES A BATCH WITH THE ONE BEFORE IT, per head placed", () => {
    const rows = feedReportRows([
      { ...base, lotId: "l1", code: "B-1", startedOn: "2026-04-01" },
      {
        ...base,
        lotId: "l2",
        code: "B-2",
        startedOn: "2026-06-01",
        measuredCents: 24_000,
      },
    ]);
    const second = rows.find((r) => r.code === "B-2")!;
    // 120 a head placed against 100 — 20 cents worse, and named so the delta is
    // checkable rather than a floating number.
    expect(second.vsPreviousCents).toBe(20);
    expect(second.previousCode).toBe("B-1");
    // The first batch has nothing to be compared with, which is the cold start
    // rather than a fault.
    expect(rows.find((r) => r.code === "B-1")!.vsPreviousCents).toBeNull();
  });

  it("NEVER COMPARES TWO BATCHES STARTED THE SAME DAY", () => {
    // Two pens placed on the same day are contemporaries, not a sequence. The
    // screen handed one of them a "+$1.00 vs last batch" against the other,
    // which is a comparison of a batch with its neighbour dressed up as history.
    const rows = feedReportRows([
      { ...base, lotId: "l1", code: "PEN-1", startedOn: "2026-07-01" },
      {
        ...base,
        lotId: "l2",
        code: "PEN-2",
        startedOn: "2026-07-01",
        measuredCents: 40_000,
      },
    ]);
    expect(rows.every((r) => r.vsPreviousCents === null)).toBe(true);
  });

  it("SKIPS A BATCH NOBODY RECORDED FEED FOR and reaches back past it", () => {
    // A batch with no feed on record is not a baseline — comparing against it
    // would report the whole of this batch's cost as a regression.
    const rows = feedReportRows([
      { ...base, lotId: "l1", code: "B-1", startedOn: "2026-02-01" },
      {
        ...base,
        lotId: "l2",
        code: "B-2",
        startedOn: "2026-04-01",
        measuredCents: 0,
        measuredQuantities: [],
      },
      {
        ...base,
        lotId: "l3",
        code: "B-3",
        startedOn: "2026-06-01",
        measuredCents: 24_000,
      },
    ]);
    const third = rows.find((r) => r.code === "B-3")!;
    expect(third.previousCode).toBe("B-1");
    expect(third.vsPreviousCents).toBe(20);
    expect(rows.find((r) => r.code === "B-2")!.vsPreviousCents).toBeNull();
  });

  it("never compares across species", () => {
    const rows = feedReportRows([
      { ...base, lotId: "l1", code: "B-1", startedOn: "2026-04-01" },
      {
        ...base,
        lotId: "l2",
        code: "COW-1",
        species: "cattle",
        startedOn: "2026-06-01",
      },
    ]);
    expect(rows.find((r) => r.code === "COW-1")!.vsPreviousCents).toBeNull();
  });

  it("leaves an undated lot out of the ordering rather than guessing", () => {
    const rows = feedReportRows([
      { ...base, lotId: "l1", code: "B-1", startedOn: "2026-04-01" },
      { ...base, lotId: "l2", code: "B-?", startedOn: null },
    ]);
    expect(rows.find((r) => r.code === "B-?")!.vsPreviousCents).toBeNull();
    // Undated sorts last; the dated batch leads.
    expect(rows.map((r) => r.code)).toEqual(["B-1", "B-?"]);
  });

  it("puts the newest batch first — the one being fed is the one being asked about", () => {
    const rows = feedReportRows([
      { ...base, lotId: "l1", code: "B-1", startedOn: "2026-04-01" },
      { ...base, lotId: "l2", code: "B-2", startedOn: "2026-06-01" },
    ]);
    expect(rows.map((r) => r.code)).toEqual(["B-2", "B-1"]);
  });
});

describe("waste streams", () => {
  it("SAYS SO when feed arrived with no price, rather than calling it free", () => {
    // Spent grain, surplus milk, garden culls, expired bakery: real feed with no
    // invoice. A model that insists every input has a purchase price gets lied
    // to, so an unpriced entry is fed-but-not-spent and counted.
    expect(unpricedNote(0)).toBeNull();
    expect(unpricedNote(1)).toContain("1 entry carried no price");
    expect(unpricedNote(3)).toContain("3 entries carried no price");
    expect(unpricedNote(2)).toContain("spent grain");
  });
});

describe("FCR", () => {
  it("is refused in words rather than divided into existence", () => {
    // Weights are slice 5. Feed per head is available today and is NOT FCR, and
    // the app must not let the two blur — this string is the single place that
    // is said, so both screens say it identically.
    expect(FCR_NEEDS_WEIGHTS).toContain("weights");
    expect(FCR_NEEDS_WEIGHTS).toContain("gain");
  });
});
