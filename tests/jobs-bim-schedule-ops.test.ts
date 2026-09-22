import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { createProject, type JobsCtx } from "../src/packs/jobs/ops";
import { createOutline } from "../src/packs/jobs/outline-ops";
import { createOutlineMeasure, listMeasurements } from "../src/packs/jobs/measure-ops";
import { listRooms } from "../src/packs/jobs/room-ops";
import { importSchedule, previewSchedule } from "../src/packs/jobs/bim-schedule-ops";

/**
 * A SCHEDULE OFF THE MODEL, WRITTEN TO THE BUILDING (X14, ADR 0106).
 *
 * The pure half is held in `tests/jobs-bim-schedule.test.ts`. This file is
 * the write path against a real database, and the one thing no pure test
 * can prove: that a measurement whose `source` is `schedule` is a row the
 * CHECK on `job_measurements` accepts — the migration that widened it is
 * exactly the kind that applies in CI from zero and is forgotten on a
 * database that already exists.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

const WALLS = [
  '"Wall Schedule"',
  '"Type"\t"Length"\t"Area"\t"Unconnected Height"',
  '"Exterior - 2x6"\t"40\' - 0""\t"360 SF"\t"9\' - 0""',
  '"Exterior - 2x6"\t"24\' - 0""\t"216 SF"\t"9\' - 0""',
  '"Exterior - 2x6"\t"40\' - 0""\t"360 SF"\t"9\' - 0""',
  '"Exterior - 2x6"\t"24\' - 0""\t"216 SF"\t"9\' - 0""',
].join("\n");

const ROOMS = [
  '"Room Schedule"',
  '"Number"\t"Name"\t"Level"\t"Area"',
  '"101"\t"Kitchen"\t"Level 1"\t"310 SF"',
  '"102"\t"Bath"\t"Level 1"\t"62 SF"',
  '"201"\t"Bath"\t"Level 2"\t"48 SF"',
  '"202"\t"Loft"\t"Level 2"\t"Not Placed"',
].join("\n");

d("a schedule off the model", () => {
  const STAMP = `bim-sched-${process.pid}`;
  let tenantId = "";
  let entityId = "";
  let projectId = "";
  let outlineId = "";
  let perimeterId = "";
  let heightId = "";
  let roofId = "";
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
      const project = await createProject(tx, ctx, {
        entityId,
        number: "BIM-1",
        name: "Modelled house",
      });
      projectId = project.id;
      const outline = await createOutline(tx, ctx, {
        name: "New build",
        steps: [{ title: "Framing", costCode: "3000", questions: [{ prompt: "Who is doing this one?" }] }],
      });
      outlineId = outline.id;
      const perimeter = await createOutlineMeasure(tx, ctx, outlineId, {
        name: "Wall perimeter",
        unit: "lf",
        kind: "length",
        guidance: "",
        required: true,
      });
      perimeterId = perimeter.id;
      const height = await createOutlineMeasure(tx, ctx, outlineId, {
        name: "Wall height",
        unit: "lf",
        kind: "length",
        guidance: "",
        required: true,
      });
      heightId = height.id;
      const roof = await createOutlineMeasure(tx, ctx, outlineId, {
        name: "Roof area",
        unit: "sf",
        kind: "area",
        guidance: "",
        required: false,
      });
      roofId = roof.id;
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)));
  });

  it("previews a wall schedule against the outline's list", async () => {
    const preview = await run((tx) =>
      previewSchedule(tx, tenantId, projectId, outlineId, WALLS, "walls.txt"),
    );
    expect(preview.title).toBe("Wall Schedule");
    expect(preview.rowCount).toBe(4);
    expect(preview.rooms).toBeNull();
    expect(preview.columns.map((c) => [c.header, c.total, c.each])).toEqual([
      ["Length", "128 lf", null],
      ["Area", "1,152 sf", null],
      ["Unconnected Height", "36 lf", "9 lf"],
    ]);
    /**
     * The words in *Unconnected Height* point at *Wall height*; *Length* points
     * at nothing. And a column that reads 9' on every row suggests the
     * measurement but NOT the figure — the total, 36 lf, went onto a building
     * once, in a drive, and that is the number this refuses to default to.
     */
    expect(preview.suggested).toEqual([{ column: 3, measureId: heightId, use: null }]);
    expect(preview.measures.map((m) => [m.name, m.has])).toEqual([
      ["Wall perimeter", null],
      ["Wall height", null],
      ["Roof area", null],
    ]);
    /** An area column can only answer the area on the list. */
    expect(preview.columns[1].canTake).toEqual([roofId]);
  });

  it("writes confirmed figures to the building as `schedule` measurements", async () => {
    const result = await run((tx) =>
      importSchedule(tx, ctx, {
        projectId,
        outlineId,
        text: WALLS,
        fileName: "walls.txt",
        rooms: false,
        choices: [
          { measureId: perimeterId, column: 1, use: "total" },
          { measureId: heightId, column: 3, use: "each" },
        ],
      }),
    );
    expect(result.refused).toEqual([]);
    expect(result.rooms).toBeNull();
    expect(result.measured).toEqual([
      { name: "Wall perimeter", figure: "128 lf" },
      { name: "Wall height", figure: "9 lf" },
    ]);

    const rows = await run((tx) => listMeasurements(tx, tenantId, projectId));
    expect(rows.map((r) => [r.name, r.valueThousandths, r.source, r.note])).toEqual([
      ["Wall perimeter", 128_000, "schedule", "Wall Schedule: Length, total of 4 rows"],
      ["Wall height", 9_000, "schedule", "Wall Schedule: Unconnected Height, the same on every one of 4 rows"],
    ]);

    /** And the preview now says what the building has. */
    const preview = await run((tx) =>
      previewSchedule(tx, tenantId, projectId, outlineId, WALLS, "walls.txt"),
    );
    expect(preview.measures.find((m) => m.id === perimeterId)?.has).toBe("128 lf");
  });

  it("refuses a column in the wrong dimension by name, and writes nothing for it", async () => {
    const result = await run((tx) =>
      importSchedule(tx, ctx, {
        projectId,
        outlineId,
        text: WALLS,
        fileName: "walls.txt",
        rooms: false,
        choices: [{ measureId: roofId, column: 1, use: "total" }],
      }),
    );
    expect(result.measured).toEqual([]);
    expect(result.refused).toEqual([
      { name: "Roof area", reason: "Roof area wants an area and Length holds a length" },
    ]);
    const rows = await run((tx) => listMeasurements(tx, tenantId, projectId));
    expect(rows.some((r) => r.name === "Roof area")).toBe(false);
  });

  it("adds the rooms with areas marked `schedule`, and does not double them", async () => {
    const first = await run((tx) =>
      importSchedule(tx, ctx, {
        projectId,
        outlineId,
        text: ROOMS,
        fileName: "rooms.txt",
        rooms: true,
        choices: [],
      }),
    );
    expect(first.rooms).toEqual({ added: 3, alreadyThere: 0, withArea: 3, skipped: 1 });

    const rooms = await run((tx) => listRooms(tx, tenantId, projectId));
    expect(rooms.map((r) => [r.room.level, r.room.name, r.areaThousandths, r.areaUnit, r.areaSource])).toEqual([
      ["Level 1", "Kitchen", 310_000, "sf", "schedule"],
      ["Level 1", "Bath", 62_000, "sf", "schedule"],
      ["Level 2", "Bath", 48_000, "sf", "schedule"],
    ]);

    const again = await run((tx) =>
      previewSchedule(tx, tenantId, projectId, outlineId, ROOMS, "rooms.txt"),
    );
    expect(again.rooms?.alreadyThere).toBe(3);
    expect(again.rooms?.skipped).toEqual([
      { line: 6, text: expect.stringContaining("Loft"), reason: "Loft is not placed in the model" },
    ]);

    const second = await run((tx) =>
      importSchedule(tx, ctx, {
        projectId,
        outlineId,
        text: ROOMS,
        fileName: "rooms.txt",
        rooms: true,
        choices: [],
      }),
    );
    expect(second.rooms).toEqual({ added: 0, alreadyThere: 3, withArea: 3, skipped: 1 });
    expect((await run((tx) => listRooms(tx, tenantId, projectId))).length).toBe(3);
  });
});
