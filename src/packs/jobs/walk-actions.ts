"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { logAuditInTx } from "@/lib/audit";
import { labelFor } from "@/lib/packs/resolve";
import { packContext } from "@/lib/packs/tenant-context";
import { takeWalkTurn, walkSystemPrompt } from "./ai/walk";
import { proposeSystemPrompt, takeProposal } from "./ai/propose";
import { listAssemblies } from "./assembly-ops";
import { listCostCodes } from "./ops";
import { applyProposal, proposeLines } from "./walk-lines-ops";
import { JobsError, type JobsCtx } from "./ops";
import { interviewGateFrom } from "./interview-gate";
import {
  asWalkAnswers,
  claimTurn,
  goToStep,
  reopenQuestion,
  closeWalk,
  getWalk,
  moveToStep,
  readAnswers,
  readInterview,
  recordAnswers,
  savePendingTurn,
  startWalk,
  walkViewFrom,
} from "./walk-ops";
import { reckoningFor } from "./walk-reckoning-ops";
import { currentStep, live, nextStep, type WalkAnswer } from "./walk-math";
import { PACK } from "./vocabulary";

/**
 * THE WALK'S DOORS (X2a, ADR 0098).
 *
 * ── THE HOUSE PATTERN, IN THREE ACTS ────────────────────────────────────────
 *
 * `takeWalkTurnAction` is the one that matters and the shape is the setup
 * interview's: **gather and claim in one transaction, call the model with no
 * transaction open, persist in another.** Holding a transaction across model
 * latency is how a pool dies, and a walk is forty-five minutes of them.
 *
 * ── THE GATE IS CHECKED AT EVERY DOOR ───────────────────────────────────────
 *
 * Not only on the page. A business whose grant is withdrawn mid-walk stops
 * being able to take a turn, which is what "a layer that can be turned off"
 * has to mean if it means anything.
 */

const BASE = "/dashboard/m/jobs";

interface WalkCtx extends JobsCtx {
  /** Carried from the gate so nothing has to call `requireTenant` again
   *  inside an open transaction. Blank when the tenant has no profile. */
  industry: string;
}

async function gate(): Promise<WalkCtx> {
  const tenant = await requireTenant();
  await requireModuleEnabled(tenant.tenant.id, PACK);
  return {
    tenantId: tenant.tenant.id,
    userId: tenant.userId,
    role: tenant.role,
    industry: tenant.tenant.industry ?? "",
  };
}

function sentence(message: string): string {
  const m = message.trim();
  return m.charAt(0).toUpperCase() + m.slice(1) + (m.endsWith(".") ? "" : ".");
}

function toResult(err: unknown): { error: string } {
  if (err instanceof JobsError) {
    switch (err.code) {
      case "FORBIDDEN":
        return { error: "You cannot change this estimate." };
      case "NOT_FOUND":
        return { error: "That walk is no longer here. Reload the page." };
      case "ESTIMATE_ACCEPTED":
        return { error: sentence(err.message) };
      case "WALK_RUNNING":
        return { error: "Somebody is already walking this estimate." };
      case "WALK_CLOSED":
        return { error: "This walk is finished. Start a new one to go again." };
      case "WALK_COOLDOWN":
        return { error: "Give it a moment, then send that again." };
      case "WALK_CAPPED":
        return { error: "That is as long as one walk goes. Finish it and start another." };
      case "MUST_ASK":
        return { error: sentence(err.message) };
      case "INVALID_VALUE":
        return { error: sentence(err.message) };
      default:
        return { error: "That did not work. Try again." };
    }
  }
  /** An API key that is not set, a model that is down: say so honestly. */
  if (err instanceof Error && err.message.includes("ANTHROPIC_API_KEY")) {
    return { error: "Walking an estimate is not switched on for this server yet." };
  }
  return { error: "It could not answer just then. Try sending that again." };
}

/**
 * The layer's own gate, at every door and not only on the page. A business
 * whose grant is withdrawn mid-walk stops being able to take a turn, which is
 * what "a layer that can be turned off" has to mean if it means anything.
 *
 * **A TURN DOES NOT CALL THIS**, and that is a speed fix rather than a hole:
 * `oneTurn` reads `packContext` anyway, so checking there costs nothing where
 * this cost a whole extra transaction on every exchange of a forty-five
 * minute conversation.
 */
