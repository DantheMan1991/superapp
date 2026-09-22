import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withSystem, withTenant, type Tx } from "../src/db";
import { createProject } from "../src/packs/jobs/ops";
import { createEstimate, getEstimate } from "../src/packs/jobs/estimating-ops";
import { createOutline, loadOutline } from "../src/packs/jobs/outline-ops";
import {
  asWalkAnswers,
  claimTurn,
  closeWalk,
  getWalk,
  goToStep,
  recordAnswers,
  reopenQuestion,
  startWalk,
  settleCovered,
} from "../src/packs/jobs/walk-ops";
import { applyProposal, listProposal, proposeLines } from "../src/packs/jobs/walk-lines-ops";
import { stepIsCovered } from "../src/packs/jobs/walk-math";
import { coverageOf } from "../src/packs/jobs/walk-coverage";
import { reckoningFor } from "../src/packs/jobs/walk-reckoning-ops";
import { JobsError, type JobsCtx } from "../src/packs/jobs/ops";

/**
 * THE WAY BACK INTO A FINISHED WALK (X9).
 *
 * X4's promise is that running out of questions does not finish a bid: the
 * reckoning says what is still outstanding and you click into a phase to fix
 * it (ADR 0099). Every door that click went through refused a walk that was
 * not running, so the promise was never keepable — the founder's own EST-6
 * closed over eight phases nobody had been asked about, and there was no way
 * back in to any of them.
 *
 * Two rules here, and they are the whole slice:
 *
 * 1. **A PERSON may pick a finished walk back up**, and the walk itself may
 *    not. `claimTurn` and `recordAnswers` still refuse a closed walk, which
 *    is what stops a stale tab writing into a bid somebody has finished.
 * 2. **A phase walked twice is still ONE item on the estimate.** Applying
 *    appended, always, so re-answering a phase put its money on twice — in
 *    the total, where a wrong number does the most damage.
 */

const RUN = !!process.env.DATABASE_URL;
const d = RUN ? describe : describe.skip;

