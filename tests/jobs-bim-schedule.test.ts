import { describe, expect, it } from "vitest";
import {
  MAX_SCHEDULE_ROWS,
  canonicalUnit,
  convertThousandths,
  decodeScheduleBytes,
  figureFor,
  parseSchedule,
  readColumns,
  readQuantity,
  readRooms,
  suggestMeasures,
  suggestedUse,
} from "../src/packs/jobs/bim-schedule";
import type { DeclaredMeasure } from "../src/packs/jobs/measure-math";

/**
 * READING A SCHEDULE EXPORTED FROM THE MODEL.
 *
 * The fixtures are the shape Revit actually writes — title on its own line,
 * every cell quoted, units on the figures, feet and inches with fractions,
 * group headers and footers, a grand total — because a parser tested on
 * tidy CSV meets its first real export in front of the founder.
 */

const ROOM_SCHEDULE = [
  '"Room Schedule"',
  '"Number"\t"Name"\t"Level"\t"Area"\t"Perimeter"\t"Unbounded Height"',
  '"Level 1"',
  '"101"\t"Kitchen"\t"Level 1"\t"310 SF"\t"71\' - 0""\t"9\' - 0""',
  '"102"\t"Great room"\t"Level 1"\t"420 SF"\t"84\' - 6 1/2""\t"9\' - 0""',
  '"103"\t"Powder room"\t"Level 1"\t"24 SF"\t"20\' - 0""\t"9\' - 0""',
  '"104"\t"Mud room"\t"Level 1"\t"Not Enclosed"\t"Not Enclosed"\t"9\' - 0""',
  '"Level 1: 4"',
  '"Level 2"',
  '"201"\t"Master bedroom"\t"Level 2"\t"224 SF"\t"60\' - 0""\t"8\' - 0""',
  '"202"\t"Bathroom"\t"Level 2"\t"62 SF"\t"32\' - 0""\t"8\' - 0""',
  '"203"\t"Bathroom"\t"Level 2"\t"48 SF"\t"28\' - 0""\t"8\' - 0""',
  '"204"\t"Storage"\t"Level 2"\t"Not Placed"\t"Not Placed"\t""',
  '"Level 2: 4"',
  '"Grand total: 8"',
].join("\r\n");

const ROOF_CSV = [
  "Type,Area,Slope",
  '"Basic Roof: Asphalt Shingle","1,224 SF","6"" / 12"""',
  '"Basic Roof: Asphalt Shingle","600 SF","6"" / 12"""',
  'Grand total: 2,"1,824 SF",',
].join("\n");

const ROOF_SCHEDULE = [
  '"Roof Schedule"',
  '"Type"\t"Area"',
  '"Basic Roof: Asphalt Shingle"\t"1224 SF"',
  '"Basic Roof: Asphalt Shingle"\t"600 SF"',
].join("\n");

const WALL_SCHEDULE = [
  '"Wall Schedule"',
  '"Type"\t"Length"\t"Area"\t"Unconnected Height"',
  '"Exterior - 2x6"\t"40\' - 0""\t"360 SF"\t"9\' - 0""',
  '"Exterior - 2x6"\t"24\' - 0""\t"216 SF"\t"9\' - 0""',
  '"Exterior - 2x6"\t"40\' - 0""\t"360 SF"\t"9\' - 0""',
  '"Exterior - 2x6"\t"24\' - 0""\t"216 SF"\t"9\' - 0""',
].join("\n");

const DECLARED: DeclaredMeasure[] = [
  { id: "m1", name: "Wall perimeter", unit: "lf", kind: "length", guidance: "", required: true },
  { id: "m2", name: "Wall height", unit: "lf", kind: "length", guidance: "", required: true },
  { id: "m3", name: "Roof area", unit: "sf", kind: "area", guidance: "", required: false },
];

const DOORS: DeclaredMeasure = {
  id: "m4",
  name: "Doors",
  unit: "ea",
  kind: "count",
  guidance: "",
  required: false,
};

function utf16le(text: string, bom: boolean): Uint8Array {
  const out: number[] = bom ? [0xff, 0xfe] : [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    out.push(code & 0xff, code >> 8);
  }
  return new Uint8Array(out);
}

