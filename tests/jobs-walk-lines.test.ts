import { describe, expect, it } from "vitest";
import { priceBookFrom, priceKey, type RememberedPrice } from "../src/packs/jobs/price-memory";
import {
  basisLabel,
  moneyInText,
  priceProposed,
  quantitiesInText,
  quantityLabel,
  resolveQuantity,
  wasSaid,
  QUANTITY_NOTE_MAX,
  type ProposedShape,
} from "../src/packs/jobs/walk-lines-math";

/**
 * ANSWERS BECOME LINES (X2b, ADR 0098).
 *
 * Almost everything here is about the same rule from a different angle:
 * **a number nobody can point at must not reach an estimate line.** The
 * feature's whole risk is that a model asked what tile costs will answer,
 * and the answer will look exactly like a real one.
 */

const TODAY = "2026-09-20";

function book(rows: Partial<RememberedPrice>[] = []) {
  return priceBookFrom(
    rows.map((r) => ({
      key: priceKey(r.description ?? "Tile, labour"),
      description: "Tile, labour",
      unitCostCents: 350,
      unit: "sf",
      projectNumber: "24-108",
      pricedOn: "2026-08-01",
      ...r,
    })) as RememberedPrice[],
  );
}

function shape(over: Partial<ProposedShape> = {}): ProposedShape {
  return { description: "Tile, labour", unit: "sf", ...over };
}

describe("reading figures out of what somebody said", () => {
  it("reads money however it is written", () => {
    expect(moneyInText("4.20 a foot")).toEqual([420]);
    expect(moneyInText("$4.20")).toEqual([420]);
    expect(moneyInText("12,000 for the lot")).toEqual([1_200_000]);
    expect(moneyInText("12000")).toEqual([1_200_000]);
  });

  it("reads several out of one sentence", () => {
    expect(moneyInText("320 feet at 4.20")).toEqual([32_000, 420]);
  });

  it("finds nothing in a sentence with no digits — a written word is not a figure", () => {
    expect(moneyInText("poured, nine foot")).toEqual([]);
    expect(moneyInText("block wall")).toEqual([]);
  });

  it("reads a quantity as thousandths", () => {
    expect(quantitiesInText("176 lf")).toEqual([176_000]);
    expect(quantitiesInText("9.375 bags")).toEqual([9_375]);
  });
});

describe("wasSaid: the guard on the one basis a model could forge", () => {
  const answers = ["Poured, 176 linear feet", "4.20 a square foot for the tile"];

  it("finds a figure that is in the transcript", () => {
    expect(wasSaid(420, answers)).toBe(true);
  });

  it("refuses one that is not", () => {
    expect(wasSaid(475, answers)).toBe(false);
    expect(wasSaid(42_000, answers)).toBe(false);
  });

  it("looks across every answer on the step, not just the last", () => {
    // "176 linear feet" in the FIRST answer; 176 dollars is 17,600 cents.
    expect(wasSaid(17_600, answers)).toBe(true);
  });

  it("refuses nothing and less than nothing", () => {
    expect(wasSaid(0, answers)).toBe(false);
    expect(wasSaid(-420, answers)).toBe(false);
  });

  it("finds nothing when nothing was said", () => {
    expect(wasSaid(420, [])).toBe(false);
  });
});

describe("priceProposed: where the number came from, or no number", () => {
  it("takes a figure the estimator actually gave", () => {
    const out = priceProposed(
      shape({ saidUnitCostCents: 420 }),
      ["Tile labour runs 4.20 a foot"],
      book(),
      TODAY,
    );
    expect(out.unitCostCents).toBe(420);
    expect(out.basis).toBe("said");
    expect(out.basisDetail).toBe("you said so");
  });

  /**
   * **THE REFUSAL THIS WHOLE FILE IS BUILT AROUND.** A model that puts an
   * invented figure in a field labelled "what they told you" gets the words
   * through — the scope is useful — and no price at all.
   */
  it("drops a figure nobody said, and keeps the words", () => {
    const out = priceProposed(
      shape({ saidUnitCostCents: 475 }),
      ["Tile labour, we do it in-house"],
      book(),
      TODAY,
    );
    expect(out.unitCostCents).toBe(0);
    expect(out.basis).toBe("none");
    expect(out.basisDetail).toBe("needs a price");
    expect(out.description).toBe("Tile, labour");
  });

  it("falls back to what they charged last time", () => {
    const out = priceProposed(shape(), ["in-house"], book([{}]), TODAY);
    expect(out.unitCostCents).toBe(350);
    expect(out.basis).toBe("memory");
    expect(out.basisDetail).toContain("24-108");
  });

  /** What was SAID beats what was charged last time: it is this job. */
  it("prefers what was said over what was remembered", () => {
    const out = priceProposed(
      shape({ saidUnitCostCents: 500 }),
      ["5.00 a foot on this one"],
      book([{}]),
      TODAY,
    );
    expect(out.unitCostCents).toBe(500);
    expect(out.basis).toBe("said");
  });

  it("comes out unpriced when there is nothing to go on", () => {
    const out = priceProposed(shape({ description: "Never priced before" }), [], book(), TODAY);
    expect(out.unitCostCents).toBe(0);
    expect(out.basis).toBe("none");
  });

  /** A memory of nothing is not a memory (E4a's own rule). */
  it("ignores a remembered price of zero", () => {
    const out = priceProposed(shape(), [], book([{ unitCostCents: 0 }]), TODAY);
    expect(out.basis).toBe("none");
  });

  it("takes the remembered unit only when the shape names none", () => {
    expect(priceProposed(shape({ unit: "" }), [], book([{}]), TODAY).unit).toBe("sf");
    expect(priceProposed(shape({ unit: "ea" }), [], book([{}]), TODAY).unit).toBe("ea");
  });

  it("carries the client's words and visibility through", () => {
    const out = priceProposed(
      shape({ clientDescription: "Porcelain tile flooring", clientVisible: false }),
      [],
      book(),
      TODAY,
    );
    expect(out.clientDescription).toBe("Porcelain tile flooring");
    expect(out.clientVisible).toBe(false);
  });
});

