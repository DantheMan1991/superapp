import { describe, expect, it } from "vitest";
import {
  cashCount,
  dayResult,
  lineTotalCents,
  remainingOnTruck,
  saleTotalCents,
  soldByItem,
  takings,
} from "../src/packs/retail/core/till";

/**
 * The till's arithmetic. No database anywhere in this file.
 *
 * **THE ROUNDING TESTS ARE THE IMPORTANT ONES.** A market stall adds a line up
 * in front of somebody holding a note, and the day-end report adds the same
 * lines up hours later. If the two rounded differently by a cent, the till would
 * be wrong in the only place a customer can check it.
 */

describe("lineTotalCents", () => {
  it("rounds once, per line, at the half cent", () => {
    // 2.35 lb at $5.50 is $12.925. A stall charges $12.93, and so does a person
    // doing it in their head.
    expect(lineTotalCents({ quantity: 2.35, unitPriceCents: 550 })).toBe(1293);
    expect(lineTotalCents({ quantity: 1, unitPriceCents: 550 })).toBe(550);
    expect(lineTotalCents({ quantity: 0.5, unitPriceCents: 999 })).toBe(500);
  });

  it("treats free as a line, because a sample is one", () => {
    expect(lineTotalCents({ quantity: 3, unitPriceCents: 0 })).toBe(0);
  });
});

describe("saleTotalCents", () => {
  it("SUMS ROUNDED LINES, never rounds a sum", () => {
    /**
     * The distinction that keeps a receipt agreeing with its own rows. Three
     * lines at $12.925 each are $12.93 three times — $38.79 — not $38.775
     * rounded to $38.78. Getting this backwards is a penny a receipt and a
     * customer who stops trusting the number.
     */
    const lines = [
      { quantity: 2.35, unitPriceCents: 550 },
      { quantity: 2.35, unitPriceCents: 550 },
      { quantity: 2.35, unitPriceCents: 550 },
    ];
    expect(saleTotalCents(lines)).toBe(3879);
    expect(saleTotalCents(lines)).not.toBe(Math.round(2.35 * 550 * 3));
  });

  it("is nothing for an empty basket", () => {
    expect(saleTotalCents([])).toBe(0);
  });
});

describe("takings", () => {
  it("keeps cash apart from everything else, because only cash can be counted", () => {
    /**
     * A day-end reconciliation that compared the tin against TOTAL takings
     * would report every card sale as a shortfall — the fastest way to teach
     * somebody to ignore the number.
     */
    const took = takings([
      { paymentMethod: "cash", totalCents: 2_000 },
      { paymentMethod: "card", totalCents: 3_500 },
      { paymentMethod: "cash", totalCents: 1_250 },
      { paymentMethod: "other", totalCents: 500 },
    ]);
    expect(took.totalCents).toBe(7_250);
    expect(took.cashCents).toBe(3_250);
    expect(took.otherCents).toBe(4_000);
    expect(took.saleCount).toBe(4);
  });

  it("is zero across the board for a day nobody sold anything on", () => {
    const took = takings([]);
    expect(took.totalCents).toBe(0);
    expect(took.saleCount).toBe(0);
  });
});

describe("cashCount", () => {
  it("checks the tin against the float plus CASH sales only", () => {
    const count = cashCount({
      openingFloatCents: 5_000,
      cashCountedCents: 8_250,
      cashSalesCents: 3_250,
    });
    expect(count.expectedCents).toBe(8_250);
    expect(count.varianceCents).toBe(0);
    expect(count.uncounted).toBe(false);
  });

  it("reports short and over with a sign", () => {
    expect(
      cashCount({
        openingFloatCents: 5_000,
        cashCountedCents: 8_000,
        cashSalesCents: 3_250,
      }).varianceCents,
    ).toBe(-250);
    expect(
      cashCount({
        openingFloatCents: 5_000,
        cashCountedCents: 8_500,
        cashSalesCents: 3_250,
      }).varianceCents,
    ).toBe(250);
  });

  it("REFUSES TO REPORT A VARIANCE FOR A DAY NOBODY COUNTED", () => {
    /**
     * Not counted and counted-and-found-right are different facts. Treating a
     * blank as zero would report the whole day's cash as a shortfall, which is
     * both alarming and wrong.
     */
    const count = cashCount({
      openingFloatCents: 5_000,
      cashCountedCents: null,
      cashSalesCents: 3_250,
    });
    expect(count.uncounted).toBe(true);
    expect(count.varianceCents).toBe(0);
    // It still says what it EXPECTED, which is the useful half.
    expect(count.expectedCents).toBe(8_250);
  });

  it("reads a missing float as nothing taken to the stall", () => {
    // Unlike the count, a float is a decision made before leaving rather than a
    // measurement somebody might not have taken.
    expect(
      cashCount({
        openingFloatCents: null,
        cashCountedCents: 3_250,
        cashSalesCents: 3_250,
      }).varianceCents,
    ).toBe(0);
  });
});

