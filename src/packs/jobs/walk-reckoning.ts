import type { WalkAnswer, WalkQuestion, WalkStep } from "./walk-math";
import { live, liveByQuestion, outstanding, stepIsCovered } from "./walk-math";
import { moneyInText } from "./walk-lines-math";

/**
 * WHAT THE WHOLE BID COMES TO, AND WHAT IS STOPPING IT (X4, ADR 0098).
 *
 * ── THE WALK COULD NOT TELL YOU WHETHER IT WAS FINISHED ─────────────────────
 *
 * Until this, the end of a walk said *"That is the whole walk"* and offered a
 * button back to the estimate. It said that over a bid with three phases
 * answered and never priced, two subcontractors who had not replied, and an
 * allowance nobody filled in. **A tool whose entire promise is a finished bid
 * in forty-five minutes could not tell you whether the bid was finished** —
 * which is the founder's own verdict on it, in his words: *"we have a ways to
 * go to actually make this right and useful."*
 *
 * So the walk now reckons: every step of the outline, what standing it is in,
 * and which of them are in the way. Nothing here is stored. A reckoning is
 * derived from the answers, the lines that were applied and the bids that went
 * out, every time it is asked for — the pack's habit since the lien waiver
 * (ADR 0066): **record the fact, derive the standing.** There is no migration
 * in this slice and that is the design working, not a corner cut.
 *
 * ── MONEY OUT FOR BID IS NOT IN THE TOTAL ───────────────────────────────────
 *
 * A phase with three subcontractors' prices on it and nobody chosen
 * contributes NOTHING to what the bid comes to. Not the lowest, not the
 * average, not a placeholder. The number is not known yet and a total that
 * quietly included a guess at it would be the plausible wrong number this
 * whole program exists to refuse — worse here than anywhere else, because
 * this is the figure somebody reads just before deciding the bid is ready.
 *
 * ── "BY OTHERS" IS A DECISION, NOT A HOLE ───────────────────────────────────
 *
 * A phase somebody else's contract pays for is finished work: it belongs in
 * the exclusions and it blocks nothing. Colouring a decision the same as an
 * omission would teach somebody to ignore the colour, and then the omissions
 * go out too.
 *
 * ── A MISREADING CAN ONLY MAKE THIS MORE CAUTIOUS ───────────────────────────
 *
 * Two standings are read from the WORDS of an answer — the starter outlines'
 * own `Bidding it out` and `By others`. A tenant who rewrites those choices
 * loses the classification, and what they get instead is `unpriced`, which
 * says *"answered, nothing priced"* and is true of every one of those cases
 * anyway. **The failure mode is a phase flagged that did not need to be, and
 * never a phase cleared that should have been flagged.** It was built this
 * way round on purpose.
 */

/** What a phase of a bid is in, once the walk has been through it. */
export const STEP_STANDINGS = [
  "priced",
  "out_for_bid",
  "by_others",
  "open",
  "unpriced",
  "nothing_asked",
] as const;

export type StepStanding = (typeof STEP_STANDINGS)[number];

/** What went out to subcontractors on this step's cost code, if anything. */
export interface StepBidFacts {
  asked: number;
  /** Replies of either kind: a number or a no-bid. */
  back: number;
  awarded: boolean;
  lowestCents: number | null;
  highestCents: number | null;
}

/** What the database knows about a step, apart from its answers. */
export interface StepFacts {
  /** Lines from this step that somebody put on the estimate. */
  appliedLines: number;
  appliedCents: number;
  /**
   * **HOW MANY OF THEM THE WALK COULD NOT PRICE.** X2b writes a line with a
   * basis of `none` when it worked out WHAT to price and could not work out
   * what it costs, and that line lands on the estimate at zero. Counting a
   * phase of those as priced is the exact failure this file exists to
   * prevent: green on the rail, nothing in the total, and a bid short by
   * whatever the concrete was going to cost. Found on the dev tenant's own
   * first walk, where all three lines of `Cast-in-place concrete` were zeroes.
   *
   * **NOT EVERY ZERO, THOUGH.** The founder's own price sheet carries about
   * sixty deliberate `$0.00` rows — *"Supplied by Turkel"*, *"By Owner"*,
   * *"(N/A)"* — which are its exclusions, stated in place. Only a line the
   * WALK could not price counts here; `walk-reckoning-ops.ts` holds that
   * distinction and the reason for it.
   */
  zeroLines: number;
  bid: StepBidFacts | null;
}

