import { describe, expect, it } from "vitest";
import {
  feePerLb,
  feeTotal,
  lineCents,
  lineQuantity,
  type FeeLine,
  type RunMeasures,
} from "../src/packs/production/core/fee";

/**
 * The half of a run's cost that was missing until slice 2c.
 *
 * Every claim here is about a refusal or about arithmetic somebody would
 * otherwise do in their head, and the second kind matters more than it looks:
 * **flat per animal plus per pound is what most plants quote**, and its
 * consequence — a smaller animal costing more per POUND at the same plant — is
 * the reason the fee could not be one number.
 */

const NOTHING: RunMeasures = {
  head: null,
  liveLb: null,
  hangingLb: null,
  finishedLb: null,
};

const A_KILL_DAY: RunMeasures = {
  head: 2,
  liveLb: 2300,
  hangingLb: 1380,
  finishedLb: 966,
};

const line = (over: Partial<FeeLine> = {}): FeeLine => ({
  key: "a",
  label: "Slaughter",
  unitPriceCents: 9500,
  unit: "head",
  minimumCents: null,
  quantity: null,
  ...over,
});

describe("lineQuantity", () => {
  it("measures the four a finished run knows about itself", () => {
    expect(lineQuantity(line({ unit: "head" }), A_KILL_DAY)).toEqual({
      quantity: 2,
      source: "measured",
    });
    expect(lineQuantity(line({ unit: "live_lb" }), A_KILL_DAY)).toEqual({
      quantity: 2300,
      source: "measured",
    });
    expect(lineQuantity(line({ unit: "hanging_lb" }), A_KILL_DAY)).toEqual({
      quantity: 1380,
      source: "measured",
    });
    expect(lineQuantity(line({ unit: "finished_lb" }), A_KILL_DAY)).toEqual({
      quantity: 966,
      source: "measured",
    });
  });

  it("NEVER INVENTS ONE FOR A UNIT ONLY A PERSON CAN COUNT", () => {
    // Assuming "one" of anything is how a fee becomes quietly wrong in the
    // direction of too small — a $0.35 vacuum pack charge on 140 packages
    // reading as $0.35.
    for (const unit of ["package", "box", "hour"] as const) {
      expect(lineQuantity(line({ unit }), A_KILL_DAY)).toEqual({
        quantity: null,
        source: "unknown",
      });
    }
  });

  it("resolves `flat` to one without measuring anything", () => {
    // Charged once for the drop-off, whatever went. Still reported as measured
    // rather than typed, because nobody typed it.
    expect(lineQuantity(line({ unit: "flat" }), NOTHING)).toEqual({
      quantity: 1,
      source: "measured",
    });
  });

  it("A TYPED QUANTITY BEATS A MEASURED ONE, including a wrong-looking one", () => {
    // The plant's invoice is the authority on what it charged for. Somebody
    // typing 3 after reading the bill is correcting the app, not the reverse.
    expect(
      lineQuantity(line({ unit: "head", quantity: 3 }), A_KILL_DAY),
    ).toEqual({ quantity: 3, source: "typed" });
  });

  it("treats an unmeasured run as unknown, not as nought", () => {
    // `livestock`'s rule arriving in a fee: a run with no kill sheet has no
    // hanging weight, and 0 lb x $0.90 would read as a free service.
    expect(lineQuantity(line({ unit: "hanging_lb" }), NOTHING)).toEqual({
      quantity: null,
      source: "unknown",
    });
  });

  it("gives an instruction line no quantity at all", () => {
    expect(
      lineQuantity(line({ unit: null, unitPriceCents: null }), A_KILL_DAY),
    ).toEqual({ quantity: null, source: "unknown" });
  });
});

describe("lineCents", () => {
  it("multiplies and rounds to the cent", () => {
    expect(lineCents(line({ unitPriceCents: 90 }), 1380)).toEqual({
      cents: 124_200,
      atMinimum: false,
    });
  });

  it("APPLIES A MINIMUM AS A FLOOR AND LAST, never by adding it", () => {
    // "$0.65 a lb, $10 minimum" charges $10 for a 12 lb bird and $13 for a 20 lb
    // one. Adding the minimum to the price — the mistake the extractor's prompt
    // is explicitly told not to make — would charge $17.80 for the first.
    const turkey = line({ unitPriceCents: 65, unit: "live_lb", minimumCents: 1000 });
    expect(lineCents(turkey, 12)).toEqual({ cents: 1000, atMinimum: true });
    expect(lineCents(turkey, 20)).toEqual({ cents: 1300, atMinimum: false });
  });

  it("charges the minimum on a line whose price nobody quoted", () => {
    // "Cutting, price on application, $75 minimum" is a real line, and the
    // floor is the one figure on it that is certain. Reporting nothing would
    // understate the bill by the only amount anybody knows.
    expect(
      lineCents(line({ unitPriceCents: null, minimumCents: 7500 }), null),
    ).toEqual({ cents: 7500, atMinimum: true });
  });

  it("returns null rather than nought when there is nothing to go on", () => {
    expect(lineCents(line({ unitPriceCents: null }), 12)).toEqual({
      cents: null,
      atMinimum: false,
    });
    expect(lineCents(line({ unitPriceCents: 9500 }), null)).toEqual({
      cents: null,
      atMinimum: false,
    });
  });
});