describe("readQuantity", () => {
  it("reads the figures a schedule states, with their units, in thousandths", () => {
    expect(readQuantity("1,234 SF")).toEqual({ valueThousandths: 1_234_000, unit: "sf" });
    expect(readQuantity("245.32 ft²")).toEqual({ valueThousandths: 245_320, unit: "sf" });
    expect(readQuantity("2.3 m²")).toEqual({ valueThousandths: 2_300, unit: "m2" });
    expect(readQuantity("12 CY")).toEqual({ valueThousandths: 12_000, unit: "cy" });
    expect(readQuantity("4 m³")).toEqual({ valueThousandths: 4_000, unit: "m3" });
    expect(readQuantity("24")).toEqual({ valueThousandths: 24_000, unit: "" });
    expect(readQuantity("3 ea")).toEqual({ valueThousandths: 3_000, unit: "ea" });
  });

  it("reads feet and inches, with fractions, into feet", () => {
    expect(readQuantity("63' - 4 1/2\"")).toEqual({ valueThousandths: 63_375, unit: "lf" });
    expect(readQuantity("63' - 4\"")).toEqual({ valueThousandths: 63_333, unit: "lf" });
    expect(readQuantity("12'")).toEqual({ valueThousandths: 12_000, unit: "lf" });
    expect(readQuantity("6\"")).toEqual({ valueThousandths: 500, unit: "lf" });
    expect(readQuantity("3 1/2\"")).toEqual({ valueThousandths: 292, unit: "lf" });
    expect(readQuantity("12'-6\"")).toEqual({ valueThousandths: 12_500, unit: "lf" });
  });

  it("reads millimetres into metres and a decimal comma as a decimal", () => {
    expect(readQuantity("2743 mm")).toEqual({ valueThousandths: 2_743, unit: "m" });
    expect(readQuantity("1 234,50 m²")).toEqual({ valueThousandths: 1_234_500, unit: "m2" });
    expect(readQuantity("1.234,50")).toEqual({ valueThousandths: 1_234_500, unit: "" });
  });

  it("reads nothing where there is nothing to read", () => {
    for (const cell of ["<varies>", "Not Placed", "Redundant", "", "$1,200.00", "12%", "Level 1", "2x4 Studs", "Kitchen"]) {
      expect(readQuantity(cell), cell).toBeNull();
    }
  });

  it("knows the words for a unit", () => {
    expect(canonicalUnit("SF")).toBe("sf");
    expect(canonicalUnit("sq. ft.")).toBe("sf");
    expect(canonicalUnit("square feet")).toBe("sf");
    expect(canonicalUnit("ft")).toBe("lf");
    expect(canonicalUnit("LF")).toBe("lf");
    expect(canonicalUnit("m²")).toBe("m2");
    expect(canonicalUnit("each")).toBe("ea");
    expect(canonicalUnit("squares")).toBeNull();
  });
});

describe("parseSchedule", () => {
  it("reads a Revit room schedule: title, headers, groups, footers and the grand total", () => {
    const s = parseSchedule(ROOM_SCHEDULE);
    expect(s.title).toBe("Room Schedule");
    expect(s.delimiter).toBe("\t");
    expect(s.headers).toEqual(["Number", "Name", "Level", "Area", "Perimeter", "Unbounded Height"]);
    expect(s.rows).toHaveLength(8);
    expect(s.footers).toBe(3);
    expect(s.rows[0].cells).toEqual(["101", "Kitchen", "Level 1", "310 SF", "71' - 0\"", "9' - 0\""]);
    expect(s.rows[0].group).toBe("Level 1");
    expect(s.rows[4].group).toBe("Level 2");
    /** A blank last cell is padded, not lost. */
    expect(s.rows[7].cells).toHaveLength(6);
    expect(s.rows[0].line).toBe(4);
  });

  it("reads a comma-separated export with the inch marks Excel doubles", () => {
    const s = parseSchedule(ROOF_CSV);
    expect(s.title).toBe("");
    expect(s.delimiter).toBe(",");
    expect(s.headers).toEqual(["Type", "Area", "Slope"]);
    expect(s.rows).toHaveLength(2);
    expect(s.rows[0].cells).toEqual(["Basic Roof: Asphalt Shingle", "1,224 SF", '6" / 12"']);
    expect(s.footers).toBe(1);
  });

  it("reads the inch mark Revit leaves before the closing quote", () => {
    const s = parseSchedule('Mark,Width\n"1","12\' - 6""\n"2","3\' - 0""');
    expect(s.rows[0].cells[1]).toBe("12' - 6\"");
    expect(s.rows[1].cells[1]).toBe("3' - 0\"");
  });

  it("skips a grouped-headers line above the real headers", () => {
    const s = parseSchedule(
      [
        '"Door Schedule"',
        '"Identity"\t""\t"Size"\t""',
        '"Mark"\t"Type"\t"Width"\t"Height"',
        '"1"\t"Single flush"\t"3\' - 0""\t"6\' - 8""',
        '"2"\t"Single flush"\t"2\' - 8""\t"6\' - 8""',
      ].join("\n"),
    );
    expect(s.headers).toEqual(["Mark", "Type", "Width", "Height"]);
    expect(s.rows).toHaveLength(2);
  });

  it("names columns when the export carried no headers", () => {
    const s = parseSchedule('"101"\t"Kitchen"\t"310 SF"\n"102"\t"Dining"\t"280 SF"');
    expect(s.headers).toEqual(["Column 1", "Column 2", "Column 3"]);
    expect(s.rows).toHaveLength(2);
  });

  it("reads a semicolon file with a decimal comma", () => {
    const s = parseSchedule("Name;Fläche\nKüche;24,50 m²\nBad;6,2 m²");
    expect(s.delimiter).toBe(";");
    expect(s.rows.map((r) => r.cells)).toEqual([
      ["Küche", "24,50 m²"],
      ["Bad", "6,2 m²"],
    ]);
  });

  it("stops at the row limit rather than reading forever", () => {
    const lines = ["Name\tArea"];
    for (let i = 0; i < MAX_SCHEDULE_ROWS + 10; i += 1) lines.push(`Room ${i}\t${i + 1} SF`);
    expect(parseSchedule(lines.join("\n")).rows).toHaveLength(MAX_SCHEDULE_ROWS);
  });

  it("does not take a lone name at the end for a group heading", () => {
    const s = parseSchedule("Name\tArea\nKitchen\t310 SF\nMud room");
    expect(s.rows).toHaveLength(2);
    expect(s.rows[1].cells).toEqual(["Mud room", ""]);
  });
});

