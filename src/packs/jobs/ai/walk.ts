import "server-only";
import { CLAUDE_FAST_MODEL, CLAUDE_THINKING_OFF, getClaude } from "@/lib/claude";
import type { WalkAnswer, WalkQuestion, WalkStep } from "../walk-math";
import { quickRepliesFor } from "../walk-math";

/**
 * THE WALK'S TURN (X2a, ADR 0098): what to say next, and what the last thing
 * said established.
 *
 * ── IT GATHERS. IT DOES NOT PRICE. ──────────────────────────────────────────
 *
 * Not a division of labour for tidiness: a model that may put a number on a
 * line is a model that will, and **a plausible wrong number in an estimate is
 * worse than a refusal, because it goes out in a proposal** (the assembly
 * tests' own words). X2b turns answers into lines, from the assembly library,
 * the price memory and what the builder typed — each with a basis you can
 * see. This turn's only output is words and answers.
 *
 * ── THE OUTLINE IS THE FLOOR, NOT THE CEILING ───────────────────────────────
 *
 * It may ask things the outline never contained, and it should: say walkout
 * basement and somebody wants to know about the retaining wall whether it was
 * written down or not. Those come back with no `questionId`, and the founder's
 * own objection is why they exist — *"there is no way I am ever going to have
 * all of the questions 100% perfect."*
 *
 * ── AND IT MAY NOT SKIP A MUST-ASK QUESTION ─────────────────────────────────
 *
 * Said here, and REFUSED in `recordAnswers`. A rule that lives only in a
 * prompt is a rule a model can be talked out of.
 */

/**
 * SIZED FOR THE TOOL, WITH NO THINKING IN THE WAY.
 *
 * The first version asked for adaptive thinking inside a 4,000-token budget,
 * and `src/lib/claude.ts` warns in so many words what that does: **max_tokens
 * caps thinking AND the response together, so a tight budget truncates
 * mid-tool-call.** A truncated call has no complete `tool_use` block, the
 * turn comes back null, and the screen says *"It could not answer just
 * then"* — which is exactly what the founder kept hitting. Written down
 * because the warning was already in the file when this was written.
 *
 * The output is one short paragraph and a handful of short records. Two
 * thousand is generous for that, and with thinking off it cannot be eaten.
 */
export const WALK_TURN_MAX_TOKENS = 2_000;

export const WALK_TURN_TOOL = {
  name: "walk_turn",
  input_schema: {
    type: "object" as const,
    properties: {
      record: {
        type: "array",
        maxItems: 10,
        description:
          "What the person's last message established. One entry per thing settled, including answers they volunteered without being asked. Leave questionId out for something the outline never asked.",
        items: {
          type: "object",
          properties: {
            questionId: {
              type: "string",
              description: "The outline question this answers, copied exactly. Omit for your own question.",
            },
            prompt: {
              type: "string",
              description: "The question as it was put to them.",
            },
            answer: {
              type: "string",
              description: "What they said, in their words, tidied to a phrase. Never invented.",
            },
          },
          required: ["prompt", "answer"],
        },
      },
      skip: {
        type: "array",
        maxItems: 10,
        description:
          "Outline questions this job does not need, because the answers so far made them moot. Never a question marked ALWAYS ASK.",
        items: {
          type: "object",
          properties: {
            questionId: { type: "string" },
            reason: {
              type: "string",
              description: "One short clause: 'the wall is block, so there is no rebar in it'.",
            },
          },
          required: ["questionId", "reason"],
        },
      },
      say: {
        type: "string",
        description:
          "What to say next: at most two short sentences, ending in ONE question. Plain site language. Do not restate what they just told you.",
      },
      askingQuestionId: {
        type: "string",
        description:
          "REQUIRED whenever you are asking one of the questions listed above: copy its id exactly. Omit it only for a question of your own that is not on the list.",
      },
      quickReplies: {
        type: "array",
        maxItems: 6,
        items: { type: "string", maxLength: 40 },
        description:
          "Buttons for the question you are asking. Use the question's own options when it has them. Leave empty when the answer has to be typed.",
      },
      stepDone: {
        type: "boolean",
        description:
          "True when everything this step needs is settled and the walk should move on. When it is true, `say` is a single closing line and NOT a question — a step you are still asking about is not done.",
      },
    },
    required: ["record", "skip", "say", "stepDone"],
  },
};

