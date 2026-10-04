import { describe, expect, it } from "vitest";
import {
  EMPTY_SHOPPING,
  addOwn,
  buildList,
  defaultRange,
  emptyTotal,
  addTo,
  listLines,
  marksFor,
  measureOf,
  measureOfFood,
  ownFor,
  rangeOk,
  removeOwn,
  setMark,
  shoppingStateSchema,
  spanWords,
  toggleOwn,
  totalWords,
  type LineName,
  type ListCook,
  type ListFood,
  type Measure,
} from "../src/modules/food/core/list";
import { cleanItem, namesPrompt, normalizeNames } from "../src/modules/food/core/list-names";

/**
 * FOOD'S SHOPPING LIST, THE PURE HALF (D3, docs/modules/food.md, ADR 0130):
 * what a line asks for, the sums and their words, the list for a run of days
 * (bought once per batch, gathered by the names Claude gave, staples and what
 * he always has), the trip kept on the phone, and the reader of Claude's
 * names. Today is Wednesday 7 Oct 2026: this week runs 5 to 11 October.
 */

const TODAY = "2026-10-07";

function words(...measures: Measure[]): string {
  const total = emptyTotal();
  for (const m of measures) addTo(total, m);
  return totalWords(total);
}

describe("what a line asks for", () => {
  it("reads a weight, a volume, a unit of its own and a count", () => {
    expect(measureOf("2 lb ground turkey", 1)).toMatchObject({ kind: "mass", us: true });
    expect(measureOf("200g rice", 1)).toEqual({ kind: "mass", grams: 200, us: false });
    expect(measureOf("1 ½ cups (190 g) flour", 1)).toMatchObject({ kind: "volume", us: true });
    expect(measureOf("500 ml stock", 1)).toEqual({ kind: "volume", ml: 500, us: false });
    expect(measureOf("4 cloves garlic, minced", 0.5)).toEqual({ kind: "unit", key: "clove", one: "clove", many: "cloves", count: 2, times: false });
    expect(measureOf("2 yellow onions, diced", 1)).toEqual({ kind: "count", count: 2 });
    expect(measureOf("2 large eggs", 2)).toEqual({ kind: "count", count: 4 });
  });

  it("keeps a container's size with it, wherever the recipe wrote it", () => {
    expect(measureOf("2 cans (15 oz) black beans, drained", 1)).toMatchObject({ kind: "unit", key: "can (15 oz)", many: "cans (15 oz)", count: 2 });
    expect(measureOf("1 (14 oz) can diced tomatoes", 1)).toMatchObject({ kind: "unit", key: "can (14 oz)", count: 1 });
  });

  it("buys a range's larger end, and adds nothing for a line with no amount", () => {
    expect(measureOf("2-3 cloves garlic", 1)).toMatchObject({ kind: "unit", count: 3 });
    expect(measureOf("Salt and pepper to taste", 1)).toEqual({ kind: "none" });
    expect(measureOf("2-inch piece of ginger", 1)).toEqual({ kind: "none" });
  });

  it("reads a planned food by its amount", () => {
    expect(measureOfFood(5, "1 banana", 630)).toEqual({ kind: "unit", key: "portion:1 banana", one: "1 banana", many: "banana", count: 5, times: true });
    expect(measureOfFood(150, "g", 150)).toEqual({ kind: "mass", grams: 150, us: false });
    expect(measureOfFood(6, "oz", 170)).toEqual({ kind: "mass", grams: 170, us: true });
  });
});