describe("readColumns", () => {
  it("tells quantity columns from words, and numbering from measuring", () => {
    const s = parseSchedule(ROOM_SCHEDULE);
    const { columns, rows, footers } = readColumns(s);
    expect(rows).toHaveLength(8);
    expect(footers).toBe(3);
    const by = Object.fromEntries(columns.map((c) => [c.header, c]));
    /** A room number is a figure and means nothing added up. */
    expect(by.Number.kind).toBe("text");
    expect(by.Level.kind).toBe("text");
    expect(by.Name.kind).toBe("text");
    expect(by.Area).toMatchObject({
      kind: "quantity",
      unit: "sf",
      dimension: "area",
      count: 6,
      totalThousandths: 1_088_000,
      sameOnEveryRow: null,
    });
    expect(by.Perimeter).toMatchObject({ kind: "quantity", unit: "lf", count: 6, totalThousandths: 295_542 });
    expect(by["Unbounded Height"]).toMatchObject({ unit: "lf", count: 7, totalThousandths: 60_000, sameOnEveryRow: null });
  });

  it("sees a figure that is the same on every row", () => {
    const { columns } = readColumns(parseSchedule(WALL_SCHEDULE));
    const height = columns.find((c) => c.header === "Unconnected Height")!;
    expect(height.sameOnEveryRow).toBe(9_000);
    expect(height.count).toBe(4);
    const length = columns.find((c) => c.header === "Length")!;
    expect(length.totalThousandths).toBe(128_000);
    expect(length.sameOnEveryRow).toBeNull();
  });

  it("takes a footer written under blank word cells out of the total", () => {
    const s = parseSchedule('"Floor Schedule"\n"Type"\t"Area"\n"Slab on grade"\t"1200 SF"\n"Wood joist"\t"1100 SF"\n""\t"2300 SF"');
    const { columns, rows, footers } = readColumns(s);
    expect(rows).toHaveLength(2);
    expect(footers).toBe(1);
    expect(columns[1]).toMatchObject({ kind: "quantity", count: 2, totalThousandths: 2_300_000 });
  });

  it("offers a Count column and a bare-number column, with no unit", () => {
    const s = parseSchedule('"Window Schedule"\n"Mark"\t"Count"\t"Width"\n"W1"\t"1"\t"3\' - 0""\n"W2"\t"1"\t"4\' - 0""\n"W3"\t"1"\t"3\' - 0""');
    const { columns } = readColumns(s);
    expect(columns[0].kind).toBe("text");
    expect(columns[1]).toMatchObject({ kind: "quantity", unit: "", dimension: null, totalThousandths: 3_000, sameOnEveryRow: 1_000 });
    expect(columns[2]).toMatchObject({ kind: "quantity", unit: "lf", totalThousandths: 10_000 });
  });
});

