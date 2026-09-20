import { OUTLINE_QUESTION_KINDS, type OutlineQuestionKind } from "@/db/schema";
import { normalizedCode } from "./assembly-math";

/**
 * ESTIMATE OUTLINES, the pure half (X1, ADR 0098).
 *
 * Everything here is arithmetic on a list: what a question's options may be,
 * what order the rows go back in, and the one derivation worth having —
 * a starter outline read off a cost code list, because a business's chart of
 * cost is already the phases of its work in the order it does them.
 *
 * The rules the database also enforces are mirrored here on purpose. A CHECK
 * is the backstop and gives "violates check constraint"; this gives a builder
 * a sentence they can act on, before the write is attempted.
 */

export interface OutlineQuestionShape {
  /** Present on a question that already exists; absent makes a new one. */
  id?: string;
  prompt: string;
  kind?: OutlineQuestionKind;
  choices?: string[];
  unit?: string;
  notes?: string;
  /** The interview may never decide this one is irrelevant (ADR 0098). */
  alwaysAsk?: boolean;
}

export interface OutlineStepShape {
  id?: string;
  /**
   * A handle for a step created in this same save, so its questions can name
   * it before it has an id. The estimate's groups do the same (ADR 0082).
   */
  key?: string;
  title: string;
  costCode?: string;
  guidance?: string;
  questions?: OutlineQuestionShape[];
}

/** Sort orders in tens, so a row can be dropped between two without a rewrite. */
export function sortOrderAt(index: number): number {
  return (index + 1) * 10;
}

export function isQuestionKind(value: string): value is OutlineQuestionKind {
  return (OUTLINE_QUESTION_KINDS as readonly string[]).includes(value);
}

/**
 * WHAT A QUESTION'S OPTIONS ACTUALLY ARE, once the blanks and the duplicates
 * are gone.
 *
 * Only a `choice` has options; every other kind is given none, rather than
 * being refused for carrying them. A form that has just switched a question
 * from "Block or poured?" to a number still has the two options in its state,
 * and rejecting the save over a field the person can no longer see is a dead
 * end. Dropping them is what they meant.
 *
 * Duplicates go because two identical buttons are one button that does not
 * work, and case is kept as typed — "Poured" and "poured" are the same option
 * to a reader, so the first spelling wins.
 */
