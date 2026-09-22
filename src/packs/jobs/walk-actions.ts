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
import { applyProposal, listProposal, proposeLines } from "./walk-lines-ops";
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
  readPendingPrice,
  recordAnswers,
  askTheUsual,
  recordUsual,
  settleStandards,
  savePendingTurn,
  startWalk,
  walkView,
  walkViewFrom,
  type WalkView,
  settleCovered,
} from "./walk-ops";
import { outlineCanCarry, outlineTurn } from "./walk-fallback";
import { priceQuestionFor, readPriceReply } from "./walk-price-math";
import {
  askNextPrice,
  passPrice,
  pendingPriceLine,
  recordSaidPrice,
  setPriceAsk,
} from "./walk-price-ops";
import { reckoningFor } from "./walk-reckoning-ops";
import { measureLines, measureQuestionFor, readMeasureReply } from "./measure-math";
import { parseRoomList, roomLines } from "./room-math";
import { addRoomList, asRoomFacts } from "./room-ops";
import { MAX_SCHEDULE_CHARS } from "./bim-schedule";
import {
  importSchedule,
  previewSchedule,
  type ScheduleImportResult,
  type SchedulePreview,
} from "./bim-schedule-ops";
import { asTaken, recordMeasurement } from "./measure-ops";
import {
  askNextMeasure,
  clearMeasureAsk,
  finishMeasuring,
  markRoomsAsked,
  passWalkMeasurement,
  pendingMeasure,
  recordWalkMeasurement,
  setMeasureAsk,
} from "./walk-measure-ops";
import {
  currentStep,
  live,
  onwardStep,
  outstanding,
  type WalkAnswer,
  type WalkStep,
} from "./walk-math";
import {
  groupStandards,
  refusesTheUsual,
  standardsIn,
  usualLines,
  usualSize,
} from "./usual-math";
import { coverageLines, coverageOf, coveredPhases } from "./walk-coverage";
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
  /** The tenant's currency symbol, for money the walk says out loud (X17). */
  symbol: string | null;
}

