import { describe, expect, it } from "vitest";
import { parseSchedule, readColumns } from "../src/packs/jobs/bim-schedule";
import {
  countColumnOf,
  driverFor,
  keyColumnOf,
  keySlug,
  lineFromRow,
  matchAssembly,
  offTheModel,
  takeoffRows,
  whyNoDriver,
  type AssemblyToMatch,
} from "../src/packs/jobs/bim-takeoff";

/**
 * THE TAKEOFF OFF THE MODEL (X15).
 *
 * A schedule is things with quantities; an assembly is what the business
 * builds a thing out of. These are the rules that join them: which column
 * names the thing, how the rows add up, which assembly a name means, and
 * which figure drives it — and where each refuses to guess.
 */

const WALL_TYPES = [
  '"Wall Schedule"',
  '"Family and Type"\t"Count"\t"Length"\t"Area"',
  '"Basic Wall: Exterior - 2x6 Wood Stud"\t"12"\t"248\' - 0""\t"2,232 SF"',
  '"Basic Wall: Interior - 2x4 Wood Stud"\t"22"\t"412\' - 0""\t"3,708 SF"',
  '"Grand total: 34"\t"34"\t"660\' - 0""\t"5,940 SF"',
].join("\n");

const MATERIALS = [
  '"Wall Material Takeoff"',
  '"Material: Name"\t"Material: Area"\t"Material: Volume"',
  '"Gypsum Wall Board"',
  '"Gypsum Wall Board"\t"1,200 SF"\t"50 CF"',
  '"Gypsum Wall Board"\t"3,264 SF"\t"136 CF"',
  '"Gypsum Wall Board: 2"\t"4,464 SF"\t"186 CF"',
  '"Wood - Stud Layer"',
  '"Wood - Stud Layer"\t"2,232 SF"\t"1,023 CF"',
  '"Wood - Stud Layer: 1"\t"2,232 SF"\t"1,023 CF"',
  '"Grand total: 3"\t"6,696 SF"\t"1,209 CF"',
].join("\n");

const FRAMING = [
  '"Structural Framing Schedule"',
  '"Type"\t"Count"\t"Cut Length"',
  '"2x10"\t"1"\t"14\' - 0""',
  '"2x10"\t"1"\t"14\' - 0""',
  '"2x10"\t"1"\t"12\' - 0""',
  '"2x12"\t"1"\t"20\' - 0""',
].join("\n");

const ASSEMBLIES: AssemblyToMatch[] = [
  { id: "a1", name: "Drywall, hang and finish", drivingUnit: "sf", keys: ["Gypsum Wall Board"] },
  { id: "a2", name: "Exterior wall framing", drivingUnit: "lf", keys: [] },
  { id: "a3", name: "Interior door, hung", drivingUnit: "ea", keys: [] },
  { id: "a4", name: "Wood stud", drivingUnit: "lf", keys: [] },
  { id: "a5", name: "Kitchen, as drawn", drivingUnit: "", keys: [] },
];

function read(text: string) {
  const schedule = parseSchedule(text);
  const { columns, rows } = readColumns(schedule);
  const key = keyColumnOf(columns);
  if (!key) throw new Error("no key column");
  return { schedule, columns, rows, key, taken: takeoffRows(columns, rows, key.index) };
}

describe("keySlug", () => {
  it("reduces a name to its identity", () => {
    expect(keySlug("Basic Wall: Exterior - 2x6 Wood Stud")).toBe("basic wall exterior 2x6 wood stud");
    expect(keySlug("  basic wall exterior 2x6 wood stud ")).toBe("basic wall exterior 2x6 wood stud");
    expect(keySlug("---")).toBe("");
  });
});

