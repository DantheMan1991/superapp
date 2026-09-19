import { describe, expect, it } from "vitest";
import { moduleOf, normaliseDenied, reaches } from "@/lib/access/can";

/**
 * WHAT ONE PERSON MAY REACH (ADR 0093).
 *
 * Unlike the rail's own predicates, this one is allowed to be wrong in only one
 * direction. A view preference that hides too much is an annoyance; a
 * permission that grants too much is the whole point of the feature failing.
 * So every assertion here is either "this closes" or "this does not silently
 * open".
 */

describe("a key", () => {
  it("is a module slug, or an area inside one", () => {
    expect(moduleOf("marketing")).toBe("marketing");
    expect(moduleOf("accounting:reports")).toBe("accounting");
  });
});

describe("what a level reaches", () => {
  it("reaches everything when it denies nothing", () => {
    expect(reaches([], "accounting")).toBe(true);
    expect(reaches([], "accounting:reports")).toBe(true);
  });

  it("closes the key it names", () => {
    expect(reaches(["marketing"], "marketing")).toBe(false);
    expect(reaches(["accounting:reports"], "accounting:reports")).toBe(false);
  });

  it("leaves every other key open", () => {
    expect(reaches(["marketing"], "accounting")).toBe(true);
    expect(reaches(["accounting:reports"], "accounting:purchases")).toBe(true);
  });

  /**
   * The founder's own example: Dave keeps Purchases and loses Reports, inside a
   * module he still has.
   */
  it("lets somebody keep one part of a tool and lose another", () => {
    const dave = ["accounting:reports", "accounting:journal", "accounting:trial-balance"];
    expect(reaches(dave, "accounting")).toBe(true);
    expect(reaches(dave, "accounting:purchases")).toBe(true);
    expect(reaches(dave, "accounting:reports")).toBe(false);
  });

  /**
   * **THE ONE THAT MUST NOT LEAK.** A level written today names `accounting`
   * and nothing else, because that is all there was to name. The areas inside
   * it ship next month. Without this, every one of them is reachable by
   * everybody who was denied the whole tool.
   */
  it("closes every area inside a module it denied whole", () => {
    expect(reaches(["accounting"], "accounting:reports")).toBe(false);
    expect(reaches(["accounting"], "accounting:anything-built-later")).toBe(false);
  });

  it("does not close a module because one of its areas is closed", () => {
    expect(reaches(["accounting:reports"], "accounting")).toBe(true);
  });

  it("does not confuse two modules whose names share a prefix", () => {
    expect(reaches(["time"], "time-tracking")).toBe(true);
    expect(reaches(["time"], "time:log")).toBe(false);
  });
});

describe("normalising what is stored", () => {
  /**
   * Unticking a whole tool has to mean unticking its areas, or the row reads
   * "no Accounting, and also no Reports" — two ways of saying one thing, and
   * the second goes stale the moment somebody ticks the tool back on.
   */
  it("drops an area whose module is denied whole", () => {
    expect(normaliseDenied(["accounting", "accounting:reports"])).toEqual(["accounting"]);
  });

  it("keeps an area whose module is not", () => {
    expect(normaliseDenied(["marketing", "accounting:reports"])).toEqual([
      "accounting:reports",
      "marketing",
    ]);
  });

  it("removes duplicates and settles on one order", () => {
    expect(normaliseDenied(["b", "a", "b"])).toEqual(["a", "b"]);
  });

  it("leaves an empty list empty", () => {
    expect(normaliseDenied([])).toEqual([]);
  });

  /** Normalising must never be the thing that opens a door. */
  it("never widens what a level reaches", () => {
    const messy = ["accounting", "accounting:reports", "marketing", "marketing"];
    const tidy = normaliseDenied(messy);
    for (const key of [
      "accounting",
      "accounting:reports",
      "accounting:purchases",
      "marketing",
    ]) {
      expect(reaches(tidy, key)).toBe(reaches(messy, key));
    }
  });
});