async function gate(): Promise<WalkCtx> {
  const tenant = await requireTenant();
  await requireModuleEnabled(tenant.tenant.id, PACK);
  return {
    tenantId: tenant.tenant.id,
    userId: tenant.userId,
    role: tenant.role,
    industry: tenant.tenant.industry ?? "",
    symbol: tenant.tenant.currencySymbol ?? null,
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
     * **MEASURE THE BUILDING FIRST, WHEN THE OUTLINE ASKS FOR NUMBERS (X7).**
     * The conversation starts once they are in, because every question
     * after this one can then use them instead of asking again.
     *
     * THE OPENING QUESTION, otherwise, asked here so the screen arrives with
     * something on it. A failure of either is not fatal to the start: the
     * walk exists either way, and the screen can ask again.
     */
    try {
      const measuring = await startMeasuring(ctx, walk.id);
      if (!measuring) await runTurn(ctx, walk.id, undefined);
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
  /**
   * **THE QUESTION THE PERSON BELIEVED THEY WERE ANSWERING**, in the words
   * they read. The server holds the pending question too, and when the two
   * disagree the screen is stale — which is how an answer came to land on a
   * question nobody had seen. Absent on the opening turn of a walk, which
   * answers nothing.
   */
  answering: z.string().trim().max(2000).optional(),
  projectId: z.string().uuid(),
  estimateId: z.string().uuid(),
});

/** Two prompts are the same question when they read the same. */
function sameQuestion(a: string, b: string): boolean {
  const flat = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
  return flat(a) === flat(b);
}

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
  opts: { ignoreCooldown?: boolean; answering?: string } = {},
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
        /**
         * **WHAT NEVER VARIES IS SETTLED AS THE PHASE OPENS** (X13), inside
         * the same transaction that read the walk, so the turn that follows
         * sees the phase as it now stands rather than asking a question that
         * is already answered.
         *
         * Idempotent — it reads what is still OUTSTANDING — so this costs a
         * re-read only on the turn that actually settles something, and
         * nothing at all on an outline with no standards or a walk whose
         * person asked to be asked everything.
         */
        const settled = walk.step
          ? await settleStandards(
              tx,
              ctx,
              interviewId,
              walk.step,
              asWalkAnswers(walk.answers),
              walk.interview.usualAccepted,
            )
          : 0;
        let after = settled > 0 ? await getWalk(tx, ctx.tenantId, interviewId) : walk;

        /**
         * **AND A PHASE THE ESTIMATE ALREADY HAS IS SETTLED THE SAME WAY**
         * (X17): its questions skipped with the reason on them, once the
         * gate agreed, every one but a must-ask. Read off the answers as
         * they stand AFTER the standards, so nothing is answered twice.
         */
        const coverage = walk.step ? coverageOf(walk.step, walk.onEstimate, walk.assemblyNames) : null;
        const settledCovered =
          walk.step && coverage && after
            ? await settleCovered(
                tx,
                ctx,
                interviewId,
                walk.step,
                asWalkAnswers(after.answers),
                walk.interview.usualAccepted,
                coverage,
                ctx.symbol,
              )
            : 0;
        if (settledCovered > 0) after = await getWalk(tx, ctx.tenantId, interviewId);

        /**
         * **AND A PHASE THE STANDARDS JUST FINISHED STILL ENDS IN MONEY.**
         *
         * Driving a whole bid is what found this. Step 2's only question had
         * a standard, so settling covered it, `currentStep` moved to step 3,
         * and the turn was ABOUT step 3 — which meant nothing ever priced
         * step 2. The walk went 1 → 3 and the estimate had one item on it.
         *
         * The worst possible shape: the standards cover the 80%, so the 80%
         * was exactly what stopped producing money. X6's rule is that a
         * phase ends in money, and a phase nobody had to talk about is still
         * a phase.
         *
         * So the turn STOPS here and says the step is finished. `runTurn`
         * already knows what to do with that — price it, ask for what it
         * cannot find, put the item on — and the walk carries on from there.
         * It also costs no model call at all, which is the point of a phase
         * that needed no conversation.
         */
        const coveredByStandards =
          settled + settledCovered > 0 && walk.step && after
            ? outstanding(walk.step, asWalkAnswers(after.answers)).length === 0
            : false;

        return {
          settledStep: coveredByStandards ? walk.step : null,
          settledView: coveredByStandards && after ? walkView(after) : null,
          walk: after ?? walk,
          labels: pack.labels,
          estimateNumber: estimate?.number ?? "",
          jobName: project ? `${project.number} ${project.name}` : "",
          pendingSay: walk.interview.pendingSay,
        };
      },
      { role: ctx.role },
    );

    /**
     * A phase the standards just completed is priced before anything else
     * happens — see the gather. No model call, and `runTurn` takes it from
     * `stepFinished` exactly as it takes a phase somebody talked through.
     */
    if (gathered.settledStep) {
      return {
        ok: true as const,
        view: gathered.settledView,
        finished: false as const,
        ranOn: gathered.settledStep.id,
        stepFinished: true as const,
        step: gathered.settledStep,
      };
    }

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
    /**
     * **THE SCREEN AND THE SERVER MUST AGREE ON WHAT IS BEING ANSWERED.**
     *
     * They came apart, and the founder found exactly how it felt: *"when it
     * errors, it stays on the question so you can answer it again, but when
     * you answer it, it actually answers the next question that you don't
     * see yet."* A turn that committed and then threw on the way back left
     * the old question on screen with the walk already past it.
     *
     * So the screen says which question it is answering, and a disagreement
     * is answered with the truth rather than a write: nothing is recorded,
     * and the current view goes back so the person sees the real question.
     * **Refusing costs one re-read; guessing costs a wrong answer in a bid.**
     */
    if (
      opts.answering !== undefined &&
      gathered.pendingSay.trim() !== "" &&
      !sameQuestion(opts.answering, gathered.pendingSay)
    ) {
      return {
        ok: true as const,
        view: walkView(gathered.walk),
        finished: false as const,
        resynced: true as const,
      };
    }

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
      /**
       * **THE BUILDING'S NUMBERS, IN EVERY TURN (X7).** Read in act one with
       * the rest of the walk, so they cost nothing extra here. This is what
       * stops a walk asking for a square footage it was given at step two.
       */
      measurements: measureLines(asTaken(gathered.walk.measurements)),
      /**
       * **THE ROOMS, SO A QUESTION CAN NAME ONE** (X8). This is what turns
       * *"how much flooring?"* into *"what is going in the master bath?"*,
       * and it is what lets one answer be allocated across a floor.
       */
      rooms: roomLines(asRoomFacts(gathered.walk.rooms)),
    });

    /* ── Act two: the model, with NO transaction open ─────────────────────── */
    const history: { role: "user" | "assistant"; content: string }[] = [];
    if (gathered.pendingSay.trim() !== "") {
      history.push({ role: "assistant", content: gathered.pendingSay });
    }
    if (said && said.trim() !== "") history.push({ role: "user", content: said.trim() });

    /**
     * **THE OUTLINE CARRIES THE WALK WHEN THE MODEL CANNOT.** `takeWalkTurn`
     * no longer throws and has already retried; null here means it is not
     * available. The outline is the floor — it always was — so the walk banks
     * what was just said and asks the next question on the list in the
     * business's own words, and nobody sees an error.
     *
     * The one case with nothing honest to say is a step whose questions are
     * all settled and no model to judge whether the walk should go further.
     * That reports the failure rather than inventing a question.
     */
    const turn =
      (await takeWalkTurn({ system, history, step })) ??
      (outlineCanCarry(step, asWalk) || (said ?? "").trim() !== ""
        ? outlineTurn({
            step,
            answers: asWalk,
            pendingQuestionId: gathered.walk.interview.pendingQuestionId,
            pendingSay: gathered.pendingSay,
            said,
          })
        : null);
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
        const interview = await readInterview(tx, ctx.tenantId, interviewId);
        const answerRows = await readAnswers(tx, ctx.tenantId, interviewId);
        if (!interview) return null;
        /**
         * A price is not pending on this path — `answerPrice` takes those
         * turns before this one runs — but the view is built from what the
         * row SAYS rather than from that reasoning, so it cannot be one
         * refactor away from naming the wrong phase. It costs no query when
         * there is nothing pending, which here is always.
         */
        const pricing = await readPendingPrice(tx, ctx.tenantId, interview);

        /**
         * **THE STEP DOES NOT MOVE HERE ANY MORE.** It used to, the moment
         * the model said the phase was done — and that is what made the walk
         * a questionnaire: the conversation swept past a phase without ever
         * saying what it cost. Moving on is now `runTurn`'s, AFTER the money
         * has been asked for (X6). All this reports is that the phase's
         * questions are finished.
         *
         * `moveToStep`'s must-ask guard still applies wherever it is called:
         * the walk cannot talk its way past a question marked always-ask.
         */
        /**
         * **COVERAGE DECIDES THIS, NOT THE MODEL.** The first cut waited for
         * `stepDone`, and driving it showed the model simply does not say so
         * reliably — it answers and carries straight on to the next thing.
         * Hanging the pricing on a claim it may never make meant the walk
         * sailed past every phase without asking what any of it cost, which
         * is the exact complaint this slice exists to answer.
         *
         * A phase is finished when its questions are settled, which is a
         * fact this code can check: `currentStep` has moved off it.
         */
        const answers = asWalkAnswers(answerRows);
        const here = currentStep(steps, answers, step.id);
        const stepFinished = !here || here.id !== step.id;
        return { steps, outlineName, interview, answerRows, stepFinished, pricing };
      },
      { role: ctx.role },
    );

    return {
      ok: true as const,
      /** The whole fresh view, so the screen needs no second round trip. */
      view: after
        ? walkViewFrom(
            after.steps,
            after.outlineName,
            after.interview,
            after.answerRows,
            {
              /** Act one's read; the building cannot have been re-measured mid-turn. */
              projectId: gathered.walk.projectId,
              declared: gathered.walk.declared,
              measurements: gathered.walk.measurements,
              rooms: gathered.walk.rooms,
            },
            after.pricing,
          )
        : null,
      finished: after?.interview.status !== "running",
      /** The step this turn was ABOUT, so a caller can see it has moved on. */
      ranOn: step.id,
      /** Its questions are all settled: time to work out what it costs. */
      stepFinished: after?.stepFinished ?? false,
      step,
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

/* ------------------------------------------------------------------------
 * MEASURING THE BUILDING, BEFORE ANYTHING IS PRICED (X7).
 *
 * The founder, while X6 was waiting to merge: *"What if before the questions
 * it prompts you to grab measurements. Full exterior elevation square
 * footage, wall square footage, wall perimeter etc. Then the questions can
 * use this information as it goes."*
 *
 * Two problems, one answer. Measuring is a different MODE from talking —
 * open the sheet, set the scale, trace the polygon — and doing it fifteen
 * times mid-conversation breaks the rhythm every time; and a number given
 * as an ANSWER falls out of the prompt after thirty of them, so a walk told
 * 2,400 square feet at framing had forgotten it by drywall. A measurement
 * is a fact about the BUILDING, there are a handful of them, and they go
 * into every turn from the first phase to the last.
 *
 * ── THE MODEL IS NOT IN THIS PATH ───────────────────────────────────────────
 *
 * The rule X6 set for prices, unchanged and for a harder reason: a wrong
 * price is wrong once, and a wrong measurement multiplies through every
 * line that reads it.
 * ---------------------------------------------------------------------- */

/**
 * **WHAT EVERY DOOR THAT ENDS A TURN HANDS BACK**, in one declaration.
 *
 * The screen narrows on `"put" in result`, and a second return shape that
 * merely LACKED the field collapsed it to `{}` — the type error that caught
 * this. One interface, so the pricing door and the measuring door cannot
 * drift apart in a way only the caller notices.
 */
interface TurnOutcome {
  ok: true;
  view: WalkView | null;
  finished: boolean;
  /** The phase that just went on the estimate, and what it came to. */
  put?: { name: string; cents: number } | null;
}

/** Where a walk's measuring stands: whose building, and what the list is. */
async function measuringContext(ctx: WalkCtx, interviewId: string) {
  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const walk = await getWalk(tx, ctx.tenantId, interviewId);
      if (!walk || walk.projectId === "") return null;
      return {
        projectId: walk.projectId,
        outlineId: walk.interview.outlineId,
        measuredAt: walk.interview.measuredAt,
        roomsAskedAt: walk.interview.roomsAskedAt,
        pendingMeasureId: walk.interview.pendingMeasureId,
        declared: walk.declared.length,
        rooms: walk.rooms.length,
      };
    },
    { role: ctx.role },
  );
}

/**
 * Open the measure-up, or say there is nothing to measure.
 *
 * Returns true when the walk is now asking for a number, which is the
 * signal to NOT take an opening turn — the conversation starts once the
 * building is measured.
 */