/**
 * **A QUANTITY IS EITHER QUOTED OR EXPLAINED.** The first version refused any
 * figure that was not verbatim, which also refused arithmetic anybody would
 * want — say "two baths, three fixtures each" and it would not put 6 on the
 * line. What makes a derived number safe is not that a model did not do it
 * but that the working is on the line and you can judge it in a second.
 */
describe("resolveQuantity: quoted, explained, or refused", () => {
  it("takes a quantity that is in the transcript, with no working needed", () => {
    expect(resolveQuantity(shape({ quantityThousandths: 176_000 }), ["176 lf of footing"])).toEqual(
      { quantityThousandths: 176_000, quantityBasis: "said", quantityNote: "" },
    );
  });

  it("does the arithmetic when the working is given", () => {
    expect(
      resolveQuantity(
        shape({ quantityThousandths: 6_000, derivedFrom: "2 baths at 3 fixtures each" }),
        ["Two baths, three fixtures in each"],
      ),
    ).toEqual({
      quantityThousandths: 6_000,
      quantityBasis: "derived",
      quantityNote: "2 baths at 3 fixtures each",
    });
  });

  /** A number with no account of itself is the thing this must not produce. */
  it("refuses a figure that is neither quoted nor explained", () => {
    expect(resolveQuantity(shape({ quantityThousandths: 240_000 }), ["176 lf of footing"])).toEqual(
      { quantityThousandths: 1_000, quantityBasis: "none", quantityNote: "" },
    );
    expect(
      resolveQuantity(shape({ quantityThousandths: 240_000, derivedFrom: "   " }), ["176 lf"]),
    ).toEqual({ quantityThousandths: 1_000, quantityBasis: "none", quantityNote: "" });
  });

  it("does not ask for working on a figure that was said outright", () => {
    const out = resolveQuantity(
      shape({ quantityThousandths: 176_000, derivedFrom: "not needed" }),
      ["176 lf"],
    );
    expect(out.quantityBasis).toBe("said");
    expect(out.quantityNote).toBe("");
  });

  it("is one when none was proposed at all", () => {
    expect(resolveQuantity(shape(), ["176 lf"]).quantityThousandths).toBe(1_000);
    expect(
      resolveQuantity(shape({ quantityThousandths: 0 }), ["176 lf"]).quantityThousandths,
    ).toBe(1_000);
  });

  it("keeps the working short enough to read on a line", () => {
    const out = resolveQuantity(
      shape({ quantityThousandths: 9_000, derivedFrom: "x".repeat(400) }),
      [],
    );
    expect(out.quantityNote.length).toBe(QUANTITY_NOTE_MAX);
  });

  it("reaches the priced line, working and all", () => {
    const derived = priceProposed(
      shape({ quantityThousandths: 6_000, derivedFrom: "2 baths at 3 fixtures each" }),
      ["two baths"],
      book(),
      TODAY,
    );
    expect(derived.quantityThousandths).toBe(6_000);
    expect(derived.quantityBasis).toBe("derived");
    expect(quantityLabel(derived.quantityBasis, derived.quantityNote)).toBe(
      "2 baths at 3 fixtures each",
    );

    const refused = priceProposed(
      shape({ quantityThousandths: 240_000 }),
      ["176 lf"],
      book(),
      TODAY,
    );
    expect(refused.quantityThousandths).toBe(1_000);
    expect(quantityLabel(refused.quantityBasis, refused.quantityNote)).toBe("");
  });
});

describe("basisLabel", () => {
  it("has a word for every basis", () => {
    for (const b of ["assembly", "memory", "said", "none"] as const) {
      expect(basisLabel(b).length).toBeGreaterThan(0);
    }
  });
});