export function normalizeChoices(
  kind: OutlineQuestionKind,
  choices: readonly string[] | undefined,
): string[] {
  if (kind !== "choice") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of choices ?? []) {
    const value = raw.trim();
    if (value === "") continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * The first thing wrong with this outline, as a sentence, or null.
 *
 * One issue at a time rather than a list: the editor shows it against the save
 * button, and a builder fixes one thing and presses it again. The order is the
 * order somebody reads the form in.
 */
export function outlineIssue(steps: readonly OutlineStepShape[]): string | null {
  if (steps.length === 0) return "An outline needs at least one step.";

  const titles = new Set<string>();
  for (const step of steps) {
    const title = step.title.trim();
    if (title === "") return "Every step needs a name.";
    const key = title.toLowerCase();
    /**
     * TWO STEPS BY THE SAME NAME ARE REFUSED, although the database allows
     * them. The interview says the step's name out loud and records an answer
     * against it; two "Foundation"s make a transcript nobody can read back.
     */
    if (titles.has(key)) return `Two steps are both called "${title}".`;
    titles.add(key);

    const prompts = new Set<string>();
    for (const question of step.questions ?? []) {
      const prompt = question.prompt.trim();
      if (prompt === "") return `A question under "${title}" has nothing in it.`;
      const kind = question.kind ?? "text";
      if (!isQuestionKind(kind)) return `"${prompt}" has a kind nothing understands.`;
      if (kind === "choice" && normalizeChoices(kind, question.choices).length < 2) {
        return `"${prompt}" is a choice and needs at least two options.`;
      }
      const promptKey = prompt.toLowerCase();
      if (prompts.has(promptKey)) return `"${title}" asks "${prompt}" twice.`;
      prompts.add(promptKey);
    }
  }
  return null;
}

/** What the editor prints at the top, and what the picker shows per outline. */
export interface OutlineSummary {
  steps: number;
  questions: number;
  /** Steps that ask nothing — legal, and worth pointing at. */
  silentSteps: number;
  /** Steps with no cost code, which the interview cannot file under a code. */
  uncodedSteps: number;
}

export function summarizeOutline(steps: readonly OutlineStepShape[]): OutlineSummary {
  let questions = 0;
  let silentSteps = 0;
  let uncodedSteps = 0;
  for (const step of steps) {
    const count = step.questions?.length ?? 0;
    questions += count;
    if (count === 0) silentSteps += 1;
    if ((step.costCode ?? "").trim() === "") uncodedSteps += 1;
  }
  return { steps: steps.length, questions, silentSteps, uncodedSteps };
}

/**
 * THE ONE QUESTION THAT IS TRUE OF EVERY PHASE OF EVERY JOB.
 *
 * A generated outline asks it and stops. Who does the work decides everything
 * downstream — whether the interview prices labour and material, carries one
 * lump from a subcontractor's number, or writes the phase into the exclusions
 * — and it is the only question that needs no knowledge of the trade to ask.
 *
 * Everything else a builder adds themselves, which is the point: a pack that
 * shipped "is the footer 24 inches?" would have made the software know one
 * business's house (`tests/packs.test.ts` scans for exactly this).
 */
export const WHO_DOES_IT: OutlineQuestionShape = {
  prompt: "Who is doing this one?",
  kind: "choice",
  choices: ["In-house", "Bidding it out", "By others", "Not on this job"],
  notes:
    "Bidding it out sends the scope to the subcontractors you pick. By others means somebody else's contract pays for it, so it is an exclusion rather than a line.",
};

/**
 * A STARTER OUTLINE READ OFF A COST CODE LIST.
 *
 * A business's chart of cost is already its phases, in the order it builds
 * them — the residential starter list is in build order for exactly that
 * reason — so the fastest way to a usable outline is to take the list it
 * already keeps and ask the one question above at every stop. A builder then
 * prunes the phases this kind of job never has and writes the real questions
 * into the ones it does.
 *
 * Retired codes are left out: a chart keeps them so old budgets still read,
 * and an interview should not stop at a phase the business no longer sells.
 */
export function outlineFromCostCodes(
  codes: readonly { code: string; name: string; isActive?: boolean }[],
): OutlineStepShape[] {
  return codes
    .filter((c) => c.isActive !== false)
    .map((c) => ({
      title: c.name,
      costCode: c.code,
      guidance: "",
      questions: [{ ...WHO_DOES_IT }],
    }));
}

/* ------------------------------------------------------------------------
 * WHETHER A STEP'S COST CODE IS A CODE THIS BUSINESS HAS.
 *
 * An outline carries a code as TEXT so it can be walked on a job using any
 * of the tenant's cost code lists (ADR 0098). The price of that is a typo
 * nobody notices: a step written `2O00` resolves to nothing when the
 * interview reaches a job, the lines come out uncoded, and the first sign of
 * it is a budget with a hole in it. So the editor checks as somebody types.
 *
 * **IT MUST AGREE WITH `resolveCostCode`** — the function the interview will
 * actually use — which is why the normalizer is imported rather than written
 * again here. A second one would mean a code the editor calls good and the
 * walk cannot find.
 * ---------------------------------------------------------------------- */

/** One of the tenant's cost code lists, as the editor needs to see it. */
export interface CostCodeBook {
  id: string;
  name: string;
  isDefault: boolean;
  codes: { code: string; name: string }[];
}

export interface CodeStanding {
  /**
   * `none` — nothing typed. `everywhere` — every list has it. `partial` —
   * some do, and `missingFrom` names the rest. `missing` — no list has it,
   * which is the one worth a warning.
   */
  state: "none" | "everywhere" | "partial" | "missing";
  /** What the code is called, from the first list that has it. */
  name: string;
  /** The lists that do NOT carry it, by name. */
  missingFrom: string[];
}

export function codeStanding(
  written: string,
  books: readonly CostCodeBook[],
): CodeStanding {
  const want = normalizedCode(written ?? "");
  if (want === "") return { state: "none", name: "", missingFrom: [] };
  if (books.length === 0) return { state: "missing", name: "", missingFrom: [] };

  let name = "";
  const missingFrom: string[] = [];
  for (const book of books) {
    const hit = book.codes.find((c) => normalizedCode(c.code) === want);
    if (hit) {
      if (name === "") name = hit.name;
    } else {
      missingFrom.push(book.name);
    }
  }
  if (name === "") return { state: "missing", name: "", missingFrom };
  return {
    state: missingFrom.length === 0 ? "everywhere" : "partial",
    name,
    missingFrom,
  };
}

/**
 * The one number worth putting at the top of the editor: how many steps carry
 * a code that NO list of this business has. Steps with no code at all are
 * already counted by `summarizeOutline`, and are a different thing — a
 * deliberate blank rather than a mistake.
 */
export function stepsWithUnknownCode(
  steps: readonly OutlineStepShape[],
  books: readonly CostCodeBook[],
): number {
  let n = 0;
  for (const step of steps) {
    if (codeStanding(step.costCode ?? "", books).state === "missing") n += 1;
  }
  return n;
}
