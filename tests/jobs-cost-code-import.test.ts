import { describe, expect, it } from "vitest";
import {
  MAX_IMPORT_ROWS,
  parseCostCodes,
  planImport,
} from "../src/packs/jobs/cost-code-import";

/**
 * READING A PASTED COST CODE LIST.
 *
 * The case this file exists for is at the bottom: **a chart numbered
 * `03.95, 03.100, 03.105` is in the right order to its owner and the wrong
 * order to a computer**, and carrying the paste's row order across is the
 * only thing that keeps it.
 */

const SPREADSHEET = [
  "Item Type\tParent Item\tChild Item",
  "Service\t03. Infrastructure\t03.20 - Excavation Labor",
  "Service\t03. Infrastructure\t03.21 - Excavation Trucking",
  "Service\t03. Infrastructure\t03.40 - Excavation Material",
  "Service\t04. Structural\t04.00 - Foundation Labor",
].join("\n");

describe("parseCostCodes", () => {
  it("reads three columns out of a spreadsheet paste", () => {
    const out = parseCostCodes(SPREADSHEET);
    expect(out.issues).toEqual([]);
    expect(out.skippedHeader).toBe("Item Type\tParent Item\tChild Item");
    expect(out.codes).toHaveLength(4);
    expect(out.codes[0]).toEqual({
      code: "03.20",
      name: "Excavation Labor",
      category: "03. Infrastructure",
      line: 2,
    });
    expect(out.codes[3].category).toBe("04. Structural");
  });

  /**
   * **A COLUMN THAT SAYS THE SAME THING ON EVERY ROW SAYS NOTHING.** The
   * pilot's export carries `Item Type: Service` on all 291 rows — an artefact
   * of wherever it came from, and not a category anybody chose.
   */
  it("drops a column that never changes", () => {
    const out = parseCostCodes(SPREADSHEET);
    expect(out.codes.every((c) => c.category !== "Service")).toBe(true);
  });

  it("takes a list with no category at all", () => {
    const out = parseCostCodes("1000\tPermits and fees\n2000\tFoundation");
    expect(out.codes).toEqual([
      { code: "1000", name: "Permits and fees", category: "", line: 1 },
      { code: "2000", name: "Foundation", category: "", line: 2 },
    ]);
  });

  it("reads one code and name per line, however they are joined", () => {
    const out = parseCostCodes(
      ["03.20 - Excavation Labor", "1000 Permits and fees", "03 30 00: Cast-in-place concrete"].join(
        "\n",
      ),
    );
    expect(out.codes.map((c) => [c.code, c.name])).toEqual([
      ["03.20", "Excavation Labor"],
      ["1000", "Permits and fees"],
      ["03 30 00", "Cast-in-place concrete"],
    ]);
  });

  it("takes commas when there are no tabs", () => {
    const out = parseCostCodes("03. Infrastructure,03.20 - Excavation Labor");
    expect(out.codes[0].code).toBe("03.20");
    expect(out.codes[0].category).toBe("03. Infrastructure");
  });

  it("strips the trailing dot off a code written as a heading", () => {
    expect(parseCostCodes("01. Design").codes[0]).toMatchObject({
      code: "01",
      name: "Design",
    });
  });

  /**
   * **A CODE MUST START WITH A DIGIT.** A looser rule turned
   * `Excavation Labor` into the code `Excavation`, and a chart whose first
   * column is sometimes a word is worse than one that refuses and says so.
   */
  it("refuses a line with no code and says which line", () => {
    const out = parseCostCodes("03.20 - Excavation Labor\nExcavation Labor\n");
    expect(out.codes).toHaveLength(1);
    expect(out.issues).toEqual([
      { line: 2, text: "Excavation Labor", reason: "no code and name on this line" },
    ]);
  });

  it("refuses the second of two identical codes and points at the first", () => {
    const out = parseCostCodes("03.20 - Excavation Labor\n03.20 - Something else");
    expect(out.codes).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ line: 2, reason: "the same code as line 1" });
  });

  it("ignores blank lines and keeps the real line numbers", () => {
    const out = parseCostCodes("\n\n03.20 - Excavation Labor\n\n04.00 - Foundation Labor\n");
    expect(out.codes.map((c) => c.line)).toEqual([3, 5]);
  });

  it("skips a header only at the top, and only when it has no code in it", () => {
    const out = parseCostCodes("Code\tName\n1000\tPermits");
    expect(out.skippedHeader).toBe("Code\tName");
    expect(out.codes).toHaveLength(1);
    /** A row that begins with a code is data, whatever words follow it. */
    const notHeader = parseCostCodes("1000\tItem name\n2000\tParent item");
    expect(notHeader.skippedHeader).toBe("");
    expect(notHeader.codes).toHaveLength(2);
  });

  it("stops at the row cap rather than taking a whole workbook", () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 3 }, (_, i) => `${i + 1} Item ${i + 1}`);
    const out = parseCostCodes(many.join("\n"));
    expect(out.codes).toHaveLength(MAX_IMPORT_ROWS);
    expect(out.issues).toHaveLength(3);
    expect(out.issues[0].reason).toContain("second paste");
  });

  it("says nothing about nothing", () => {
    expect(parseCostCodes("")).toEqual({ codes: [], issues: [], skippedHeader: "" });
    expect(parseCostCodes("   \n \n")).toEqual({ codes: [], issues: [], skippedHeader: "" });
  });

  /**
   * **THE CASE THIS WHOLE FILE IS FOR.** The pilot's chart runs
   * `03.90, 03.95, 03.100, 03.105` — right to a person, wrong to a computer,
   * because `03.100` is less than `03.20` as text. The paste's own order is
   * what `sortOrder` gets, so the chart keeps the shape its owner wrote.
   */
  it("keeps the order of the paste, which a text sort would destroy", () => {
    const written = ["03.90", "03.95", "03.100", "03.105", "03.110", "03.20"];
    const out = parseCostCodes(written.map((c) => `${c} - Something`).join("\n"));
    expect(out.codes.map((c) => c.code)).toEqual(written);

    const asText = [...written].sort();
    expect(asText).not.toEqual(written);
    expect(asText[0]).toBe("03.100");
  });
});