d("walking an estimate: the write path", () => {
  const STAMP = `walk-ops-${process.pid}`;
  let tenantId = "";
  let entityId = "";
  let projectId = "";
  let outlineId = "";
  let stepIds: string[] = [];
  let questionIds: string[] = [];
  let ctx: JobsCtx;

  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    withTenant(tenantId, fn, { role: "owner", userId: `${STAMP}-owner` });

  beforeAll(async () => {
    await withSystem(async (tx) => {
      const t = await tx
        .insert(schema.tenants)
        .values({ clerkOrgId: STAMP, name: "Walk Builder", slug: STAMP })
        .returning();
      tenantId = t[0].id;
      const e = await tx
        .insert(schema.entities)
        .values({ tenantId, name: "Walk Builder LLC", isDefault: true })
        .returning();
      entityId = e[0].id;
    });
    ctx = { tenantId, userId: `${STAMP}-owner`, role: "owner" };

    await run(async (tx) => {
      const project = await createProject(tx, ctx, {
        entityId,
        number: "WALK-1",
        name: "Barn conversion",
      });
      projectId = project.id;
      const outline = await createOutline(tx, ctx, {
        name: "New build",
        steps: [
          { title: "Rough carpentry", costCode: "3000", questions: [{ prompt: "Who is doing this one?" }] },
          { title: "Drywall", costCode: "9250", questions: [{ prompt: "Who is doing this one?" }] },
          { title: "Landscaping", costCode: "2900", questions: [{ prompt: "Who is doing this one?" }] },
        ],
      });
      outlineId = outline.id;
      const loaded = await loadOutline(tx, tenantId, outline.id);
      stepIds = loaded!.steps.map((s) => s.id);
      questionIds = loaded!.steps.map((s) => s.questions[0].id);
    });
  });

  afterAll(async () => {
    await withSystem((tx) => tx.delete(schema.tenants).where(eq(schema.tenants.id, tenantId)));
  });

  /** A fresh estimate and a walk on it, so no test depends on another's. */
  let walkSeq = 0;
  const aWalk = async (): Promise<string> =>
    run(async (tx) => {
      const estimate = await createEstimate(tx, ctx, {
        projectId,
        number: `WALK-EST-${(walkSeq += 1)}`,
      });
      const walk = await startWalk(tx, ctx, { estimateId: estimate.id, outlineId });
      return walk.id;
    });

  const answerStep = (interviewId: string, at: number, said: string) =>
    run((tx) =>
      recordAnswers(tx, ctx, interviewId, [
        {
          questionId: questionIds[at],
          stepId: stepIds[at],
          stepTitle: "phase",
          prompt: "Who is doing this one?",
          answer: said,
        },
      ]),
    );

  it("A PHASE THE ESTIMATE ALREADY HAS is seen, settled once the gate agreed, and reckoned as priced (X17)", async () => {
    const interviewId = await aWalk();
    const first = (await run((tx) => getWalk(tx, tenantId, interviewId)))!;
    const estimateId = first.interview.estimateId;
    /** An item named after the assembly the Drywall step is pinned to, with a line off the model. */
    await run(async (tx) => {
      const asm = await tx
        .insert(schema.jobAssemblies)
        .values({ tenantId, name: "Drywall, hang and finish" })
        .returning();
      await tx
        .update(schema.jobEstimateOutlineSteps)
        .set({ assemblyId: asm[0].id })
        .where(eq(schema.jobEstimateOutlineSteps.id, stepIds[1]));
      const g = await tx
        .insert(schema.jobEstimateGroups)
        .values({ tenantId, estimateId, name: "Drywall, hang and finish" })
        .returning();
      await tx.insert(schema.jobEstimateLines).values({
        tenantId,
        estimateId,
        groupId: g[0].id,
        description: "Hang, tape and finish",
        unit: "sf",
        quantityThousandths: 3_708_000,
        unitCostCents: 150,
        basis: "assembly",
        basisDetail: "Drywall, hang and finish at 3,708 sf · off the model: Wall Schedule",
      });
    });

    const walk = (await run((tx) => getWalk(tx, tenantId, interviewId)))!;
    expect(walk.onEstimate.map((l) => [l.groupName, l.costCents])).toEqual([
      ["Drywall, hang and finish", 556_200],
    ]);
    const drywall = walk.steps[1];
    expect(coverageOf(walk.steps[0], walk.onEstimate, walk.assemblyNames)).toBeNull();
    const cov = coverageOf(drywall, walk.onEstimate, walk.assemblyNames);
    expect(cov?.costCents).toBe(556_200);
    expect(cov?.from).toBe("off the model");

    /** Nothing is settled until the gate agreed, and then every question but a must-ask. */
    const answers = asWalkAnswers(walk.answers);
    expect(await run((tx) => settleCovered(tx, ctx, interviewId, drywall, answers, null, cov, "$"))).toBe(0);
    expect(await run((tx) => settleCovered(tx, ctx, interviewId, drywall, answers, true, cov, "$"))).toBe(1);
    const after = (await run((tx) => getWalk(tx, tenantId, interviewId)))!;
    expect(after.answers.filter((a) => a.stepId === stepIds[1]).map((a) => [a.skipped, a.skipReason])).toEqual([
      [true, "already on the estimate — $5,562.00 in 1 line, off the model"],
    ]);
    /** And again settles nothing: it reads what is outstanding. */
    expect(
      await run((tx) => settleCovered(tx, ctx, interviewId, drywall, asWalkAnswers(after.answers), true, cov, "$")),
    ).toBe(0);

    const reckoning = await run((tx) =>
      reckoningFor(tx, tenantId, {
        interviewId,
        projectId,
        estimateId,
        steps: after.steps,
        answers: asWalkAnswers(after.answers),
      }),
    );
    const step = reckoning.steps.find((s) => s.stepId === stepIds[1])!;
    expect([step.standing, step.amountCents, step.detail]).toEqual([
      "priced",
      556_200,
      "1 line already on the estimate, off the model",
    ]);
  });

  it("A PERSON PICKS A FINISHED WALK BACK UP; the walk itself cannot", async () => {
    const interviewId = await aWalk();
    await answerStep(interviewId, 1, "In-house");
    await run((tx) => closeWalk(tx, ctx, interviewId, "finished"));

    /**
     * The state the founder was in: a closed walk with the reckoning in front
     * of him naming a phase nobody had answered. Before this, both of these
     * threw and the two buttons were hidden rather than offered.
     */
    await expect(
      run((tx) => claimTurn(tx, ctx, interviewId)),
    ).rejects.toThrow(JobsError);
    await expect(answerStep(interviewId, 0, "In-house")).rejects.toThrow(JobsError);

    const back = await run(async (tx) => {
      await goToStep(tx, ctx, interviewId, stepIds[0]);
      return getWalk(tx, ctx.tenantId, interviewId);
    });
    expect(back?.interview.status).toBe("running");
    expect(back?.interview.finishedAt).toBeNull();
    expect(back?.step?.id).toBe(stepIds[0]);
    /** And now the walk may write, because there is a walk again. */
    await expect(run((tx) => claimTurn(tx, ctx, interviewId))).resolves.toBeDefined();
  });

  it("ASKING AGAIN re-opens the phase of a finished walk, and resumes it", async () => {
    const interviewId = await aWalk();
    for (const at of [0, 1, 2]) await answerStep(interviewId, at, "In-house");
    await run((tx) => closeWalk(tx, ctx, interviewId, "finished"));

    /**
     * **THE ONLY DOOR INTO A PHASE OF A FINISHED WALK.** Every one of them is
     * covered by definition, so no bookmark sticks to any of them until an
     * answer stops standing — which is exactly what superseding does.
     */
    const where = await run((tx) =>
      reopenQuestion(tx, ctx, interviewId, questionIds[1]),
    );
    expect(where.resumed).toBe(true);
    expect(where.stepId).toBe(stepIds[1]);

    const after = await run((tx) => getWalk(tx, ctx.tenantId, interviewId));
    expect(after?.interview.status).toBe("running");
    expect(after?.step?.id).toBe(stepIds[1]);
    const answers = asWalkAnswers(after!.answers);
    expect(stepIsCovered(after!.steps[1], answers)).toBe(false);
    /** The transcript still says what was said at the time. */
    expect(after!.answers.filter((a) => a.questionId === questionIds[1])).toHaveLength(1);
  });

  it("AN ABANDONED WALK STAYS ABANDONED — somebody stopped that one", async () => {
    const interviewId = await aWalk();
    await answerStep(interviewId, 0, "In-house");
    await run((tx) => closeWalk(tx, ctx, interviewId, "abandoned"));

    await expect(
      run((tx) => goToStep(tx, ctx, interviewId, stepIds[1])),
    ).rejects.toThrow(JobsError);
    const after = await run((tx) => getWalk(tx, ctx.tenantId, interviewId));
    expect(after?.interview.status).toBe("abandoned");
  });

  /**
   * THE MONEY BUG UNDER THE WAY BACK IN. Found by driving it: ask a phase
   * again, answer it, price it, and the estimate grew a SECOND `Landscaping`
   * beside the first — both in the total.
   */
  it("A PHASE WALKED TWICE IS ONE ITEM, and the second lot of lines replaces the first", async () => {
    const estimateId = await run(async (tx) => {
      const estimate = await createEstimate(tx, ctx, {
        projectId,
        number: `WALK-EST-${(walkSeq += 1)}`,
      });
      return estimate.id;
    });
    const interviewId = await run(async (tx) => {
      const walk = await startWalk(tx, ctx, { estimateId, outlineId });
      return walk.id;
    });
    const step = await run(async (tx) => {
      const walk = await getWalk(tx, ctx.tenantId, interviewId);
      return walk!.steps[1];
    });

    const put = async (description: string, cents: number) =>
      run(async (tx) => {
        await proposeLines(tx, ctx, {
          interviewId,
          step,
          shapes: [{ description, unit: "ls", quantityThousandths: 1_000 }],
          answers: [`we charge ${cents / 100} for that`],
          today: "2026-09-21",
        });
        /** Typed as the walk would after asking, so the line carries money. */
        await tx
          .update(schema.jobEstimateProposedLines)
          .set({ unitCostCents: cents, basis: "said" })
          .where(eq(schema.jobEstimateProposedLines.interviewId, interviewId));
        return applyProposal(tx, ctx, { interviewId, estimateId, stepId: step.id });
      });

    await put("Hang and finish, first pass", 120_000);
    const twice = await put("Hang and finish, as re-walked", 250_000);

    const estimate = await run((tx) => getEstimate(tx, ctx.tenantId, estimateId));
    const items = estimate!.groups.filter((g) => g.name === "Drywall");
    expect(items).toHaveLength(1);
    expect(twice.groupName).toBe("Drywall");

    const lines = estimate!.lines.filter((l) => l.groupId === items[0].id);
    expect(lines.map((l) => l.description)).toEqual(["Hang and finish, as re-walked"]);
    expect(lines[0].unitCostCents).toBe(250_000);

    /** And the row that landed knows which line it became, so the reckoning
     *  can read the money through it. */
    const left = await run((tx) => listProposal(tx, ctx.tenantId, interviewId, step.id));
    expect(left).toHaveLength(0);
  });
});
