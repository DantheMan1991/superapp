import { describe, expect, it } from "vitest";
import {
  carriedValue,
  shareOfCarried,
  valuationTotal,
  valueLine,
  type StockValuation,
  type ValuedLine,
} from "../src/packs/inventory/core/valuation";
import {
  valuationCaveat,
  valuationCsvFilename,
  valuationToCsvRows,
} from "../src/packs/inventory/core/valuation-csv";
import { VALUATION_METHOD_NOTES } from "../src/packs/inventory/vocabulary";
import { toCsv } from "../src/lib/csv";

/**
 * Valuing the shelf. No database anywhere in this file.
 *
 * **THE UNVALUED TESTS ARE THE IMPORTANT ONES.** Twice now this codebase has
 * shipped a figure that treated "nobody recorded a cost" as "it cost nothing":
 * `costPerUnit` was written to refuse it, and `production` slice 0 shipped a
 * `$0.00` stamp on a pen with no feed anyway — because every test in that suite
 * used a pen that HAD feed. These tests exist so the third time is caught here.
 */

const line = (over: Partial<Parameters<typeof valueLine>[0]> = {}) =>
  valueLine({ quantity: 10, carriedCents: null, averageRate: null, ...over });

describe("valueLine", () => {
  it("values a lot at its CARRIED cost, not at quantity times average", () => {
    /**
     * The ordering that keeps the lot spine worth having. This pen accumulated
     * $1,000 in chicks and feed; the item's average across every other batch is
     * irrelevant to it, and applying that average would throw away the one
     * measurement traceability exists to preserve.
     */
    expect(
      line({ quantity: 200, carriedCents: 100_000, averageRate: 3 }),
    ).toEqual({ valueCents: 100_000, method: "carried" });
  });

  it("falls back to the average for stock held outside any lot", () => {
    // The fungible case the design says average cost is fine for: feed, seed,
    // cartons. 40 lb at 250.5 cents rounds once, here.
    expect(line({ quantity: 40, averageRate: 250.5 })).toEqual({
      valueCents: 10_020,
      method: "average",
    });
  });

  it("REFUSES TO VALUE STOCK NOBODY COSTED, and does not call it zero", () => {
    /**
     * Raised, no purchase basis: eggs, a calf you bred, a pen nobody entered
     * feed for. Zero would say the shelf holds something worthless; a guess
     * would put an invented number on a balance sheet. It is neither.
     */
    const result = line({ quantity: 30 });
    expect(result.valueCents).toBeNull();
    expect(result.method).toBe("none");
    expect(result.valueCents).not.toBe(0);
  });

  it("distinguishes nothing-on-hand from nothing-known", () => {
    // An empty shelf really is worth zero — there is no stock to be uncertain
    // about. That is a different fact from the test above and must read
    // differently.
    expect(line({ quantity: 0 })).toEqual({ valueCents: 0, method: "carried" });
  });

  it("carries a zero carried cost through rather than falling to the average", () => {
    /**
     * A lot whose cost has all been released — everything in it has left — is
     * genuinely worth nothing more, and must NOT silently fall through to the
     * average. Falling through would re-value stock that has already carried
     * its cost out, which is the double-count `lotCarried` was written to end.
     */
    expect(
      line({ quantity: 5, carriedCents: 0, averageRate: 400 }),
    ).toEqual({ valueCents: 0, method: "carried" });
  });

  it("lets a negative carried cost fall as it lies", () => {
    // Same rule as `lotCarried`: a correction landing after stock has left is a
    // real disagreement somebody should see, not a number to tidy away.
    expect(line({ quantity: 5, carriedCents: -2_500 })).toEqual({
      valueCents: -2_500,
      method: "carried",
    });
  });

  it("values negative stock at the average too, rather than skipping it", () => {
    // Negative stock is allowed on purpose in this pack. A valuation that
    // dropped those lines would report the shelf as worth more than the ledger
    // says it is.
    expect(line({ quantity: -4, averageRate: 100 })).toEqual({
      valueCents: -400,
      method: "average",
    });
  });
});

