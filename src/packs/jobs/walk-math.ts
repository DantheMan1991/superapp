/**
 * THE WALK, the pure half (X2a, ADR 0098).
 *
 * Where the conversation IS in an outline, worked out from what has been
 * answered — never stored as a position somebody has to keep in step with the
 * facts. The stored `current_step_id` is a bookmark, not the truth: if the
 * outline gains a step underneath a walk in progress, these functions notice,
 * which is the whole reason the outline is read live rather than copied.
 *
 * Nothing here knows about React, the database or the model. The walk is a
 * fold over two lists, and that is what makes it testable without a
 * conversation.
 */

export interface WalkQuestion {
  id: string;
  prompt: string;
  kind: string;
  choices: string[];
  unit: string;
  notes: string;
  /** The walk may never decide this one does not apply. */
  alwaysAsk: boolean;
}

export interface WalkStep {
  id: string;
  title: string;
  /** The part of the bid this step belongs to. A heading, not a code. */
  section: string;
  costCode: string;
  guidance: string;
  questions: WalkQuestion[];
}

export interface WalkAnswer {
  /** Null when the walk asked something the outline never contained. */
  questionId: string | null;
  stepId: string | null;
  prompt: string;
  answer: string;
  skipped: boolean;
  skipReason: string;
  /**
   * SOMEBODY ASKED THIS ONE AGAIN, so it is history rather than an answer
   * (X4). Every derivation below ignores it, which is what takes the walk
   * back to a step whose question has been re-opened — no special case for
   * "a person is revisiting", just a row that stopped counting.
   */
  superseded: boolean;
}

/** The answers that still stand, newest last. */
export function live(answers: readonly WalkAnswer[]): WalkAnswer[] {
  return answers.filter((a) => !a.superseded);
}

/**
 * The answer that stands for each question, by id. Later rows win, so
 * answering the same question twice without superseding — which the walk may
 * do within a step — reads as the last thing said.
 */
export function liveByQuestion(answers: readonly WalkAnswer[]): Map<string, WalkAnswer> {
  const out = new Map<string, WalkAnswer>();
  for (const a of live(answers)) {
    if (a.questionId) out.set(a.questionId, a);
  }
  return out;
}

/** Every outline question this walk has settled, answered or skipped. */
export function settledIds(answers: readonly WalkAnswer[]): Set<string> {
  const out = new Set<string>();
  for (const a of live(answers)) {
    if (a.questionId) out.add(a.questionId);
  }
  return out;
}

/** The questions of a step nobody has answered or skipped yet, in order. */
export function outstanding(
  step: WalkStep,
  answers: readonly WalkAnswer[],
): WalkQuestion[] {
  const settled = settledIds(answers);
  return step.questions.filter((q) => !settled.has(q.id));
}

/**
 * **THE GUARDRAIL `always_ask` EXISTS FOR.**
 *
 * The walk asks to move on and is refused while a must-ask question of this
 * step is outstanding. Not "warned" — refused: the point of marking a
 * question is that judgement does not get to override it, and a rule that
 * can be talked past is a rule nobody relies on.
 *
 * A question marked always-ask may still be SKIPPED by a person, because a
 * person is not the thing being guarded against. It may not be skipped by
 * the walk, and `recordAnswers` is where that is enforced.
 */
export function mustAskOutstanding(
  step: WalkStep,
  answers: readonly WalkAnswer[],
): WalkQuestion[] {
  return outstanding(step, answers).filter((q) => q.alwaysAsk);
}

/** Nothing left outstanding: every question answered or skipped. */
export function stepIsCovered(step: WalkStep, answers: readonly WalkAnswer[]): boolean {
  return outstanding(step, answers).length === 0;
}

/**
 * Where the walk actually is: the bookmark if it still points at a step with
 * work in it, otherwise the first step that has any.
 *
 * Falling back rather than trusting the bookmark is what makes an outline
 * edited mid-walk safe. Delete the step somebody is on and they land on the
 * next one with questions; add a step before it and they are taken back to
 * it, which is the behaviour the founder asked for when he said a question he
 * adds mid-bid should show up in the bid he is doing.
 */
