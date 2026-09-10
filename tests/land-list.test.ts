import { describe, expect, it } from "vitest";
import {
  compareNames,
  groupRows,
  matchesTerm,
  NO_PLAN,
  ONE_GROUP,
  type Groupable,
} from "@/packs/land/core/list";

/** The shape the plan list and the paddock table both reduce to. */
function feature(
  name: string,
  kind: string,
  planId: string | null = null,
): Groupable {
  return { id: name, name, kind, planId };
}

describe("compareNames", () => {
  it("orders the names this pack mints by number, not by digit", () => {
    const names = [
      "Paddock 1",
      "Paddock 10",
      "Paddock 11",
      "Paddock 12",
      "Paddock 2",
      "Paddock 3",
    ];
    expect([...names].sort(compareNames)).toEqual([
      "Paddock 1",
      "Paddock 2",
      "Paddock 3",
      "Paddock 10",
      "Paddock 11",
      "Paddock 12",
    ]);
  });

  it("orders a name carrying two numbers by the first that differs", () => {
    const names = ["North 10 gate", "North 2 gate", "North 2 brace"];
    expect([...names].sort(compareNames)).toEqual([
      "North 2 brace",
      "North 2 gate",
      "North 10 gate",
    ]);
  });

  it("leaves names with no numbers where they were", () => {
    const names = ["Woods", "Creek field", "Tree line"];
    expect([...names].sort(compareNames)).toEqual([
      "Creek field",
      "Tree line",
      "Woods",
    ]);
  });
});

describe("groupRows", () => {
  const rows = [
    feature("North division 1", "fence", "plan-north"),
    feature("North division 2", "fence", "plan-north"),
    feature("North 1 gate", "gate", "plan-north"),
    feature("South line", "fence", null),
    feature("Centre lane", "lane", null),
  ];

  it("by kind puts every fence under one heading", () => {
    const groups = groupRows(rows, "kind", (key) => key.toUpperCase());
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ["FENCE", 3],
      ["GATE", 1],
      ["LANE", 1],
    ]);
  });

  it("by plan collects one layout's output and leaves the rest last", () => {
    const groups = groupRows(rows, "plan", (key) =>
      key === NO_PLAN ? "Not in a plan" : "North",
    );
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ["North", 3],
      ["Not in a plan", 2],
    ]);
  });

  it("keeps the residual group last however it is named", () => {
    // "Not in a plan" sorts before "North" alphabetically, so a plain sort on
    // the label would put what is left over above the plans it is left over
    // from.
    const groups = groupRows(
      [feature("a", "fence", null), feature("b", "fence", "p")],
      "plan",
      (key) => (key === NO_PLAN ? "Aardvark" : "Zebra"),
    );
    expect(groups.map((g) => g.key)).toEqual(["p", NO_PLAN]);
  });

  it("orders headings by number too", () => {
    const groups = groupRows(
      [
        feature("a", "fence", "p10"),
        feature("b", "fence", "p2"),
        feature("c", "fence", "p1"),
      ],
      "plan",
      (key) => `Plan ${key.slice(1)}`,
    );
    expect(groups.map((g) => g.label)).toEqual(["Plan 1", "Plan 2", "Plan 10"]);
  });

  it("none is one group holding everything, in the order it arrived", () => {
    const groups = groupRows(rows, "none", () => "unused");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(ONE_GROUP);
    expect(groups[0].rows.map((r) => r.name)).toEqual(rows.map((r) => r.name));
  });

  it("holds an empty list without inventing a heading", () => {
    expect(groupRows([], "kind", (k) => k)).toEqual([]);
    expect(groupRows([], "none", (k) => k)).toEqual([
      { key: ONE_GROUP, label: "", rows: [] },
    ]);
  });
});

describe("matchesTerm", () => {
  it("matches any of the values, case-insensitively", () => {
    expect(matchesTerm("fen", "South line", "Fence")).toBe(true);
    expect(matchesTerm("SOUTH", "South line", "Fence")).toBe(true);
    expect(matchesTerm("gate", "South line", "Fence")).toBe(false);
  });

  it("ignores surrounding whitespace and matches everything when empty", () => {
    expect(matchesTerm("  south  ", "South line")).toBe(true);
    expect(matchesTerm("", "anything")).toBe(true);
    expect(matchesTerm("   ", "anything")).toBe(true);
  });

  it("skips a value that is not there rather than throwing", () => {
    expect(matchesTerm("north", null, "North fence")).toBe(true);
    expect(matchesTerm("north", null)).toBe(false);
  });
});