describe("carriedValue", () => {
  /**
   * **THE TWO ZEROS.** This function exists because a db-backed test caught the
   * first draft valuing 30 dozen eggs at exactly $0.00 — after the header of
   * the file it lives in had already been written warning about that precise
   * mistake. `remainingCents` alone cannot tell "all its cost has left" from
   * "nobody ever costed it", and only one of those is worth nothing.
   */
  const cost = (over = {}) => ({
    purchasedCents: 0,
    consumedCents: 0,
    releasedCents: 0,
    adjustedOnHandCents: 0,
    adjustedIssuedCents: 0,
    remainingCents: 0,
    ...over,
  });

  it("refuses a lot no money has EVER touched", () => {
    expect(carriedValue(cost())).toBeNull();
  });

  it("returns a real zero for a lot whose cost has all been released", () => {
    // Bought for $500, all $500 issued out. It really is worth nothing more.
    expect(
      carriedValue(
        cost({ purchasedCents: 50_000, releasedCents: 50_000, remainingCents: 0 }),
      ),
    ).toBe(0);
  });

  it("counts consumption alone as having been costed", () => {
    // A raised pen with no purchase basis, but feed was issued into it. That
    // feed is a real cost and the pen is worth it.
    expect(
      carriedValue(cost({ consumedCents: 20_000, remainingCents: 20_000 })),
    ).toBe(20_000);
  });

  it("passes an ordinary carried cost straight through", () => {
    expect(
      carriedValue(cost({ purchasedCents: 10_000, remainingCents: 10_000 })),
    ).toBe(10_000);
  });

  /**
   * **THE EGGS-AT-$0.00 BUG THROUGH A NEW DOOR**, and the reason `carriedValue`
   * had to change when `inventory_cost_adjustments` arrived (ADR 0012 §A.4).
   *
   * A delivery that arrived with nothing on the ticket is recorded uncosted,
   * and the correction that supplies its price is not a movement — so the batch
   * has purchased, consumed and released all at zero while carrying real money.
   * Reading only those three called it "No cost recorded", about a batch the
   * ledger holds a debit for.
   */
  it("counts a correction alone as having been costed", () => {
    expect(
      carriedValue(cost({ adjustedOnHandCents: 34_000, remainingCents: 34_000 })),
    ).toBe(34_000);
  });

  /**
   * The correction landed entirely on stock that had already gone, so nothing
   * is carried — but somebody HAS said what this batch cost, and zero is now a
   * real answer rather than an absence.
   */
  it("counts a correction on already-issued stock as having been costed", () => {
    expect(carriedValue(cost({ adjustedIssuedCents: 6_000 }))).toBe(0);
  });

  it("passes a negative through rather than reading it as uncosted", () => {
    // A correction landing after stock has left. Real disagreement, not an
    // absence of information.
    expect(
      carriedValue(
        cost({ purchasedCents: 10_000, releasedCents: 12_000, remainingCents: -2_000 }),
      ),
    ).toBe(-2_000);
  });
});

describe("valuationTotal", () => {
  const valued = (valueCents: number | null, quantity: number) =>
    ({
      valueCents,
      method: valueCents === null ? "none" : "carried",
      quantity,
    }) as ValuedLine & { quantity: number };

  it("adds up what it can and SAYS WHAT IT COULD NOT", () => {
    /**
     * The whole point of the return shape. `$4,200` reads identically whether
     * it covers everything on the farm or everything except three pens of birds
     * nobody costed — so the total never travels without its own caveat.
     */
    const total = valuationTotal([
      valued(100_000, 200),
      valued(320_000, 40),
      valued(null, 30),
      valued(null, 12.5),
    ]);
    expect(total.valueCents).toBe(420_000);
    expect(total.valuedLines).toBe(2);
    expect(total.unvaluedLines).toBe(2);
    expect(total.unvaluedQuantity).toBe(42.5);
    expect(total.incomplete).toBe(true);
  });

  it("is complete when everything carried a number", () => {
    const total = valuationTotal([valued(100, 1), valued(200, 2)]);
    expect(total.valueCents).toBe(300);
    expect(total.incomplete).toBe(false);
    expect(total.unvaluedQuantity).toBe(0);
  });

  it("is complete rather than incomplete for an empty farm", () => {
    // Nothing on hand is not the same as something uncosted, and a brand new
    // tenant must not be told its balance sheet is unreliable.
    const total = valuationTotal([]);
    expect(total.valueCents).toBe(0);
    expect(total.incomplete).toBe(false);
  });

  it("does not let fractional quantities drift", () => {
    // Four places, the same the quantity ledger keeps. 0.1 + 0.2 must not
    // produce a gap size nobody can match against the stock list.
    const total = valuationTotal([valued(null, 0.1), valued(null, 0.2)]);
    expect(total.unvaluedQuantity).toBe(0.3);
  });

  it("sums a negative line rather than clamping it", () => {
    expect(valuationTotal([valued(5_000, 10), valued(-2_000, -4)]).valueCents).toBe(
      3_000,
    );
  });
});