describe("feeTotal", () => {
  it("FLAT PER ANIMAL PLUS PER POUND — the arrangement most plants quote", () => {
    const total = feeTotal(
      [
        line({ key: "kill", unitPriceCents: 9500, unit: "head" }),
        line({
          key: "cut",
          label: "Cut and wrap",
          unitPriceCents: 90,
          unit: "hanging_lb",
        }),
      ],
      A_KILL_DAY,
    );
    // 2 head at $95 = $190, plus 1,380 lb hanging at $0.90 = $1,242.
    expect(total.cents).toBe(19_000 + 124_200);
    expect(total.unpriced).toEqual([]);
  });

  it("IS WHY A SMALLER ANIMAL COSTS MORE PER POUND AT THE SAME PLANT", () => {
    // The fact this whole model exists to make visible. Same rates, two
    // carcasses; the flat half spreads over less meat on the smaller one.
    const rates = (hangingLb: number) =>
      feeTotal(
        [
          line({ key: "kill", unitPriceCents: 9500, unit: "head" }),
          line({ key: "cut", unitPriceCents: 90, unit: "hanging_lb" }),
        ],
        { head: 1, liveLb: null, hangingLb, finishedLb: hangingLb * 0.7 },
      );
    const big = rates(900);
    const small = rates(600);
    const perLbBig = feePerLb(big.cents, 900);
    const perLbSmall = feePerLb(small.cents, 600);
    expect(perLbBig).not.toBeNull();
    expect(perLbSmall).not.toBeNull();
    // $905 over 900 lb against $635 over 600 lb: 100.6c against 105.8c, a real
    // 5% difference in what the meat cost, from identical rates.
    expect(perLbSmall!).toBeGreaterThan(perLbBig!);
    expect(Math.round(perLbBig!)).toBe(101);
    expect(Math.round(perLbSmall!)).toBe(106);
  });

  it("REPORTS WHAT IT COULD NOT PRICE RATHER THAN QUIETLY OMITTING IT", () => {
    // A screen showing $612.40 with no mention of the lines it could not price
    // is worse than one showing nothing: it looks finished.
    const total = feeTotal(
      [
        line({ key: "kill", unitPriceCents: 9500, unit: "head" }),
        line({
          key: "pack",
          label: "Vacuum pack",
          unitPriceCents: 35,
          unit: "package",
        }),
      ],
      A_KILL_DAY,
    );
    expect(total.cents).toBe(19_000);
    expect(total.unpriced.map((l) => l.label)).toEqual(["Vacuum pack"]);
  });

  it("AN INSTRUCTION IS NOT UNPRICED — it is not a charge", () => {
    // "Grind the chuck" has no price, no unit and no minimum. Listing it among
    // the things that could not be worked out would make every cut sheet look
    // broken.
    const total = feeTotal(
      [
        line({ key: "kill", unitPriceCents: 9500, unit: "head" }),
        line({
          key: "grind",
          label: "Grind the chuck",
          unitPriceCents: null,
          unit: null,
        }),
      ],
      A_KILL_DAY,
    );
    expect(total.cents).toBe(19_000);
    expect(total.unpriced).toEqual([]);
    expect(total.lines).toHaveLength(2);
  });

  it("adds up to nothing, and says so, on a sheet nothing could measure", () => {
    const total = feeTotal(
      [line({ key: "cut", unitPriceCents: 90, unit: "hanging_lb" })],
      NOTHING,
    );
    expect(total.cents).toBe(0);
    expect(total.unpriced).toHaveLength(1);
  });

  it("is nothing at all for a sheet with no lines", () => {
    expect(feeTotal([], A_KILL_DAY)).toEqual({
      lines: [],
      cents: 0,
      unpriced: [],
    });
  });
});

describe("feePerLb", () => {
  it("refuses a rate over no pounds rather than calling it free", () => {
    // The same refusal `lotShareCents` makes: a rate with no denominator is a
    // question, not a zero.
    expect(feePerLb(19_000, null)).toBeNull();
    expect(feePerLb(19_000, 0)).toBeNull();
  });
});
