import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withSystem, withTenant, schema } from "../src/db";
import {
  choicesOf,
  copyQuestionsBetweenOutlines,
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
import { deleteAssembly, saveItemAsAssembly } from "../src/packs/jobs/assembly-ops";

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

  /**
   * ALWAYS ASK survives a save, and defaults to off. The interview will read
   * it to decide what it may skip, so a flag that quietly reset on an edit
   * would turn an unskippable question into a skippable one with nothing
   * failing.
   */
  it("keeps a question marked always-ask, and defaults the rest to off", async () => {
    const loaded = await as(async (tx) => {
      const rows = await listOutlines(tx, tenantId);
      const id = rows.find((r) => r.outline.name === "New build")!.outline.id;
      return (await loadOutline(tx, tenantId, id))!;
    });
    const foundation = loaded.steps.find((s) => s.title === "Foundation")!;
    expect(foundation.questions.every((q) => q.alwaysAsk === false)).toBe(true);

    await as((tx) =>
      updateOutline(tx, ctx, loaded.outline.id, {
        version: loaded.outline.version,
        steps: loaded.steps.map((step) => ({
          id: step.id,
          title: step.title,
          costCode: step.costCode,
          guidance: step.guidance,
          questions: step.questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            kind: q.kind as "choice" | "yes_no" | "number" | "money" | "text",
            choices: (q.choices as string[]) ?? [],
            unit: q.unit,
            notes: q.notes,
            alwaysAsk: q.prompt === "Poured or block?",
          })),
        })),
      }),
    );

    const after = await as((tx) => loadOutline(tx, tenantId, loaded.outline.id));
    const asked = after!.steps.find((s) => s.title === "Foundation")!.questions;
    expect(asked.find((q) => q.prompt === "Poured or block?")!.alwaysAsk).toBe(true);
    expect(asked.filter((q) => q.alwaysAsk)).toHaveLength(1);
    // And the ids did not move because a boolean changed.
    expect(asked.map((q) => q.id).sort()).toEqual(
      foundation.questions.map((q) => q.id).sort(),
    );
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

  /**
   * BRINGING ONE OUTLINE'S QUESTIONS ONTO ANOTHER'S STEPS.
   *
   * The matcher that proposes the pairs is pure and tested elsewhere; what
   * matters here is that the write **adds and never replaces**, that doing it
   * twice is a no-op, and that the outline lent from is untouched.
   */
  it("copies questions onto another outline's steps, and never twice", async () => {
    const from = await withTenant(tenantId, (tx) =>
      createOutline(tx, ctx, {
        name: `${STAMP} lender`,
        steps: [
          {
            title: "Foundation",
            questions: [
              { prompt: "Block or poured?", kind: "choice", choices: ["Block", "Poured"] },
              { prompt: "Any rebar?", alwaysAsk: true },
            ],
          },
          { title: "Roofing", questions: [{ prompt: "How many squares?", unit: "sq" }] },
          { title: "Asks nothing" },
        ],
      }),
    );
    const into = await withTenant(tenantId, (tx) =>
      createOutline(tx, ctx, {
        name: `${STAMP} borrower`,
        steps: [
          { title: "Foundation", questions: [{ prompt: "Who is doing this one?" }] },
          { title: "Roofing", questions: [{ prompt: "Who is doing this one?" }] },
        ],
      }),
    );

    const lender = await withTenant(tenantId, (tx) => loadOutline(tx, tenantId, from.id));
    const borrower = await withTenant(tenantId, (tx) => loadOutline(tx, tenantId, into.id));
    const pairs = [
      { fromStepId: lender!.steps[0].id, intoStepId: borrower!.steps[0].id },
      { fromStepId: lender!.steps[1].id, intoStepId: borrower!.steps[1].id },
    ];

    const out = await withTenant(tenantId, (tx) =>
      copyQuestionsBetweenOutlines(tx, ctx, {
        fromOutlineId: from.id,
        intoOutlineId: into.id,
        pairs,
      }),
    );
    expect(out).toEqual({ steps: 2, copied: 3, skipped: 0 });

    /** **APPENDED, NOT REPLACED** — the step's own question stays first. */
    const after = await withTenant(tenantId, (tx) => loadOutline(tx, tenantId, into.id));
    expect(after!.steps[0].questions.map((q) => q.prompt)).toEqual([
      "Who is doing this one?",
      "Block or poured?",
      "Any rebar?",
    ]);
    /** Everything about a question comes across, not just its words. */
    const rebar = after!.steps[0].questions[2];
    expect(rebar.alwaysAsk).toBe(true);
    const blockOrPoured = after!.steps[0].questions[1];
    expect(blockOrPoured.kind).toBe("choice");
    expect(choicesOf(blockOrPoured)).toEqual(["Block", "Poured"]);
    expect(after!.steps[1].questions[1].unit).toBe("sq");

    /** **THE OUTLINE LENT FROM IS NOT TOUCHED.** This is a copy, not a move. */
    const lenderAfter = await withTenant(tenantId, (tx) => loadOutline(tx, tenantId, from.id));
    expect(lenderAfter!.steps[0].questions).toHaveLength(2);
    expect(lenderAfter!.outline.version).toBe(lender!.outline.version);

    /** Doing it again changes nothing: a prompt already asked is skipped. */
    const again = await withTenant(tenantId, (tx) =>
      copyQuestionsBetweenOutlines(tx, ctx, {
        fromOutlineId: from.id,
        intoOutlineId: into.id,
        pairs,
      }),
    );
    expect(again).toEqual({ steps: 0, copied: 0, skipped: 3 });
    const twice = await withTenant(tenantId, (tx) => loadOutline(tx, tenantId, into.id));
    expect(twice!.steps[0].questions).toHaveLength(3);

    /**
     * **TWO SOURCES ONTO ONE TARGET.** The pilot's `Framing labour` and
     * `Framing materials` both land on `Framing`; both sets belong, and
     * neither may re-import what the other just added.
     */
    const both = await withTenant(tenantId, (tx) =>
      copyQuestionsBetweenOutlines(tx, ctx, {
        fromOutlineId: from.id,
        intoOutlineId: into.id,
        pairs: [
          { fromStepId: lender!.steps[1].id, intoStepId: borrower!.steps[0].id },
          { fromStepId: lender!.steps[1].id, intoStepId: borrower!.steps[0].id },
        ],
      }),
    );
    expect(both).toEqual({ steps: 1, copied: 1, skipped: 1 });
  });

  it("refuses to copy an outline onto itself, and refuses one that is gone", async () => {
    const one = await withTenant(tenantId, (tx) =>
      createOutline(tx, ctx, { name: `${STAMP} self`, steps: [{ title: "A" }] }),
    );
    await expect(
      withTenant(tenantId, (tx) =>
        copyQuestionsBetweenOutlines(tx, ctx, {
          fromOutlineId: one.id,
          intoOutlineId: one.id,
          pairs: [],
        }),
      ),
    ).rejects.toThrow(JobsError);
    await expect(
      withTenant(tenantId, (tx) =>
        copyQuestionsBetweenOutlines(tx, ctx, {
          fromOutlineId: one.id,
          intoOutlineId: "00000000-0000-4000-8000-000000000000",
          pairs: [],
        }),
      ),
    ).rejects.toThrow(JobsError);
  });

  /** A pair naming a step of some other outline is ignored, not obeyed. */
  it("ignores a pair whose steps are not on the outlines named", async () => {
    const a = await withTenant(tenantId, (tx) =>
      createOutline(tx, ctx, {
        name: `${STAMP} stray a`,
        steps: [{ title: "A", questions: [{ prompt: "Ask A?" }] }],
      }),
    );
    const b = await withTenant(tenantId, (tx) =>
      createOutline(tx, ctx, { name: `${STAMP} stray b`, steps: [{ title: "B" }] }),
    );
    const other = await withTenant(tenantId, (tx) =>
      createOutline(tx, ctx, { name: `${STAMP} stray c`, steps: [{ title: "C" }] }),
    );
    const loadedOther = await withTenant(tenantId, (tx) => loadOutline(tx, tenantId, other.id));
    const loadedA = await withTenant(tenantId, (tx) => loadOutline(tx, tenantId, a.id));

    const out = await withTenant(tenantId, (tx) =>
      copyQuestionsBetweenOutlines(tx, ctx, {
        fromOutlineId: a.id,
        intoOutlineId: b.id,
        pairs: [{ fromStepId: loadedA!.steps[0].id, intoStepId: loadedOther!.steps[0].id }],
      }),
    );
    expect(out).toEqual({ steps: 0, copied: 0, skipped: 0 });
    const untouched = await withTenant(tenantId, (tx) => loadOutline(tx, tenantId, other.id));
    expect(untouched!.steps[0].questions).toEqual([]);
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

  /* ------------------------------------------------------------------------
   * A STEP NAMES ITS ASSEMBLY (X11).
   *
   * The founder: *"I'm struggling to see that we are going to get the
   * consistent items being put on the estimate in the way I want with the
   * verbiage I want."* The pin is the answer, and these are the two things
   * about it that could quietly be wrong.
   * ---------------------------------------------------------------------- */

  it("keeps the item a step always makes, and lets it be taken off again", async () => {
    const assembly = await as((tx) =>
      saveItemAsAssembly(tx, ctx, {
        name: "Drywall, hung and finished",
        clientNote: "",
        notes: "",
        drivingQuantityThousandths: 1_000_000,
        drivingUnit: "sf",
        lines: [
          {
            description: "Board",
            clientDescription: "",
            clientVisible: true,
            unit: "sf",
            quantityThousandths: 1_000_000,
            unitCostCents: 42,
            markupPpm: null,
            unitPriceCents: null,
            costCode: "",
            sortOrder: 0,
          },
        ],
      }),
    );

    const outline = await as((tx) =>
      createOutline(tx, ctx, {
        name: "Pinned",
        steps: [{ title: "Drywall", assemblyId: assembly.id, questions: [] }],
      }),
    );
    const pinned = await as((tx) => loadOutline(tx, tenantId, outline.id));
    expect(pinned!.steps[0].assemblyId).toBe(assembly.id);

    /** **ABSENT LEAVES IT.** Anything that writes a step without knowing
     *  about pins — a seed, a chart read into an outline — must not undo one. */
    await as((tx) =>
      updateOutline(tx, ctx, outline.id, {
        version: pinned!.outline.version,
        steps: [{ id: pinned!.steps[0].id, title: "Drywall", questions: [] }],
      }),
    );
    const still = await as((tx) => loadOutline(tx, tenantId, outline.id));
    expect(still!.steps[0].assemblyId).toBe(assembly.id);

    /** And null is how the editor unpins one. */
    await as((tx) =>
      updateOutline(tx, ctx, outline.id, {
        version: still!.outline.version,
        steps: [{ id: still!.steps[0].id, title: "Drywall", assemblyId: null, questions: [] }],
      }),
    );
    const cleared = await as((tx) => loadOutline(tx, tenantId, outline.id));
    expect(cleared!.steps[0].assemblyId).toBeNull();
  });

  /**
   * **THE TRAP THIS REPO HAS PAID FOR TWICE.** Drizzle emits a BARE
   * `ON DELETE set null` on a composite `(tenant_id, assembly_id)` key, and a
   * bare one can never fire — it would try to null `tenant_id` as well.
   * `constraints.test.ts` proves the SHAPE in `pg_constraint`; this proves the
   * BEHAVIOUR, by deleting a real assembly and looking at the real step.
   */
  it("unpins a step when its assembly leaves the library, and keeps the step", async () => {
    const assembly = await as((tx) =>
      saveItemAsAssembly(tx, ctx, {
        name: "Tiled shower",
        clientNote: "",
        notes: "",
        drivingQuantityThousandths: 1_000,
        drivingUnit: "ea",
        lines: [
          {
            description: "Pan",
            clientDescription: "",
            clientVisible: true,
            unit: "ea",
            quantityThousandths: 1_000,
            unitCostCents: 45_000,
            markupPpm: null,
            unitPriceCents: null,
            costCode: "",
            sortOrder: 0,
          },
        ],
      }),
    );
    const outline = await as((tx) =>
      createOutline(tx, ctx, {
        name: "Showers",
        steps: [{ title: "Bathrooms", assemblyId: assembly.id, questions: [] }],
      }),
    );

    await as((tx) => deleteAssembly(tx, ctx, assembly.id));

    const after = await as((tx) => loadOutline(tx, tenantId, outline.id));
    expect(after!.steps).toHaveLength(1);
    expect(after!.steps[0].title).toBe("Bathrooms");
    expect(after!.steps[0].assemblyId).toBeNull();
  });
});