async function startMeasuring(ctx: WalkCtx, interviewId: string): Promise<boolean> {
  const where = await measuringContext(ctx, interviewId);
  if (!where || where.measuredAt !== null) return false;

  if (where.declared > 0) {
    const ask = await withTenant(
      ctx.tenantId,
      (tx) => askNextMeasure(tx, ctx, interviewId, where.outlineId, where.projectId),
      { role: ctx.role },
    );
    if (ask) return true;
  }

  /**
   * **NOTHING TO MEASURE STILL MEANS THE ROOMS GET ASKED FOR** (X8). An
   * outline that declares no measurements, and a building somebody measured
   * on last month's estimate, both land here — and the rooms are the half
   * that makes the finishes questions specific.
   */
  if (await askForRooms(ctx, interviewId)) return true;

  /**
   * Stamped rather than left null, so a measurement added to the outline
   * next week does not drop this walk back into measuring halfway through.
   */
  await withTenant(ctx.tenantId, (tx) => finishMeasuring(tx, ctx, interviewId), {
    role: ctx.role,
  });
  /** **AND THEN THE USUAL** (X13) — the last gate before the first phase. */
  return askForTheUsual(ctx, interviewId);
}

/** The fresh view, read once, for the several places below that end with one. */
async function freshView(ctx: WalkCtx, interviewId: string): Promise<WalkView | null> {
  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const walk = await getWalk(tx, ctx.tenantId, interviewId);
      return walk ? walkView(walk) : null;
    },
    { role: ctx.role },
  );
}


/**
 * Put the rooms question, unless it has already been put. True when the
 * walk is now waiting on it.
 */
async function askForRooms(ctx: WalkCtx, interviewId: string): Promise<boolean> {
  const where = await measuringContext(ctx, interviewId);
  if (!where || where.measuredAt !== null || where.roomsAskedAt !== null) return false;
  await withTenant(
    ctx.tenantId,
    async (tx) => {
      await savePendingTurn(tx, ctx, interviewId, {
        say:
          where.rooms > 0
            ? `${where.rooms} ${where.rooms === 1 ? "room" : "rooms"} on this one already. Add any that are missing, or carry on.`
            : "What rooms are in it? Paste the list — one a line, with a floor heading if you want them grouped. Every finishes question after this can then name one.",
        questionId: null,
        quickReplies: [where.rooms > 0 ? "Carry on" : "Skip the rooms"],
      });
      await markRoomsAsked(tx, ctx, interviewId);
    },
    { role: ctx.role },
  );
  return true;
}


/* ------------------------------------------------------------------------
 * AGREE THE USUAL, ONCE (X13).
 *
 * The third of the three things that happen before the first phase: measure
 * the building, list the rooms, agree the usual.
 *
 * The founder, on the shape of his work: *"i'd say 80/20 standard vs
 * custom"*; and on the 80, with a screenshot of the walk asking it for the
 * ninth time: *"I'm getting questions like this one: who is doing this one.
 * it doesn't give any context."*
 *
 * **NOTHING IS ASSUMED UNTIL IT HAS BEEN READ.** The standards go on the
 * screen grouped by what they SAY — *"Who is doing this one? In-house —
 * every phase"* — because thirty-three separate lines is a rubber stamp
 * rather than a check. Only when somebody agrees are they settled, phase by
 * phase, each marked as having come from the outline rather than from them.
 * ---------------------------------------------------------------------- */

/** Where this walk's standards stand, and what they say. */
async function usualContext(ctx: WalkCtx, interviewId: string) {
  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const walk = await getWalk(tx, ctx.tenantId, interviewId);
      if (!walk) return null;
      const standards = standardsIn(walk.steps);
      /** The phases the estimate already has, stated at the same gate (X17). */
      const covered = coveredPhases(walk.steps, walk.onEstimate, walk.assemblyNames);
      return {
        askedAt: walk.interview.usualAskedAt,
        accepted: walk.interview.usualAccepted,
        measuredAt: walk.interview.measuredAt,
        standards,
        lines: usualLines(groupStandards(standards), walk.steps.length),
        size: usualSize(standards),
        covered,
        coverLines: coverageLines(covered, ctx.symbol),
      };
    },
    { role: ctx.role },
  );
}

/**
 * State the usual and wait to be told it is right.
 *
 * Returns true when the walk is now asking, which is the signal not to take
 * an opening turn. An outline with no standards on it never sees this — the
 * gate is stamped straight through, so nothing changes for a business that
 * has not filled any in.
 */
async function askForTheUsual(ctx: WalkCtx, interviewId: string): Promise<boolean> {
  const where = await usualContext(ctx, interviewId);
  if (!where || where.askedAt !== null) return false;

  /**
   * **AN OUTLINE WITH NO STANDARDS NEVER SEES THIS.** Stamped through rather
   * than skipped, so a standard added to the outline next week does not put
   * the question in front of a walk that is already half way down the house.
   */
  if (where.standards.length === 0 && where.covered.length === 0) {
    await withTenant(ctx.tenantId, (tx) => recordUsual(tx, ctx, interviewId, false), {
      role: ctx.role,
    });
    return false;
  }

  /**
   * One gate for both: what the outline answers for itself (X13), and what
   * the estimate already has (X17). Both are things the walk will take as
   * read, and a second confirmation for the second kind would be a second
   * tap for the same question.
   */
  const { questions, steps } = where.size;
  const say: string[] = [];
  if (where.standards.length > 0) {
    say.push(
      `Before we start, here is what I will take as read — ${questions} ${
        questions === 1 ? "question" : "questions"
      } across ${steps} ${steps === 1 ? "phase" : "phases"}:`,
      "",
      ...where.lines,
    );
  }
  if (where.covered.length > 0) {
    if (say.length > 0) say.push("");
    say.push(
      say.length > 0
        ? "And these phases are already on the estimate, so I will move past them:"
        : "Before we start — these phases are already on the estimate, so I will move past them:",
      "",
      ...where.coverLines,
    );
  }
  say.push("", "Right for this one? Anything you say no to, I will ask you about as we go.");
  await withTenant(
    ctx.tenantId,
    (tx) =>
      askTheUsual(tx, ctx, interviewId, {
        say: say.join("\n"),
        questionId: null,
        quickReplies: ["That's right", "Ask me everything"],
      }),
    { role: ctx.role },
  );
  return true;
}

/**
 * THE ANSWER TO THE USUAL — agreed, or ask me everything.
 *
 * Null when the walk is not on this question, so the turn is handled as an
 * ordinary one. **Both answers stamp the gate**: saying no does not mean ask
 * again next turn, it means this walk takes no standards at all.
 */
async function answerTheUsual(
  ctx: WalkCtx,
  interviewId: string,
  said: string | undefined,
): Promise<TurnOutcome | null> {
  const where = await usualContext(ctx, interviewId);
  if (!where || where.askedAt === null || where.accepted !== null) return null;

  /**
   * **AN EMPTY REPLY IS NOT AN ANSWER**, and this is the one question where
   * that matters: there are two buttons under it, and reading a stray return
   * as either a yes or a no would settle — or throw away — a screenful of
   * answers nobody chose. The question stays up.
   */
  if ((said ?? "").trim() === "") {
    return { ok: true, view: await freshView(ctx, interviewId), finished: false };
  }

  /**
   * **A "NO" IS ANY REFUSAL, AND EVERYTHING ELSE IS A YES.** The two buttons
   * are what this is answered with in practice; the words below are what
   * somebody types instead of pressing one. Reading an unclear answer as a
   * YES would settle answers on somebody who meant to object, so the
   * uncertain case goes the other way: `refusesTheUsual` is generous, and
   * agreeing has to actually look like agreement.
   */
  const accepted = !refusesTheUsual(said ?? "");
  await withTenant(
    ctx.tenantId,
    (tx) => recordUsual(tx, ctx, interviewId, accepted),
    { role: ctx.role },
  );

  try {
    const opened = await openPhase(ctx, interviewId);
    if (opened.ok) return { ok: true, view: opened.view ?? null, finished: !!opened.finished };
  } catch {
    /** A failed opening turn is not a failed agreement: the gate is stamped. */
  }
  return { ok: true, view: await freshView(ctx, interviewId), finished: false };
}

/**
 * THE ROOMS ANSWER — a pasted list, or a word that means carry on.
 *
 * Returns null when the walk is not on the rooms question, so the turn is
 * handled as an ordinary one.
 */