export const NO_FACTS: StepFacts = {
  appliedLines: 0,
  appliedCents: 0,
  zeroLines: 0,
  bid: null,
};

/** One question of a step as the review card reads it back. */
export interface AskedAndAnswered {
  /** Null when the walk asked something the outline never had; not re-askable. */
  questionId: string | null;
  prompt: string;
  answer: string;
  skipped: boolean;
  skipReason: string;
  /** Taken from the outline's standard rather than given by a person (X13). */
  fromStandard: boolean;
}

export interface StepReckoning {
  stepId: string;
  title: string;
  costCode: string;
  /** What stands on this step, in the order it was said. */
  asked: AskedAndAnswered[];
  /** Questions of this step nobody has settled. */
  outstanding: number;
  standing: StepStanding;
  /** The words the panel shows beside the phase. May be empty. */
  detail: string;
  /** Only ever what is ON the estimate. Never a bid nobody has chosen. */
  amountCents: number;
  /** In the way of this bid going out. */
  blocking: boolean;
}

export interface Reckoning {
  steps: StepReckoning[];
  /** The ones in the way, worst first: holes, then what is merely waiting. */
  blocking: StepReckoning[];
  priced: number;
  pricedCents: number;
  outForBid: number;
  byOthers: number;
  open: number;
  unpriced: number;
  /**
   * **ROOMS NOTHING ON THE BID MENTIONS** (X8b). Worked out from the room
   * list and the lines' own words, not from the conversation — so it is
   * true of lines somebody typed by hand as well as lines the walk wrote.
   *
   * Not counted in `ready`: a room with nothing against it is very often
   * correct (a garage with no finishes), so it is something to LOOK at
   * rather than something in the way. Blocking on it would teach somebody
   * to ignore the panel that matters.
   */
  roomsUnpriced: { id: string; name: string; level: string }[];
  /** Nothing is in the way. */
  ready: boolean;
}

/* ------------------------------------------------------------------------
 * Reading an answer.
 * ---------------------------------------------------------------------- */

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.?!]+$/, "");
}

/**
 * The starter outlines' own answers to *"Who is doing this one?"*. Matched on
 * the answer rather than the question, because a business may reword the
 * prompt and keep the choices — and because the walk is allowed to ask the
 * question in its own words when the outline never had it.
 */
const BY_OTHERS = new Set(["by others", "not on this job"]);
const BIDDING = new Set(["bidding it out", "bidding", "subbing it out", "sub it out"]);

function saidAnyOf(answers: readonly WalkAnswer[], words: ReadonlySet<string>): boolean {
  return live(answers).some((a) => !a.skipped && words.has(normalize(a.answer)));
}

/**
 * An allowance question nobody put a figure to: skipped, or answered with
 * words that carry no money. `moneyInText` is X2b's reader, so *"we will
 * price it later"* and *"TBD"* both count as blank and `$12,000` does not.
 */
function blankAllowance(
  questions: readonly WalkQuestion[],
  answers: readonly WalkAnswer[],
): boolean {
  const money = questions.filter((q) => q.kind === "money");
  if (money.length === 0) return false;
  /** The answer that STANDS for each, so a figure given on the second ask counts. */
  const byQuestion = liveByQuestion(answers);
  return money.some((q) => {
    const a = byQuestion.get(q.id);
    return a !== undefined && (a.skipped || moneyInText(a.answer).length === 0);
  });
}

/* ------------------------------------------------------------------------
 * One step.
 * ---------------------------------------------------------------------- */

function bidDetail(bid: StepBidFacts): string {
  const parts = [`${bid.asked} asked`, `${bid.back} back`];
  return parts.join(" · ");
}

/**
 * **FACTS BEAT INTENTIONS, IN THAT ORDER.** Lines on the estimate beat a bid
 * that went out, which beats what somebody said they were going to do. A step
 * answered *"by others"* and then priced anyway is priced — the lines are
 * really there, and the answer is the older, weaker claim.
 */