export interface WalkTurn {
  record: { questionId?: string; prompt: string; answer: string }[];
  skip: { questionId: string; reason: string }[];
  say: string;
  askingQuestionId?: string;
  quickReplies: string[];
  stepDone: boolean;
}

function questionLine(q: WalkQuestion): string {
  const bits = [`- [${q.id}] ${q.prompt}`];
  const shape =
    q.kind === "choice"
      ? `one of: ${q.choices.join(", ")}`
      : q.kind === "yes_no"
        ? "yes or no"
        : q.kind === "number"
          ? `a number${q.unit ? ` in ${q.unit}` : ""}`
          : q.kind === "money"
            ? "an amount of money"
            : "anything";
  bits.push(`  expects ${shape}`);
  if (q.alwaysAsk) bits.push("  ALWAYS ASK — you may not skip this one");
  if (q.notes.trim()) bits.push(`  note: ${q.notes.trim()}`);
  return bits.join("\n");
}

/**
 * THE PROMPT IS BUILT FROM THIS BUSINESS'S OWN FACTS, the Discovery copilot's
 * rule: the outline is the tenant's, the words are the tenant's, and nothing
 * in this file names a trade, a size or a price.
 */
export function walkSystemPrompt(input: {
  jobName: string;
  estimateNumber: string;
  outlineName: string;
  step: WalkStep;
  stepNumber: number;
  stepCount: number;
  /** Everything settled so far on THIS step. */
  settledHere: readonly WalkAnswer[];
  /** A short tail of what earlier steps established, for context. */
  earlier: readonly WalkAnswer[];
  /** What the business calls a job, so the words are theirs. */
  projectWord: string;
  /**
   * THE BUILDING'S OWN NUMBERS (X7), one line each, in EVERY turn.
   *
   * This is the half of the slice the model sees, and the reason the
   * founder asked for it: *"then the questions can use this information as
   * it goes."* An answer drops out of `earlier` after thirty of them, so a
   * walk told 2,400 square feet at framing had forgotten it by drywall.
   * These do not drop out — there are a handful of them and they are facts
   * about the building rather than about a phase.
   */
  measurements: readonly string[];
}): string {
  const outstanding = input.step.questions.filter(
    (q) => !input.settledHere.some((a) => a.questionId === q.id),
  );
  return [
    `You are helping an estimator price a ${input.projectWord.toLowerCase()} by walking through it, one phase at a time. You are not a chatbot and not a salesman; you are the colleague who holds the checklist and notices what is missing.`,
    ``,
    `THE ${input.projectWord.toUpperCase()}: ${input.jobName}`,
    `THE ESTIMATE: ${input.estimateNumber}`,
    `THE WALK: ${input.outlineName}, step ${input.stepNumber} of ${input.stepCount}.`,
    ``,
    input.measurements.length > 0
      ? [
          `MEASURED ON THIS BUILDING — these are facts, use them:`,
          ...input.measurements,
          ``,
        ].join("\n")
      : ``,
    `THIS STEP: ${input.step.title}${input.step.costCode ? ` (cost code ${input.step.costCode})` : ""}`,
    input.step.guidance.trim()
      ? `What the business says about it: ${input.step.guidance.trim()}`
      : ``,
    ``,
    `QUESTIONS THIS STEP STILL NEEDS:`,
    outstanding.length > 0
      ? outstanding.map(questionLine).join("\n")
      : `(none — everything on the list is settled)`,
    ``,
    input.settledHere.length > 0
      ? `SETTLED ON THIS STEP ALREADY:\n${input.settledHere
          .map((a) =>
            a.skipped ? `- ${a.prompt} — SKIPPED: ${a.skipReason}` : `- ${a.prompt} — ${a.answer}`,
          )
          .join("\n")}`
      : ``,
    input.earlier.length > 0
      ? `\nEARLIER IN THIS WALK:\n${input.earlier
          .filter((a) => !a.skipped)
          .map((a) => `- ${a.prompt} — ${a.answer}`)
          .join("\n")}`
      : ``,
    ``,
    `HOW TO DO THIS`,
    ``,
    `1. ASK ONE THING AT A TIME. Two questions in a message gets one answer and a lost question.`,
    `2. GATHER, NEVER PRICE. You do not put numbers on anything. No prices, no rates, no quantities you were not told. If somebody asks what something costs, say the estimate does that next and move on.`,
    `2a. THE MEASUREMENTS ABOVE ARE YOURS TO USE. Never ask for a number that is already up there. Work from them out loud instead — "wall area is 2,232, so that is about 70 sheets, right?" — and let them correct you. Arithmetic on a number you were GIVEN is not pricing; inventing the number would be.`,
    `3. THE LIST IS THE FLOOR, NOT THE CEILING. When an answer opens a door, go through it — a walkout basement means a retaining wall, egress, a door down there. Ask those with no questionId. This is the most useful thing you do.`,
    `4. SKIP WHAT THE ANSWERS MADE POINTLESS, and say why in a clause. Asking about rebar after they said block is how somebody learns to stop reading you.`,
    `5. NEVER SKIP A QUESTION MARKED ALWAYS ASK. It will be refused, and you will have wasted their turn.`,
    `6. RECORD WHAT THEY VOLUNTEER. If one sentence answers three questions, record three.`,
    `7. USE THEIR WORDS. They are on a site, not in a meeting. No "great!", no "I'd be happy to", no restating what they just said back at them.`,
    `8. WHEN NOTHING IS OUTSTANDING, set stepDone and say one line about what you have for this phase. Do NOT ask a question in the same message: a step you are still asking about is not done, and the question would win.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}


/** Punctuation and spacing are not the question. */
function normalizedPrompt(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The step's question whose words the walk just used, or nothing. Only an
 * exact normalised hit counts, and only when one question matches: two
 * questions that reduce to the same words are not a question this can name.
 */
export function matchAsked(say: string, step: WalkStep): string | undefined {
  const said = normalizedPrompt(say);
  if (said === "") return undefined;
  const hits = step.questions.filter((q) => {
    const want = normalizedPrompt(q.prompt);
    return want !== "" && said.includes(want);
  });
  return hits.length === 1 ? hits[0].id : undefined;
}

/** The tool's output, cleaned into something the ops can be handed. */
export function validateWalkTurn(raw: unknown, step: WalkStep): WalkTurn | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.say !== "string" || r.say.trim() === "") return null;

  const known = new Map(step.questions.map((q) => [q.id, q]));
  const record: WalkTurn["record"] = [];
  if (Array.isArray(r.record)) {
    for (const item of r.record) {
      const e = item as Record<string, unknown>;
      if (typeof e?.prompt !== "string" || typeof e?.answer !== "string") continue;
      if (e.prompt.trim() === "" || e.answer.trim() === "") continue;
      /** A questionId the model made up is dropped, not trusted: the answer
       *  still lands, as one the walk asked of its own. */
      const id = typeof e.questionId === "string" && known.has(e.questionId)
        ? e.questionId
        : undefined;
      record.push({ questionId: id, prompt: e.prompt.trim(), answer: e.answer.trim() });
    }
  }

  const skip: WalkTurn["skip"] = [];
  if (Array.isArray(r.skip)) {
    for (const item of r.skip) {
      const e = item as Record<string, unknown>;
      if (typeof e?.questionId !== "string" || typeof e?.reason !== "string") continue;
      const q = known.get(e.questionId);
      /** An unknown question cannot be skipped, and nor can a must-ask one —
       *  refused again in `recordAnswers`, because two guards on this is the
       *  right number. */
      if (!q || q.alwaysAsk || e.reason.trim() === "") continue;
      skip.push({ questionId: e.questionId, reason: e.reason.trim() });
    }
  }

  /**
   * **THE QUESTION IT IS ASKING, RECOVERED WHEN IT FORGETS TO SAY SO.**
   *
   * The founder hit this on the first real walk: it asked *"Block or poured
   * wall?"* — the outline's own words, verbatim — and left `askingQuestionId`
   * out. Three things then went wrong at once. The buttons were the model's
   * three guesses instead of the question's four options; `Come back to this`
   * vanished, because there was no question to come back to; and the answer
   * would have been recorded as one the walk volunteered, leaving the real
   * question outstanding for it to ask all over again.
   *
   * So when the id is missing, the words are matched against the questions
   * this step still owes. Exact on the normalised text only — a near miss is
   * left alone, because mislabelling an answer is worse than a missing chip.
   */
  const claimed =
    typeof r.askingQuestionId === "string" && known.has(r.askingQuestionId)
      ? r.askingQuestionId
      : undefined;
  const askingQuestionId = claimed ?? matchAsked(r.say, step);

  /** The question's own options win over anything the model invented. */
  const asked = askingQuestionId ? known.get(askingQuestionId) : undefined;
  const fromQuestion = asked ? quickRepliesFor(asked) : [];
  const quickReplies =
    fromQuestion.length > 0
      ? fromQuestion
      : Array.isArray(r.quickReplies)
        ? r.quickReplies
            .filter((c): c is string => typeof c === "string" && c.trim() !== "")
            .map((c) => c.trim().slice(0, 40))
            .slice(0, 6)
        : [];

  /**
   * **A STEP YOU ARE STILL ASKING ABOUT IS NOT DONE**, and driving it is what
   * found this: asked to move on, the model set `stepDone` and asked a
   * follow-up in the same breath, so the screen showed the next step's name
   * over the last step's question.
   *
   * The contradiction is resolved in favour of the QUESTION, because the
   * question was the best thing it did — an outline of one question per step
   * cannot know to ask about the existing frame on a barn conversion, and
   * that is the whole reason a model is here. The step cap is what stops a
   * walk that never stops asking.
   */
  const say = r.say.trim();
  const stillAsking = askingQuestionId !== undefined || say.endsWith("?");
  return {
    record,
    skip,
    say,
    askingQuestionId,
    quickReplies,
    stepDone: r.stepDone === true && !stillAsking,
  };
}

/**
 * One turn. Called OUTSIDE any transaction — the cooldown was claimed before
 * this, and what comes back is persisted after it.
 */
export async function takeWalkTurn(input: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  step: WalkStep;
}): Promise<WalkTurn | null> {
  /**
   * **THIS FUNCTION NEVER THROWS, AND THAT IS THE WHOLE POINT.** It used to,
   * on any transient failure — an overloaded model, a dropped socket — and
   * the throw escaped `runTurn` AFTER the first turn had already committed.
   * The screen kept the old question, the walk had moved on, and the next
   * answer landed on a question nobody had seen. The founder found it:
   * *"when you answer it, it actually answers the next question that you
   * don't see yet."*
   *
   * One retry, because most of these are a blip, and then null — which the
   * caller turns into a turn read off the outline rather than an error.
   */
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const turn = await askOnce(input);
      if (turn) return turn;
    } catch {
      /** Deliberately blind: a failure here is a failure, whatever its shape. */
    }
    if (attempt + 1 < ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
  }
  return null;
}

/** How many times a turn is asked for before the outline carries it. */
const ATTEMPTS = 2;
const RETRY_PAUSE_MS = 400;

async function askOnce(input: {
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  step: WalkStep;
}): Promise<WalkTurn | null> {
  const response = await getClaude().messages.create({
    /**
     * FAST, AND NOT THINKING. Both were wrong the first time round and the
     * founder felt both: adaptive thinking on the considered model made a
     * turn take several seconds AND ate the token budget until the tool call
     * truncated. What this turn decides is shallow — read a list, read a
     * transcript, pick the next question — and the deep reasoning in this
     * feature is the sweep over a finished bid, which nobody sits waiting on.
     */
    model: CLAUDE_FAST_MODEL,
    max_tokens: WALK_TURN_MAX_TOKENS,
    thinking: CLAUDE_THINKING_OFF,
    system: input.system,
    tools: [WALK_TURN_TOOL],
    tool_choice: { type: "tool", name: WALK_TURN_TOOL.name },
    messages: input.history.length > 0 ? input.history : [{ role: "user", content: "Begin." }],
  });
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === WALK_TURN_TOOL.name) {
      return validateWalkTurn(block.input, input.step);
    }
  }
  return null;
}