describe("keyColumnOf", () => {
  it("finds the column that names a thing, by what the export calls it", () => {
    expect(keyColumnOf(readColumns(parseSchedule(WALL_TYPES)).columns)?.header).toBe("Family and Type");
    expect(keyColumnOf(readColumns(parseSchedule(MATERIALS)).columns)?.header).toBe("Material: Name");
    expect(keyColumnOf(readColumns(parseSchedule(FRAMING)).columns)?.header).toBe("Type");
  });

  it("falls back to the first word column that is not a number or a mark", () => {
    const { columns } = readColumns(parseSchedule("Mark\tWhat\tWidth\nD1\tSingle flush\t3' - 0\"\nD2\tDouble\t6' - 0\""));
    expect(keyColumnOf(columns)?.header).toBe("What");
    expect(countColumnOf(columns)).toBeNull();
    expect(keyColumnOf(readColumns(parseSchedule("Width\tHeight\n3' - 0\"\t6' - 8\"")).columns)).toBeNull();
  });
});

describe("takeoffRows", () => {
  it("adds a wall schedule up by type, taking the count from its column", () => {
    const { taken } = read(WALL_TYPES);
    expect(taken.unnamed).toBe(0);
    expect(taken.rows).toEqual([
      {
        key: "Basic Wall: Exterior - 2x6 Wood Stud",
        slug: "basic wall exterior 2x6 wood stud",
        rows: 1,
        count: 12,
        quantities: [
          { header: "Length", unit: "lf", dimension: "length", totalThousandths: 248_000 },
          { header: "Area", unit: "sf", dimension: "area", totalThousandths: 2_232_000 },
        ],
      },
      {
        key: "Basic Wall: Interior - 2x4 Wood Stud",
        slug: "basic wall interior 2x4 wood stud",
        rows: 1,
        count: 22,
        quantities: [
          { header: "Length", unit: "lf", dimension: "length", totalThousandths: 412_000 },
          { header: "Area", unit: "sf", dimension: "area", totalThousandths: 3_708_000 },
        ],
      },
    ]);
  });

  it("adds an itemised material takeoff up by material, past its group headers and footers", () => {
    const { taken } = read(MATERIALS);
    expect(taken.rows.map((r) => [r.key, r.rows, r.count, r.quantities.map((q) => q.totalThousandths)])).toEqual([
      ["Gypsum Wall Board", 2, 2, [4_464_000, 186_000]],
      ["Wood - Stud Layer", 1, 1, [2_232_000, 1_023_000]],
    ]);
  });

  it("adds an itemised framing schedule up by type", () => {
    const { taken } = read(FRAMING);
    expect(taken.rows.map((r) => [r.key, r.count, r.quantities[0].totalThousandths])).toEqual([
      ["2x10", 3, 40_000],
      ["2x12", 1, 20_000],
    ]);
  });

  it("counts a row with no name and leaves it out", () => {
    const { taken } = read('Type\tMark\tArea\nRoof\tR1\t100 SF\n""\tR2\t50 SF\nRoof\tR3\t20 SF');
    expect(taken.unnamed).toBe(1);
    expect(taken.rows).toHaveLength(1);
    expect(taken.rows[0].quantities[0].totalThousandths).toBe(120_000);
  });
});

describe("matchAssembly", () => {
  const walls = read(WALL_TYPES).taken.rows;
  const materials = read(MATERIALS).taken.rows;
  const framing = read(FRAMING).taken.rows;

  it("remembers what the business said a name means", () => {
    expect(matchAssembly(materials[0], ASSEMBLIES)).toEqual({ assemblyId: "a1", how: "remembered" });
    /** However the model spells it this time. */
    expect(matchAssembly({ key: "gypsum  wall-board", slug: keySlug("gypsum  wall-board") }, ASSEMBLIES)).toEqual({
      assemblyId: "a1",
      how: "remembered",
    });
  });

  it("suggests by words only when every word of the assembly's name is in the model's", () => {
    /** *Wood stud* is in *Basic Wall: Exterior - 2x6 Wood Stud*; *Exterior wall framing* is not. */
    expect(matchAssembly(walls[0], ASSEMBLIES)).toEqual({ assemblyId: "a4", how: "words" });
    expect(matchAssembly(framing[0], ASSEMBLIES)).toBeNull();
    /** *Wood stud* is in *Wood - Stud Layer* too — a suggestion, which the person can decline. */
    expect(matchAssembly(materials[1], ASSEMBLIES)).toEqual({ assemblyId: "a4", how: "words" });
    /** Nothing on the list is in *Gypsum Wall Board* by words alone. */
    expect(matchAssembly({ key: "Gypsum Wall Board", slug: "gypsum wall board" }, ASSEMBLIES.slice(1))).toBeNull();
  });
});