async function requireWalkGranted(ctx: WalkCtx): Promise<void> {
  const available = await withTenant(
    ctx.tenantId,
    async (tx) => {
      const pack = await packContext(tx, ctx.tenantId, ctx.industry, PACK);
      return interviewGateFrom(pack.config).available;
    },
    { role: ctx.role },
  );
  if (!available) throw new JobsError("NOT_FOUND", "walking an estimate is not switched on");
}

/** The same refusal, from a `packContext` the caller already has. */
function requireGrantedFrom(config: unknown): void {
  if (!interviewGateFrom(config).available) {
    throw new JobsError("NOT_FOUND", "walking an estimate is not switched on");
  }
}

const startSchema = z.object({
  estimateId: z.string().uuid(),
  outlineId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export async function startWalkAction(input: unknown) {
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await requireWalkGranted(ctx);
    const walk = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const started = await startWalk(tx, ctx, {
          estimateId: parsed.data.estimateId,
          outlineId: parsed.data.outlineId,
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_walk.started",
          targetType: "job_estimate",
          targetId: parsed.data.estimateId,
          meta: { outlineId: parsed.data.outlineId },
        });
        return started;
      },
      { role: ctx.role },
    );
    /**
     * THE OPENING QUESTION, asked here so the screen arrives with something on
     * it. A failure is not fatal to the start: the walk exists either way, and
     * the screen can ask again.
     */
    try {
      await runTurn(ctx, walk.id, undefined);
    } catch {
      // The walk stands; its first question can be asked from the screen.
    }
    revalidatePath(`${BASE}/${parsed.data.projectId}/estimates/${parsed.data.estimateId}`, "layout");
    return { ok: true as const, interviewId: walk.id };
  } catch (err) {
    return toResult(err);
  }
}

const turnSchema = z.object({
  interviewId: z.string().uuid(),
  /** Blank on the first turn of a step: the walk opens the conversation. */
  said: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid(),
  estimateId: z.string().uuid(),
});

/** How much of the earlier steps goes into the prompt as context. */
const EARLIER_CONTEXT = 30;

/**
 * ONE TURN, shared by the two doors that need one.
 *
 * **THE OPENING QUESTION IS ASKED BY THE SERVER**, when the walk starts,
 * rather than by the screen on mount. The first draft had the component fire
 * a turn from an effect and it was wrong twice over: `setState` inside an
 * effect is an error in this repo (cascading renders), and a screen that has
 * to bootstrap itself shows an empty panel for as long as the model takes. A
 * walk now arrives already asking something.
 */