describe("adding up", () => {
  it("adds counts, units of the same kind, weights and volumes", () => {
    expect(words(measureOf("2 yellow onions", 1), measureOf("1 yellow onion", 1))).toBe("3");
    expect(words(measureOf("2 cans (15 oz) black beans", 1), measureOf("1 can (15 oz) black beans", 1))).toBe("3 cans (15 oz)");
    expect(words(measureOf("1 can (15 oz) black beans", 1))).toBe("1 can (15 oz)");
    expect(words(measureOf("2 lb ground turkey", 4 / 6))).toBe("1 ⅓ lb");
    expect(words(measureOf("10 oz spinach", 1))).toBe("10 oz");
    expect(words(measureOf("1 cup rice", 1), measureOf("2 tbsp rice", 1))).toBe("1 ⅛ cups");
  });

  it("never turns a volume into a weight: the parts are joined", () => {
    expect(words(measureOf("4 cloves garlic", 1), measureOf("1 tsp minced garlic", 1))).toBe("4 cloves + 1 tsp");
  });

  it("writes small volumes in spoons and metric sums in grams and litres", () => {
    expect(words(measureOf("2 tsp cumin", 1))).toBe("2 tsp");
    expect(words(measureOf("3 tbsp olive oil", 1))).toBe("3 tbsp");
    expect(words(measureOf("2 tbsp oil", 1), measureOf("2 tbsp oil", 1))).toBe("¼ cup");
    expect(words(measureOf("450 g chicken", 1))).toBe("450 g");
    expect(words(measureOf("1 kg potatoes", 1), measureOf("500 g potatoes", 1))).toBe("1.5 kg");
    expect(words(measureOf("750 ml stock", 1), measureOf("500 ml stock", 1))).toBe("1.3 l");
  });

  it("counts portions of a planned food", () => {
    expect(words(measureOfFood(1, "1 banana", 126))).toBe("1 banana");
    expect(words(measureOfFood(2, "1 banana", 252), measureOfFood(3, "1 banana", 378))).toBe("5 × banana");
  });
});

const chili: ListCook = {
  planId: "c1",
  day: TODAY,
  title: "Turkey chili",
  yieldAmount: 6,
  make: 4,
  lines: ["2 lb ground turkey", "2 yellow onions, diced", "4 cloves garlic, minced", "1 tsp salt", "1 cup water"],
};
const bowl: ListCook = {
  planId: "c2",
  day: "2026-10-08",
  title: "Chicken rice bowl",
  yieldAmount: 1,
  make: 2,
  lines: ["1 yellow onion", "1 cup long-grain white rice", "Black pepper to taste"],
};
const later: ListCook = { ...bowl, planId: "c3", day: "2026-10-15" };
const banana: ListFood = { planId: "f1", day: TODAY, name: "Banana, raw", amount: 1, portion: "1 banana", grams: 126 };

const names: Record<string, LineName[]> = {
  "2 lb ground turkey": [{ item: "ground turkey", aisle: "meat", staple: false }],
  "2 yellow onions, diced": [{ item: "yellow onions", aisle: "produce", staple: false }],
  "1 yellow onion": [{ item: "yellow onions", aisle: "produce", staple: false }],
  "4 cloves garlic, minced": [{ item: "garlic", aisle: "produce", staple: false }],
  "1 tsp salt": [{ item: "salt", aisle: "pantry", staple: true }],
  "1 cup water": [{ item: null, aisle: "other", staple: false }],
  "1 cup long-grain white rice": [{ item: "long-grain white rice", aisle: "pantry", staple: false }],
  "Black pepper to taste": [{ item: "black pepper", aisle: "pantry", staple: true }],
  "Banana, raw": [{ item: "bananas", aisle: "produce", staple: false }],
};