describe("driverFor", () => {
  const walls = read(WALL_TYPES).taken.rows;
  const materials = read(MATERIALS).taken.rows;

  it("takes the row's figure in the assembly's own dimension, converted into its unit", () => {
    expect(driverFor(walls[0], ASSEMBLIES[3])).toEqual({ valueThousandths: 248_000, from: "Length 248 lf" });
    expect(driverFor(walls[0], ASSEMBLIES[0])).toEqual({ valueThousandths: 2_232_000, from: "Area 2,232 sf" });
    expect(driverFor(materials[0], ASSEMBLIES[0])).toEqual({ valueThousandths: 4_464_000, from: "Material: Area 4,464 sf" });
    const metric = { count: 1, quantities: [{ header: "Area", unit: "m2" as const, dimension: "area" as const, totalThousandths: 100_000 }] };
    expect(driverFor(metric, ASSEMBLIES[0])).toEqual({ valueThousandths: 1_076_391, from: "Area 100 m2" });
  });

  it("drops an assembly per thing, or per nothing, once per thing counted", () => {
    expect(driverFor(walls[0], ASSEMBLIES[2])).toEqual({ valueThousandths: 12_000, from: "12 in the schedule" });
    expect(driverFor(walls[0], ASSEMBLIES[4])).toEqual({ valueThousandths: 12_000, from: "12 in the schedule" });
  });

  it("prefers a wall's length to its height for a length", () => {
    const row = {
      count: 4,
      quantities: [
        { header: "Unconnected Height", unit: "lf" as const, dimension: "length" as const, totalThousandths: 36_000 },
        { header: "Length", unit: "lf" as const, dimension: "length" as const, totalThousandths: 128_000 },
      ],
    };
    expect(driverFor(row, ASSEMBLIES[3])).toEqual({ valueThousandths: 128_000, from: "Length 128 lf" });
  });

  it("refuses, in words, a row with no figure in the dimension", () => {
    expect(driverFor(materials[0], ASSEMBLIES[3])).toBeNull();
    expect(whyNoDriver(materials[0], ASSEMBLIES[3])).toBe("Wood stud is per lf and the schedule has no length for it");
    expect(driverFor({ count: 0, quantities: [] }, ASSEMBLIES[2])).toBeNull();
    expect(whyNoDriver({ count: 0, quantities: [] }, ASSEMBLIES[2])).toBe("the schedule counts nothing for it");
  });
});

describe("lineFromRow and offTheModel", () => {
  const { schedule, taken } = read(WALL_TYPES);

  it("makes a plain line from a chosen figure, or from the count", () => {
    expect(lineFromRow(taken.rows[0], "Area")).toEqual({
      description: "Basic Wall: Exterior - 2x6 Wood Stud",
      quantityThousandths: 2_232_000,
      unit: "sf",
    });
    expect(lineFromRow(taken.rows[0], "count")).toEqual({
      description: "Basic Wall: Exterior - 2x6 Wood Stud",
      quantityThousandths: 12_000,
      unit: "ea",
    });
    expect(lineFromRow(taken.rows[0], "Slope")).toBeNull();
  });

  it("says where a figure came from in one clause", () => {
    expect(offTheModel(schedule, "walls.txt", taken.rows[0], "Length 248 lf")).toBe(
      "off the model: Wall Schedule · Basic Wall: Exterior - 2x6 Wood Stud · Length 248 lf",
    );
    expect(offTheModel({ title: "" }, "walls.txt", taken.rows[0], "Length 248 lf")).toBe(
      "off the model: walls.txt · Basic Wall: Exterior - 2x6 Wood Stud · Length 248 lf",
    );
  });
});
