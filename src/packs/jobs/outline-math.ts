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
  /** The part of the bid this step belongs to; a heading, not a code. */
  section?: string;
  costCode?: string;
  guidance?: string;
  /**
   * The assembly this step always makes (X11), by id, or null for none.
   * **Absent and null differ**: absent leaves the pin alone, null clears it,
   * which is what an editor posting the whole outline needs in order to be
   * able to unpin one.
   */
  assemblyId?: string | null;
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

/* ------------------------------------------------------------------------
 * A STARTER OUTLINE READ OFF A CHART OF COST.
 *
 * A business's chart is already its phases in the order it builds them, so
 * the shortest road to a usable outline is the list it already keeps.
 *
 * ── ONE STEP PER CODE WAS RIGHT UNTIL A REAL CHART TURNED UP ───────────────
 *
 * It gave a fine outline off a 38-code starter list. The pilot's own chart is
 * **291 codes**, because it splits every phase by the KIND of cost —
 * `03.20 Excavation Labor`, `03.21 Excavation Trucking`, `03.40 Excavation
 * Material`, five more. A 291-step interview is not an interview. What a
 * person walks is the WORK ITEM, `Excavation`, once; the kinds of cost
 * underneath it are the lines that come out the other end.
 *
 * ── GROUPED BY WHAT THE NAMES SHARE, NOT BY WORDS THIS FILE KNOWS ──────────
 *
 * **Nothing here knows what "Labor" or "Material" mean**, and it must not:
 * those are one business's suffixes, and the next business splits by crew, or
 * by phase of install, or not at all. Adjacent codes are grouped while their
 * names keep sharing a leading prefix, and the prefix is the step's title.
 *
 * **A GROUP'S PREFIX IS SET BY ITS FIRST TWO MEMBERS AND MAY NOT SHRINK
 * AFTERWARDS.** Without that rule `Interior Trim Labor` and `Interior Paint
 * Labor` collapse into one step called `Interior`, which is not a thing
 * anybody builds. With it they stay two, and `Excavation`'s eight stay one.
 *
 * Codes are only ever grouped with their NEIGHBOURS, so the chart's own order
 * is what decides — which is the same order the walk then follows.
 *
 * ── A STARTER IS A FLOOR, NOT A CEILING ────────────────────────────────────
 *
 * The grouping is a guess at somebody's naming and it will occasionally join
 * two things or split one. That is fine and always was: what comes out is an
 * outline to prune and rewrite, not a contract. Retired codes are left out —
 * a chart keeps them so old budgets still read, and an interview should not
 * stop at a phase the business no longer sells.
 * ---------------------------------------------------------------------- */

/** The leading words every one of these names shares, in the first's casing. */
export function sharedPrefix(names: readonly string[]): string {
  if (names.length === 0) return "";
  const split = names.map((n) => n.trim().split(/\s+/).filter(Boolean));
  const first = split[0] ?? [];
  let i = 0;
  while (
    i < first.length &&
    split.every((w) => (w[i] ?? "").toLowerCase() === first[i].toLowerCase())
  ) {
    i += 1;
  }
  return first.slice(0, i).join(" ");
}

export interface WorkItem {
  /** The shared prefix — `Excavation`, `Interior Trim` — or the lone name. */
  title: string;
  /** The part of the bid it belongs to, from the codes' own category. */
  section: string;
  /** Every code that rolls up into it, in the chart's order. */
  codes: { code: string; name: string }[];
}

export interface ChartCode {
  code: string;
  name: string;
  category?: string;
  isActive?: boolean;
}

/**
 * The chart, folded into the things a person actually walks. Grouping never
 * crosses a category, because two phases that happen to start with the same
 * word in different parts of a bid are not one phase.
 */
export function workItemsFrom(codes: readonly ChartCode[]): WorkItem[] {
  const live = codes.filter((c) => c.isActive !== false);
  const out: WorkItem[] = [];
  let prefix = "";

  for (const c of live) {
    const section = c.category?.trim() ?? "";
    const last = out[out.length - 1];
    if (last && last.section === section) {
      const merged = sharedPrefix([...last.codes.map((x) => x.name), c.name]);
      const keeps =
        merged !== "" && (prefix === "" || merged.toLowerCase() === prefix.toLowerCase());
      if (keeps) {
        last.codes.push({ code: c.code, name: c.name });
        prefix = merged;
        continue;
      }
    }
    out.push({ title: c.name, section, codes: [{ code: c.code, name: c.name }] });
    prefix = "";
  }

  for (const item of out) {
    item.title = sharedPrefix(item.codes.map((c) => c.name)) || item.codes[0].name;
  }
  return out;
}

/**
 * An outline off the chart: one step per work item, carrying its section and
 * the one question that needs no knowledge of the trade to ask.
 *
 * **THE STEP TAKES THE FIRST OF ITS CODES, as a starting point rather than an
 * answer.** A work item spanning eight codes has no single one, and the lines
 * a walk produces carry their own — the step's is what a bid request is
 * matched on and what shows on the step card, and it is meant to be edited.
 */
export function outlineFromCostCodes(codes: readonly ChartCode[]): OutlineStepShape[] {
  return workItemsFrom(codes).map((item) => ({
    title: item.title,
    section: item.section,
    costCode: item.codes[0].code,
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