export function reckonStep(
  step: WalkStep,
  answers: readonly WalkAnswer[],
  facts: StepFacts = NO_FACTS,
): StepReckoning {
  const mine = answers.filter((a) => a.stepId === step.id);
  const left = outstanding(step, answers);
  const base = {
    stepId: step.id,
    title: step.title,
    costCode: step.costCode,
    asked: live(mine).map((a) => ({
      questionId: a.questionId,
      prompt: a.prompt,
      answer: a.answer,
      skipped: a.skipped,
      skipReason: a.skipReason,
      /** Nothing the walk assumed is allowed to be invisible here (X13). */
      fromStandard: a.fromStandard,
    })),
    outstanding: left.length,
  };

  if (step.questions.length === 0) {
    return { ...base, standing: "nothing_asked", detail: "", amountCents: 0, blocking: false };
  }

  if (facts.appliedLines > 0) {
    /** Lines are on, and some of them are waiting for a number. */
    if (facts.zeroLines > 0) {
      return {
        ...base,
        standing: "unpriced",
        detail:
          facts.zeroLines === facts.appliedLines
            ? `${facts.zeroLines} ${facts.zeroLines === 1 ? "line" : "lines"} on the estimate, no prices`
            : `${facts.zeroLines} of ${facts.appliedLines} lines have no price`,
        amountCents: facts.appliedCents,
        blocking: true,
      };
    }
    return {
      ...base,
      standing: "priced",
      detail: "",
      amountCents: facts.appliedCents,
      blocking: false,
    };
  }

  if (facts.bid) {
    /**
     * A bid CHOSEN and not yet on the estimate is the most easily missed hole
     * there is: the work is done, the decision is made, and the number is
     * still not in the total.
     */
    if (facts.bid.awarded) {
      return {
        ...base,
        standing: "unpriced",
        detail: "a bid chosen, not on the estimate yet",
        amountCents: 0,
        blocking: true,
      };
    }
    if (facts.bid.asked > 0) {
      return {
        ...base,
        standing: "out_for_bid",
        detail: bidDetail(facts.bid),
        amountCents: 0,
        blocking: true,
      };
    }
  }

  if (saidAnyOf(mine, BY_OTHERS)) {
    return {
      ...base,
      standing: "by_others",
      detail: "in the exclusions",
      amountCents: 0,
      blocking: false,
    };
  }

  if (left.length > 0) {
    const must = left.filter((q) => q.alwaysAsk).length;
    return {
      ...base,
      standing: "open",
      detail:
        must > 0
          ? `${left.length} still to ask, ${must} of them always`
          : `${left.length} still to ask`,
      amountCents: 0,
      blocking: true,
    };
  }

  /** Covered, and nothing came of it. Why, in the order that is most useful. */
  const detail = saidAnyOf(mine, BIDDING)
    ? "bidding it out, nobody asked"
    : blankAllowance(step.questions, mine)
      ? "allowance never set"
      : "answered, nothing priced";
  return { ...base, standing: "unpriced", detail, amountCents: 0, blocking: true };
}

/* ------------------------------------------------------------------------
 * The whole bid.
 * ---------------------------------------------------------------------- */

/**
 * Holes before waiting: a phase nobody priced needs somebody to do something,
 * a phase out for bid needs somebody else to. Within each, outline order, so
 * the list reads the way the job is built.
 */
const BLOCKING_RANK: Record<string, number> = { unpriced: 0, open: 1, out_for_bid: 2 };

export function reckonWalk(
  steps: readonly WalkStep[],
  answers: readonly WalkAnswer[],
  factsByStep: ReadonlyMap<string, StepFacts> = new Map(),
  /** Worked out by the caller, which is the half that can read the lines. */
  roomsUnpriced: readonly { id: string; name: string; level: string }[] = [],
): Reckoning {
  const reckoned = steps.map((s) => reckonStep(s, answers, factsByStep.get(s.id) ?? NO_FACTS));

  const blocking = reckoned
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.blocking)
    .sort(
      (a, b) =>
        (BLOCKING_RANK[a.r.standing] ?? 9) - (BLOCKING_RANK[b.r.standing] ?? 9) || a.i - b.i,
    )
    .map((x) => x.r);

  const count = (s: StepStanding) => reckoned.filter((r) => r.standing === s).length;

  return {
    steps: reckoned,
    blocking,
    priced: count("priced"),
    /** Applied lines only. See the note at the top of this file. */
    pricedCents: reckoned.reduce((n, r) => n + r.amountCents, 0),
    outForBid: count("out_for_bid"),
    byOthers: count("by_others"),
    open: count("open"),
    unpriced: count("unpriced"),
    roomsUnpriced: [...roomsUnpriced],
    ready: blocking.length === 0,
  };
}

/**
 * Whether the walk has run out of steps to take somebody to. Separate from
 * `ready`, because a walk can be out of QUESTIONS while the bid is still full
 * of holes — which is exactly the state that used to say "that is the whole
 * walk" and nothing else.
 */
export function walkIsCovered(
  steps: readonly WalkStep[],
  answers: readonly WalkAnswer[],
): boolean {
  return steps.every((s) => stepIsCovered(s, answers));
}