describe("readRooms", () => {
  it("reads a room schedule into rooms with their floors and areas", () => {
    const s = parseSchedule(ROOM_SCHEDULE);
    const { columns, rows } = readColumns(s);
    const read = readRooms(s, columns, rows);
    expect(read).not.toBeNull();
    expect(read!.nameHeader).toBe("Name");
    expect(read!.levelHeader).toBe("Level");
    expect(read!.areaHeader).toBe("Area");
    expect(read!.areaUnit).toBe("sf");
    expect(read!.rooms).toEqual([
      { name: "Kitchen", level: "Level 1", areaThousandths: 310_000 },
      { name: "Great room", level: "Level 1", areaThousandths: 420_000 },
      { name: "Powder room", level: "Level 1", areaThousandths: 24_000 },
      /** Not enclosed is a room with no area, not no room. */
      { name: "Mud room", level: "Level 1", areaThousandths: null },
      { name: "Master bedroom", level: "Level 2", areaThousandths: 224_000 },
      { name: "Bathroom", level: "Level 2", areaThousandths: 62_000 },
      /** The second Bathroom on a floor is told apart by its number, not lost. */
      { name: "Bathroom 203", level: "Level 2", areaThousandths: 48_000 },
    ]);
    expect(read!.skipped).toEqual([{ line: 13, text: expect.stringContaining("Storage"), reason: "Storage is not placed in the model" }]);
  });

  it("takes the floor from the group headings when there is no level column", () => {
    const s = parseSchedule('"Room Schedule"\n"Name"\t"Area"\n"Main floor"\n"Kitchen"\t"310 SF"\n"Upstairs"\n"Bedroom 2"\t"132 SF"');
    const { columns, rows } = readColumns(s);
    const read = readRooms(s, columns, rows)!;
    expect(read.levelHeader).toBe("the group headings");
    expect(read.rooms.map((r) => [r.name, r.level])).toEqual([
      ["Kitchen", "Main floor"],
      ["Bedroom 2", "Upstairs"],
    ]);
  });

  it("reads a typed spreadsheet whose areas carry no unit", () => {
    const s = parseSchedule("Name\tLevel\tArea\nKitchen\tMain floor\t310\nDining\tMain floor\t280");
    const { columns, rows } = readColumns(s);
    const read = readRooms(s, columns, rows)!;
    expect(read.areaUnit).toBe("");
    expect(read.rooms.map((r) => r.areaThousandths)).toEqual([310_000, 280_000]);
  });

  it("reads a metric one", () => {
    const s = parseSchedule("Name;Fläche\nKüche;24,50 m²\nBad;6,2 m²");
    const { columns, rows } = readColumns(s);
    const read = readRooms(s, columns, rows)!;
    expect(read.areaUnit).toBe("m2");
    expect(read.rooms).toEqual([
      { name: "Küche", level: "", areaThousandths: 24_500 },
      { name: "Bad", level: "", areaThousandths: 6_200 },
    ]);
  });

  it("is not a room list without a name column or a reason to think so", () => {
    const wall = parseSchedule(WALL_SCHEDULE);
    const w = readColumns(wall);
    expect(readRooms(wall, w.columns, w.rows)).toBeNull();
    /** A name column alone, with nothing else saying rooms, is a type list. */
    const types = parseSchedule('"Material Takeoff"\n"Name"\t"Volume"\n"Concrete"\t"12 CY"');
    const t = readColumns(types);
    expect(readRooms(types, t.columns, t.rows)).toBeNull();
  });
});

