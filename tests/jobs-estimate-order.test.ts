import { describe, expect, it } from "vitest";
import {
  dragTo,
  dropInSection,
  inVisualOrder,
  lineNumber,
  linesIn,
  moveItem,
  parseAddress,
  placeLine,
  sectionOf,
  sectionsOf,
} from "@/packs/jobs/estimate-order";

/**
 * THE ORDER OF AN ESTIMATE (ADR 0087).
 *
 * The arithmetic of "put this row there" is worth a test of its own because
 * the screen cannot prove it: a row that lands one place off looks like a row
 * that landed, and the wrong `sort_order` reaches the client's proposal.
 */

interface Row {
  key: string;
  groupKey: string;
}

const row = (key: string, groupKey = ""): Row => ({ key, groupKey });
const keys = (rows: readonly Row[]): string[] => rows.map((r) => r.key);

/** Two items and a loose line: a, b under g1; c under g2; d in no item. */
const GROUPS = ["g1", "g2"];
const LINES: Row[] = [row("a", "g1"), row("b", "g1"), row("c", "g2"), row("d")];

describe("the sections a line can sit in", () => {
  it("draws the items in their order, then the loose pile", () => {
    expect(sectionsOf(GROUPS)).toEqual(["g1", "g2", ""]);
  });

  it("puts a line whose item is gone in the loose pile", () => {
    expect(sectionOf(row("x", "g9"), GROUPS)).toBe("");
    expect(sectionOf(row("x", "g2"), GROUPS)).toBe("g2");
  });
});

describe("visual order", () => {
  it("is each item's lines beneath it, the loose ones last", () => {
    const scrambled = [row("d"), row("c", "g2"), row("b", "g1"), row("a", "g1")];
    expect(keys(inVisualOrder(scrambled, GROUPS))).toEqual(["b", "a", "c", "d"]);
  });

  it("keeps two lines of one item in the order they were in", () => {
    expect(keys(inVisualOrder(LINES, GROUPS))).toEqual(["a", "b", "c", "d"]);
  });

  it("hands back the rows of one section", () => {
    expect(keys(linesIn(LINES, GROUPS, "g1"))).toEqual(["a", "b"]);
    expect(keys(linesIn(LINES, GROUPS, ""))).toEqual(["d"]);
  });
});

describe("moving an item by its number", () => {
  const items = ["one", "two", "three", "four"];

  it("takes #4 to #2 and pushes the rest down — the founder's example", () => {
    expect(moveItem(items, 3, 2)).toEqual(["one", "four", "two", "three"]);
  });

  it("takes #1 to #3", () => {
    expect(moveItem(items, 0, 3)).toEqual(["two", "three", "one", "four"]);
  });

  it("clamps a number past the end rather than dropping the item", () => {
    expect(moveItem(items, 0, 99)).toEqual(["two", "three", "four", "one"]);
    expect(moveItem(items, 3, 0)).toEqual(["four", "one", "two", "three"]);
  });

  it("changes nothing when the item is not there", () => {
    expect(moveItem(items, 9, 1)).toEqual(items);
  });
});

describe("placing a line by its number", () => {
  it("moves it within its own item", () => {
    expect(keys(placeLine(LINES, GROUPS, "b", "g1", 1))).toEqual(["b", "a", "c", "d"]);
  });

  it("moves it into another item, at the place named", () => {
    const next = placeLine(LINES, GROUPS, "a", "g2", 1);
    expect(keys(next)).toEqual(["b", "a", "c", "d"]);
    expect(next.find((l) => l.key === "a")?.groupKey).toBe("g2");
    expect(keys(linesIn(next, GROUPS, "g2"))).toEqual(["a", "c"]);
  });

  it("takes a line out of an item when the loose pile is named", () => {
    const next = placeLine(LINES, GROUPS, "a", "", 1);
    expect(next.find((l) => l.key === "a")?.groupKey).toBe("");
    expect(keys(linesIn(next, GROUPS, ""))).toEqual(["a", "d"]);
  });

  it("treats an item that is not there as the loose pile", () => {
    expect(placeLine(LINES, GROUPS, "a", "g9", 1).find((l) => l.key === "a")?.groupKey).toBe("");
  });

  it("lands last when the place is past the end", () => {
    expect(keys(linesIn(placeLine(LINES, GROUPS, "a", "g1", 99), GROUPS, "g1"))).toEqual(["b", "a"]);
  });

  it("changes nothing when the line is not there", () => {
    expect(keys(placeLine(LINES, GROUPS, "zz", "g1", 1))).toEqual(["a", "b", "c", "d"]);
  });

  it("always hands back the whole list in visual order", () => {
    const scrambled = [row("d"), row("c", "g2"), row("a", "g1"), row("b", "g1")];
    expect(keys(placeLine(scrambled, GROUPS, "d", "g1", 1))).toEqual(["d", "a", "b", "c"]);
  });
});

describe("dragging a line onto another", () => {
  it("takes the slot it was dropped on, moving down", () => {
    const flat = [row("a", "g1"), row("b", "g1"), row("c", "g1")];
    expect(keys(dragTo(flat, ["g1"], "a", "c"))).toEqual(["b", "c", "a"]);
  });

  it("takes the slot it was dropped on, moving up", () => {
    const flat = [row("a", "g1"), row("b", "g1"), row("c", "g1")];
    expect(keys(dragTo(flat, ["g1"], "c", "a"))).toEqual(["c", "a", "b"]);
  });

  it("joins the item of the row it was dropped on", () => {
    const next = dragTo(LINES, GROUPS, "d", "a");
    expect(next.find((l) => l.key === "d")?.groupKey).toBe("g1");
    expect(keys(linesIn(next, GROUPS, "g1"))).toEqual(["d", "a", "b"]);
    expect(keys(linesIn(next, GROUPS, ""))).toEqual([]);
  });

  it("is a no-op on itself, or on a row that is not there", () => {
    expect(keys(dragTo(LINES, GROUPS, "a", "a"))).toEqual(["a", "b", "c", "d"]);
    expect(keys(dragTo(LINES, GROUPS, "a", "zz"))).toEqual(["a", "b", "c", "d"]);
  });

  it("puts a line dropped on a section's own row at the end of it", () => {
    const next = dropInSection(LINES, GROUPS, "a", "g2");
    expect(keys(linesIn(next, GROUPS, "g2"))).toEqual(["c", "a"]);
  });
});

describe("reading a typed number", () => {
  it("reads a bare place in the row's own section", () => {
    expect(parseAddress("3")).toEqual({ section: null, position: 3 });
    expect(parseAddress("  12 ")).toEqual({ section: null, position: 12 });
  });

  it("reads item-and-place, with a dot, a hyphen or a slash", () => {
    expect(parseAddress("3.2")).toEqual({ section: 3, position: 2 });
    expect(parseAddress("3-2")).toEqual({ section: 3, position: 2 });
    expect(parseAddress("3 / 2")).toEqual({ section: 3, position: 2 });
  });

  it("refuses what it cannot read rather than guessing", () => {
    for (const bad of ["", "   ", "0", "2.0", "a", "1.2.3", "-1", "1..2", "3rd", "1e3"]) {
      expect(parseAddress(bad), bad).toBeNull();
    }
  });
});

describe("the number a line shows", () => {
  it("is a bare place while the estimate has no items", () => {
    expect(lineNumber(0, 2, false)).toBe("2");
  });

  it("is item-and-place once it has", () => {
    expect(lineNumber(0, 2, true)).toBe("1.2");
    expect(lineNumber(2, 1, true)).toBe("3.1");
  });
});