describe("the list", () => {
  it("buys each batch once, gathers the same thing across recipes and sorts by aisle", () => {
    const list = buildList({ cooks: [chili, bowl, later], foods: [banana], names, always: [], from: TODAY, to: "2026-10-13" });
    expect(list.items.map((item) => [item.aisle, item.name, item.amount])).toEqual([
      ["produce", "Bananas", "1 banana"],
      ["produce", "Garlic", "2 ⅔ cloves"],
      ["produce", "Yellow onions", "3 ⅓"],
      ["meat", "Ground turkey", "1 ⅓ lb"],
      ["pantry", "Black pepper", ""],
      ["pantry", "Long-grain white rice", "2 cups"],
      ["pantry", "Salt", "⅔ tsp"],
    ]);
    expect(list.cooks).toBe(2);
    expect(list.foods).toBe(1);
    const onions = list.items.find((item) => item.name === "Yellow onions");
    expect(onions?.sources).toEqual([
      { label: "Turkey chili", amount: "1 ⅓" },
      { label: "Chicken rice bowl", amount: "2" },
    ]);
    expect(list.items.find((item) => item.name === "Ground turkey")?.sources).toEqual([{ label: "Turkey chili", amount: "" }]);
    expect(list.items.filter((item) => item.staple).map((item) => item.name)).toEqual(["Black pepper", "Salt"]);
  });

  it("leaves off what he always has, and lists a line not named yet as written, at the batch's size", () => {
    const partial = { ...names };
    delete partial["4 cloves garlic, minced"];
    const list = buildList({ cooks: [chili], foods: [], names: partial, always: ["Salt"], from: TODAY, to: TODAY });
    expect(list.leftOff).toEqual(["salt"]);
    expect(list.items.some((item) => item.name === "Salt")).toBe(false);
    expect(list.unsorted).toBe(1);
    const unsorted = list.items.at(-1);
    expect(unsorted).toMatchObject({ sorted: false, name: "2 ⅔ cloves garlic, minced", key: "line:2 ⅔ cloves garlic, minced", aisle: "other" });
  });

  it("lists each thing a line buys: salt and pepper are two", () => {
    const seasoned: ListCook = { ...chili, lines: ["Salt and pepper to taste", "1 cup each carrots and celery"] };
    const list = buildList({
      cooks: [seasoned],
      foods: [],
      names: {
        "Salt and pepper to taste": [
          { item: "salt", aisle: "pantry", staple: true },
          { item: "black pepper", aisle: "pantry", staple: true },
        ],
        "1 cup each carrots and celery": [
          { item: "carrots", aisle: "produce", staple: false },
          { item: "celery", aisle: "produce", staple: false },
        ],
      },
      always: ["salt"],
      from: TODAY,
      to: TODAY,
    });
    expect(list.items.map((item) => [item.name, item.amount])).toEqual([
      ["Carrots", "⅔ cup"],
      ["Celery", "⅔ cup"],
      ["Black pepper", ""],
    ]);
    expect(list.leftOff).toEqual(["salt"]);
  });

  it("names every line once, the planned foods' names with them", () => {
    expect(listLines([chili, { ...chili, planId: "x" }], [banana])).toEqual([...chili.lines, "Banana, raw"]);
    expect(listLines([{ ...chili, lines: ["  2 lb  ground turkey ", ""] }], [])).toEqual(["2 lb ground turkey"]);
  });
});

describe("the days a list covers", () => {
  it("start today for a week, last until their last day, and end by next Sunday", () => {
    expect(defaultRange(TODAY)).toEqual({ from: TODAY, to: "2026-10-13" });
    expect(rangeOk({ from: "2026-10-05", to: "2026-10-18" }, TODAY)).toBe(true);
    // Sunday's shop for the week ahead lasts into it.
    expect(rangeOk({ from: "2026-10-04", to: "2026-10-10" }, TODAY)).toBe(true);
    expect(rangeOk({ from: "2026-10-05", to: "2026-10-06" }, TODAY)).toBe(false);
    expect(rangeOk({ from: "2026-10-10", to: "2026-10-08" }, TODAY)).toBe(false);
    expect(rangeOk({ from: "2026-10-12", to: "2026-10-19" }, TODAY)).toBe(false);
    expect(spanWords(TODAY, "2026-10-13")).toBe("Oct 7 to 13");
    expect(spanWords("2026-09-29", "2026-10-05")).toBe("Sep 29 to Oct 5");
    expect(spanWords(TODAY, TODAY)).toBe("Oct 7");
  });
});