async function oneTurn(
  ctx: WalkCtx,
  interviewId: string,
  said: string | undefined,
  opts: { ignoreCooldown?: boolean } = {},
) {
  {

    /* ── Act one: gather and claim, in one transaction ───────────────────── */
    const gathered = await withTenant(
      ctx.tenantId,
      async (tx) => {
        await claimTurn(tx, ctx, interviewId, opts);
        const walk = await getWalk(tx, ctx.tenantId, interviewId);
        if (!walk) throw new JobsError("NOT_FOUND", "that walk is no longer here");
        const pack = await packContext(tx, ctx.tenantId, ctx.industry, PACK);
        requireGrantedFrom(pack.config);
        const estimate = await tx.query.jobEstimates.findFirst({
          where: (e, { and: a, eq: q }) =>
            a(q(e.tenantId, ctx.tenantId), q(e.id, walk.interview.estimateId)),
          columns: { number: true, projectId: true },
        });
        const project = estimate
          ? await tx.query.jobProjects.findFirst({
              where: (p, { and: a, eq: q }) =>
                a(q(p.tenantId, ctx.tenantId), q(p.id, estimate.projectId)),
              columns: { name: true, number: true },
            })
          : null;
        return {
          walk,
          labels: pack.labels,
          estimateNumber: estimate?.number ?? "",
          jobName: project ? `${project.number} ${project.name}` : "",
          pendingSay: walk.interview.pendingSay,
        };
      },
      { role: ctx.role },
    );

    /**
     * **COVERAGE IS NOT THE END OF THE WALK**, and driving it is what found
     * this. `currentStep` goes null the moment every outline question is
     * settled, and the first draft closed the walk right there — mid-sentence,
     * with *"what's the cast-in-place work on this one, slab, footings, piers
     * or all of it?"* still on the screen and the header already reading
     * `Finished`.
     *
     * The outline is a FLOOR. A walk ends when it says it is done and is not
     * asking anything, which is the `stepDone` branch below; until then it
     * stays on the last step so it can keep going past the list. An outline
     * with no steps at all is the only thing that ends here.
     */
    /** `loadWalk` already rides out the last step while the walk is running,
     *  so a null here means an outline with nothing in it. */
    const step = gathered.walk.step;
    if (!step) {
      await withTenant(ctx.tenantId, (tx) => closeWalk(tx, ctx, interviewId, "finished"), {
        role: ctx.role,
      });
      return { ok: true as const, view: null, finished: true as const };
    }

    const asWalk: WalkAnswer[] = live(asWalkAnswers(gathered.walk.answers));
    const settledHere = asWalk.filter((a) => a.stepId === step.id);
    const earlier = asWalk.filter((a) => a.stepId !== step.id).slice(-EARLIER_CONTEXT);
    const stepNumber = gathered.walk.steps.findIndex((s) => s.id === step.id) + 1;

    const system = walkSystemPrompt({
      jobName: gathered.jobName,
      estimateNumber: gathered.estimateNumber,
      outlineName: gathered.walk.outlineName,
      step,
      stepNumber,
      stepCount: gathered.walk.steps.length,
      settledHere,
      earlier,
      projectWord: labelFor(gathered.labels, "project", "Project"),
    });

    /* ── Act two: the model, with NO transaction open ─────────────────────── */
    const history: { role: "user" | "assistant"; content: string }[] = [];
    if (gathered.pendingSay.trim() !== "") {
      history.push({ role: "assistant", content: gathered.pendingSay });
    }
    if (said && said.trim() !== "") history.push({ role: "user", content: said.trim() });

    const turn = await takeWalkTurn({ system, history, step });
    if (!turn) return { error: "It could not answer just then. Try sending that again." };

    /* ── Act three: persist ──────────────────────────────────────────────── */
    const after = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const entries = [
          ...turn.record.map((r) => ({
            questionId: r.questionId ?? null,
            stepId: step.id,
            stepTitle: step.title,
            prompt: r.prompt,
            answer: r.answer,
          })),
          ...turn.skip.map((sk) => ({
            questionId: sk.questionId,
            stepId: step.id,
            stepTitle: step.title,
            prompt:
              step.questions.find((q) => q.id === sk.questionId)?.prompt ?? "a question",
            skipped: true,
            skipReason: sk.reason,
          })),
        ];
        if (entries.length > 0) {
          await recordAnswers(tx, ctx, interviewId, entries, { steps: gathered.walk.steps });
        }

        await savePendingTurn(tx, ctx, interviewId, {
          say: turn.say,
          questionId: turn.askingQuestionId ?? null,
          quickReplies: turn.quickReplies,
        });

        /**
         * **ONLY WHAT CHANGED IS READ BACK.** This called `getWalk` three
         * times — the whole outline, its questions and every answer, five
         * queries each, on every exchange. The steps are act one's and the
         * outline cannot have moved since; the answers and the interview row
         * are the only things this transaction touched.
         */
        const steps = gathered.walk.steps;
        const outlineName = gathered.walk.outlineName;
        let interview = await readInterview(tx, ctx.tenantId, interviewId);
        const answerRows = await readAnswers(tx, ctx.tenantId, interviewId);
        if (!interview) return null;

        /**
         * MOVING ON IS A REQUEST, NOT A DECISION. `moveToStep` refuses while
         * a must-ask question of this step is outstanding, so the walk cannot
         * talk its way past one by claiming it is done.
         */
        if (turn.stepDone) {
          const answers = asWalkAnswers(answerRows);
          const onward = nextStep(steps, answers, step.id);
          const here = currentStep(steps, answers, step.id);
          if (!here || here.id !== step.id) {
            interview = await moveToStep(tx, ctx, interviewId, onward?.id ?? null);
            if (!onward) interview = await closeWalk(tx, ctx, interviewId, "finished");
          }
        }
        return { steps, outlineName, interview, answerRows };
      },
      { role: ctx.role },
    );

    return {
      ok: true as const,
      /** The whole fresh view, so the screen needs no second round trip. */
      view: after
        ? walkViewFrom(after.steps, after.outlineName, after.interview, after.answerRows)
        : null,
      finished: after?.interview.status !== "running",
      /** The step this turn was ABOUT, so a caller can see it has moved on. */
      ranOn: step.id,
    };
  }
}