export function currentStep(
  steps: readonly WalkStep[],
  answers: readonly WalkAnswer[],
  bookmark: string | null,
): WalkStep | null {
  const marked = bookmark ? steps.find((s) => s.id === bookmark) : undefined;
  if (marked && !stepIsCovered(marked, answers)) return marked;
  return steps.find((s) => !stepIsCovered(s, answers)) ?? null;
}

/**
 * The step after this one that still has work, or null when the walk is out
 * of steps. A step with no questions at all is already covered, so it is
 * passed straight through — which is what the outline editor warns about
 * when it says a step is "asking nothing".
 */
export function nextStep(
  steps: readonly WalkStep[],
  answers: readonly WalkAnswer[],
  afterId: string,
): WalkStep | null {
  const at = steps.findIndex((s) => s.id === afterId);
  const rest = at === -1 ? steps : steps.slice(at + 1);
  return rest.find((s) => !stepIsCovered(s, answers)) ?? null;
}

/**
 * WHERE THE WALK GOES WHEN A PHASE LANDS, and **null only when nothing
 * anywhere is outstanding** — which is the one thing that ends a walk.
 *
 * `nextStep` looks FORWARD, and that was the whole rule while a walk could
 * only ever go forwards. X4 made it possible to jump about, and forwards
 * stopped meaning finished: walk EST-6 on dev was taken to Painting from the
 * rail, answered it and Landscaping, and **closed itself over eight phases
 * nobody had ever been asked about** — because Landscaping is last on the
 * list, so there was no step after it.
 *
 * A walk is finished when nothing is outstanding, not when the questions run
 * out ([ADR 0099](../../../docs/decisions/0099-a-walk-is-finished-when-nothing-is-outstanding-not-when-the-questions-run-out.md)).
 * So the walk carries on to the next phase with work in it — after this one
 * if there is one, and back up the list if there is not.
 */
export function onwardStep(
  steps: readonly WalkStep[],
  answers: readonly WalkAnswer[],
  afterId: string,
): WalkStep | null {
  return nextStep(steps, answers, afterId) ?? currentStep(steps, answers, null);
}

export interface WalkProgress {
  steps: number;
  /** Steps with nothing outstanding. */
  covered: number;
  questions: number;
  answered: number;
  skipped: number;
  /** Questions the walk asked that the outline never had. */
  volunteered: number;
  /** Must-ask questions still outstanding, anywhere in the outline. */
  mustAskLeft: number;
}

export function walkProgress(
  steps: readonly WalkStep[],
  answers: readonly WalkAnswer[],
): WalkProgress {
  const byId = liveByQuestion(answers);
  let questions = 0;
  let answered = 0;
  let skipped = 0;
  let covered = 0;
  let mustAskLeft = 0;
  for (const step of steps) {
    questions += step.questions.length;
    if (stepIsCovered(step, answers)) covered += 1;
    for (const q of step.questions) {
      const a = byId.get(q.id);
      if (!a) {
        if (q.alwaysAsk) mustAskLeft += 1;
        continue;
      }
      if (a.skipped) skipped += 1;
      else answered += 1;
    }
  }
  return {
    steps: steps.length,
    covered,
    questions,
    answered,
    skipped,
    volunteered: live(answers).filter((a) => !a.questionId).length,
    mustAskLeft,
  };
}

/**
 * What the walk offers as buttons for a question, or nothing when the answer
 * has to be typed. The kinds are the outline's; this is the one place that
 * turns them into taps.
 */
export function quickRepliesFor(question: WalkQuestion): string[] {
  switch (question.kind) {
    case "choice":
      return question.choices;
    case "yes_no":
      return ["Yes", "No"];
    default:
      return [];
  }
}