describe("a trip, kept on the phone", () => {
  it("keeps ticks by the list's first day, so other days start unticked", () => {
    let state = setMark(EMPTY_SHOPPING, TODAY, "garlic", { kind: "got", amount: "3 cloves" });
    state = setMark(state, TODAY, "salt", { kind: "have", amount: "1 tsp" });
    expect(Object.keys(marksFor(state, TODAY))).toEqual(["garlic", "salt"]);
    expect(marksFor(state, "2026-10-10")).toEqual({});
    state = setMark(state, "2026-10-10", "rice", { kind: "got", amount: "2 cups" });
    expect(marksFor(state, "2026-10-10")).toEqual({ rice: { kind: "got", amount: "2 cups" } });
    expect(marksFor(state, TODAY)).toEqual({});
    state = setMark(state, "2026-10-10", "rice", null);
    expect(marksFor(state, "2026-10-10")).toEqual({});
  });

  it("keeps his own items until they are bought, and a new trip starts without the bought ones", () => {
    let state = addOwn(EMPTY_SHOPPING, "a", "  Coffee   beans ");
    state = addOwn(state, "b", "Paper towels");
    state = addOwn(state, "c", "   ");
    expect(state.own.map((item) => item.name)).toEqual(["Coffee beans", "Paper towels"]);
    state = toggleOwn(state, TODAY, "a");
    state = setMark(state, TODAY, "garlic", { kind: "got", amount: "3 cloves" });
    state = setMark(state, TODAY, "salt", { kind: "have", amount: "1 tsp" });
    expect(ownFor(state, TODAY).map((item) => [item.name, item.got])).toEqual([
      ["Coffee beans", TODAY],
      ["Paper towels", null],
    ]);
    // Another trip: what was bought on the last one is gone, and the first write drops it.
    expect(ownFor(state, "2026-10-10").map((item) => item.name)).toEqual(["Paper towels"]);
    const next = setMark(state, "2026-10-10", "rice", { kind: "got", amount: "2 cups" });
    expect(next.own.map((item) => item.name)).toEqual(["Paper towels"]);
    expect(removeOwn(next, "b").own).toEqual([]);
  });

  it("reads back only what it wrote", () => {
    expect(shoppingStateSchema.safeParse(setMark(addOwn(EMPTY_SHOPPING, "a", "Coffee"), TODAY, "garlic", { kind: "got", amount: "3" })).success).toBe(true);
    expect(shoppingStateSchema.safeParse({ range: { from: "today", to: TODAY }, marks: { from: "", byKey: {} }, own: [] }).success).toBe(false);
  });
});

describe("Claude's names, read", () => {
  const lines = ["2 lb ground turkey", "1 cup water", "1 tsp salt", "2 yellow onions"];

  it("keeps each answer by its line's number, in lower case, an unknown aisle as other", () => {
    const out = normalizeNames(
      {
        items: [
          { line: 1, item: " Ground  Turkey ", aisle: "meat", staple: false },
          { line: 2, item: null, aisle: "other", staple: false },
          { line: 3, item: "salt", aisle: "spices", staple: true },
          { line: 3, item: "sea salt", aisle: "pantry", staple: true },
          { line: 9, item: "ghost", aisle: "produce", staple: false },
          { line: "x", item: "nothing", aisle: "produce", staple: false },
        ],
      },
      lines,
    );
    expect(out).toEqual({
      "2 lb ground turkey": [{ item: "ground turkey", aisle: "meat", staple: false }],
      "1 cup water": [{ item: null, aisle: "other", staple: false }],
      "1 tsp salt": [
        { item: "salt", aisle: "other", staple: true },
        { item: "sea salt", aisle: "pantry", staple: true },
      ],
    });
    // The onions were not answered: they stay unnamed, to be asked again.
    expect("2 yellow onions" in out).toBe(false);
    expect(normalizeNames(null, lines)).toEqual({});
  });

  it("keeps several things to a line, each once, and drops a 'nothing' beside a thing", () => {
    const out = normalizeNames(
      {
        items: [
          { line: 1, item: "salt", aisle: "pantry", staple: true },
          { line: 1, item: "black pepper", aisle: "pantry", staple: true },
          { line: 1, item: "Salt", aisle: "pantry", staple: true },
          { line: 1, item: null, aisle: "other", staple: false },
        ],
      },
      ["Salt and pepper to taste"],
    );
    expect(out["Salt and pepper to taste"].map((n) => n.item)).toEqual(["salt", "black pepper"]);
  });

  it("cleans an item, and sends the names in use with the numbered lines", () => {
    expect(cleanItem("   ")).toBeNull();
    expect(cleanItem(7)).toBeNull();
    expect(cleanItem("x".repeat(90))).toHaveLength(80);
    expect(namesPrompt(["1 cup rice", "2 eggs"], ["white rice"])).toBe(
      "Names this person's lists already use: white rice\n\nThe lines:\n1. 1 cup rice\n2. 2 eggs",
    );
    expect(namesPrompt(["2 eggs"], [])).toContain("already use: None yet.");
  });
});
