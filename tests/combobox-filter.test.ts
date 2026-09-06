import { describe, expect, it } from "vitest";
import { matchOptions } from "../src/components/app/combobox-filter";

const chart = [
  { value: "a", label: "6300 · Insurance", keywords: "expense" },
  { value: "b", label: "6310 · Interest Expense", keywords: "expense" },
  { value: "c", label: "4000 · Sales", keywords: "income" },
];

describe("combobox matching", () => {
  it("returns everything, in the caller's order, for an empty query", () => {
    expect(matchOptions(chart, "").map((o) => o.value)).toEqual(["a", "b", "c"]);
    expect(matchOptions(chart, "   ").map((o) => o.value)).toEqual(["a", "b", "c"]);
  });

  it("matches part of a code or a name, case-insensitively", () => {
    expect(matchOptions(chart, "630").map((o) => o.value)).toEqual(["a"]);
    expect(matchOptions(chart, "INSUR").map((o) => o.value)).toEqual(["a"]);
    expect(matchOptions(chart, "63").map((o) => o.value)).toEqual(["a", "b"]);
  });

  it("requires every word, in any order", () => {
    expect(matchOptions(chart, "63 inte").map((o) => o.value)).toEqual(["b"]);
    expect(matchOptions(chart, "expense 63").map((o) => o.value)).toEqual(["a", "b"]);
    expect(matchOptions(chart, "63 sales")).toEqual([]);
  });

  it("matches keywords the row never shows", () => {
    expect(matchOptions(chart, "income").map((o) => o.value)).toEqual(["c"]);
  });

  it("puts a label that starts with the query first, keeping the rest in order", () => {
    const names = [
      { value: "p", label: "Prepaid Insurance" },
      { value: "w", label: "Workers Comp Insurance" },
      { value: "i", label: "Insurance" },
    ];
    expect(matchOptions(names, "insurance").map((o) => o.value)).toEqual(["i", "p", "w"]);
  });

  it("does not mutate the caller's list", () => {
    const copy = [...chart];
    matchOptions(chart, "63");
    expect(chart).toEqual(copy);
  });
});
