import { describe, expect, it } from "vitest";
import {
  SHRINK_DAYS,
  averageWeightLb,
  combinedConfidence,
  describeSample,
  conversionWarning,
  feedConversion,
  feedPerLiveweightLb,
  formatLb,
  formatRatio,
  gainBetween,
  isMeasuredMethod,
  isShrinkAffected,
  latestWeighIn,
  tapeWeightLb,
  type WeighIn,
} from "../src/packs/livestock/core/weights";
import { tapeDivisorFrom } from "../src/packs/livestock/vocabulary";

/**
 * Livestock slice 5 — weights, and the feed conversion they finally make
 * possible.
 *
 * The claims worth certifying are the REFUSALS. A weight is easy; the whole
 * point of this slice is that the number the broiler enterprise is judged on is
 * only produced when it is genuinely known:
 *
 *   1. **Gain needs two weighings**, and one is a weight rather than a gain.
 *   2. **A haul lies to weight data** — cattle drop 3–5% on a trailer — so a
 *      weighing in its shadow is kept and left out of the arithmetic.
 *   3. **A tape is an estimate and a scale is not**, and anything downstream of
 *      an estimate says so rather than reading as a figure to price against.
 */

const weighIn = (over: Partial<WeighIn> = {}): WeighIn => ({
  id: "w1",
  weighedOn: "2026-08-01",
  method: "sample",
  averageLb: 4,
  shrinkAffected: false,
  ...over,
});

describe("tapeWeightLb", () => {
  it("is girth squared times length over the divisor", () => {
    // A pig: 40" girth, 42" length, ÷ 400 → 168 lb.
    expect(tapeWeightLb(40, 42, 400)).toBe(168);
  });

  it("REFUSES WITHOUT A DIVISOR rather than picking one", () => {
    // The divisor is the species' and comes from the profile. A pack that
    // defaulted to 400 would quietly weigh sheep as though they were pigs.
    expect(tapeWeightLb(40, 42, null)).toBeNull();
  });

  it("refuses a measurement that is not a measurement", () => {
    expect(tapeWeightLb(0, 42, 400)).toBeNull();
    expect(tapeWeightLb(40, -1, 400)).toBeNull();
    expect(tapeWeightLb(null, 42, 400)).toBeNull();
  });
});

describe("tapeDivisorFrom", () => {
  const config = { species: ["cattle"], tapeDivisors: { cattle: 300, swine: 400 } };

  it("reads the profile's number for that species", () => {
    expect(tapeDivisorFrom(config, "cattle")).toBe(300);
    expect(tapeDivisorFrom(config, "Swine")).toBe(400);
  });

  it("is null for a species the profile says nothing about", () => {
    // Poultry is deliberately absent — nobody tapes a chicken — and the form
    // uses this to stop offering the method at all.
    expect(tapeDivisorFrom(config, "poultry")).toBeNull();
  });

  it("is TOTAL BY CONSTRUCTION over anything jsonb can hold", () => {
    expect(tapeDivisorFrom(null, "cattle")).toBeNull();
    expect(tapeDivisorFrom("nonsense", "cattle")).toBeNull();
    expect(tapeDivisorFrom({ tapeDivisors: [1, 2] }, "cattle")).toBeNull();
    expect(tapeDivisorFrom({ tapeDivisors: { cattle: "300" } }, "cattle")).toBeNull();
    expect(tapeDivisorFrom({ tapeDivisors: { cattle: 0 } }, "cattle")).toBeNull();
  });
});

describe("averageWeightLb", () => {
  const observation = {
    id: "w",
    weighedOn: "2026-08-01",
    method: "sample",
    sampleSize: 10,
    sampleWeightLb: 62.5,
    heartGirthIn: null,
    bodyLengthIn: null,
  };

  it("divides the crate by what was in it", () => {
    // The division the app does so nobody has to do it in the yard.
    expect(averageWeightLb(observation, null)).toBe(6.25);
  });

  it("falls back to the tape when there was no scale", () => {
    expect(
      averageWeightLb(
        { ...observation, sampleSize: 1, sampleWeightLb: null, heartGirthIn: 40, bodyLengthIn: 42 },
        400,
      ),
    ).toBe(168);
  });

  it("is null when a tape reading has no divisor to go through", () => {
    expect(
      averageWeightLb(
        { ...observation, sampleWeightLb: null, heartGirthIn: 40, bodyLengthIn: 42 },
        null,
      ),
    ).toBeNull();
  });
});

