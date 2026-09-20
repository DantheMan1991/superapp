import "server-only";
import { CLAUDE_MODEL, getClaude } from "@/lib/claude";
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

export const WALK_TURN_MAX_TOKENS = 4_000;

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
        description: "The outline question you are now asking, copied exactly. Omit when the question is your own.",
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

  const askingQuestionId =
    typeof r.askingQuestionId === "string" && known.has(r.askingQuestionId)
      ? r.askingQuestionId
      : undefined;

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
  const response = await getClaude().messages.create({
    model: CLAUDE_MODEL,
    max_tokens: WALK_TURN_MAX_TOKENS,
    /**
     * ADAPTIVE, and it is the right call here even though it costs latency.
     * The judgement this turn makes — is this question moot, what did that
     * answer open up, what is missing — IS reasoning; a turn that only
     * reads the next line off a list would not need a model at all.
     */
    thinking: { type: "adaptive" },
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
