import { describe, expect, it } from "vitest";
import {
  outlineFromCostCodes,
  sharedPrefix,
  workItemsFrom,
  type ChartCode,
} from "../src/packs/jobs/outline-math";

/**
 * AN OUTLINE READ OFF A CHART OF COST.
 *
 * One step per CODE was right until a real chart turned up. The pilot's is
 * 291 codes because it splits every phase by the kind of cost, and a 291-step
 * interview is not an interview. What a person walks is the work item.
 *
 * **Nothing in the implementation knows the words "Labor" or "Material"**,
 * and these tests are careful never to require that it does.
 */

function chart(rows: [string, string, string][]): ChartCode[] {
  return rows.map(([category, code, name]) => ({ category, code, name }));
}

/** A slice of the pilot's own chart, verbatim. */
const PILOT = chart([
  ["03. Infrastructure", "03.20", "Excavation Labor"],
  ["03. Infrastructure", "03.21", "Excavation Trucking"],
  ["03. Infrastructure", "03.25", "Excavation Shrock Equipment"],
  ["03. Infrastructure", "03.40", "Excavation Material"],
  ["03. Infrastructure", "03.45", "Tree Removal Labor"],
  ["03. Infrastructure", "03.55", "Tree Removal Subcontractor"],
  ["03. Infrastructure", "03.95", "Well Subcontractor"],
  ["04. Structural", "04.00", "Foundation Labor"],
  ["04. Structural", "04.10", "Foundation Material"],
]);

describe("sharedPrefix", () => {
  it("is the leading words every name has in common", () => {
    expect(sharedPrefix(["Excavation Labor", "Excavation Material"])).toBe("Excavation");
    expect(sharedPrefix(["Interior Trim Labor", "Interior Trim Material"])).toBe("Interior Trim");
  });

  it("is the whole name when there is only one", () => {
    expect(sharedPrefix(["Well Subcontractor"])).toBe("Well Subcontractor");
  });

  it("is nothing when they share nothing, and ignores case", () => {
    expect(sharedPrefix(["Roofing", "Plumbing"])).toBe("");
    expect(sharedPrefix(["Excavation labor", "EXCAVATION material"])).toBe("Excavation");
  });

  it("says nothing about no names", () => {
    expect(sharedPrefix([])).toBe("");
  });
});