describe("shrink", () => {
  it("flags a weighing taken in the shadow of a haul", () => {
    expect(isShrinkAffected("2026-08-02", "2026-08-01")).toBe(true);
    expect(isShrinkAffected("2026-08-01", "2026-08-01")).toBe(true);
  });

  it("stops flagging once they have had time to put it back", () => {
    expect(isShrinkAffected("2026-08-05", "2026-08-01")).toBe(false);
    expect(SHRINK_DAYS).toBe(3);
  });

  it("does not flag a weighing taken BEFORE the haul", () => {
    // The trailer had not happened yet. That weight is as good as any other.
    expect(isShrinkAffected("2026-07-30", "2026-08-01")).toBe(false);
  });

  it("a farm that has never hauled has nothing to flag", () => {
    expect(isShrinkAffected("2026-08-02", null)).toBe(false);
  });
});

describe("gainBetween", () => {
  it("measures between the first and last usable weighing", () => {
    const gain = gainBetween([
      weighIn({ id: "a", weighedOn: "2026-07-01", averageLb: 1 }),
      weighIn({ id: "b", weighedOn: "2026-07-31", averageLb: 4 }),
    ])!;
    expect(gain.gainLb).toBe(3);
    expect(gain.days).toBe(30);
    expect(gain.adgLb).toBe(0.1);
    expect(gain.measured).toBe(true);
  });

  it("ONE WEIGHING IS A WEIGHT, NOT A GAIN", () => {
    expect(gainBetween([weighIn()])).toBeNull();
    expect(gainBetween([])).toBeNull();
  });

  it("refuses two weighings on the same day", () => {
    expect(
      gainBetween([
        weighIn({ id: "a", weighedOn: "2026-07-01", averageLb: 1 }),
        weighIn({ id: "b", weighedOn: "2026-07-01", averageLb: 4 }),
      ]),
    ).toBeNull();
  });

  it("LEAVES SHRINK-AFFECTED WEIGHINGS OUT OF THE ARITHMETIC", () => {
    // The haul weighing is the lightest and the latest. Counting it would report
    // a batch that lost weight in its last fortnight, which did not happen.
    const gain = gainBetween([
      weighIn({ id: "a", weighedOn: "2026-07-01", averageLb: 1 }),
      weighIn({ id: "b", weighedOn: "2026-07-31", averageLb: 4 }),
      weighIn({
        id: "c",
        weighedOn: "2026-08-14",
        averageLb: 3.8,
        shrinkAffected: true,
      }),
    ])!;
    expect(gain.to.id).toBe("b");
    expect(gain.gainLb).toBe(3);
  });

  it("is an ESTIMATE when either end came off a tape", () => {
    const gain = gainBetween([
      weighIn({ id: "a", weighedOn: "2026-07-01", averageLb: 400, method: "scale" }),
      weighIn({ id: "b", weighedOn: "2026-07-31", averageLb: 460, method: "tape" }),
    ])!;
    expect(gain.measured).toBe(false);
  });

  it("skips a weighing whose method could produce no number at all", () => {
    expect(
      gainBetween([
        weighIn({ id: "a", weighedOn: "2026-07-01", averageLb: 1 }),
        weighIn({ id: "b", weighedOn: "2026-07-31", averageLb: null }),
      ]),
    ).toBeNull();
  });
});

describe("the gain window travels with the gain", () => {
  it("carries the two DATES and the day count, not just a rate", () => {
    // Found by driving. Handed "gaining 0.129 lb a day" and nothing else, the
    // advisor spotted that the figure was near the latest weight divided by the
    // bird's age and told the founder it was being read off hatch rather than
    // off two weighings. It was not — but nothing it had been given could prove
    // otherwise, so the objection was fair and the answer was wrong.
    const gain = gainBetween([
      weighIn({ id: "a", weighedOn: "2026-07-10", averageLb: 1.2 }),
      weighIn({ id: "b", weighedOn: "2026-08-18", averageLb: 6.25 }),
    ])!;
    expect(gain.from.weighedOn).toBe("2026-07-10");
    expect(gain.to.weighedOn).toBe("2026-08-18");
    expect(gain.days).toBe(39);
    // And the rate really is over that window rather than over the animal's
    // whole life: 5.05 lb across 39 days, not 6.25 across 49.
    expect(gain.adgLb).toBe(0.129);
  });
});

