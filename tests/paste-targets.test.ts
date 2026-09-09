import { describe, expect, it } from "vitest";
import {
  checkRow,
  isCalendarDate,
  matchChoice,
  normalizeName,
  parseNumber,
  PASTE_MAX_ROWS,
  proposeToolFor,
  resolveRows,
  rowLabel,
  validateProposal,
} from "../src/lib/paste-targets/shape";
import type { PasteField } from "../src/lib/paste-targets/types";

/**
 * The pure half of a paste (ADR 0036): the tool built from a target's fields,
 * the loose boundary on what comes back, and the judgement of every cell.
 * What this file certifies: every field reaches the model nullable and
 * required, so "none" is said rather than omitted; a choice is never an enum,
 * so the list's own words survive to the reviewer; a cell that cannot be
 * placed becomes a HINT rather than a guess or a dropped row; and the check a
 * reviewed row gets in the dialog is the one the server runs.
 */

const FIELDS: PasteField[] = [
  { key: "name", label: "Name", kind: "text", required: true, hint: "The name." },
  { key: "head", label: "Head", kind: "number", hint: "How many." },
  { key: "born", label: "Born", kind: "date", hint: "Birth date." },
  {
    key: "parcel",
    label: "Parcel",
    kind: "choice",
    hint: "Where.",
    choices: [
      { value: "p1", label: "Home place" },
      { value: "p2", label: "Back Forty" },
    ],
  },
];

describe("paste shape", () => {
  it("builds a tool with every field nullable and every key required", () => {
    const tool = proposeToolFor(FIELDS);
    const schema = tool.input_schema as {
      properties: { rows: { items: { properties: Record<string, { type: unknown; description: string; enum?: unknown }>; required: string[] } } };
    };
    const item = schema.properties.rows.items;
    expect(item.required).toEqual(["name", "head", "born", "parcel"]);
    expect(item.properties.name.type).toEqual(["string", "null"]);
    expect(item.properties.head.type).toEqual(["number", "null"]);
    // A choice lists its labels in words and is NOT an enum, so "the creek
    // field" comes back as what the list said rather than as null.
    expect(item.properties.parcel.enum).toBeUndefined();
    expect(item.properties.parcel.description).toContain("“Home place”");
    expect(item.properties.parcel.description).toContain("“Back Forty”");
  });

  it("holds the model to rows of cells and refuses anything else", () => {
    expect(validateProposal({ rows: [{ name: "Bluebell", head: 1 }] })).toEqual([
      { name: "Bluebell", head: 1 },
    ]);
    expect(validateProposal({ rows: [] })).toEqual([]);
    expect(validateProposal({})).toBeNull();
    expect(validateProposal({ rows: "Bluebell" })).toBeNull();
    expect(validateProposal({ rows: [{ name: { first: "B" } }] })).toBeNull();
    expect(
      validateProposal({ rows: Array.from({ length: PASTE_MAX_ROWS + 1 }, () => ({ name: "x" })) }),
    ).toBeNull();
  });

  it("judges each cell by its kind and keeps what it could not place as a hint", () => {
    const rows = resolveRows(
      [
        { name: "  Bluebell ", head: "1,250", born: "2024-02-29", parcel: "back forty" },
        { name: "Rosie", head: "a few", born: "spring 2024", parcel: "the creek field" },
        { name: null, head: null, born: null, parcel: null },
        { name: "", head: "", born: "", parcel: "" },
        { name: 840, head: 2, born: "2024-02-30", parcel: "Home Place." },
      ],
      FIELDS,
    );
    expect(rows).toHaveLength(3);

    expect(rows[0].values).toEqual({ name: "Bluebell", head: 1250, born: "2024-02-29", parcel: "p2" });
    expect(rows[0].hints).toEqual({});
    expect(rows[0].duplicateOf).toBeNull();

    expect(rows[1].values).toEqual({ name: "Rosie", head: null, born: null, parcel: null });
    expect(rows[1].hints).toEqual({
      head: "a few",
      born: "spring 2024",
      parcel: "the creek field",
    });

    // A number as a name is still a name; an impossible date is a hint; a
    // label with a trailing full stop still matches.
    expect(rows[2].values).toEqual({ name: "840", head: 2, born: null, parcel: "p1" });
    expect(rows[2].hints).toEqual({ born: "2024-02-30" });
  });

  it("caps a proposal at the row limit", () => {
    const rows = resolveRows(
      Array.from({ length: PASTE_MAX_ROWS + 5 }, (_, i) => ({ name: `n${i}` })),
      FIELDS,
    );
    expect(rows).toHaveLength(PASTE_MAX_ROWS);
  });

  it("checks a reviewed row the way the server will", () => {
    expect(checkRow({ name: "Bluebell", head: 3, born: "2024-02-29", parcel: "p1" }, FIELDS)).toBeNull();
    expect(checkRow({ name: null, head: null, born: null, parcel: null }, FIELDS)).toBe("Name is missing.");
    expect(checkRow({ name: "B", head: "3", born: null, parcel: null }, FIELDS)).toBe("Head should be a number.");
    expect(checkRow({ name: "B", head: null, born: "2024-02-30", parcel: null }, FIELDS)).toBe("Born is not a real date.");
    expect(checkRow({ name: "B", head: null, born: null, parcel: "Back Forty" }, FIELDS)).toBe(
      "Parcel is not one of the choices.",
    );
    // Optional and empty is fine.
    expect(checkRow({ name: "B" }, FIELDS)).toBeNull();
  });

  it("names a row by its first text value", () => {
    expect(rowLabel({ name: "Bluebell", head: 1 }, FIELDS)).toBe("Bluebell");
    expect(rowLabel({ name: null, head: 1 }, FIELDS)).toBeNull();
  });

  it("matches a choice exactly, case and punctuation aside, and never nearest", () => {
    expect(matchChoice(FIELDS[3], "BACK FORTY")).toBe("p2");
    expect(matchChoice(FIELDS[3], " home place. ")).toBe("p1");
    expect(matchChoice(FIELDS[3], "p2")).toBe("p2");
    expect(matchChoice(FIELDS[3], "Back")).toBeNull();
    expect(matchChoice(FIELDS[3], "")).toBeNull();
  });

  it("normalises names for the duplicate check and parses what people write", () => {
    expect(normalizeName("Tractor  Supply Co.")).toBe("tractor supply co");
    expect(normalizeName(" tractor supply co ")).toBe("tractor supply co");
    expect(parseNumber("$1,250.50")).toBe(1250.5);
    expect(parseNumber("-3")).toBe(-3);
    expect(parseNumber("about 40")).toBeNull();
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2023-02-29")).toBe(false);
    expect(isCalendarDate("24-02-29")).toBe(false);
  });
});