/**
 * A TURN, AND THE OPENING QUESTION OF THE NEXT STEP WHEN THIS ONE ENDS.
 *
 * Driving it found the reason: asked to move on, the model set `stepDone`
 * AND asked a follow-up in the same breath, so the screen showed *"Cast in
 * place concrete, step 2 of 2"* over a question about the framing. Both
 * halves of what it said were honoured and they contradicted each other.
 *
 * **A STEP IS NOT DONE IF SOMETHING IS STILL BEING ASKED.** So when the step
 * changes, the question left pending belonged to the step just closed, and a
 * second turn is taken immediately to ask the new step's own first question.
 * One logical turn, two calls; the cooldown is waived for the second because
 * nobody is hammering anything.
 */
async function runTurn(ctx: WalkCtx, interviewId: string, said: string | undefined) {
  const first = await oneTurn(ctx, interviewId, said);
  if (!first.ok || first.finished || !first.view) return first;
  const movedOn = first.view.stepTitle !== "" && first.ranOn !== undefined;
  if (!movedOn) return first;

  /** Did the step actually change? Compare what it ran on with where it is. */
  const stillHere = await withTenant(
    ctx.tenantId,
    async (tx) => {
      const walk = await getWalk(tx, ctx.tenantId, interviewId);
      return walk?.step?.id ?? null;
    },
    { role: ctx.role },
  );
  /** `null` means coverage is complete and the walk is riding out the last
   *  step; that is not a transition and needs no second turn. */
  if (stillHere === first.ranOn || stillHere === null) return first;

  const second = await oneTurn(ctx, interviewId, undefined, { ignoreCooldown: true });
  return second.ok ? second : first;
}

export async function takeWalkTurnAction(input: unknown) {
  const parsed = turnSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    /** The grant is checked inside the turn, off a read it makes anyway. */
    const out = await runTurn(ctx, parsed.data.interviewId, parsed.data.said);
    /**
     * **NO `revalidatePath` ON A TURN.** It was here out of habit and it was
     * expensive: `"layout"` invalidates the whole estimate subtree, and the
     * estimate page's loader is the heaviest in the pack — the price book up
     * to six hundred rows, the assembly library, the client links, the cost
     * codes. X2a writes no lines, so **nothing on that page has changed**,
     * and the turn hands the screen its own fresh view anyway. Starting and
     * closing a walk still revalidate, because the banner is on that page.
     */
    return out;
  } catch (err) {
    return toResult(err);
  }
}

const skipSchema = z.object({
  interviewId: z.string().uuid(),
  questionId: z.string().uuid(),
  projectId: z.string().uuid(),
  estimateId: z.string().uuid(),
});

/**
 * A PERSON skipping a question, which is a different act from the walk doing
 * it — a person may skip one marked always-ask, because the mark guards
 * against judgement and not against a decision made with eyes open.
 */