async function answerRooms(
  ctx: WalkCtx,
  interviewId: string,
  said: string | undefined,
): Promise<TurnOutcome | null> {
  const where = await measuringContext(ctx, interviewId);
  if (!where || where.measuredAt !== null || where.roomsAskedAt === null) return null;

  const text = (said ?? "").trim();
  const read = parseRoomList(text);
  /**
   * **A SENTENCE IS NOT A ROOM LIST.** "Skip", "carry on", "none" and an
   * empty answer all mean move on — and so does anything that reduces to a
   * single line, because one line of prose would otherwise become a room
   * called *"the usual ones"*. A real list is pasted, and a real list has
   * more than one line or a number beside it.
   */
  const looksLikeAList =
    read.rooms.length > 1 || read.rooms.some((r) => r.areaThousandths !== null);
  if (text !== "" && looksLikeAList) {
    await withTenant(
      ctx.tenantId,
      (tx) => addRoomList(tx, ctx, where.projectId, read.rooms),
      { role: ctx.role },
    );
  }
  await withTenant(ctx.tenantId, (tx) => finishMeasuring(tx, ctx, interviewId), {
    role: ctx.role,
  });

  /**
   * **AND THEN THE USUAL** (X13). **THERE ARE THREE WAYS OUT OF MEASURING**
   * and this was the one that forgot: `startMeasuring` when there is nothing
   * to measure, `afterMeasuring` when the last number lands, and here when
   * the rooms are answered — which is the way EVERY walk with an outline
   * that declares measurements actually leaves. Driving it is what said so;
   * the gate read `usual_asked: false` on a walk that had finished
   * measuring, so nothing would ever have been taken as read.
   */
  if (await askForTheUsual(ctx, interviewId)) {
    return { ok: true, view: await freshView(ctx, interviewId), finished: false };
  }

  try {
    const opened = await openPhase(ctx, interviewId);
    if (opened.ok) return { ok: true, view: opened.view ?? null, finished: !!opened.finished };
  } catch {
    /** A failed opening turn is not a failed room list: the rooms are in. */
  }
  return { ok: true, view: await freshView(ctx, interviewId), finished: false };
}

/**
 * A MEASUREMENT ANSWER — deterministic, and never near the model.
 *
 * Returns the fresh view, or null when nothing was being measured and the
 * turn should be handled as an ordinary one.
 */
async function answerMeasure(
  ctx: WalkCtx,
  interviewId: string,
  said: string | undefined,
): Promise<TurnOutcome | null> {
  const where = await measuringContext(ctx, interviewId);
  if (!where?.pendingMeasureId) return null;

  const measure = await withTenant(
    ctx.tenantId,
    (tx) => pendingMeasure(tx, ctx.tenantId, where.outlineId, where.pendingMeasureId!),
    { role: ctx.role },
  );
  /**
   * The measurement was deleted from the outline while it was on screen.
   * Not an error: the walk stops asking for it and carries on.
   */
  if (!measure) {
    await withTenant(ctx.tenantId, (tx) => clearMeasureAsk(tx, ctx, interviewId), {
      role: ctx.role,
    });
    return null;
  }

  const reply = readMeasureReply(said ?? "");

  /** Unreadable is not an error: it asks again, in the same words. */
  if (reply.kind === "unclear") {
    const ask = measureQuestionFor(measure);
    const view = await withTenant(
      ctx.tenantId,
      async (tx) => {
        await savePendingTurn(tx, ctx, interviewId, {
          say: `${ask.prompt} — one figure, please.`,
          questionId: null,
          quickReplies: ["Skip this one"],
        });
        await setMeasureAsk(tx, ctx, interviewId, measure.id);
        const walk = await getWalk(tx, ctx.tenantId, interviewId);
        return walk ? walkView(walk) : null;
      },
      { role: ctx.role },
    );
    return { ok: true, view, finished: false };
  }

  await withTenant(
    ctx.tenantId,
    async (tx) => {
      if (reply.kind === "value") {
        await recordWalkMeasurement(tx, ctx, {
          projectId: where.projectId,
          measure,
          valueThousandths: reply.valueThousandths,
        });
      } else {
        await passWalkMeasurement(tx, ctx, { projectId: where.projectId, measure });
      }
    },
    { role: ctx.role },
  );

  return afterMeasuring(ctx, interviewId, where.outlineId, where.projectId);
}

/**
 * The next number, or the end of measuring and the first real question.
 *
 * **THE OPENING TURN IS TAKEN HERE**, not by the screen, for the reason the
 * walk has never bootstrapped itself: a screen that fires a turn on mount
 * shows an empty panel for as long as the model takes.
 */
async function afterMeasuring(
  ctx: WalkCtx,
  interviewId: string,
  outlineId: string,
  projectId: string,
): Promise<TurnOutcome> {
  const next = await withTenant(
    ctx.tenantId,
    (tx) => askNextMeasure(tx, ctx, interviewId, outlineId, projectId),
    { role: ctx.role },
  );
  if (next) return { ok: true, view: await freshView(ctx, interviewId), finished: false };

  /**
   * **AND THEN THE ROOMS, ONCE** (X8). The founder wanted them gathered with
   * the other numbers — *"along with the takeoff measurements at the start,
   * you should identify the rooms on every floor"* — because every finishes
   * question after this can then name one.
   *
   * Asking is stamped when the question is PUT, not when it is answered:
   * "asked and waiting" and "not asked yet" are otherwise the same three
   * nulls, and the walk would either ask twice or never.
   */
  const asked = await askForRooms(ctx, interviewId);
  if (asked) return { ok: true, view: await freshView(ctx, interviewId), finished: false };

  /** And then the usual, once (X13), before any phase opens. */
  if (await askForTheUsual(ctx, interviewId)) {
    return { ok: true, view: await freshView(ctx, interviewId), finished: false };
  }

  /** Measuring is over — stamped HERE now, not by `askNextMeasure`. */
  await withTenant(ctx.tenantId, (tx) => finishMeasuring(tx, ctx, interviewId), {
    role: ctx.role,
  });

  /** Open the first phase. */
  try {
    const opened = await openPhase(ctx, interviewId);
    if (opened.ok) return { ok: true, view: opened.view ?? null, finished: !!opened.finished };
  } catch {
    /** A failed opening turn is not a failed measure-up: the numbers are in. */
  }
  return { ok: true, view: await freshView(ctx, interviewId), finished: false };
}

/* ------------------------------------------------------------------------
 * THE MONEY, AS PART OF THE WALK (X6).
 *
 * The founder, having walked a real bid: *"I'm still not seeing how the
 * estimate is built with pricing etc. Seems like I am just answering
 * questions."* He was right. The conversation gathered scope and stopped;
 * working out the lines and putting them on were two buttons he had to
 * remember, twice a phase, thirty-three times — and everything they
 * produced came back `needs a price`, because his tenant had no assemblies
 * and one priced line in the whole system.
 *
 * So a phase now ENDS in money. Its questions finish, the lines are worked
 * out, **every price the pack cannot find is asked for**, and the item goes
 * on the estimate before the walk moves on.
 *
 * ── THE MODEL IS NOT IN THE PRICING PATH ────────────────────────────────────
 *
 * It works out WHAT to price — the shapes — which is reading a transcript.
 * It never sees a figure and never attributes one: the question is written
 * from the line, the answer is read by a parser, and it is written to the
 * row whose id was on the screen. `ai/propose.ts` has had no price field
 * since X2b, and that stays true.
 * ---------------------------------------------------------------------- */