describe("one place's share of a batch", () => {
  /**
   * Nothing anywhere records what a shelf of a batch cost. A batch has ONE
   * carried figure, and a person in front of one freezer still wants a number,
   * so the quantity there is used as the share of the quantity everywhere.
   */
  it("apportions by quantity, and rounds to whole cents", () => {
    expect(shareOfCarried(10_000, 25, 100)).toBe(2_500);
    expect(shareOfCarried(10_000, 100, 100)).toBe(10_000);
    expect(shareOfCarried(10_000, 0, 100)).toBe(0);
    // A third of $100.00 is not a whole number of cents, and money is integers.
    expect(shareOfCarried(10_000, 1, 3)).toBe(3_333);
  });

  it("REFUSES rather than guessing when there is nothing to take a share of", () => {
    /**
     * Nine in the freezer and minus nine in the truck nets to nothing. There is
     * no share of zero, dividing is a division by zero, and picking a side is an
     * invention — so the answer is that it cannot be said.
     */
    expect(shareOfCarried(10_000, 9, 0)).toBeNull();
  });

  it("REFUSES when the signs disagree or the place holds more than the batch", () => {
    // A ratio above one multiplies the batch's cost UP, and a negative one
    // flips its sign. Both are confidently wrong rather than uncertain.
    expect(shareOfCarried(10_000, 120, 100)).toBeNull();
    expect(shareOfCarried(10_000, 5, -100)).toBeNull();
    expect(shareOfCarried(10_000, -5, 100)).toBeNull();
    // Both negative is a share of a batch that is itself below zero, which is
    // allowed on purpose and is a perfectly good ratio.
    expect(shareOfCarried(-10_000, -5, -100)).toBe(-500);
  });

  it("reaches valueLine as `share`, and its refusal as `unsplit`", () => {
    expect(
      valueLine({
        quantity: 25,
        carriedCents: 10_000,
        averageRate: null,
        share: { here: 25, whole: 100 },
      }),
    ).toEqual({ valueCents: 2_500, method: "share" });

    /**
     * **`unsplit` IS NOT `none`, AND THAT IS THE POINT.** `none` says nobody
     * ever costed this batch. This batch WAS costed and the figure cannot
     * honestly be divided. Folding them together would tell somebody looking at
     * one freezer that their bought stock had never been priced.
     */
    expect(
      valueLine({
        quantity: 9,
        carriedCents: 10_000,
        averageRate: null,
        share: { here: 9, whole: 0 },
      }),
    ).toEqual({ valueCents: null, method: "unsplit" });
  });

  it("leaves the whole-business answer exactly as it was", () => {
    // No share asked for, no share taken. Every existing caller passes nothing.
    expect(
      valueLine({ quantity: 25, carriedCents: 10_000, averageRate: null }),
    ).toEqual({ valueCents: 10_000, method: "carried" });
  });

  it("does not apportion stock held outside a batch", () => {
    // The average multiplies by the quantity HERE, which is already the answer.
    expect(
      valueLine({
        quantity: 10,
        carriedCents: null,
        averageRate: 250,
        share: { here: 10, whole: 40 },
      }),
    ).toEqual({ valueCents: 2_500, method: "average" });
  });

  it("counts an unsplit line as one the total leaves out", () => {
    /**
     * The whole caveat machinery already exists, so the honest answer costs
     * nothing to say: an unsplit line lands in `unvaluedLines` beside the
     * uncosted ones and the card above the table reports both.
     */
    const total = valuationTotal([
      { valueCents: 2_500, method: "share", quantity: 25 },
      { valueCents: null, method: "unsplit", quantity: 9 },
    ]);
    expect(total).toMatchObject({
      valueCents: 2_500,
      valuedLines: 1,
      unvaluedLines: 1,
      unvaluedQuantity: 9,
      incomplete: true,
    });
  });
});

