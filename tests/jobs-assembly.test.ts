import { describe, expect, it } from "vitest";
import {
  explodeAssembly,
  resolveCostCode,
  scaleQuantity,
  suggestDriver,
  toEditable,
  type AssemblyLineShape,
} from "../src/packs/jobs/assembly-math";

/**
 * ASSEMBLIES (E6, ADR 0086) — an item, saved, and dropped at another size.
 *
 * The one mistake here that would produce a PLAUSIBLE wrong number is scaling
 * a rate, so most of this is about what must NOT move: a unit cost, a unit
 * price and a markup are per-unit already. A plausible wrong number in an
 * estimate is worse than a refusal, because it goes out in a proposal.
 */

function line(over: Partial<AssemblyLineShape> = {}): AssemblyLineShape {
  return {
    description: "Tile, material",
    clientDescription: "",
    clientVisible: true,
    unit: "sf",
    quantityThousandths: 320_000,
    unitCostCents: 420,
    markupPpm: null,
    unitPriceCents: null,
    costCode: "09 30 00",
    sortOrder: 10,
    ...over,
  };
}

describe("scaleQuantity", () => {
  it("scales in proportion to the driving quantity", () => {
    // 320 sf saved at 320 sf, dropped at 500 sf.
    expect(scaleQuantity(320_000, 320_000, 500_000)).toBe(500_000);
    // 6 bags per 320 sf, at 500 sf, is 9.375 bags — exact in thousandths.
    expect(scaleQuantity(6_000, 320_000, 500_000)).toBe(9_375);
  });

  it("is exact at an awkward ratio rather than drifting", () => {
    expect(scaleQuantity(6_000, 320_000, 501_000)).toBe(9_394);
  });

  it("gives the same back when the size has not changed", () => {
    expect(scaleQuantity(6_000, 320_000, 320_000)).toBe(6_000);
  });

  it("handles a smaller drop", () => {
    expect(scaleQuantity(320_000, 320_000, 80_000)).toBe(80_000);
    expect(scaleQuantity(6_000, 320_000, 80_000)).toBe(1_500);
  });

  it("keeps zero at zero — a line priced as a note stays a note", () => {
    expect(scaleQuantity(0, 320_000, 500_000)).toBe(0);
  });

  /**
   * The table's CHECK makes a zero driver impossible; this is here so a caller
   * that has not read it gets the saved quantity rather than an Infinity.
   */
  it("refuses to divide by nothing, and returns the saved quantity", () => {
    expect(scaleQuantity(6_000, 0, 500_000)).toBe(6_000);
    expect(scaleQuantity(6_000, -1, 500_000)).toBe(6_000);
  });
});

describe("explodeAssembly: only the quantity moves", () => {
  const assembly = { drivingQuantityThousandths: 320_000 };
  const lines = [
    line(),
    line({ description: "Tile, labour", unitCostCents: 350, sortOrder: 20 }),
    line({ description: "Thinset", unit: "bag", quantityThousandths: 6_000, unitCostCents: 1_800, sortOrder: 30 }),
  ];

  it("scales every quantity and nothing else", () => {
    const out = explodeAssembly(assembly, lines, 500_000);
    expect(out.map((l) => l.quantityThousandths)).toEqual([500_000, 500_000, 9_375]);
    // Every rate is untouched.
    expect(out.map((l) => l.unitCostCents)).toEqual([420, 350, 1_800]);
  });

  /**
   * A unit price and a markup are rates too. Scaling either would double-count
   * the size: twice the tile at twice the price per foot is four times the
   * money, and it would look almost right.
   */
  it("leaves an explicit unit price and a markup alone", () => {
    const out = explodeAssembly(
      assembly,
      [line({ unitPriceCents: 1_200, markupPpm: 150_000 })],
      640_000,
    );
    expect(out[0].quantityThousandths).toBe(640_000);
    expect(out[0].unitPriceCents).toBe(1_200);
    expect(out[0].markupPpm).toBe(150_000);
  });

  it("carries the words, the visibility, the code and the order through", () => {
    const out = explodeAssembly(
      assembly,
      [line({ clientDescription: "Porcelain tile flooring", clientVisible: false, sortOrder: 40 })],
      320_000,
    );
    expect(out[0].description).toBe("Tile, material");
    expect(out[0].clientDescription).toBe("Porcelain tile flooring");
    expect(out[0].clientVisible).toBe(false);
    expect(out[0].costCode).toBe("09 30 00");
    expect(out[0].sortOrder).toBe(40);
  });

  it("returns one line out for every line in, in order", () => {
    expect(explodeAssembly(assembly, lines, 1_000).map((l) => l.description)).toEqual([
      "Tile, material",
      "Tile, labour",
      "Thinset",
    ]);
  });

  it("makes nothing from nothing", () => {
    expect(explodeAssembly(assembly, [], 500_000)).toEqual([]);
  });
});