describe("latestWeighIn", () => {
  it("is the most recent one that produced a number", () => {
    const latest = latestWeighIn([
      weighIn({ id: "a", weighedOn: "2026-07-01" }),
      weighIn({ id: "b", weighedOn: "2026-08-01" }),
      weighIn({ id: "c", weighedOn: "2026-08-10", averageLb: null }),
    ])!;
    expect(latest.id).toBe("b");
  });

  it("still reports a shrink-affected weighing, because it IS the latest fact", () => {
    // Kept out of the GAIN, kept in the "what do they weigh now" answer, with
    // the badge beside it. Hiding it would lose an observation somebody made.
    const latest = latestWeighIn([
      weighIn({ id: "a", weighedOn: "2026-07-01" }),
      weighIn({ id: "b", weighedOn: "2026-08-01", shrinkAffected: true }),
    ])!;
    expect(latest.id).toBe("b");
  });
});

describe("confidence", () => {
  it("is measured only when BOTH ends are", () => {
    expect(combinedConfidence("measured", true)).toBe("measured");
    // The design's own sentence: cattle gain from a tape against allocated
    // pasture cost is estimated and is a trend to watch.
    expect(combinedConfidence("measured", false)).toBe("estimated");
    expect(combinedConfidence("allocated", true)).toBe("estimated");
    expect(combinedConfidence("mixed", true)).toBe("estimated");
  });

  it("treats a method it has never seen as an estimate", () => {
    // The taxonomy is open, so this code will meet methods it does not know.
    expect(isMeasuredMethod("scale")).toBe(true);
    expect(isMeasuredMethod("sample")).toBe(true);
    expect(isMeasuredMethod("walk_over_weigher")).toBe(false);
  });
});

describe("feedConversion", () => {
  it("is pounds of feed per pound of gain", () => {
    const fcr = feedConversion(1000, 500, "measured")!;
    expect(fcr.ratio).toBe(2);
    expect(fcr.confidence).toBe("measured");
  });

  it("REFUSES A NON-POSITIVE GAIN rather than returning a monstrous ratio", () => {
    // An animal that lost weight has a real problem, and a feed conversion is
    // not how to say so.
    expect(feedConversion(1000, 0, "measured")).toBeNull();
    expect(feedConversion(1000, -10, "measured")).toBeNull();
  });

  it("refuses when no feed was recorded by weight", () => {
    // Surplus milk is stocked in gallons and there is no factor to pounds that
    // does not depend on what is in the bucket.
    expect(feedConversion(0, 500, "measured")).toBeNull();
  });
});

describe("feedPerLiveweightLb", () => {
  it("gives a FIRST batch something honest from a single weighing", () => {
    // Not a conversion: it counts the weight the animal arrived with as though
    // the feed had made it. The label on the screen is the whole of the honesty.
    expect(feedPerLiveweightLb(500, 250)).toBe(2);
    expect(feedPerLiveweightLb(500, 0)).toBeNull();
  });
});

describe("formatting", () => {
  it("says an em dash rather than nothing", () => {
    expect(formatLb(null)).toBe("—");
    expect(formatRatio(null)).toBe("—");
  });

  it("speaks a conversion the way a feed rep would", () => {
    expect(formatRatio(2.3)).toBe("2.30 : 1");
    expect(formatLb(1234.567)).toBe("1,234.57 lb");
  });

  it("SAYS HOW MANY WENT ON THE SCALE, because that is how far to trust it", () => {
    expect(describeSample("sample", 10, 200)).toBe("10 of 200 on the scale");
    expect(describeSample("scale", 1, 1)).toBe("1 on the scale");
    expect(describeSample("sample", 200, 200)).toBe("all 200 on the scale");
    expect(describeSample("tape", 1, 12)).toBe("Tape");
  });
});

describe("conversionWarning — slice 8d", () => {
  it("says nothing about a ratio that is physically possible", () => {
    expect(conversionWarning(2.4)).toBeNull();
    expect(conversionWarning(1)).toBeNull();
    expect(conversionWarning(null)).toBeNull();
  });

  it("TELLS ON A RATIO UNDER 1 : 1, and says what it actually means", () => {
    // A pound of gain cannot come from less than a pound of feed, so this is
    // not a miraculous pen — it is feed nobody recorded, and on a homestead
    // that is pasture, which land allocates and deliberately never prices.
    const said = conversionWarning(0.94);
    expect(said).not.toBeNull();
    expect(said).toMatch(/pasture/i);
    // Read as a FLOOR rather than hidden: the figure is still worth something.
    expect(said).toMatch(/floor/i);
  });
});