describe("the valuation as a file", () => {
  const methodLabels = Object.fromEntries(
    Object.entries(VALUATION_METHOD_NOTES).map(([k, v]) => [k, v.label]),
  );
  const row = (over: Record<string, unknown> = {}) => ({
    itemId: "i1",
    itemName: "Grower crumble",
    unit: "lb",
    lotId: "l1",
    lotCode: "FEED-1",
    lotSource: "purchased",
    quantity: 40,
    valueCents: 29_040,
    method: "carried" as const,
    ...over,
  });
  const valuation = (rows: ReturnType<typeof row>[]): StockValuation => ({
    rows,
    total: valuationTotal(rows),
    asOf: "2026-09-09",
  });

  it("PUTS THE CAVEAT ON THE FIRST LINE, ahead of anything a spreadsheet totals", () => {
    /**
     * A screen can put the caveat beside the number. A file cannot — it is
     * emailed to an accountant and opened months later with no memory of the
     * screen that produced it. Same shape as the general ledger's export, and
     * the same reason.
     */
    const rows = valuationToCsvRows(
      valuation([row(), row({ lotCode: "PEN-1", valueCents: null, method: "none", quantity: 12 })]),
      { asOf: "2026-09-09" },
      methodLabels,
    );
    expect(rows[0][0]).toMatch(/^INCOMPLETE — one batch has no cost recorded, 12 in all/);
    expect(rows[0][0]).toContain("does NOT include them");
    // And the header comes after it, so nothing above the data is a number.
    expect(rows.find((r) => r[0] === "What")).toEqual([
      "What",
      "Batch",
      "On hand",
      "Unit",
      "How it was valued",
      "Worth",
    ]);
  });

  it("has no caveat line at all when nothing is missing, top or bottom", () => {
    // A row reading "0 batches" under a complete valuation trains a reader to
    // skip the line that matters on the day it is not zero.
    const rows = valuationToCsvRows(valuation([row()]), { asOf: "2026-09-09" }, methodLabels);
    expect(rows[0]).toEqual(["As of 2026-09-09"]);
    expect(valuationCaveat(valuation([row()]))).toBeNull();
    expect(rows.some((r) => r[0] === "Not in the total")).toBe(false);
    expect(rows.at(-1)).toEqual(["Total", "", "", "", "1 line valued", "290.40"]);
  });

  it("CARRIES THE FILTERS, because a freezer and a farm are two different files", () => {
    const rows = valuationToCsvRows(
      valuation([row()]),
      {
        asOf: "2026-09-09",
        placeLabel: "Market truck",
        kindLabel: "Feed",
        enterpriseLabel: "Broilers",
      },
      methodLabels,
    );
    const flat = rows.map((r) => r[0]);
    expect(flat).toContain("As of 2026-09-09");
    expect(flat).toContain("Place: Market truck");
    expect(flat).toContain("Kind: Feed");
    expect(flat).toContain("Line of business: Broilers");
  });

  it("LEAVES `Worth` EMPTY for a line it could not value, never 0.00", () => {
    /**
     * A spreadsheet SUMs a zero and skips a blank. Writing `0.00` here would
     * put the exact lie this whole file exists to prevent into a column an
     * accountant adds up.
     */
    const rows = valuationToCsvRows(
      valuation([row({ valueCents: null, method: "none" })]),
      { asOf: "2026-09-09" },
      methodLabels,
    );
    const data = rows.find((r) => r[0] === "Grower crumble")!;
    expect(data[5]).toBe("");
    expect(data[4]).toBe("No cost recorded");
  });

  it("names both admissions apart in the file, as on the screen", () => {
    const rows = valuationToCsvRows(
      valuation([
        row({ valueCents: null, method: "unsplit" }),
        row({ itemName: "Eggs", valueCents: null, method: "none" }),
      ]),
      { asOf: "2026-09-09", placeLabel: "Chest freezer" },
      methodLabels,
    );
    expect(rows.find((r) => r[0] === "Grower crumble")![4]).toBe("Cannot be split");
    expect(rows.find((r) => r[0] === "Eggs")![4]).toBe("No cost recorded");
  });

  it("repeats what is missing at the bottom, beside the total somebody copies", () => {
    const rows = valuationToCsvRows(
      valuation([row(), row({ itemName: "Eggs", valueCents: null, method: "none", quantity: 12 })]),
      { asOf: "2026-09-09" },
      methodLabels,
    );
    expect(rows.at(-2)).toEqual(["Total", "", "", "", "1 line valued", "290.40"]);
    expect(rows.at(-1)).toEqual([
      "Not in the total",
      "",
      "12",
      "",
      "1 batch with no cost recorded",
      "",
    ]);
  });

  it("writes money as a plain number a spreadsheet reads, and quotes what needs it", () => {
    const rows = valuationToCsvRows(
      valuation([row({ itemName: 'Beef, "prime"', valueCents: -800 })]),
      { asOf: "2026-09-09" },
      methodLabels,
    );
    const csv = toCsv(rows);
    // No symbol, no thousands separator, a real minus.
    expect(csv).toContain("-8.00");
    // RFC 4180: the doubled quote is what stops a spreadsheet splitting a name.
    expect(csv).toContain('"Beef, ""prime"""');
  });

  it("names the file after the day and what it was narrowed to", () => {
    expect(valuationCsvFilename({ asOf: "2026-09-09" })).toBe(
      "stock-value_2026-09-09.csv",
    );
    expect(
      valuationCsvFilename({
        asOf: "2026-09-09",
        placeLabel: "Chest freezer (garage)",
        kindLabel: "Feed",
      }),
    ).toBe("stock-value_2026-09-09_chest-freezer-garage_feed.csv");
  });
});