describe("suggestDriver: what this item is per, guessed from its lines", () => {
  it("takes the quantity and unit most of the lines agree on", () => {
    const driver = suggestDriver([
      { unit: "sf", quantityThousandths: 320_000 },
      { unit: "sf", quantityThousandths: 320_000 },
      { unit: "bag", quantityThousandths: 6_000 },
    ]);
    expect(driver).toEqual({ quantityThousandths: 320_000, unit: "sf" });
  });

  it("breaks a tie on the larger quantity — the thing measured, not the fitting", () => {
    const driver = suggestDriver([
      { unit: "sf", quantityThousandths: 320_000 },
      { unit: "bag", quantityThousandths: 6_000 },
    ]);
    expect(driver.quantityThousandths).toBe(320_000);
  });

  it("ignores case when counting the same unit", () => {
    const driver = suggestDriver([
      { unit: "SF", quantityThousandths: 320_000 },
      { unit: "sf", quantityThousandths: 320_000 },
      { unit: "ea", quantityThousandths: 4_000 },
    ]);
    expect(driver.quantityThousandths).toBe(320_000);
  });

  /**
   * A kitchen of lump sums has nothing to measure, so it is one of itself.
   * That is a useful assembly, not a broken one.
   */
  it("is one of nothing when no line carries a unit", () => {
    expect(suggestDriver([{ unit: "", quantityThousandths: 1_000 }])).toEqual({
      quantityThousandths: 1_000,
      unit: "",
    });
    expect(suggestDriver([])).toEqual({ quantityThousandths: 1_000, unit: "" });
  });

  it("ignores a line with a unit but no quantity", () => {
    expect(suggestDriver([{ unit: "sf", quantityThousandths: 0 }])).toEqual({
      quantityThousandths: 1_000,
      unit: "",
    });
  });
});

describe("resolveCostCode: the code is text, and it lands on THIS job's set", () => {
  const codes = [
    { id: "c1", code: "09 30 00" },
    { id: "c2", code: "06 10 00" },
  ];

  it("matches the same code however it is spaced or cased", () => {
    expect(resolveCostCode("09 30 00", codes)).toBe("c1");
    expect(resolveCostCode("093000", codes)).toBe("c1");
    expect(resolveCostCode(" 09  30  00 ", codes)).toBe("c1");
  });

  /**
   * NO MATCH MEANS NO CODE, never a guess. An uncoded line still prices and is
   * merely left out of the budget, which is visible; a line silently filed
   * under somebody else's code is not.
   */
  it("gives no code rather than a near one", () => {
    expect(resolveCostCode("09 30 01", codes)).toBeNull();
    expect(resolveCostCode("09", codes)).toBeNull();
    expect(resolveCostCode("Tiling", codes)).toBeNull();
  });

  it("gives no code for a line that never had one, and for a job with no set", () => {
    expect(resolveCostCode("", codes)).toBeNull();
    expect(resolveCostCode("   ", codes)).toBeNull();
    expect(resolveCostCode("09 30 00", [])).toBeNull();
  });
});

/**
 * A LINE AS A FORM SHOWS IT (X10).
 *
 * Stored money is cents and stored quantity is thousandths; a text input
 * holds neither. The conversion lives in the pure module and not in the
 * editor for a reason worth a test of its own: **a server component may not
 * call a function out of a `"use client"` file**, only render one. It was in
 * the wrong file first, `tsc` and `next build` were both green, and opening
 * the page was the only thing that said so.
 */
describe("toEditable", () => {
  function line(over: Partial<Parameters<typeof toEditable>[0]> = {}) {
    return {
      description: "Tile, material",
      clientDescription: "",
      clientVisible: true,
      unit: "sf",
      quantityThousandths: 320_000,
      unitCostCents: 420,
      costCode: "09 30 00",
      markupPpm: null,
      unitPriceCents: null,
      ...over,
    };
  }

  it("writes the quantity and the money the way a box takes them", () => {
    const e = toEditable(line());
    expect(e.quantity).toBe("320");
    expect(e.unitCost).toBe("4.20");
  });

  it("keeps a fractional quantity rather than rounding it into the box", () => {
    expect(toEditable(line({ quantityThousandths: 24_500 })).quantity).toBe("24.5");
  });

  /** Nothing is not zero: a line saved without a markup has none, not 0%. */
  it("carries a missing markup and price through as missing", () => {
    const e = toEditable(line());
    expect(e.markupPpm).toBeNull();
    expect(e.unitPriceCents).toBeNull();
  });

  it("carries the words and the flags untouched", () => {
    const e = toEditable(line({ clientVisible: false, clientDescription: "Porcelain tile" }));
    expect([e.description, e.clientDescription, e.unit, e.costCode, e.clientVisible]).toEqual([
      "Tile, material",
      "Porcelain tile",
      "sf",
      "09 30 00",
      false,
    ]);
  });
});