describe("suggestMeasures", () => {
  it("suggests a measurement whose every word is in the title or the header", () => {
    const roof = parseSchedule(ROOF_SCHEDULE);
    const r = readColumns(roof);
    expect([...suggestMeasures(roof, r.columns, DECLARED)]).toEqual([[1, "m3"]]);

    const wall = parseSchedule(WALL_SCHEDULE);
    const w = readColumns(wall);
    const suggested = suggestMeasures(wall, w.columns, DECLARED);
    /** *Wall height* is found under *Unconnected Height*; *Wall perimeter* is not under *Length*. */
    expect([...suggested]).toEqual([[3, "m2"]]);
  });

  it("starts from the total, except where every row carries the same figure", () => {
    const wall = parseSchedule(WALL_SCHEDULE);
    const { columns } = readColumns(wall);
    expect(suggestedUse(columns[1])).toBe("total");
    expect(suggestedUse(columns[2])).toBe("total");
    /** 9' on every row: four wall heights are not 36', and the pack cannot know. */
    expect(suggestedUse(columns[3])).toBeNull();
    expect(suggestedUse(columns[0])).toBeNull();
    /** A count column's rows of `1` add up to the count. */
    expect(
      suggestedUse({ kind: "quantity", count: 3, sameOnEveryRow: 1_000, dimension: "count" }),
    ).toBe("total");
    /** One row is one figure, whichever way it is read. */
    expect(
      suggestedUse({ kind: "quantity", count: 1, sameOnEveryRow: 9_000, dimension: "length" }),
    ).toBe("total");
  });

  it("suggests nothing across dimensions", () => {
    const wall = parseSchedule(WALL_SCHEDULE);
    const w = readColumns(wall);
    const areaOnly: DeclaredMeasure[] = [{ ...DECLARED[2], name: "Wall area" }];
    /** Wall area is an area; the Length column cannot be it, the Area column can. */
    expect([...suggestMeasures(wall, w.columns, areaOnly)]).toEqual([[2, "m3"]]);
  });
});

describe("figureFor", () => {
  const wall = parseSchedule(WALL_SCHEDULE);
  const { columns, rows } = readColumns(wall);
  const length = columns[1];
  const area = columns[2];
  const height = columns[3];

  it("offers a total, the figure every row shares, or the row count", () => {
    expect(figureFor(wall, length, rows.length, "total", DECLARED[0], "walls.txt")).toEqual({
      valueThousandths: 128_000,
      note: "Wall Schedule: Length, total of 4 rows",
    });
    expect(figureFor(wall, height, rows.length, "each", DECLARED[1], "walls.txt")).toEqual({
      valueThousandths: 9_000,
      note: "Wall Schedule: Unconnected Height, the same on every one of 4 rows",
    });
    expect(figureFor(wall, null, rows.length, "rows", DOORS, "walls.txt")).toEqual({
      valueThousandths: 4_000,
      note: "Wall Schedule: 4 rows",
    });
  });

  it("refuses a figure in the wrong dimension, and a row count for anything but a count", () => {
    expect(figureFor(wall, area, rows.length, "total", DECLARED[0], "walls.txt")).toBeNull();
    expect(figureFor(wall, length, rows.length, "each", DECLARED[1], "walls.txt")).toBeNull();
    expect(figureFor(wall, null, rows.length, "rows", DECLARED[2], "walls.txt")).toBeNull();
  });

  it("converts between units of one dimension and says when the file had none", () => {
    expect(convertThousandths(100_000, "m2", "sf")).toBe(1_076_391);
    expect(convertThousandths(128_000, "lf", "m")).toBe(39_014);
    expect(convertThousandths(27_000, "cf", "cy")).toBe(1_000);
    expect(convertThousandths(100_000, "sf", "lf")).toBeNull();
    expect(convertThousandths(100_000, "", "sf")).toBe(100_000);
    /** An outline unit this file does not know cannot be converted to. */
    expect(convertThousandths(100_000, "sf", "squares")).toBeNull();
    expect(convertThousandths(100_000, "", "squares")).toBe(100_000);

    const bare = parseSchedule("Type\tArea\nRoof\t1224\nRoof\t600");
    const b = readColumns(bare);
    expect(figureFor(bare, b.columns[1], 2, "total", DECLARED[2], "roof.txt")).toEqual({
      valueThousandths: 1_824_000,
      note: "roof.txt: Area, total of 2 rows, no unit in the file, taken as sf",
    });
  });
});

describe("decodeScheduleBytes", () => {
  const text = '"Room Schedule"\n"Name"\t"Area"\n"Küche"\t"24 m²"';

  it("reads UTF-16 with and without its byte-order mark, which is what Revit writes", () => {
    expect(decodeScheduleBytes(utf16le(text, true))).toBe(text);
    expect(decodeScheduleBytes(utf16le(text, false))).toBe(text);
  });

  it("reads UTF-8 with and without a mark, and an older single-byte file", () => {
    const utf8 = new TextEncoder().encode(text);
    expect(decodeScheduleBytes(utf8)).toBe(text);
    expect(decodeScheduleBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe(text);
    /** `245 m²` in Windows-1252: the superscript is one byte, 0xB2. */
    const ansi = new Uint8Array([...new TextEncoder().encode("Area\n245 m"), 0xb2]);
    expect(decodeScheduleBytes(ansi)).toBe("Area\n245 m²");
  });
});