/** Work out the lines for a step, without the button. Null when it cannot. */
async function proposeForStep(
  ctx: WalkCtx,
  interviewId: string,
  /**
   * **THE STEP, EXPLICITLY.** Reading it off the walk was wrong and driving
   * it found out: once a phase is covered, `currentStep` has already moved
   * to the NEXT one, so a phase was priced against the questions of the
   * phase after it — which proposed nothing, and the walk sailed past the
   * money it was supposed to be asking for.
   */
  step: WalkStep,
): Promise<{ lines: number } | null> {
  try {
    const gathered = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const walk = await getWalk(tx, ctx.tenantId, interviewId);
        if (!walk) return null;
        const pack = await packContext(tx, ctx.tenantId, ctx.industry, PACK);
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
          step,
          labels: pack.labels,
          jobName: project ? `${project.number} ${project.name}` : "",
          projectId: project?.id,
          assemblies: assemblies.map((a) => ({
            id: a.assembly.id,
            name: a.assembly.name,
            per:
              a.assembly.drivingQuantityThousandths === 1000 && a.assembly.drivingUnit === ""
                ? "each"
                : `per ${a.assembly.drivingQuantityThousandths / 1000} ${a.assembly.drivingUnit}`.trim(),
            /** How this one is bid, which is the estimator's to set (X11). */
            perRoom: a.assembly.lineShape === "per_room",
          })),
          costCodes: codes.filter((c) => c.isActive).map((c) => ({ code: c.code, name: c.name })),
          /** The building's numbers, read with the walk in the same call (X7). */
          measurements: measureLines(asTaken(walk.measurements)),
          /** And its rooms, so a line can be per-room (X8). */
          rooms: roomLines(asRoomFacts(walk.rooms)),
          /** The same rooms as FACTS, for the shaping rather than the prompt (X11). */
          roomFacts: asRoomFacts(walk.rooms),
        };
      },
      { role: ctx.role },
    );
    if (!gathered) return null;

    const here = gathered.walk.answers.filter((a) => a.stepId === gathered.step.id);
    const proposal = await takeProposal({
      system: proposeSystemPrompt({
        projectWord: labelFor(gathered.labels, "project", "Project"),
        jobName: gathered.jobName,
        step: gathered.step,
        answers: live(asWalkAnswers(here)),
        assemblies: gathered.assemblies,
        /** The item this phase always makes, when the outline names one (X11). */
        pinnedAssembly:
          gathered.assemblies.find((a) => a.id === gathered.step.assemblyId)?.name ?? null,
        costCodes: gathered.costCodes,
        /** The building's numbers, so a line comes out measured, not lump. */
        measurements: gathered.measurements,
        rooms: gathered.rooms,
      }),
    });
    if (!proposal) return null;

    const rows = await withTenant(
      ctx.tenantId,
      (tx) =>
        proposeLines(tx, ctx, {
          interviewId,
          step: gathered.step,
          shapes: proposal.lines,
          /** Only what was actually SAID counts as having been said. */
          answers: here.filter((a) => !a.skipped).map((a) => a.answer),
          rooms: gathered.roomFacts,
          today: new Date().toISOString().slice(0, 10),
          projectId: gathered.projectId,
        }),
      { role: ctx.role },
    );
    return { lines: rows.length };
  } catch (err) {
    /**
     * **PRICING NEVER BLOCKS THE WALK.** If the shapes cannot be worked out,
     * the phase goes on the reckoning unpriced and the conversation carries
     * on — the same rule as the outline fallback. A walk that stops dead is
     * worse than a walk with a hole somebody can see.
     *
     * **BUT IT SAYS SO.** This swallowed everything in silence, and the
     * first time a phase quietly proposed nothing there was no way to tell
     * a model that had nothing to say from a bug in this function — which
     * is exactly the position driving X8 put us in. The pack's other
     * best-effort paths log the same way (`attention source x failed`).
     *
     * **The step is named**, because the answer to *"why did Drywall come
     * out empty"* has to start somewhere.
     */
    console.error(
      `walk: could not work out the lines for ${step.title} (${step.id})`,
      err,
    );
    return null;
  }
}

/** What a phase leaves behind when it lands on the estimate. */
interface PhaseLanded {
  /** The item that went on, and what it came to. Null when it was empty. */
  put: { name: string; cents: number } | null;
  /** There is another phase to open. False means the walk is over. */
  onward: boolean;
}

/**
 * Put this step's priced lines on the estimate, then let the walk move on,
 * and say what the phase came to — **money that lands silently may as well
 * not have landed**, which was half of what "it seems like I am just
 * answering questions" meant.
 */
async function applyAndMoveOn(
  ctx: WalkCtx,
  interviewId: string,
  stepId: string,
): Promise<PhaseLanded> {
  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const walk = await getWalk(tx, ctx.tenantId, interviewId);
      if (!walk) return { put: null, onward: false };
      const proposed = await listProposal(tx, ctx.tenantId, interviewId, stepId);
      let put: { name: string; cents: number } | null = null;
      /** Nothing worth writing is not a failure; the phase is simply empty. */
      if (proposed.some((r) => r.unitCostCents > 0)) {
        const estimate = await tx.query.jobEstimates.findFirst({
          where: (e, { and: a, eq: q }) =>
            a(q(e.tenantId, ctx.tenantId), q(e.id, walk.interview.estimateId)),
          columns: { id: true },
        });
        if (estimate) {
          const out = await applyProposal(tx, ctx, {
            interviewId,
            estimateId: estimate.id,
            stepId,
          });
          put = {
            name: out.groupName,
            cents: proposed.reduce(
              (n, r) => n + Math.round((r.quantityThousandths * r.unitCostCents) / 1_000),
              0,
            ),
          };
        }
      }
      /**
       * **THE MONEY LANDS EITHER WAY; THE CONVERSATION ONLY MOVES IF THERE IS
       * ONE.** A phase can finish on a walk that is no longer running — one
       * closed in another tab while this turn was with the model, or the last
       * price of a phase somebody came back to. Putting the item on is still
       * right; moving the bookmark and closing the walk again are not, and
       * `closeWalk` would refuse the second one anyway.
       */
      if (walk.interview.status !== "running") return { put, onward: false };
      const answers = asWalkAnswers(walk.answers);
      /**
       * **NOT `nextStep`.** Forwards stopped meaning finished when X4 made it
       * possible to jump about: answering the LAST phase on the list closed
       * the walk over eight earlier ones nobody had been asked about. A walk
       * ends when nothing is outstanding (ADR 0099), which is what this says.
       */
      const onward = onwardStep(walk.steps, answers, stepId);
      /** The guard belongs to the phase being LEFT, which is this one. */
      await moveToStep(tx, ctx, interviewId, onward?.id ?? null, { guardStepId: stepId });
      if (!onward) await closeWalk(tx, ctx, interviewId, "finished");
      return { put, onward: onward !== null };
    },
    { role: ctx.role },
  );
}

/**
 * A PRICE ANSWER — deterministic, and never near the model.
 *
 * Returns the fresh view, or null when no price was pending and the turn
 * should be handled as an ordinary one.
 */
