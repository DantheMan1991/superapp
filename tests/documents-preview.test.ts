import "dotenv/config";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { cellText, trimGrid } from "@/modules/documents/preview/cell";
import {
  parseDelimited,
  sniffDelimiter,
} from "@/modules/documents/preview/csv";
import { readXlsxPreview } from "@/modules/documents/preview/spreadsheet";

/** Write a workbook to the bytes the reader would receive from blob storage. */
async function bytesOf(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/**
 * Spreadsheet preview parsing. Pure, so these run everywhere.
 *
 * The cases here are the ones that show up in real files rather than the ones
 * that are easy to imagine: formula cells carrying a cached result, rich text
 * split into runs, quoted commas in an address, and the BOM every Excel CSV
 * export starts with.
 */

describe("spreadsheet cell text", () => {
  it("reads the plain types", () => {
    expect(cellText("Acme Roofing")).toBe("Acme Roofing");
    expect(cellText(4200)).toBe("4200");
    expect(cellText(0)).toBe("0");
    expect(cellText(true)).toBe("TRUE");
    expect(cellText(false)).toBe("FALSE");
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
  });

  /**
   * A formula cell must show its RESULT. Showing "=SUM(A1:A9)" would be
   * showing the mechanism instead of the number someone came to read.
   */
  it("shows a formula's cached result, not the formula", () => {
    expect(cellText({ formula: "SUM(A1:A9)", result: 4200 })).toBe("4200");
    expect(cellText({ formula: "CONCAT(A1,B1)", result: "Acme Ltd" })).toBe(
      "Acme Ltd",
    );
    // Not yet calculated — blank beats printing the formula source.
    expect(cellText({ formula: "SUM(A1:A9)" })).toBe("");
    expect(cellText({ sharedFormula: "B2" })).toBe("");
  });

  it("flattens rich text into its runs", () => {
    expect(
      cellText({
        richText: [{ text: "Change " }, { text: "Order" }, { text: " 12" }],
      }),
    ).toBe("Change Order 12");
  });

  it("keeps a hyperlink's text rather than its URL", () => {
    expect(
      cellText({ text: "Supplier portal", hyperlink: "https://example.com" }),
    ).toBe("Supplier portal");
  });

  it("surfaces an error cell as Excel shows it", () => {
    expect(cellText({ error: "#DIV/0!" })).toBe("#DIV/0!");
  });

  it("renders a midnight date as a plain date", () => {
    expect(cellText(new Date("2026-07-26T00:00:00.000Z"))).toBe("2026-07-26");
    expect(cellText(new Date("2026-07-26T14:30:00.000Z"))).toBe(
      "2026-07-26 14:30",
    );
  });

  /** The whole point: no shape may ever render as "[object Object]". */
  it("never renders an object literally", () => {
    const shapes: unknown[] = [
      { formula: "A1" },
      { richText: [] },
      { unexpected: "shape" },
      {},
      [],
    ];
    for (const shape of shapes) {
      expect(cellText(shape)).not.toContain("object Object");
    }
  });
});

describe("trimming a sheet", () => {
  it("drops trailing empty rows and columns", () => {
    expect(
      trimGrid([
        ["Item", "Qty", "", ""],
        ["Joist", "12", "", ""],
        ["", "", "", ""],
        ["", "", "", ""],
      ]),
    ).toEqual([
      ["Item", "Qty"],
      ["Joist", "12"],
    ]);
  });

  it("keeps interior blanks, which are real data", () => {
    expect(
      trimGrid([
        ["Item", "Qty", "Note"],
        ["Joist", "", "back-ordered"],
      ]),
    ).toEqual([
      ["Item", "Qty", "Note"],
      ["Joist", "", "back-ordered"],
    ]);
  });

  it("returns nothing for a sheet that is entirely empty", () => {
    expect(trimGrid([["", ""], ["", ""]])).toEqual([]);
    expect(trimGrid([])).toEqual([]);
  });
});

describe("CSV parsing", () => {
  it("parses the ordinary case", () => {
    expect(parseDelimited("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted commas — the reason this is not a split()", () => {
    expect(parseDelimited('name,address\n"Smith, John","1 Main St, Apt 2"')).toEqual(
      [
        ["name", "address"],
        ["Smith, John", "1 Main St, Apt 2"],
      ],
    );
  });

  it("handles a newline inside a quoted field", () => {
    expect(parseDelimited('note\n"line one\nline two"')).toEqual([
      ["note"],
      ["line one\nline two"],
    ]);
  });

  it("handles a doubled quote as an escaped quote", () => {
    expect(parseDelimited('a\n"He said ""no"""')).toEqual([
      ["a"],
      ['He said "no"'],
    ]);
  });

  it("treats CRLF and LF the same and drops the Excel BOM", () => {
    expect(parseDelimited("﻿a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("does not invent a row from a trailing newline", () => {
    expect(parseDelimited("a,b\n1,2\n")).toHaveLength(2);
  });

  it("keeps empty fields", () => {
    expect(parseDelimited("a,,c")).toEqual([["a", "", "c"]]);
  });

  it("survives an unterminated quote instead of throwing", () => {
    expect(() => parseDelimited('a,"unterminated')).not.toThrow();
  });
});

/**
 * Round-trips through the REAL reader.
 *
 * The first version of `readXlsxPreview` indexed cells by `worksheet.rowCount`
 * and `worksheet.columnCount`. Those are derived from metadata the writing
 * application chooses to emit — a workbook exceljs itself writes reports them
 * correctly, which is exactly why that version passed its tests and then showed
 * "This sheet is empty" on a real file out of Excel. These cases exercise the
 * shapes that broke it.
 */
describe("reading a workbook", () => {
  it("reads an ordinary sheet", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Customers");
    ws.addRow(["Name", "City", "Balance"]);
    ws.addRow(["Acme Roofing", "Austin", 4200]);
    ws.addRow(["Fulton Lumber", "Dallas", 980]);

    const out = await readXlsxPreview(await bytesOf(wb));
    expect(out.sheets).toHaveLength(1);
    expect(out.sheets[0].name).toBe("Customers");
    expect(out.sheets[0].rows).toEqual([
      ["Name", "City", "Balance"],
      ["Acme Roofing", "Austin", "4200"],
      ["Fulton Lumber", "Dallas", "980"],
    ]);
  });

  /** A sheet whose data starts below row 1 — a title block, a logo, a gap. */
  it("reads a sheet whose rows do not start at row 1", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Offset");
    ws.getCell("A4").value = "Item";
    ws.getCell("B4").value = "Qty";
    ws.getCell("A5").value = "Joist";
    ws.getCell("B5").value = 12;

    const out = await readXlsxPreview(await bytesOf(wb));
    const rows = out.sheets[0].rows;
    // The leading blank rows are trimmed away, but the data survives — the
    // old indexed traversal returned nothing at all here.
    expect(rows.some((r) => r.includes("Joist"))).toBe(true);
    expect(rows.some((r) => r.includes("Item"))).toBe(true);
  });

  /** Gaps between populated columns must not shift cells left. */
  it("keeps sparse cells in their real columns", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sparse");
    ws.getCell("A1").value = "left";
    ws.getCell("D1").value = "right";

    const out = await readXlsxPreview(await bytesOf(wb));
    expect(out.sheets[0].rows[0]).toEqual(["left", "", "", "right"]);
  });

  it("reads every sheet and names them", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("First").addRow(["a"]);
    wb.addWorksheet("Second").addRow(["b"]);

    const out = await readXlsxPreview(await bytesOf(wb));
    expect(out.sheets.map((s) => s.name)).toEqual(["First", "Second"]);
  });

  it("resolves formulas to their cached result", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Totals");
    ws.getCell("A1").value = 100;
    ws.getCell("A2").value = 250;
    ws.getCell("A3").value = { formula: "SUM(A1:A2)", result: 350 };

    const out = await readXlsxPreview(await bytesOf(wb));
    expect(out.sheets[0].rows[2][0]).toBe("350");
  });

  it("reports truncation rather than pretending the sheet ends", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Big");
    for (let i = 1; i <= 250; i += 1) ws.addRow([`row ${i}`]);

    const out = await readXlsxPreview(await bytesOf(wb));
    expect(out.sheets[0].rows).toHaveLength(200);
    expect(out.sheets[0].truncated).toBe(true);
    expect(out.sheets[0].totalRows).toBe(250);
  });

  it("returns an empty grid for a genuinely empty sheet", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Blank");
    const out = await readXlsxPreview(await bytesOf(wb));
    expect(out.sheets[0].rows).toEqual([]);
  });
});

describe("delimiter sniffing", () => {
  it("finds semicolons and tabs, not just commas", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(sniffDelimiter("a\tb\tc")).toBe("\t");
  });

  /**
   * A quoted address full of commas must not win the vote in a
   * semicolon-delimited file — which is the whole reason quotes are tracked
   * while counting.
   */
  it("ignores delimiters inside quoted fields", () => {
    expect(sniffDelimiter('"Smith, John, Jr";age;city')).toBe(";");
  });

  it("defaults to a comma when there is nothing to go on", () => {
    expect(sniffDelimiter("singlecolumn")).toBe(",");
    expect(sniffDelimiter("")).toBe(",");
  });
});