export async function skipQuestionAction(input: unknown) {
  const parsed = skipSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await requireWalkGranted(ctx);
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        const walk = await getWalk(tx, ctx.tenantId, parsed.data.interviewId);
        if (!walk?.step) throw new JobsError("NOT_FOUND", "that walk is no longer here");
        const question = walk.step.questions.find((q) => q.id === parsed.data.questionId);
        if (!question) throw new JobsError("NOT_FOUND", "that question is not on this step");
        await recordAnswers(
          tx,
          ctx,
          parsed.data.interviewId,
          [
            {
              questionId: question.id,
              stepId: walk.step.id,
              stepTitle: walk.step.title,
              prompt: question.prompt,
              skipped: true,
              skipReason: "passed over by the estimator",
            },
          ],
          { byPerson: true },
        );
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}/estimates/${parsed.data.estimateId}`, "layout");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

const closeSchema = z.object({
  interviewId: z.string().uuid(),
  status: z.enum(["finished", "abandoned"]),
  projectId: z.string().uuid(),
  estimateId: z.string().uuid(),
});

export async function closeWalkAction(input: unknown) {
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await withTenant(
      ctx.tenantId,
      async (tx) => {
        await closeWalk(tx, ctx, parsed.data.interviewId, parsed.data.status);
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: `jobs.estimate_walk.${parsed.data.status}`,
          targetType: "job_estimate",
          targetId: parsed.data.estimateId,
        });
      },
      { role: ctx.role },
    );
    revalidatePath(`${BASE}/${parsed.data.projectId}/estimates/${parsed.data.estimateId}`, "layout");
    return { ok: true as const };
  } catch (err) {
    return toResult(err);
  }
}

/* ------------------------------------------------------------------------
 * WHAT A STEP COMES TO (X2b, ADR 0098).
 *
 * The same three acts as a turn — gather and claim, call the model with no
 * transaction open, persist — because it is the same hazard.
 * ---------------------------------------------------------------------- */

const proposeSchema = z.object({
  interviewId: z.string().uuid(),
  projectId: z.string().uuid(),
  estimateId: z.string().uuid(),
});

export async function proposeStepAction(input: unknown) {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();

    const gathered = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const pack = await packContext(tx, ctx.tenantId, ctx.industry, PACK);
        requireGrantedFrom(pack.config);
        await claimTurn(tx, ctx, parsed.data.interviewId, { ignoreCooldown: true });
        const walk = await getWalk(tx, ctx.tenantId, parsed.data.interviewId);
        if (!walk?.step) throw new JobsError("NOT_FOUND", "that walk is no longer here");
        const estimate = await tx.query.jobEstimates.findFirst({
          where: (e, { and: a, eq: q }) =>
            a(q(e.tenantId, ctx.tenantId), q(e.id, walk.interview.estimateId)),
          columns: { projectId: true },
        });
        const project = estimate
          ? await tx.query.jobProjects.findFirst({
              where: (p, { and: a, eq: q }) =>
                a(q(p.tenantId, ctx.tenantId), q(p.id, estimate.projectId)),
              columns: { id: true, name: true, number: true, costCodeSetId: true },
            })
          : null;
        const assemblies = await listAssemblies(tx, ctx.tenantId);
        const codes = project?.costCodeSetId
          ? await listCostCodes(tx, ctx.tenantId, project.costCodeSetId)
          : [];
        return {
          walk,
          step: walk.step,
          labels: pack.labels,
          jobName: project ? `${project.number} ${project.name}` : "",
          projectId: project?.id,
          assemblies: assemblies.map((a) => ({
            name: a.assembly.name,
            per:
              a.assembly.drivingQuantityThousandths === 1000 && a.assembly.drivingUnit === ""
                ? "each"
                : `per ${a.assembly.drivingQuantityThousandths / 1000} ${a.assembly.drivingUnit}`.trim(),
          })),
          costCodes: codes
            .filter((c) => c.isActive)
            .map((c) => ({ code: c.code, name: c.name })),
        };
      },
      { role: ctx.role },
    );

    const here = gathered.walk.answers.filter((a) => a.stepId === gathered.step.id);
    const system = proposeSystemPrompt({
      projectWord: labelFor(gathered.labels, "project", "Project"),
      jobName: gathered.jobName,
      step: gathered.step,
      answers: live(asWalkAnswers(here)),
      assemblies: gathered.assemblies,
      costCodes: gathered.costCodes,
    });

    const proposal = await takeProposal({ system });
    if (!proposal) return { error: "It could not work that out just then. Try again." };

    const rows = await withTenant(
      ctx.tenantId,
      (tx) =>
        proposeLines(tx, ctx, {
          interviewId: parsed.data.interviewId,
          step: gathered.step,
          shapes: proposal.lines,
          /** Only what was actually SAID counts as having been said. */
          answers: here.filter((a) => !a.skipped).map((a) => a.answer),
          today: new Date().toISOString().slice(0, 10),
          projectId: gathered.projectId,
        }),
      { role: ctx.role },
    );

    return {
      ok: true as const,
      excluded: proposal.excluded,
      lines: rows.map((r) => ({
        id: r.id,
        description: r.description,
        unit: r.unit,
        quantityThousandths: r.quantityThousandths,
        unitCostCents: r.unitCostCents,
        costCode: r.costCode,
        basis: r.basis,
        basisDetail: r.basisDetail,
        quantityBasis: r.quantityBasis,
        quantityNote: r.quantityNote,
      })),
    };
  } catch (err) {
    return toResult(err);
  }
}

export async function applyStepAction(input: unknown) {
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const applied = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const walk = await getWalk(tx, ctx.tenantId, parsed.data.interviewId);
        if (!walk) throw new JobsError("NOT_FOUND", "that walk is no longer here");
        const out = await applyProposal(tx, ctx, {
          interviewId: parsed.data.interviewId,
          estimateId: walk.interview.estimateId,
          stepId: walk.step?.id ?? null,
        });
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_walk.applied",
          targetType: "job_estimate",
          targetId: walk.interview.estimateId,
          meta: { item: out.groupName, lines: out.lines },
        });
        return out;
      },
      { role: ctx.role },
    );
    /** This one DOES change the estimate, so the page behind is stale. */
    revalidatePath(
      `${BASE}/${parsed.data.projectId}/estimates/${parsed.data.estimateId}`,
      "layout",
    );
    return { ok: true as const, ...applied };
  } catch (err) {
    return toResult(err);
  }
}


/* ------------------------------------------------------------------------
 * THE WHOLE BID, AND THE WAY BACK INTO IT (X4, ADR 0098).
 * ---------------------------------------------------------------------- */

const reckonSchema = z.object({
  interviewId: z.string().uuid(),
  projectId: z.string().uuid(),
});

/**
 * **A DOOR OF ITS OWN, AND DELIBERATELY NOT PART OF A TURN.** The founder's
 * word on the first version of this walk was that it felt slow, and the fix
 * was to stop doing anything on a turn that the turn did not need. A
 * reckoning is five indexed reads; folding them into every exchange would
 * put them on the critical path of a conversation forty-five minutes long.
 *
 * The screen calls this AFTER a turn has already landed, without waiting, so
 * the panel catches up a beat later and nothing on screen is ever blocked on
 * it.
 */
export async function reckonWalkAction(input: unknown) {
  const parsed = reckonSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    const reckoning = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const pack = await packContext(tx, ctx.tenantId, ctx.industry, PACK);
        requireGrantedFrom(pack.config);
        const walk = await getWalk(tx, ctx.tenantId, parsed.data.interviewId);
        if (!walk) throw new JobsError("NOT_FOUND", "that walk is no longer here");
        return reckoningFor(tx, ctx.tenantId, {
          interviewId: parsed.data.interviewId,
          projectId: parsed.data.projectId,
          steps: walk.steps,
          answers: asWalkAnswers(walk.answers),
        });
      },
      { role: ctx.role },
    );
    return { ok: true as const, reckoning };
  } catch (err) {
    return toResult(err);
  }
}

const goToStepSchema = z.object({
  interviewId: z.string().uuid(),
  stepId: z.string().uuid(),
  projectId: z.string().uuid(),
  estimateId: z.string().uuid(),
});

/** Put the walk on a step and ask that step's question. */
export async function goToStepAction(input: unknown) {
  const parsed = goToStepSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await requireWalkGranted(ctx);
    await withTenant(
      ctx.tenantId,
      (tx) => goToStep(tx, ctx, parsed.data.interviewId, parsed.data.stepId),
      { role: ctx.role },
    );
    /** Nobody is hammering anything: this is one click, not a conversation. */
    const out = await oneTurn(ctx, parsed.data.interviewId, undefined, {
      ignoreCooldown: true,
    });
    return { ok: true as const, view: out.view };
  } catch (err) {
    return toResult(err);
  }
}

const askAgainSchema = z.object({
  interviewId: z.string().uuid(),
  questionId: z.string().uuid(),
  projectId: z.string().uuid(),
  estimateId: z.string().uuid(),
});

/**
 * ASK ME THAT ONE AGAIN. Supersedes the answer, which re-opens its step, and
 * takes a turn there so the question is on the screen when the click lands.
 */
export async function askAgainAction(input: unknown) {
  const parsed = askAgainSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again." };
  try {
    const ctx = await gate();
    await requireWalkGranted(ctx);
    const where = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const out = await reopenQuestion(
          tx,
          ctx,
          parsed.data.interviewId,
          parsed.data.questionId,
        );
        await logAuditInTx(tx, {
          tenantId: ctx.tenantId,
          actorClerkUserId: ctx.userId,
          action: "jobs.estimate_walk.reopened",
          targetType: "job_estimate_interview",
          targetId: parsed.data.interviewId,
          meta: { questionId: parsed.data.questionId },
        });
        return out;
      },
      { role: ctx.role },
    );
    const out = await oneTurn(ctx, parsed.data.interviewId, undefined, {
      ignoreCooldown: true,
    });
    return { ok: true as const, view: out.view, prompt: where.prompt };
  } catch (err) {
    return toResult(err);
  }
}