async function answerPrice(
  ctx: WalkCtx,
  interviewId: string,
  said: string | undefined,
): Promise<TurnOutcome | null> {
  const state = await withTenant(
    ctx.tenantId,
    async (tx) => {
      const interview = await readInterview(tx, ctx.tenantId, interviewId);
      if (!interview?.pendingPriceLineId) return null;
      const line = await pendingPriceLine(tx, ctx.tenantId, interview.pendingPriceLineId);
      return line ? { interview, line } : null;
    },
    { role: ctx.role },
  );
  if (!state) return null;

  const ask = priceQuestionFor({
    id: state.line.id,
    description: state.line.description,
    unit: state.line.unit,
    quantityThousandths: state.line.quantityThousandths,
    unitCostCents: state.line.unitCostCents,
    basis: state.line.basis,
  });
  const reply = readPriceReply(said ?? "", ask);

  /** Unreadable is not an error: it asks again, in the same words. */
  if (reply.kind === "unclear") {
    const view = await withTenant(
      ctx.tenantId,
      async (tx) => {
        await savePendingTurn(tx, ctx, interviewId, {
          say: `${ask.prompt} — one figure, please.`,
          questionId: null,
          quickReplies: ["Skip this one"],
        });
        await setPriceAsk(tx, ctx, interviewId, ask.lineId);
        const walk = await getWalk(tx, ctx.tenantId, interviewId);
        return walk ? walkView(walk) : null;
      },
      { role: ctx.role },
    );
    return { ok: true, view, finished: false };
  }

  const stepId = state.line.stepId;
  await withTenant(
    ctx.tenantId,
    async (tx) => {
      if (reply.kind === "price") {
        await recordSaidPrice(tx, ctx, interviewId, state.line.id, reply.unitCostCents);
      } else {
        await passPrice(tx, ctx, interviewId, state.line.id);
      }
    },
    { role: ctx.role },
  );

  /** Next price on the phase, or the phase is done and goes on the estimate. */
  const next = stepId
    ? await withTenant(ctx.tenantId, (tx) => askNextPrice(tx, ctx, interviewId, stepId), {
        role: ctx.role,
      })
    : null;
  if (next) {
    const view = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const walk = await getWalk(tx, ctx.tenantId, interviewId);
        return walk ? walkView(walk) : null;
      },
      { role: ctx.role },
    );
    return { ok: true, view, finished: false };
  }

  const landed = stepId
    ? await applyAndMoveOn(ctx, interviewId, stepId)
    : { put: null, onward: false };

  /**
   * **THE LAST PRICE OF A WALK IS NOT AN ERROR.** This opened the next phase
   * unconditionally, and when the phase that just landed was the last one the
   * walk had already closed itself a line earlier — so `claimTurn` refused,
   * the refusal escaped to the action's catch, and the person's final answer
   * came back as *"This walk is finished. Start a new one to go again."* over
   * money that had in fact gone on perfectly. Nothing to open is the end of
   * the walk, and the screen says so.
   */
  if (!landed.onward) {
    return {
      ok: true,
      view: await freshView(ctx, interviewId),
      finished: true,
      put: landed.put,
    };
  }

  /** Open the phase the walk has just arrived at. */
  const opened = await openPhase(ctx, interviewId);
  if (opened.ok) {
    return {
      ok: true,
      view: opened.view ?? null,
      finished: !!opened.finished,
      put: landed.put,
    };
  }
  return { ok: true, view: await freshView(ctx, interviewId), finished: false, put: landed.put };
}

/**
 * A phase's questions are finished: work out what it costs, and start
 * asking. Returns the view when there is a price to ask for.
 */
async function priceTheStep(
  ctx: WalkCtx,
  interviewId: string,
  step: WalkStep,
): Promise<WalkView | null> {
  await proposeForStep(ctx, interviewId, step);
  const stepId = step.id;
  const ask = await withTenant(
    ctx.tenantId,
    (tx) => askNextPrice(tx, ctx, interviewId, stepId),
    { role: ctx.role },
  );
  if (!ask) return null;
  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const walk = await getWalk(tx, ctx.tenantId, interviewId);
      return walk ? walkView(walk) : null;
    },
    { role: ctx.role },
  );
}

/**
 * **NOTHING AFTER THE FIRST TURN MAY UNDO IT.** The first turn commits; the
 * continuation is a convenience. A throw in either of the two calls below
 * used to escape to the action's catch, which answered `{ error }` with no
 * view while the walk had already moved — the exact fault the founder hit.
 * Both are wrapped, and a failure returns the first turn's view.
 */

/**
 * A stop, not a rule: one turn may carry the walk through several phases the
 * standards covered, and it may not carry it through more phases than any
 * outline plausibly has. The pilot's longest is thirty-three.
 */
const PHASES_AT_MOST = 60;

/**
 * **OPEN THE PHASE THE WALK HAS ARRIVED AT — AND PRICE ANY THAT NEEDED NO
 * CONVERSATION ON THE WAY** (X13).
 *
 * X6's rule is that a phase ends in money, and until X13 every phase ended
 * because somebody answered its last question — so "price the phase that just
 * finished" lived in `runTurn`, where the answering happens, and that was
 * enough.
 *
 * Standards broke that. A phase whose every question the outline answers for
 * itself is finished the moment it opens, with no answer and no turn, and
 * **four different paths open a phase without going through `runTurn`** — the
 * end of measuring, the rooms, agreeing the usual, and the last price of a
 * phase. Driving a whole bid is what showed it: the walk went 1 → 3 → 5 and
 * the estimate had two items on it, because the standards cover the 80% and
 * the 80% was exactly what stopped producing money.
 *
 * So opening a phase is one function, and every path calls it. Pricing that
 * needs to ASK returns straight away, so the loop only ever runs on phases
 * the pack could price by itself.
 */
/**
 * Whether the estimate already has this phase — lines this walk did not
 * write, on the phase's code or in the item its assembly makes (X17).
 * Read fresh, because it is asked about a phase that has just finished and
 * the estimate may have moved since the walk was loaded.
 */
async function alreadyPriced(ctx: WalkCtx, interviewId: string, step: WalkStep): Promise<boolean> {
  return withTenant(
    ctx.tenantId,
    async (tx) => {
      const walk = await getWalk(tx, ctx.tenantId, interviewId);
      return walk ? coverageOf(step, walk.onEstimate, walk.assemblyNames) !== null : false;
    },
    { role: ctx.role },
  );
}

async function openPhase(ctx: WalkCtx, interviewId: string) {
  let out = await oneTurn(ctx, interviewId, undefined, { ignoreCooldown: true });
  for (let pass = 0; pass < PHASES_AT_MOST; pass += 1) {
    if (!out.ok || !out.stepFinished || !out.step) break;
    const step = out.step;
    try {
      /**
       * **A PHASE THE ESTIMATE ALREADY HAS ENDS IN THE MONEY IT HAS** (X17),
       * whether the gate agreed or the questions were asked: a refusal at
       * the gate means *ask me*, never *price the drywall twice*.
       */
      if (await alreadyPriced(ctx, interviewId, step)) {
        await applyAndMoveOn(ctx, interviewId, step.id);
        out = await oneTurn(ctx, interviewId, undefined, { ignoreCooldown: true });
        continue;
      }
      const pricing = await priceTheStep(ctx, interviewId, step);
      if (pricing) return { ...out, view: pricing };
      await applyAndMoveOn(ctx, interviewId, step.id);
    } catch {
      /** Pricing never blocks: move on and let the reckoning show the hole. */
      try {
        await applyAndMoveOn(ctx, interviewId, step.id);
      } catch {
        return out;
      }
    }
    out = await oneTurn(ctx, interviewId, undefined, { ignoreCooldown: true });
  }
  return out;
}

