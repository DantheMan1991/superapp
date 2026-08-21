import { describe, expect, it } from "vitest";
import {
  carriedValue,
  valuationTotal,
  valueLine,
  type ValuedLine,
} from "../src/packs/inventory/core/valuation";

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
