import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import {
  createOutline,
  deleteOutline,
  duplicateOutline,
  getDefaultOutline,
  listOutlines,
  loadOutline,
  setDefaultOutline,
  updateOutline,
} from "../src/packs/jobs/outline-ops";
import { JobsError, type JobsCtx } from "../src/packs/jobs/ops";

/**
 * ESTIMATE OUTLINES: the write path (X1, ADR 0098).
 *
 * The one thing here that everything later depends on is **a row keeping its
 * id across a save**. An interview records an answer against a QUESTION, so a
 * save that re-created its rows would orphan a transcript every time somebody
 * fixed a typo — and nothing would fail loudly. That is what most of this
 * file is about.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;
const STAMP = `outline-ops-test-${process.pid}`;

let tenantId = "";
let ctx: JobsCtx;
let staff: JobsCtx;

d("estimate outline ops", () => {
  beforeAll(async () => {
    tenantId = await withSystem(async (tx) => {
      const [row] = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: `${STAMP} Builders`, slug: STAMP })
        .returning({ id: schema.tenants.id });
      return row.id;
    });
    ctx = { tenantId, userId: `${STAMP}-owner`, role: "owner" };
    staff = { tenantId, userId: `${STAMP}-staff`, role: "staff" };
  });

  afterAll(async () => {
    await withSystem((tx) =>
      tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)),
    );
  });

  const as = <T>(fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner" });

  it("makes the first outline the default, whether or not anybody asked", async () => {
    const first = await as((tx) =>
      createOutline(tx, ctx, {
        name: "New build",
        notes: "From a bare lot",
        steps: [
          {
            title: "Foundation",
            costCode: "2000",
            questions: [
              { prompt: "Block or poured?", kind: "choice", choices: ["Block", "Poured"] },
              { prompt: "How many linear feet of footing?", kind: "number", unit: "lf" },
            ],
          },
          { title: "Framing", costCode: "3000", questions: [{ prompt: "Stick or truss?" }] },
        ],
      }),
    );
    expect(first.isDefault).toBe(true);

    const second = await as((tx) => createOutline(tx, ctx, { name: "Remodel" }));
    expect(second.isDefault).toBe(false);
    expect((await as((tx) => getDefaultOutline(tx, tenantId)))?.name).toBe("New build");
  });

  it("refuses a second outline by the same name", async () => {
    await expect(as((tx) => createOutline(tx, ctx, { name: "Remodel" }))).rejects.toThrow(
      JobsError,
    );
  });

  it("refuses a shape the editor would not have let through either", async () => {
    await expect(
      as((tx) =>
        createOutline(tx, ctx, {
          name: "Bad",
          steps: [
            { title: "One", questions: [{ prompt: "Which?", kind: "choice", choices: ["only"] }] },
          ],
        }),
      ),
    ).rejects.toThrow(/at least two options/);
    // And nothing was left behind by the attempt.
    const rows = await as((tx) => listOutlines(tx, tenantId));
    expect(rows.map((r) => r.outline.name).sort()).toEqual(["New build", "Remodel"]);
  });

  it("is owner work to write and member work to read", async () => {
    await expect(
      as((tx) => createOutline(tx, staff, { name: "Staff tried" })),
    ).rejects.toThrow(JobsError);
    const rows = await withTenant(tenantId, (tx) => listOutlines(tx, tenantId), {
      role: "staff",
    });
    expect(rows).toHaveLength(2);
  });

  /**
   * THE LOAD-BEARING ONE. Rename a step, reword a question, add one, drop
   * one, and reorder — every surviving row must come back with the id it went
   * in with.
   */
  it("keeps every surviving row's id across an edit", async () => {
    const before = await as(async (tx) => {
      const rows = await listOutlines(tx, tenantId);
      const id = rows.find((r) => r.outline.name === "New build")!.outline.id;
      return (await loadOutline(tx, tenantId, id))!;
    });
    const foundation = before.steps[0];
    const framing = before.steps[1];
    expect(foundation.title).toBe("Foundation");
    expect(foundation.questions).toHaveLength(2);

    await as((tx) =>
      updateOutline(tx, ctx, before.outline.id, {
        version: before.outline.version,
        steps: [
          // Framing first now, and renamed.
          { id: framing.id, title: "Rough framing", costCode: "3000", questions: [] },
          {
            id: foundation.id,
            title: "Foundation",
            costCode: "2000",
            guidance: "Type first, then the wall.",
            questions: [
              // Kept, reworded.
              { id: foundation.questions[0].id, prompt: "Poured or block?", kind: "choice", choices: ["Poured", "Block"] },
              // The footing question is left out, so it goes.
              // And a new one arrives.
              { prompt: "Any rebar?", kind: "yes_no" },
            ],
          },
          // A wholly new step.
          { title: "Roofing", costCode: "4000", questions: [{ prompt: "How many squares?", kind: "number", unit: "sq" }] },
        ],
      }),
    );

    const after = await as((tx) => loadOutline(tx, tenantId, before.outline.id));
    expect(after!.steps.map((s) => s.title)).toEqual([
      "Rough framing",
      "Foundation",
      "Roofing",
    ]);
    // The two that survived are the SAME ROWS, reordered.
    expect(after!.steps[0].id).toBe(framing.id);
    expect(after!.steps[1].id).toBe(foundation.id);
    expect(after!.steps[1].guidance).toBe("Type first, then the wall.");

    const kept = after!.steps[1].questions;
    expect(kept).toHaveLength(2);
    expect(kept[0].id).toBe(foundation.questions[0].id);
    expect(kept[0].prompt).toBe("Poured or block?");
    expect(kept[0].choices).toEqual(["Poured", "Block"]);
    expect(kept[1].prompt).toBe("Any rebar?");
    expect(kept[1].kind).toBe("yes_no");
    expect(kept[1].choices).toEqual([]);

    // The dropped question is gone, and the step that lost its questions kept none.
    const dropped = await withSystem((tx) =>
      tx
        .select()
        .from(schema.jobEstimateOutlineQuestions)
        .where(eq(schema.jobEstimateOutlineQuestions.id, foundation.questions[1].id)),
    );
    expect(dropped).toEqual([]);
    expect(after!.steps[0].questions).toEqual([]);
  });

  it("refuses a save against a version somebody else has already moved", async () => {
    const loaded = await as(async (tx) => {
      const rows = await listOutlines(tx, tenantId);
      const id = rows.find((r) => r.outline.name === "New build")!.outline.id;
      return (await loadOutline(tx, tenantId, id))!;
    });
    await expect(
      as((tx) =>
        updateOutline(tx, ctx, loaded.outline.id, {
          version: loaded.outline.version - 1,
          name: "Too late",
        }),
      ),
    ).rejects.toThrow(/changed since/);
  });

  it("refuses a step that belongs to a different outline", async () => {
    const [newBuild, remodel] = await as(async (tx) => {
      const rows = await listOutlines(tx, tenantId);
      return [
        rows.find((r) => r.outline.name === "New build")!.outline,
        rows.find((r) => r.outline.name === "Remodel")!.outline,
      ];
    });
    const stolen = (await as((tx) => loadOutline(tx, tenantId, newBuild.id)))!.steps[0];
    await expect(
      as((tx) =>
        updateOutline(tx, ctx, remodel.id, {
          steps: [{ id: stolen.id, title: "Not mine" }],
        }),
      ),
    ).rejects.toThrow(/is not on this outline/);
  });

  it("moves the default, and only ever has one", async () => {
    const remodel = await as(async (tx) => {
      const rows = await listOutlines(tx, tenantId);
      return rows.find((r) => r.outline.name === "Remodel")!.outline;
    });
    await as((tx) => setDefaultOutline(tx, ctx, remodel.id));
    const rows = await as((tx) => listOutlines(tx, tenantId));
    expect(rows.filter((r) => r.outline.isDefault).map((r) => r.outline.name)).toEqual([
      "Remodel",
    ]);
    // The default sorts first, which is what the picker relies on.
    expect(rows[0].outline.name).toBe("Remodel");
  });

  it("copies an outline whole, and the copy is its own rows", async () => {
    const source = await as(async (tx) => {
      const rows = await listOutlines(tx, tenantId);
      return (await loadOutline(
        tx,
        tenantId,
        rows.find((r) => r.outline.name === "New build")!.outline.id,
      ))!;
    });
    const copy = await as((tx) =>
      duplicateOutline(tx, ctx, source.outline.id, "New build, walkout"),
    );
    expect(copy.isDefault).toBe(false);

    const loaded = await as((tx) => loadOutline(tx, tenantId, copy.id));
    expect(loaded!.steps.map((s) => s.title)).toEqual(
      source.steps.map((s) => s.title),
    );
    // Its rows are NEW rows, so editing the copy cannot reach the original.
    const sourceIds = new Set(source.steps.map((s) => s.id));
    for (const step of loaded!.steps) expect(sourceIds.has(step.id)).toBe(false);
    expect(loaded!.steps[1].questions.map((q) => q.prompt)).toEqual(
      source.steps[1].questions.map((q) => q.prompt),
    );
  });

  it("counts what the list shows, gaps included", async () => {
    const rows = await as((tx) => listOutlines(tx, tenantId));
    const newBuild = rows.find((r) => r.outline.name === "New build")!;
    expect(newBuild.summary.steps).toBe(3);
    expect(newBuild.summary.questions).toBe(3);
    // "Rough framing" lost its questions in the edit above.
    expect(newBuild.summary.silentSteps).toBe(1);
    expect(newBuild.summary.uncodedSteps).toBe(0);
  });

  it("takes the whole tree with it when it goes", async () => {
    const target = await as(async (tx) => {
      const rows = await listOutlines(tx, tenantId);
      return (await loadOutline(
        tx,
        tenantId,
        rows.find((r) => r.outline.name === "New build, walkout")!.outline.id,
      ))!;
    });
    const stepIds = target.steps.map((s) => s.id);
    await as((tx) => deleteOutline(tx, ctx, target.outline.id));

    const left = await withSystem((tx) =>
      tx
        .select()
        .from(schema.jobEstimateOutlineSteps)
        .where(eq(schema.jobEstimateOutlineSteps.outlineId, target.outline.id)),
    );
    expect(left).toEqual([]);
    const orphans = await withSystem((tx) =>
      tx
        .select()
        .from(schema.jobEstimateOutlineQuestions)
        .where(eq(schema.jobEstimateOutlineQuestions.stepId, stepIds[0])),
    );
    expect(orphans).toEqual([]);
  });
});