describe("planImport", () => {
  const existing = [
    { code: "03.20", name: "Excavation Labor", category: "03. Infrastructure" },
    { code: "03.40", name: "Excavation Material", category: "03. Infrastructure" },
    { code: "9999", name: "An old one", category: "" },
  ];

  it("counts what will be added, changed, left as it is and not touched", () => {
    const parsed = parseCostCodes(
      [
        "03. Infrastructure\t03.20 - Excavation Labor",
        "03. Infrastructure\t03.40 - Excavation labour, renamed",
        "04. Structural\t04.00 - Foundation Labor",
      ].join("\n"),
    ).codes;
    expect(planImport(parsed, existing)).toEqual({
      adding: 1,
      updating: 1,
      unchanged: 1,
      untouched: 1,
      categories: ["03. Infrastructure", "04. Structural"],
    });
  });

  /**
   * **NOTHING IS DELETED AND NOTHING IS SWITCHED OFF.** A code the paste does
   * not mention may have a year of costs posted against it; a paste that adds
   * three rows must never read as an instruction to retire forty.
   */
  it("reports what the paste left out rather than acting on it", () => {
    expect(planImport([], existing).untouched).toBe(3);
    expect(planImport([], existing).adding).toBe(0);
  });

  it("matches an existing code whatever its case and spacing", () => {
    const parsed = parseCostCodes("03.20 - Excavation Labor").codes;
    expect(
      planImport(parsed, [{ code: " 03.20 ", name: "Named differently", category: "" }]),
    ).toMatchObject({ adding: 0, updating: 1 });
  });

  it("lists the categories in the order they first appear", () => {
    const parsed = parseCostCodes(
      ["B\t2 - Two", "A\t1 - One", "B\t3 - Three"].join("\n"),
    ).codes;
    expect(planImport(parsed, []).categories).toEqual(["B", "A"]);
  });
});
