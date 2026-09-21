import { outstanding, type WalkAnswer, type WalkStep } from "./walk-math";

/**
 * WHAT NEVER VARIES (X13). Pure — no database, no model.
 *
 * ── THE PROBLEM, IN THE FOUNDER'S WORDS ─────────────────────────────────────
 *
 * On the shape of his work: *"i'd say 80/20 standard vs custom."* And on what
 * the walk felt like, with a screenshot attached: *"I'm getting questions like
 * this one: who is doing this one. it doesn't give any context."*
 *
 * A thirty-three phase outline that asks who is doing each one is thirty-three
 * questions with a single answer, and the whole target is **a bid in
 * forty-five minutes**. The 80 is what this slice is for.
 *
 * ── WHY IT IS SAID ALOUD FIRST, AND NOT JUST APPLIED ────────────────────────
 *
 * Settling an answer nobody has seen is the exact failure this layer refuses
 * everywhere else: a plausible answer that goes into a bid unread. So the
 * walk STATES the standards before the first phase, in one screen, and
 * settles nothing until it is told the statement is right — after which every
 * answer it takes that way says on the record where it came from.
 *
 * ── WHY THEY ARE GROUPED BY WHAT THEY SAY ───────────────────────────────────
 *
 * Listing thirty-three phases each with *"Who is doing this one? In-house"*
 * is a screen nobody reads, and a screen nobody reads is worse than no screen
 * — it is a rubber stamp with the founder's name on it. Grouped, the same
 * thing is one line: *"Who is doing this one? In-house — every phase."* What
 * he is being asked to check is then small enough to actually check, and an
 * odd one out stands on its own line where it can be seen.
 */

/** One question the outline answers for itself. */
export interface Standard {
  stepId: string;
  stepTitle: string;
  questionId: string;
  prompt: string;
  answer: string;
}

/** The same thing said about several phases. */
export interface UsualGroup {
  prompt: string;
  answer: string;
  /** The phases it is true of, in outline order. */
  steps: string[];
}

/**
 * Every standard the outline carries, in the order it is walked.
 *
 * **A MUST-ASK QUESTION IS NEVER ONE.** `writeSteps` refuses to store a
 * standard against one, and this refuses to read one — the same rule at both
 * ends, because a row written before the rule existed must not start being
 * obeyed by a later reader.
 */
export function standardsIn(steps: readonly WalkStep[]): Standard[] {
  const out: Standard[] = [];
  for (const step of steps) {
    for (const q of step.questions) {
      const answer = q.standardAnswer.trim();
      if (answer === "" || q.alwaysAsk) continue;
      out.push({
        stepId: step.id,
        stepTitle: step.title,
        questionId: q.id,
        prompt: q.prompt,
        answer,
      });
    }
  }
  return out;
}

/**
 * The standards of ONE phase that nobody has answered yet.
 *
 * Read against the live answers rather than blindly, so a phase somebody has
 * already been through — or come back to and re-opened — is not quietly
 * re-answered underneath them.
 */
export function standardsOutstanding(
  step: WalkStep,
  answers: readonly WalkAnswer[],
): Standard[] {
  const left = new Set(outstanding(step, answers).map((q) => q.id));
  return standardsIn([step]).filter((s) => left.has(s.questionId));
}

/** The same (question, answer) said once, with the phases it covers. */
export function groupStandards(standards: readonly Standard[]): UsualGroup[] {
  const out: UsualGroup[] = [];
  const at = new Map<string, number>();
  for (const s of standards) {
    const key = `${s.prompt.trim().toLowerCase()}|${s.answer.trim().toLowerCase()}`;
    const seen = at.get(key);
    if (seen === undefined) {
      at.set(key, out.length);
      out.push({ prompt: s.prompt.trim(), answer: s.answer, steps: [s.stepTitle] });
    } else if (!out[seen].steps.includes(s.stepTitle)) {
      out[seen].steps.push(s.stepTitle);
    }
  }
  return out;
}

/**
 * What the walk says, one line a group.
 *
 * `totalSteps` is how many phases the outline has, so a standard that covers
 * all of them reads *"every phase"* rather than a list of thirty-three names
 * nobody will read to the end of.
 */
export function usualLines(
  groups: readonly UsualGroup[],
  totalSteps: number,
): string[] {
  return groups.map((g) => {
    const where =
      totalSteps > 0 && g.steps.length === totalSteps
        ? "every phase"
        : g.steps.join(", ");
    return `- ${g.prompt} ${g.answer} — ${where}`;
  });
}

/** "7 questions across 5 phases" — what the confirm is asking about. */
export function usualSize(standards: readonly Standard[]): {
  questions: number;
  steps: number;
} {
  return {
    questions: standards.length,
    steps: new Set(standards.map((s) => s.stepId)).size,
  };
}

/**
 * Did they say no?
 *
 * **GENEROUS ON PURPOSE, AND ONLY IN THIS DIRECTION.** The two buttons are
 * what this is answered with nearly always; these are the words somebody
 * types instead of pressing one. Reading an unclear reply as a YES would
 * settle a screenful of answers on somebody who meant to object — so a reply
 * that looks at all like a refusal is one, and agreeing has to look like
 * agreement.
 */
export function refusesTheUsual(said: string): boolean {
  const text = said.trim().toLowerCase();
  if (text === "") return false;
  return /\b(no|nope|not|ask|everything|each|change|different|wrong|some|hold on|wait)\b/.test(
    text,
  );
}
