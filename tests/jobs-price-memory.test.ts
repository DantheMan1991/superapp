import { describe, expect, it } from "vitest";
import {
  fillFromMemory,
  fitsUnit,
  howLongAgo,
  priceBookFrom,
  priceHint,
  priceKey,
  recall,
  type RememberedPrice,
} from "../src/packs/jobs/price-memory";

/**
 * PRICE MEMORY (E4a) — what this business charged for this line last time.
 *
 * The match is the whole feature and the whole risk: **a wrong price offered
 * confidently is worse than no price at all**, because it is money, it is
 * quiet, and it goes out in a proposal. So the cases below are mostly about
 * what must NOT match, and about the memory never arguing with a number
 * somebody typed.
 */

function remembered(over: Partial<RememberedPrice> = {}): RememberedPrice {
  return {
    key: "tile labour",
    description: "Tile labour",
    unitCostCents: 350,
    unit: "sf",
    projectNumber: "24-108",
    pricedOn: "2026-08-24",
    ...over,
  };
}

describe("priceKey: what two typings of the same line share", () => {
  it("ignores case, punctuation and extra spaces", () => {
    const same = [
      "Tile labour",
      "tile labour",
      "TILE LABOUR",
      "  tile   labour  ",
      "Tile, labour.",
      "Tile — labour",
      "tile/labour",
    ];
    for (const s of same) expect(priceKey(s), s).toBe("tile labour");
  });

  it("keeps digits, because a size is part of what a line is", () => {
    expect(priceKey("Slab, 4in, fibre mesh")).toBe("slab 4in fibre mesh");
    // 4in and 6in are different lines and must not share a price.
    expect(priceKey("Slab, 6in, fibre mesh")).not.toBe(priceKey("Slab, 4in, fibre mesh"));
  });

  /**
   * A description of punctuation has no key. Returning "" and then matching on
   * it would make every such line collide with every other — the one way an
   * exact-match design could still hand somebody a wrong price.
   */
  it("gives punctuation-only descriptions an empty key, which never matches", () => {
    expect(priceKey("---")).toBe("");
    expect(priceKey("   ")).toBe("");
    const book = priceBookFrom([remembered({ key: "", description: "---" })]);
    expect(book.size).toBe(0);
    expect(recall(book, "***")).toBeNull();
  });

  it("does NOT match a line that merely starts the same", () => {
    const book = priceBookFrom([remembered()]);
    expect(recall(book, "tile labour, second floor")).toBeNull();
    expect(recall(book, "tile")).toBeNull();
  });

  /** Fuzzy matching is deliberately absent — a typo gets no price, not a guess. */
  it("does NOT match across a spelling difference", () => {
    const book = priceBookFrom([remembered()]);
    expect(recall(book, "tile labor")).toBeNull();
  });
});

describe("priceBookFrom: the last time, not any time", () => {
  it("keeps the FIRST row for a key, because the rows arrive newest first", () => {
    const book = priceBookFrom([
      remembered({ unitCostCents: 420, pricedOn: "2026-09-01", projectNumber: "24-110" }),
      remembered({ unitCostCents: 350, pricedOn: "2026-08-24", projectNumber: "24-108" }),
    ]);
    expect(book.get("tile labour")?.unitCostCents).toBe(420);
    expect(book.get("tile labour")?.projectNumber).toBe("24-110");
  });

  it("holds one entry per key and skips keyless rows", () => {
    const book = priceBookFrom([
      remembered(),
      remembered({ key: "rebar", description: "Rebar", unitCostCents: 90000, unit: "ton" }),
      remembered({ key: "" }),
    ]);
    expect(book.size).toBe(2);
  });
});

describe("fillFromMemory: it fills a blank and never argues", () => {
  const book = priceBookFrom([remembered()]);

  it("offers a price for a line that has none", () => {
    expect(fillFromMemory(book, { description: "Tile labour", unitCostCents: 0 })?.unitCostCents).toBe(350);
  });

  /** The estimator is the one pricing the job. This is a memory, not an opinion. */
  it("leaves a typed price alone, even a lower one", () => {
    expect(fillFromMemory(book, { description: "Tile labour", unitCostCents: 100 })).toBeNull();
    expect(fillFromMemory(book, { description: "Tile labour", unitCostCents: 99999 })).toBeNull();
  });

  it("offers nothing for a line it has never seen", () => {
    expect(fillFromMemory(book, { description: "Helipad", unitCostCents: 0 })).toBeNull();
  });
});