describe("dayResult", () => {
  const took = takings([
    { paymentMethod: "cash", totalCents: 20_000 },
    { paymentMethod: "card", totalCents: 10_000 },
  ]);

  it("is takings less what it cost to stand there", () => {
    const result = dayResult({
      takings: took,
      outOfPocketCents: 5_300,
      personHours: 10,
      costUnrecorded: false,
    });
    expect(result.revenueCents).toBe(30_000);
    expect(result.costCents).toBe(5_300);
    expect(result.marginCents).toBe(24_700);
  });

  it("KEEPS THE HOURS OUT OF THE MONEY and beside it instead", () => {
    /**
     * The design's whole argument for the market-day record: if own hours count
     * as zero then every market is profitable and the dud is invisible. Charging
     * them at some invented rate would make comparing two markets a comparison
     * of two guesses — so the hours are a divisor, not a cost.
     */
    const long = dayResult({
      takings: took,
      outOfPocketCents: 5_300,
      personHours: 10,
      costUnrecorded: false,
    });
    const short = dayResult({
      takings: took,
      outOfPocketCents: 5_300,
      personHours: 4,
      costUnrecorded: false,
    });
    // Same margin, and the four-hour market is plainly the better one.
    expect(long.marginCents).toBe(short.marginCents);
    expect(long.perPersonHourCents).toBe(2_470);
    expect(short.perPersonHourCents).toBe(6_175);
  });

  it("says nothing per hour rather than dividing by hours nobody recorded", () => {
    expect(
      dayResult({
        takings: took,
        outOfPocketCents: 5_300,
        personHours: null,
        costUnrecorded: false,
      }).perPersonHourCents,
    ).toBeNull();
  });

  it("flags a day that took money with no cost recorded, because the margin flatters it", () => {
    const result = dayResult({
      takings: took,
      outOfPocketCents: 0,
      personHours: null,
      costUnrecorded: true,
    });
    expect(result.marginCents).toBe(30_000);
    expect(result.costUnrecorded).toBe(true);
    // A day with no takings AND no cost is simply an empty day, not a flattered
    // one — there is nothing to warn about.
    expect(
      dayResult({
        takings: takings([]),
        outOfPocketCents: 0,
        personHours: null,
        costUnrecorded: true,
      }).costUnrecorded,
    ).toBe(false);
  });
});

describe("remainingOnTruck", () => {
  it("counts the truck down locally as things sell", () => {
    /**
     * **THE WHOLE OFFLINE ARCHITECTURE.** The truck is a mobile inventory
     * location touched by exactly one device, so there is nothing to conflict
     * over and nothing to ask a server about between customers.
     */
    const snapshot = [
      { itemId: "beef", onHand: 40 },
      { itemId: "eggs", onHand: 30 },
    ];
    const sold = soldByItem([
      { itemId: "beef", quantity: 2.35 },
      { itemId: "beef", quantity: 1.5 },
      { itemId: "eggs", quantity: 6 },
    ]);
    expect(remainingOnTruck(snapshot, sold)).toEqual([
      { itemId: "beef", onHand: 36.15 },
      { itemId: "eggs", onHand: 24 },
    ]);
  });

  it("lets the truck go negative rather than refusing a customer", () => {
    // `inventory` allows negative stock on purpose. A till that would not sell
    // the last item because the morning snapshot was stale would be choosing a
    // tidy number over somebody holding cash.
    expect(
      remainingOnTruck(
        [{ itemId: "beef", onHand: 1 }],
        soldByItem([{ itemId: "beef", quantity: 3 }]),
      ),
    ).toEqual([{ itemId: "beef", onHand: -2 }]);
  });

  it("leaves an untouched line alone", () => {
    expect(
      remainingOnTruck([{ itemId: "beef", onHand: 40 }], new Map()),
    ).toEqual([{ itemId: "beef", onHand: 40 }]);
  });
});