describe("workItemsFrom", () => {
  it("folds a chart into the things a person actually walks", () => {
    const items = workItemsFrom(PILOT);
    expect(items.map((i) => [i.title, i.codes.length, i.section])).toEqual([
      ["Excavation", 4, "03. Infrastructure"],
      ["Tree Removal", 2, "03. Infrastructure"],
      ["Well Subcontractor", 1, "03. Infrastructure"],
      ["Foundation", 2, "04. Structural"],
    ]);
  });

  /**
   * **THE RULE THAT STOPS `Interior`.** A group's prefix is fixed by its first
   * two members; a third that would shorten it starts its own group instead.
   * Without this, trim and paint collapse into one step called `Interior`,
   * which is not a thing anybody builds.
   */
  it("will not let a later code shorten a group's prefix", () => {
    const items = workItemsFrom(
      chart([
        ["06. Finishes", "06.10", "Interior Trim Labor"],
        ["06. Finishes", "06.15", "Interior Trim Material"],
        ["06. Finishes", "06.20", "Interior Paint Labor"],
        ["06. Finishes", "06.25", "Interior Paint Material"],
      ]),
    );
    expect(items.map((i) => i.title)).toEqual(["Interior Trim", "Interior Paint"]);
  });

  /** Two phases in different parts of a bid are not one phase. */
  it("never groups across a category", () => {
    const items = workItemsFrom(
      chart([
        ["03. Infrastructure", "03.180", "Concrete Sidewalk Labor"],
        ["04. Structural", "04.60", "Concrete Inside Labor"],
      ]),
    );
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.section)).toEqual(["03. Infrastructure", "04. Structural"]);
  });

  /** Only neighbours group, so the chart's own order is what decides. */
  it("groups neighbours only, so a scattered name stays scattered", () => {
    const items = workItemsFrom(
      chart([
        ["A", "1", "Roofing Labor"],
        ["A", "2", "Siding Labor"],
        ["A", "3", "Roofing Material"],
      ]),
    );
    expect(items.map((i) => i.title)).toEqual(["Roofing Labor", "Siding Labor", "Roofing Material"]);
  });

  it("keeps the chart's order, both of items and of codes inside them", () => {
    const items = workItemsFrom(PILOT);
    expect(items[0].codes.map((c) => c.code)).toEqual(["03.20", "03.21", "03.25", "03.40"]);
  });

  it("leaves retired codes out", () => {
    const items = workItemsFrom([
      { category: "A", code: "1", name: "Excavation Labor" },
      { category: "A", code: "2", name: "Excavation Material", isActive: false },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].codes).toHaveLength(1);
    expect(items[0].title).toBe("Excavation Labor");
  });

  it("copes with a chart that has no categories at all", () => {
    const items = workItemsFrom([
      { code: "1000", name: "Permits and fees" },
      { code: "2000", name: "Foundation" },
    ]);
    expect(items.map((i) => [i.title, i.section])).toEqual([
      ["Permits and fees", ""],
      ["Foundation", ""],
    ]);
  });

  it("says nothing about an empty chart", () => {
    expect(workItemsFrom([])).toEqual([]);
  });

  /**
   * **NOTHING HERE KNOWS WHAT "LABOR" MEANS**, and this is the test that
   * keeps it that way: a business that splits by crew rather than by kind of
   * cost gets exactly the same treatment.
   */
  it("groups by what the names share, not by words it was taught", () => {
    const items = workItemsFrom(
      chart([
        ["Trades", "10", "Masonry crew A"],
        ["Trades", "11", "Masonry crew B"],
        ["Trades", "12", "Masonry crew C"],
        ["Trades", "20", "Glazing crew A"],
      ]),
    );
    expect(items.map((i) => [i.title, i.codes.length])).toEqual([
      ["Masonry crew", 3],
      ["Glazing crew A", 1],
    ]);
  });

  /**
   * **WHAT THE NO-SHRINK RULE COSTS, WRITTEN DOWN RATHER THAN HIDDEN.**
   * `Masonry crew A` and `Masonry crew B` fix the prefix at two words, so
   * `Masonry scaffolding` cannot join them and becomes its own step — even
   * though a person would probably call all three `Masonry`.
   *
   * It is the same rule that keeps `Interior Trim` and `Interior Paint`
   * apart, and that case is the commoner and the more damaging one: a step
   * called `Interior` covering trim, paint, doors and stairs is not a thing
   * anybody walks. **Splitting one work item in two costs a click to merge;
   * merging two costs an estimator a whole phase of questions they never got
   * asked.** A starter is a floor, so it errs towards too many steps.
   */
  it("splits rather than over-merges, and that is the deliberate trade", () => {
    const items = workItemsFrom(
      chart([
        ["Trades", "10", "Masonry crew A"],
        ["Trades", "11", "Masonry crew B"],
        ["Trades", "12", "Masonry scaffolding"],
      ]),
    );
    expect(items.map((i) => i.title)).toEqual(["Masonry crew", "Masonry scaffolding"]);
  });
});

describe("outlineFromCostCodes", () => {
  it("makes one step per work item, carrying its section", () => {
    const steps = outlineFromCostCodes(PILOT);
    expect(steps).toHaveLength(4);
    expect(steps[0]).toMatchObject({
      title: "Excavation",
      section: "03. Infrastructure",
      costCode: "03.20",
    });
  });

  /**
   * A work item spanning eight codes has no single one. The step takes the
   * first as a starting point; the lines a walk produces carry their own.
   */
  it("gives a step the first of its codes, not all of them", () => {
    expect(outlineFromCostCodes(PILOT).map((s) => s.costCode)).toEqual([
      "03.20",
      "03.45",
      "03.95",
      "04.00",
    ]);
  });

  it("asks the one question that needs no knowledge of the trade", () => {
    const steps = outlineFromCostCodes(PILOT);
    expect(steps[0].questions).toHaveLength(1);
    expect(steps[0].questions?.[0].prompt).toBe("Who is doing this one?");
  });

  /**
   * **THE SIZE THIS WHOLE CHANGE EXISTS FOR.** 291 codes used to mean 291
   * steps. The pilot's real chart folds to roughly seventy work items, which
   * is an interview somebody can actually walk.
   */
  it("turns a chart far larger than an outline into one the size of a job", () => {
    const big: ChartCode[] = [];
    for (let phase = 0; phase < 70; phase += 1) {
      for (const kind of ["Labor", "Material", "Mileage", "Subcontractor"]) {
        big.push({ category: "03. Infrastructure", code: `03.${phase}${kind[0]}`, name: `Phase${phase} ${kind}` });
      }
    }
    expect(big).toHaveLength(280);
    expect(outlineFromCostCodes(big)).toHaveLength(70);
  });
});