describe("howLongAgo: vague on purpose past a month", () => {
  const cases: Array<[string, string]> = [
    ["2026-09-17", "today"],
    ["2026-09-16", "yesterday"],
    ["2026-09-14", "3 days ago"],
    ["2026-09-09", "last week"],
    ["2026-09-01", "2 weeks ago"],
    ["2026-08-20", "4 weeks ago"],
    ["2026-07-17", "2 months ago"],
    ["2026-08-17", "1 month ago"],
    ["2025-09-17", "1 year ago"],
    ["2023-09-17", "3 years ago"],
  ];
  for (const [pricedOn, expected] of cases) {
    it(`reads ${pricedOn} as "${expected}"`, () => {
      expect(howLongAgo(pricedOn, "2026-09-17")).toBe(expected);
    });
  }

  /** A clock skew must not produce "in -2 days"; the future reads as today. */
  it("never speaks of the future", () => {
    expect(howLongAgo("2026-09-20", "2026-09-17")).toBe("today");
  });

  it("is exact across a daylight-saving boundary", () => {
    expect(howLongAgo("2026-03-07", "2026-03-09")).toBe("2 days ago");
    expect(howLongAgo("2026-10-31", "2026-11-02")).toBe("2 days ago");
  });
});

describe("priceHint: the whole sentence", () => {
  it("reads as a rate when there is a unit", () => {
    expect(priceHint(remembered(), "3.50", "2026-09-17")).toBe("3.50/sf · 24-108 · 3 weeks ago");
  });

  /** A lump has no unit to put a rate over, so it is just the money. */
  it("drops the rate for a lump sum", () => {
    const lump = remembered({ unit: "", unitCostCents: 1_200_000, pricedOn: "2026-09-16" });
    expect(priceHint(lump, "12,000.00", "2026-09-17")).toBe("12,000.00 · 24-108 · yesterday");
  });

  it("treats a whitespace-only unit as no unit", () => {
    expect(priceHint(remembered({ unit: "  " }), "3.50", "2026-09-17")).toBe("3.50 · 24-108 · 3 weeks ago");
  });

  /** The money arrives formatted, so this file holds no money rules at all. */
  it("prints the money exactly as it was handed in", () => {
    expect(priceHint(remembered(), "$3.50", "2026-09-17")).toContain("$3.50/sf");
  });
});

describe("fitsUnit: a remembered price is per its unit", () => {
  const perSf = remembered({ unit: "sf" });
  it("fits the same unit however either is spelled, and any unit when the line has none yet", () => {
    expect(fitsUnit(perSf, "sf")).toBe(true);
    expect(fitsUnit(perSf, "sq. ft.")).toBe(true);
    expect(fitsUnit(perSf, "square feet")).toBe(true);
    expect(fitsUnit(remembered({ unit: "sq ft" }), "SF")).toBe(true);
    expect(fitsUnit(perSf, "")).toBe(true);
    expect(fitsUnit(remembered({ unit: "" }), "")).toBe(true);
  });
  it("does NOT fit another unit — 3.50/sf is not a price per sy — and a lump remembered with no unit is not a rate for any unit", () => {
    expect(fitsUnit(perSf, "sy")).toBe(false);
    expect(fitsUnit(perSf, "lf")).toBe(false);
    expect(fitsUnit(perSf, "ea")).toBe(false);
    expect(fitsUnit(remembered({ unit: "" }), "sf")).toBe(false);
  });
  it("fillFromMemory keeps the rule once the line knows its unit, and asks nothing of a line that does not", () => {
    const book = priceBookFrom([perSf]);
    expect(fillFromMemory(book, { description: "tile labour", unitCostCents: 0 })?.unitCostCents).toBe(350);
    expect(fillFromMemory(book, { description: "tile labour", unitCostCents: 0, unit: "" })?.unitCostCents).toBe(350);
    expect(fillFromMemory(book, { description: "tile labour", unitCostCents: 0, unit: "sq ft" })?.unitCostCents).toBe(350);
    expect(fillFromMemory(book, { description: "tile labour", unitCostCents: 0, unit: "sy" })).toBeNull();
    // A typed price is still never argued with, whatever the unit.
    expect(fillFromMemory(book, { description: "tile labour", unitCostCents: 500, unit: "sf" })).toBeNull();
  });
});
