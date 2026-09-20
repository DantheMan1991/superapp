import { outstanding, quickRepliesFor, settledIds, type WalkAnswer, type WalkStep } from "./walk-math";
import type { WalkTurn } from "./ai/walk";

/**
 * THE WALK WITHOUT THE MODEL.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * The founder's words, after hitting it repeatedly: *"There should be no
 * errors period. If errors start happening people get frustrated and stop
 * using the tool."* He is right, and the shape of the fix was already written
 * down in this feature's first ADR: **the outline is the floor.** A walk that
 * stops dead because a model call timed out has made the model the floor
 * instead, which it never was.
 *
 * So when the model gives nothing back — overloaded, dropped, a tool call
 * that would not validate — the walk carries on from the outline: bank what
 * was just said against the question it was asked, and ask the next question
 * on the list, in the words the business wrote. Deterministic, instant, and
 * the same question the model would almost certainly have asked next.
 *
 * ── WHAT IS LOST, SAID PLAINLY ──────────────────────────────────────────────
 *
 * The model's judgement: noticing a gap the list does not cover, reading
 * three answers out of one sentence, rewording a question to suit the job. A
 * fallback turn asks ONE question and banks ONE answer. That is a worse walk
 * and a working one, and the transcript still records exactly what was asked
 * and exactly what was said — which is the promise that matters.
 *
 * ── IT NEVER GUESSES WHICH QUESTION WAS ANSWERED ────────────────────────────
 *
 * The answer is banked against the question that was ON THE SCREEN, by id
 * when the outline owns it and by its words when the walk asked one of its
 * own. Nothing here infers, matches or recovers: that is the model's job and
 * this runs precisely when the model is not available.
 */

export function outlineTurn(input: {
  step: WalkStep;
  /** Everything that already stands, so the next question is a fresh one. */
  answers: readonly WalkAnswer[];
  /** The outline question on the screen, when it was one of theirs. */
  pendingQuestionId: string | null;
  /** The words on the screen, whoever wrote them. */
  pendingSay: string;
  said: string | undefined;
}): WalkTurn {
  const answer = (input.said ?? "").trim();
  const asked = input.pendingSay.trim();

  const record: WalkTurn["record"] =
    answer !== "" && asked !== ""
      ? [
          {
            ...(input.pendingQuestionId ? { questionId: input.pendingQuestionId } : {}),
            prompt: asked,
            answer,
          },
        ]
      : [];

  /**
   * What is left AFTER banking that, so the fallback cannot ask again the
   * question it has just this moment answered.
   *
   * **ONLY WHAT WAS ACTUALLY RECORDED COUNTS.** Marking the pending question
   * settled because it was PENDING would skip it whenever somebody sent an
   * empty answer — a question quietly dropped out of a bid, which is the
   * class of fault this whole slice exists to remove.
   */
  const settled = settledIds(input.answers);
  if (record.length > 0 && input.pendingQuestionId) settled.add(input.pendingQuestionId);
  const left = input.step.questions.filter((q) => !settled.has(q.id));

  const next = left[0];
  if (!next) {
    return { record, skip: [], say: "", quickReplies: [], stepDone: true };
  }

  return {
    record,
    skip: [],
    /** The business's own words, verbatim. Nothing here writes prose. */
    say: next.prompt,
    askingQuestionId: next.id,
    quickReplies: quickRepliesFor(next),
    stepDone: false,
  };
}

/**
 * Whether the outline still has something to ask on this step — the test
 * `oneTurn` uses to decide whether a fallback can carry the walk at all. When
 * it cannot, there is nothing honest to say and the turn reports the failure
 * rather than inventing a question.
 */
export function outlineCanCarry(step: WalkStep, answers: readonly WalkAnswer[]): boolean {
  return outstanding(step, answers).length > 0;
}
