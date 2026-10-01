import { describe, expect, it } from "vitest";
import { formatAmount, readLine, scaleLine, showLine } from "../src/modules/food/core/amounts";

/**
 * FOOD D1: an ingredient line read for what scales (ADR 0123). Invented lines;
 * every case is one a pasted recipe really brings.
 */

describe("reading the amount at the start of a line", () => {
  it.each([
    ["2 cups flour", 2],
    ["1 ½ cups milk", 1.5],
    ["1½ cups milk", 1.5],
    ["1 1/2 cups milk", 1.5],
    ["1-1/2 cups milk", 1.5],
    ["3/4 cup sugar", 0.75],
    ["¾ cup sugar", 0.75],
    ["1⁄2 tsp salt", 0.5],
    ["1.5 kg potatoes", 1.5],
    ["1,5 kg potatoes", 1.5],
    ["1,000 g flour", 1000],
    [".5 tsp pepper", 0.5],
    ["200g oats", 200],
  ])("%s", (line, amount) => {
    const read = readLine(line);
    expect(read.scales).toBe(true);
    const first = read.pieces.find((piece) => piece.kind === "amount");
    expect(first && first.kind === "amount" ? first.min : null).toBeCloseTo(amount);
  });

  it("reads a range", () => {
    for (const line of ["2-3 cloves garlic", "2 – 3 cloves garlic", "2 to 3 cloves garlic", "2 or 3 cloves garlic"]) {
      const amount = readLine(line).pieces.find((piece) => piece.kind === "amount");
      expect(amount && amount.kind === "amount" ? [amount.min, amount.max] : null).toEqual([2, 3]);
    }
  });

  it("leaves a line with no amount at its start", () => {
    for (const line of ["salt and pepper to taste", "juice of 1 lemon", "a pinch of salt", "Fresh basil"]) {
      expect(readLine(line).scales).toBe(false);
      expect(scaleLine(line, 2)).toBe(line);
    }
  });

  it("does not take a size for an amount", () => {
    for (const line of ["2-inch piece ginger", "2 inch piece ginger", "14-ounce can tomatoes", "5 cm piece ginger"]) {
      expect(readLine(line).scales).toBe(false);
    }
  });
});

describe("writing an amount", () => {
  it.each([
    [0.5, "fraction", "½"],
    [1.5, "fraction", "1 ½"],
    [2.25, "fraction", "2 ¼"],
    [1 / 3, "fraction", "⅓"],
    [2 / 3, "fraction", "⅔"],
    [0.75, "fraction", "¾"],
    [2.99, "fraction", "3"],
    [0.02, "fraction", "⅛"],
    [3, "fraction", "3"],
    [133.333, "decimal", "135"],
    [66.666, "decimal", "67"],
    [2.5, "decimal", "2.5"],
    [1.25, "decimal", "1.3"],
    [0.333, "decimal", "0.33"],
  ] as const)("%s as %s is %s", (value, style, written) => {
    expect(formatAmount(value, style)).toBe(written);
  });
});

describe("scaling a line", () => {
  it("is the line exactly as written at its own size", () => {
    for (const line of ["1 1/2 cups (190 g) all-purpose flour", "2 large eggs", "3 Tbsp. olive oil", "salt"]) {
      expect(scaleLine(line, 1)).toBe(line);
    }
  });

  it("multiplies the amount and keeps the cook's words", () => {
    expect(scaleLine("1 ½ lb chicken thighs", 1.5)).toBe("2 ¼ lb chicken thighs");
    expect(scaleLine("2 tbsp olive oil", 1.5)).toBe("3 tbsp olive oil");
    expect(scaleLine("3 cloves garlic, minced", 0.5)).toBe("1 ½ cloves garlic, minced");
    expect(scaleLine("200 g rolled oats", 2)).toBe("400 g rolled oats");
    expect(scaleLine("2-3 cloves garlic", 2)).toBe("4–6 cloves garlic");
  });

  it("makes a unit written in full follow the number", () => {
    expect(scaleLine("1 cup milk", 2)).toBe("2 cups milk");
    expect(scaleLine("2 cups milk", 0.5)).toBe("1 cup milk");
    expect(scaleLine("1 ½ cups milk", 0.5)).toBe("¾ cup milk");
    expect(scaleLine("1 Tablespoon honey", 3)).toBe("3 Tablespoons honey");
    expect(scaleLine("1 tbsp honey", 3)).toBe("3 tbsp honey");
  });

  it("makes a food counted whole follow the number", () => {
    expect(scaleLine("2 eggs", 0.5)).toBe("1 egg");
    expect(scaleLine("1 large egg, beaten", 2)).toBe("2 large eggs, beaten");
    expect(scaleLine("1 lemon, juiced", 2)).toBe("2 lemons, juiced");
    expect(scaleLine("3 potatoes", 1 / 3)).toBe("1 potato");
  });

  it("scales an equivalent after a measure, but never a can's size, before or after the can", () => {
    expect(scaleLine("1 ½ cups (190 g) flour", 2)).toBe("3 cups (380 g) flour");
    expect(scaleLine("1 stick (½ cup) butter", 2)).toBe("2 sticks (1 cup) butter");
    expect(scaleLine("1 (14 oz) can tomatoes", 2)).toBe("2 (14 oz) cans tomatoes");
    // Found by the drive: the size after the can doubled to "(30 oz)".
    expect(scaleLine("1 can (15 oz) cannellini beans, rinsed", 2)).toBe("2 cans (15 oz) cannellini beans, rinsed");
    expect(scaleLine("2 jars (16 oz each) salsa", 0.5)).toBe("1 jar (16 oz each) salsa");
  });

  it("reads tablespoons and teaspoons as old cards write them", () => {
    expect(scaleLine("1 T butter", 2)).toBe("2 T butter");
    expect(scaleLine("1 t vanilla", 0.5)).toBe("½ t vanilla");
    expect(readLine("2 tomatoes").scales).toBe(true);
    expect(scaleLine("2 tomatoes", 0.5)).toBe("1 tomato");
  });

  it("marks the amount and its unit for the page to highlight", () => {
    expect(showLine(readLine("1 ½ cups (190 g) flour"), 1)).toEqual([
      { text: "1 ½ cups", amount: true },
      { text: " (", amount: false },
      { text: "190 g", amount: true },
      { text: ") flour", amount: false },
    ]);
    expect(showLine(readLine("2 large eggs"), 1)).toEqual([
      { text: "2", amount: true },
      { text: " large eggs", amount: false },
    ]);
  });
});