async function runTurn(
  ctx: WalkCtx,
  interviewId: string,
  said: string | undefined,
  answering?: string,
) {
  const first = await oneTurn(ctx, interviewId, said, { answering });
  /**
   * **WHAT THE PRICING NEEDS, NOT WHETHER THE WALK IS STILL OPEN.** This read
   * `first.finished` as well, and `finished` is only *"the interview's status
   * is not running"* — so a turn that committed answers and found the walk
   * closed underneath it (another tab, or the phase somebody came back to on
   * a finished walk) banked the scope and skipped the money entirely, with no
   * error anywhere. The answers were on record and the phase was worth
   * nothing.
   *
   * The two things `finished` was standing in for are said directly: a turn
   * with no view has nothing to price (the empty outline that closes itself
   * below), and a resync recorded nothing at all. **A phase that finished
   * gets priced, and `applyAndMoveOn` leaves a closed walk closed.**
   */
  if (!first.ok || !first.view || first.resynced) return first;

  /**
   * **A PHASE ENDS IN MONEY, NOT IN SILENCE.** Its questions are settled, so
   * the lines get worked out and every price the pack cannot find is asked
   * for. Only when they are all in does `answerPrice` put the item on the
   * estimate and let the walk move on.
   */
  if (first.stepFinished && first.step) {
    try {
      const pricing = await priceTheStep(ctx, interviewId, first.step);
      if (pricing) return { ...first, view: pricing };
      /** Nothing to price: put on whatever there is and carry on. */
      await applyAndMoveOn(ctx, interviewId, first.step.id);
    } catch {
      /** Pricing never blocks: move on and let the reckoning show the hole. */
      try {
        await applyAndMoveOn(ctx, interviewId, first.step.id);
      } catch {
        return first;
      }
    }
  }
  const movedOn = first.view.stepTitle !== "" && first.ranOn !== undefined;
  if (!movedOn) return first;

  try {
    /** Did the step actually change? Compare what it ran on with where it is. */
    const where = await withTenant(
      ctx.tenantId,
      async (tx) => {
        const walk = await getWalk(tx, ctx.tenantId, interviewId);
        return {
          stepId: walk?.step?.id ?? null,
          running: walk?.interview.status === "running",
          /** Read here so a walk that has just closed goes back SAYING so. */
          view: walk ? walkView(walk) : null,
        };
      },
      { role: ctx.role },
    );
    /**
     * **A CLOSED WALK ASKS NOTHING MORE.** The phase that just landed was the
     * last of them, or somebody came back to one on a finished walk and it is
     * finished again. `claimTurn` would refuse and the refusal would be
     * swallowed; not asking is the same answer without the round trip — and
     * the view goes back fresh, so the screen shows the reckoning rather than
     * a conversation the walk has left.
     */
    if (!where.running) {
      return { ...first, view: where.view ?? first.view, finished: true };
    }
    const stillHere = where.stepId;
    /** `null` means coverage is complete and the walk is riding out the last
     *  step; that is not a transition and needs no second turn. */
    if (stillHere === first.ranOn || stillHere === null) return first;

    const out = await openPhase(ctx, interviewId);
    return out.ok ? out : first;
  } catch {
    return first;
  }
}

export async function takeWalkTurnAction(input: unknown) {
  const parsed = turnSchema.safeParse(input);
  /** Every failure of this action carries a view, even the ones with none. */
  if (!parsed.success) return { error: "Check the form and try again.", view: null };
  try {
    const ctx = await gate();
    /**
     * **A PRICE ANSWER NEVER REACHES THE MODEL.** When the walk is asking
     * what something costs, the reply is one figure read by a parser and
     * written to the row whose id was on the screen. Nothing interprets it,
     * nothing attributes it, and the walk's own rule 2 — gather, never
     * price — stays true of the model all the way through.
     */
    /**
     * **A MEASUREMENT ANSWER NEVER REACHES THE MODEL EITHER (X7).** Same
     * shape as the price below it, and a harder reason: a wrong price is
     * wrong once, and a wrong measurement multiplies through every line
     * that reads it.
     */
    const measured = await answerMeasure(ctx, parsed.data.interviewId, parsed.data.said);
    if (measured) return measured;

    /** The rooms, which close the measure-up (X8). Also not the model's. */
    const roomed = await answerRooms(ctx, parsed.data.interviewId, parsed.data.said);
    if (roomed) return roomed;

    /** Agreeing the usual (X13) — a yes or a no, read here and not by a model. */
    const usual = await answerTheUsual(ctx, parsed.data.interviewId, parsed.data.said);
    if (usual) return usual;

    const priced = await answerPrice(ctx, parsed.data.interviewId, parsed.data.said);
    if (priced) return priced;

    /** The grant is checked inside the turn, off a read it makes anyway. */
    const out = await runTurn(
      ctx,
      parsed.data.interviewId,
      parsed.data.said,
      parsed.data.answering,
    );
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
    /**
     * **AN ERROR NEVER GOES BACK WITHOUT THE TRUTH WITH IT.** A bare
     * `{ error }` left the screen holding whatever it had, and if the turn
     * had committed before failing, that was a question the walk was already
     * past — so the next answer landed on one nobody had seen. Whatever went
     * wrong, the current view goes back so the screen shows what the walk
     * actually has. Failing to read it is not worth a second failure.
     */
    let view: WalkView | null = null;
    try {
      const ctx = await gate();
      view = await withTenant(
        ctx.tenantId,
        async (tx) => {
          const walk = await getWalk(tx, ctx.tenantId, parsed.data.interviewId);
          return walk ? walkView(walk) : null;
        },
        { role: ctx.role },
      );
    } catch {
      /* The message below is still worth sending. */
    }
    return { ...toResult(err), view };
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
            id: a.assembly.id,
            name: a.assembly.name,
            per:
              a.assembly.drivingQuantityThousandths === 1000 && a.assembly.drivingUnit === ""
                ? "each"
                : `per ${a.assembly.drivingQuantityThousandths / 1000} ${a.assembly.drivingUnit}`.trim(),
            /** How this one is bid, which is the estimator's to set (X11). */
            perRoom: a.assembly.lineShape === "per_room",
          })),
          costCodes: codes
            .filter((c) => c.isActive)
            .map((c) => ({ code: c.code, name: c.name })),
          /** The building's numbers, the same as the automatic path (X7). */
          measurements: measureLines(asTaken(walk.measurements)),
          rooms: roomLines(asRoomFacts(walk.rooms)),
          roomFacts: asRoomFacts(walk.rooms),
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
      pinnedAssembly:
        gathered.assemblies.find((a) => a.id === gathered.step.assemblyId)?.name ?? null,
      costCodes: gathered.costCodes,
      measurements: gathered.measurements,
      rooms: gathered.rooms,
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
          rooms: gathered.roomFacts,
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
          estimateId: walk.interview.estimateId,
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

/**
 * Put the walk on a step and ask that step's question.
 *
 * **IT PICKS A FINISHED WALK BACK UP**, which is the whole point of the rail:
 * the reckoning names a phase nobody has answered and this is the click that
 * goes and answers it. The walk closes itself again as soon as nothing is
 * outstanding, so it ends where it was.
 */
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
    /**
     * **OPEN THE PHASE, NOT JUST A TURN** (X17). A phase the standards or the
     * estimate already cover is finished the moment it opens, and a bare turn
     * left the walk standing there with nothing asked and nothing priced —
     * the fifth and sixth doors X13a did not find, because nobody had jumped
     * to such a phase from the rail until the takeoff made one.
     */
    const out = await openPhase(ctx, parsed.data.interviewId);
    /**
     * **THE VIEW COMES BACK EVEN WHEN THE TURN DID NOT.** The screen keeps
     * whatever it has when this is empty, and on a walk just picked back up
     * that is the finished panel — no question, no answer box, and no sign
     * that the click did anything.
     */
    return {
      ok: true as const,
      view: out.view ?? (await freshView(ctx, parsed.data.interviewId)),
    };
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
 *
 * **ON A FINISHED WALK THIS IS THE ONLY DOOR BACK IN**, and it is the one
 * X4 wrote for it: every phase of a finished walk is covered, so no bookmark
 * will stick to any of them until an answer stops standing. Superseding one
 * re-opens its step and picks the walk back up on it.
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
    /**
     * **OPEN THE PHASE, NOT JUST A TURN** (X17). A phase the standards or the
     * estimate already cover is finished the moment it opens, and a bare turn
     * left the walk standing there with nothing asked and nothing priced —
     * the fifth and sixth doors X13a did not find, because nobody had jumped
     * to such a phase from the rail until the takeoff made one.
     */
    const out = await openPhase(ctx, parsed.data.interviewId);
    return {
      ok: true as const,
      view: out.view ?? (await freshView(ctx, parsed.data.interviewId)),
      prompt: where.prompt,
      /** The walk was finished and is going again, which the screen says. */
      resumed: where.resumed,
    };
  } catch (err) {
    return toResult(err);
  }
}

