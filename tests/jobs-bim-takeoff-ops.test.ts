import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { createProject, type JobsCtx } from "../src/packs/jobs/ops";
import {
  keysOf,
  listAssemblyKeys,
  saveItemAsAssembly,
  setAssemblyKeys,
} from "../src/packs/jobs/assembly-ops";
import { previewTakeoff, takeoffItems } from "../src/packs/jobs/bim-takeoff-ops";

/**
 * THE TAKEOFF OFF THE MODEL, AS ITEMS (X15, ADR 0107).
 *
 * The pure half is held in `tests/jobs-bim-takeoff.test.ts`. This is the
 * join against a real library: an assembly priced at 320 sf, a wall schedule
 * naming 3,708 sf of a wall type, and the lines that come out scaled to it
 * — plus the memory that makes the second takeoff map itself, and the
 * refusal that stops a length driving an area.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const WALL_TYPES = [
  '"Wall Schedule"',
  '"Family and Type"\t"Count"\t"Length"\t"Area"',
  '"Basic Wall: Exterior - 2x6 Wood Stud"\t"12"\t"248\' - 0""\t"2,232 SF"',
  '"Basic Wall: Interior - 2x4 Wood Stud"\t"22"\t"412\' - 0""\t"3,708 SF"',
  '"Grand total: 34"\t"34"\t"660\' - 0""\t"5,940 SF"',
].join("\n");

const FRAMING = [
  '"Structural Framing Schedule"',
  '"Type"\t"Count"\t"Cut Length"',
  '"2x10"\t"1"\t"14\' - 0""',
  '"2x10"\t"1"\t"14\' - 0""',
  '"2x10"\t"1"\t"12\' - 0""',
  '"2x12"\t"1"\t"20\' - 0""',
].join("\n");

const MATERIALS = [
  '"Wall Material Takeoff"',
  '"Material: Name"\t"Material: Area"\t"Material: Volume"',
  '"Gypsum Wall Board"\t"4,464 SF"\t"186 CF"',
  '"Wood - Stud Layer"\t"2,232 SF"\t"1,023 CF"',
].join("\n");

d("a takeoff off the model", () => {
  const STAMP = `bim-takeoff-${process.pid}`;
  let tenantId = "";
  let entityId = "";
  let projectId = "";
  let drywallId = "";
  let studId = "";
  let ctx: JobsCtx;

  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: `${STAMP}-owner` });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const t = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Model Builder", slug: STAMP })
        .returning();
      tenantId = t[0].id;
      const e = await tx
        .insert(schema.entities)
        .values({ tenantId, name: "Model Builder LLC", isDefault: true })
        .returning();
      entityId = e[0].id;
    });
    ctx = { tenantId, userId: `${STAMP}-owner`, role: "owner" };

    await run(async (tx) => {
      const project = await createProject(tx, ctx, { entityId, number: "TAKEOFF-1", name: "Modelled house" });
      projectId = project.id;
      const drywall = await saveItemAsAssembly(tx, ctx, {
        name: "Drywall, hang and finish",
        clientNote: "Drywall, hung, taped and finished",
        notes: "",
        drivingQuantityThousandths: 320_000,
        drivingUnit: "sf",
        lines: [
          { description: "Drywall, 1/2 in sheets", clientDescription: "", clientVisible: true, unit: "ea", quantityThousandths: 10_000, unitCostCents: 1_200, markupPpm: null, unitPriceCents: null, costCode: "", sortOrder: 0 },
          { description: "Hang, tape and finish", clientDescription: "", clientVisible: true, unit: "sf", quantityThousandths: 320_000, unitCostCents: 150, markupPpm: null, unitPriceCents: null, costCode: "", sortOrder: 1 },
        ],
      });
      drywallId = drywall.id;
      const stud = await saveItemAsAssembly(tx, ctx, {
        name: "Wood stud",
        clientNote: "",
        notes: "",
        drivingQuantityThousandths: 10_000,
        drivingUnit: "lf",
        lines: [
          { description: "2x4 studs at 16 in", clientDescription: "", clientVisible: true, unit: "ea", quantityThousandths: 8_000, unitCostCents: 450, markupPpm: null, unitPriceCents: null, costCode: "", sortOrder: 0 },
        ],
      });
      studId = stud.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)));
  });

  it("previews a wall schedule as things, each with the assemblies it could drive", async () => {
    const preview = await run((tx) => previewTakeoff(tx, tenantId, WALL_TYPES, "walls.txt"));
    expect(preview.title).toBe("Wall Schedule");
    expect(preview.keyHeader).toBe("Family and Type");
    expect(preview.rowCount).toBe(2);
    expect(preview.footers).toBe(1);
    expect(preview.rows.map((r) => [r.key, r.count, r.quantities.map((q) => q.figure)])).toEqual([
      ["Basic Wall: Exterior - 2x6 Wood Stud", 12, ["248 lf", "2,232 sf"]],
      ["Basic Wall: Interior - 2x4 Wood Stud", 22, ["412 lf", "3,708 sf"]],
    ]);
    /** Nothing remembered yet; *Wood stud* is suggested by its words on both. */
    expect(preview.rows[1].match).toEqual({ assemblyId: studId, how: "words" });
    expect(preview.rows[1].canDrive).toEqual([
      { assemblyId: drywallId, at: "3,708 sf" },
      { assemblyId: studId, at: "412 lf" },
    ]);
    expect(preview.assemblies.map((a) => [a.name, a.per])).toEqual([
      ["Drywall, hang and finish", "320 sf"],
      ["Wood stud", "10 lf"],
    ]);
  });

  it("makes the items confirmed, scaled to the model's figures, and remembers the names", async () => {
    const result = await run((tx) =>
      takeoffItems(tx, ctx, {
        projectId,
        text: WALL_TYPES,
        fileName: "walls.txt",
        choices: [
          { key: "Basic Wall: Interior - 2x4 Wood Stud", assemblyId: drywallId, remember: true },
          { key: "Basic Wall: Exterior - 2x6 Wood Stud", lineFrom: "Length" },
        ],
      }),
    );
    expect(result.refused).toEqual([]);
    expect(result.remembered).toBe(1);
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.name).toBe("Drywall, hang and finish");
    expect(item.isAllowance).toBe(false);
    /** 10 sheets per 320 sf at 3,708 sf is 115.875 sheets; the rates are untouched. */
    expect(item.lines.map((l) => [l.description, l.quantityThousandths, l.unitCostCents])).toEqual([
      ["Drywall, 1/2 in sheets", 115_875, 1_200],
      ["Hang, tape and finish", 3_708_000, 150],
    ]);
    expect(item.basisDetail).toBe(
      "Drywall, hang and finish at 3,708 sf · off the model: Wall Schedule · Basic Wall: Interior - 2x4 Wood Stud · Area 3,708 sf",
    );
    expect(result.loose).toEqual([
      {
        description: "Basic Wall: Exterior - 2x6 Wood Stud",
        quantityThousandths: 248_000,
        unit: "lf",
        basisDetail: "off the model: Wall Schedule · Basic Wall: Exterior - 2x6 Wood Stud · Length 248 lf",
      },
    ]);

    /** And the second takeoff off the same model maps itself. */
    expect(await run((tx) => keysOf(tx, tenantId, drywallId))).toEqual(["Basic Wall: Interior - 2x4 Wood Stud"]);
    const again = await run((tx) => previewTakeoff(tx, tenantId, WALL_TYPES, "walls.txt"));
    expect(again.rows[1].match).toEqual({ assemblyId: drywallId, how: "remembered" });
  });

  it("refuses, by name, an assembly the schedule has no figure for", async () => {
    const result = await run((tx) =>
      takeoffItems(tx, ctx, {
        projectId,
        text: MATERIALS,
        fileName: "materials.txt",
        choices: [
          { key: "Gypsum Wall Board", assemblyId: studId },
          { key: "Wood - Stud Layer", lineFrom: "Cut Length" },
          { key: "Not in it", lineFrom: "count" },
        ],
      }),
    );
    expect(result.items).toEqual([]);
    expect(result.loose).toEqual([]);
    expect(result.refused).toEqual([
      { key: "Gypsum Wall Board", reason: "Wood stud is per lf and the schedule has no length for it" },
      { key: "Wood - Stud Layer", reason: "the schedule has no Cut Length figure for it" },
      { key: "Not in it", reason: "it is not in the schedule" },
    ]);
  });

  it("names framing by type and cut length unless told not to, and says which columns it used", async () => {
    const preview = await run((tx) => previewTakeoff(tx, tenantId, FRAMING, "framing.txt"));
    expect(preview.namedBy?.header).toBe("Type");
    expect(preview.alsoBy?.header).toBe("Cut Length");
    expect(preview.nameChoices.map((c) => c.header)).toEqual(["Type"]);
    expect(preview.alsoChoices.map((c) => c.header)).toEqual(["Count", "Cut Length"]);
    expect(preview.rows.map((r) => [r.key, r.count])).toEqual([
      ["2x10 · 14' - 0\"", 2],
      ["2x10 · 12' - 0\"", 1],
      ["2x12 · 20' - 0\"", 1],
    ]);
    /** As a lumber list line: the count is the figure that matters. */
    const result = await run((tx) =>
      takeoffItems(tx, ctx, {
        projectId,
        text: FRAMING,
        fileName: "framing.txt",
        choices: [{ key: "2x10 · 14' - 0\"", lineFrom: "count" }],
      }),
    );
    expect(result.loose).toEqual([
      {
        description: "2x10 · 14' - 0\"",
        quantityThousandths: 2_000,
        unit: "ea",
        basisDetail: "off the model: Structural Framing Schedule · 2x10 · 14' - 0\" · 2 in the schedule",
      },
    ]);
    /** Told *nothing*, every 2x10 is one thing again — and the import groups the same way. */
    const flat = await run((tx) => previewTakeoff(tx, tenantId, FRAMING, "framing.txt", { alsoBy: -1 }));
    expect(flat.alsoBy).toBeNull();
    expect(flat.rows.map((r) => [r.key, r.count])).toEqual([
      ["2x10", 3],
      ["2x12", 1],
    ]);
    const flatResult = await run((tx) =>
      takeoffItems(tx, ctx, {
        projectId,
        text: FRAMING,
        fileName: "framing.txt",
        choices: [{ key: "2x10", lineFrom: "count" }],
        named: { alsoBy: -1 },
      }),
    );
    expect(flatResult.loose.map((l) => [l.description, l.quantityThousandths])).toEqual([["2x10", 3_000]]);
  });

  it("keeps one assembly per name, and a name typed on another assembly moves to it", async () => {
    await run((tx) => setAssemblyKeys(tx, ctx, drywallId, ["Gypsum Wall Board", "GWB", "gypsum  wall-board"]));
    expect(await run((tx) => keysOf(tx, tenantId, drywallId))).toEqual(["GWB", "Gypsum Wall Board"]);
    await run((tx) => setAssemblyKeys(tx, ctx, studId, ["GWB", "Wood - Stud Layer"]));
    expect(await run((tx) => keysOf(tx, tenantId, studId))).toEqual(["GWB", "Wood - Stud Layer"]);
    expect(await run((tx) => keysOf(tx, tenantId, drywallId))).toEqual(["Gypsum Wall Board"]);
    const all = await run((tx) => listAssemblyKeys(tx, tenantId));
    expect(all.map((k) => k.keySlug).sort()).toEqual(["gwb", "gypsum wall board", "wood stud layer"]);
  });
});