const fromSheetSchema = z.object({
  interviewId: z.string().uuid(),
  /** Thousandths, already read through the sheet's scale by the viewer. */
  valueThousandths: z.number().int().positive().max(1_000_000_000_000),
  sheetId: z.string().uuid(),
  /** The trace it came from, so the number can be shown where it was taken. */
  markupId: z.string().uuid().optional(),
  note: z.string().trim().max(200).optional(),
});

/**
 * **THE NUMBER CAME OFF A DRAWING (X7).**
 *
 * The founder's ask: *"I don't see where it allows you to open the takeoff
 * inline... I need the takeoff tool to get that a lot of the time."* The
 * viewer measures through the sheet's own scale — that arithmetic is ADR
 * 0074's and is not repeated here — and hands back the total in
 * thousandths. This writes it to the measurement the walk was asking for,
 * with the sheet and the trace beside it, and carries on.
 *
 * The sheet and markup are PROVENANCE, not the value: re-scaling a sheet
 * does not silently change a measurement already taken, because a bid that
 * quietly moved underneath somebody is worse than one that is out of date
 * where they can see it.
 */
export async function measureFromSheetAction(
  input: unknown,
): Promise<TurnOutcome | { error: string; view: WalkView | null }> {
  const parsed = fromSheetSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the form and try again.", view: null };
  try {
    const ctx = await gate();
    await requireWalkGranted(ctx);
    const where = await measuringContext(ctx, parsed.data.interviewId);
    /**
     * **AN ERROR NEVER GOES BACK WITHOUT THE TRUTH WITH IT** — the rule the
     * wrong-answer bug bought. A refusal that left the screen holding a
     * stale question is how the next answer landed somewhere nobody saw.
     */
    if (!where?.pendingMeasureId) {
      return {
        error: "The walk is not asking for a measurement just now.",
        view: await freshView(ctx, parsed.data.interviewId),
      };
    }
    const measure = await withTenant(
      ctx.tenantId,
      (tx) => pendingMeasure(tx, ctx.tenantId, where.outlineId, where.pendingMeasureId!),
      { role: ctx.role },
    );
    if (!measure) {
      return {
        error: "That measurement is no longer on the outline.",
        view: await freshView(ctx, parsed.data.interviewId),
      };
    }
    await withTenant(
      ctx.tenantId,
      (tx) =>
        recordMeasurement(tx, ctx, {
          projectId: where.projectId,
          name: measure.name,
          unit: measure.unit,
          valueThousandths: parsed.data.valueThousandths,
          source: "measured",
          note: parsed.data.note ?? "",
          sheetId: parsed.data.sheetId,
          markupId: parsed.data.markupId ?? null,
        }),
      { role: ctx.role },
    );
    return await afterMeasuring(ctx, parsed.data.interviewId, where.outlineId, where.projectId);
  } catch (err) {
    let view: WalkView | null = null;
    try {
      view = await freshView(await gate(), parsed.data.interviewId);
    } catch {
      /* The message below is still worth sending. */
    }
    return { ...toResult(err), view };
  }
}

/* ------------------------------------------------------------------------
 * A SCHEDULE OFF THE MODEL (X14, ADR 0106).
 *
 * The founder's first answer on the first day of this layer: *they draw in
 * Revit.* The perimeter, the roof area and every room with its floor area
 * are in the model before anybody opens a PDF, and every modelling tool
 * exports a schedule as a text file. So the measure-up takes one: the pure
 * half reads it, the person says which column answers which measurement and
 * whether to add the rooms, and the walk carries on from wherever it stood
 * exactly as if the figures had been typed — because to the walk they were.
 * ---------------------------------------------------------------------- */

const bimTextSchema = z.object({
  interviewId: z.string().uuid(),
  text: z.string().min(1).max(MAX_SCHEDULE_CHARS),
  fileName: z.string().trim().max(200).default(""),
});

/**
 * What the file holds, before anything is written: the columns and their
 * totals, the rooms it lists, and which measurement each column looks like.
 */
export async function previewBimScheduleAction(
  input: unknown,
): Promise<{ ok: true; preview: SchedulePreview } | { error: string }> {
  const parsed = bimTextSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the file and try again." };
  try {
    const ctx = await gate();
    await requireWalkGranted(ctx);
    const where = await measuringContext(ctx, parsed.data.interviewId);
    if (!where) return { error: "This walk has no job to measure." };
    const preview = await withTenant(
      ctx.tenantId,
      (tx) =>
        previewSchedule(
          tx,
          ctx.tenantId,
          where.projectId,
          where.outlineId,
          parsed.data.text,
          parsed.data.fileName,
        ),
      { role: ctx.role },
    );
    return { ok: true as const, preview };
  } catch (err) {
    return toResult(err);
  }
}

const bimImportSchema = bimTextSchema.extend({
  rooms: z.boolean(),
  choices: z
    .array(
      z.object({
        measureId: z.string().uuid(),
        column: z.number().int().min(0).max(500).nullable(),
        use: z.enum(["total", "each", "rows"]),
      }),
    )
    .max(50),
});

/**
 * **WRITE WHAT WAS CONFIRMED, THEN CARRY THE WALK ON.**
 *
 * The server reads the text again and honours only choices — which column,
 * which measurement, whether to add the rooms — so nothing the browser held
 * describes a row. Then the walk moves from wherever it stood: mid
 * measure-up, `afterMeasuring` asks for the next figure the file did not
 * carry, or the rooms, or the usual, or opens the first phase; on the rooms
 * question with rooms just added, it is answered; anywhere else, the numbers
 * are simply on the building and the screen reads them.
 */
export async function importBimScheduleAction(
  input: unknown,
): Promise<
  (TurnOutcome & { imported: ScheduleImportResult }) | { error: string; view: WalkView | null }
> {
  const parsed = bimImportSchema.safeParse(input);
  if (!parsed.success) return { error: "Check the file and try again.", view: null };
  try {
    const ctx = await gate();
    await requireWalkGranted(ctx);
    const where = await measuringContext(ctx, parsed.data.interviewId);
    if (!where) {
      return {
        error: "This walk has no job to measure.",
        view: await freshView(ctx, parsed.data.interviewId),
      };
    }
    const imported = await withTenant(
      ctx.tenantId,
      (tx) =>
        importSchedule(tx, ctx, {
          projectId: where.projectId,
          outlineId: where.outlineId,
          text: parsed.data.text,
          fileName: parsed.data.fileName,
          rooms: parsed.data.rooms,
          choices: parsed.data.choices,
        }),
      { role: ctx.role },
    );

    if (where.measuredAt === null && where.pendingMeasureId) {
      const out = await afterMeasuring(ctx, parsed.data.interviewId, where.outlineId, where.projectId);
      return { ...out, imported };
    }
    const roomsCameIn =
      imported.rooms !== null && imported.rooms.added + imported.rooms.alreadyThere > 0;
    if (where.measuredAt === null && where.roomsAskedAt !== null && roomsCameIn) {
      const out = await answerRooms(ctx, parsed.data.interviewId, undefined);
      if (out) return { ...out, imported };
    }
    return {
      ok: true as const,
      view: await freshView(ctx, parsed.data.interviewId),
      finished: false,
      imported,
    };
  } catch (err) {
    let view: WalkView | null = null;
    try {
      view = await freshView(await gate(), parsed.data.interviewId);
    } catch {
      /* The message below is still worth sending. */
    }
    return { ...toResult(err), view };
  }
}
