/**
 * The SHAPE of what a profile may seed into this pack, with no server imports —
 * so a profile's constant can be typed against it and a pure test can check a
 * manifest without opening a database. The applier that writes rows is
 * `./seed.ts`; this file is what it parses with.
 *
 * **THE PACK OWNS THE SHAPE, THE PROFILE OWNS THE DATA.** A profile's
 * `seed.packs.jobs` is `unknown` to the profile type — Layer 0 must not know
 * what a pack's seed looks like — and is parsed here with the same tolerance
 * `deliveryMethodsFrom` has for its config: anything unreadable is nothing,
 * never a crash, because the applier runs inside a superadmin's install and a
 * thrown shape error there would leave a tenant half-installed.
 */
export interface CostCodeSetSeed {
  name: string;
  notes?: string;
  codes: Array<{ code: string; name: string }>;
}

/**
 * The question kinds, repeated here rather than imported.
 *
 * This file takes no imports on purpose — a profile's constant is typed
 * against it and a pure test reads a manifest with it — and importing the
 * schema to reach one array would pull drizzle into every module that touches
 * a profile. `tests/jobs-outline.test.ts` asserts this list is the same as
 * `OUTLINE_QUESTION_KINDS` and the CHECK beside it, so the copy cannot drift
 * quietly.
 */
export const SEED_QUESTION_KINDS = [
  "choice",
  "yes_no",
  "number",
  "money",
  "text",
] as const;

export type SeedQuestionKind = (typeof SEED_QUESTION_KINDS)[number];

export interface EstimateOutlineQuestionSeed {
  prompt: string;
  kind?: SeedQuestionKind;
  choices?: string[];
  unit?: string;
  notes?: string;
}

export interface EstimateOutlineStepSeed {
  title: string;
  costCode?: string;
  guidance?: string;
  questions?: EstimateOutlineQuestionSeed[];
}

/** A starter way of walking an estimate — "New build", "Remodel" (ADR 0098). */
export interface EstimateOutlineSeed {
  name: string;
  notes?: string;
  steps: EstimateOutlineStepSeed[];
}

export interface JobsSeed {
  costCodeSets: CostCodeSetSeed[];
  estimateOutlines?: EstimateOutlineSeed[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Total by construction: unreadable means no lists, never a throw. */
export function costCodeSetsFrom(seed: unknown): CostCodeSetSeed[] {
  const sets = asRecord(seed)?.costCodeSets;
  if (!Array.isArray(sets)) return [];
  const out: CostCodeSetSeed[] = [];
  for (const raw of sets) {
    const set = asRecord(raw);
    if (!set || typeof set.name !== "string" || set.name.trim() === "") continue;
    if (!Array.isArray(set.codes)) continue;
    const codes: CostCodeSetSeed["codes"] = [];
    for (const c of set.codes) {
      const code = asRecord(c);
      if (
        code &&
        typeof code.code === "string" &&
        code.code.trim() !== "" &&
        typeof code.name === "string" &&
        code.name.trim() !== ""
      ) {
        codes.push({ code: code.code.trim(), name: code.name.trim() });
      }
    }
    out.push({
      name: set.name.trim(),
      notes: typeof set.notes === "string" ? set.notes : undefined,
      codes,
    });
  }
  return out;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (typeof v === "string" && v.trim() !== "") out.push(v.trim());
  }
  return out;
}

function questionFrom(raw: unknown): EstimateOutlineQuestionSeed | null {
  const q = asRecord(raw);
  if (!q || typeof q.prompt !== "string" || q.prompt.trim() === "") return null;
  const kind =
    typeof q.kind === "string" &&
    (SEED_QUESTION_KINDS as readonly string[]).includes(q.kind)
      ? (q.kind as SeedQuestionKind)
      : "text";
  /**
   * Options belong to a choice and to nothing else, which the table's CHECK
   * also says. A seeded choice with fewer than two is dropped whole rather
   * than written as a `text` question nobody meant — a starter that quietly
   * changed what it asks is worse than one short question.
   */
  const choices = kind === "choice" ? asStringArray(q.choices) : [];
  if (kind === "choice" && choices.length < 2) return null;
  return {
    prompt: q.prompt.trim(),
    kind,
    choices,
    unit: typeof q.unit === "string" ? q.unit.trim() : undefined,
    notes: typeof q.notes === "string" ? q.notes : undefined,
  };
}

/** Total by construction: unreadable means no outlines, never a throw. */
export function estimateOutlinesFrom(seed: unknown): EstimateOutlineSeed[] {
  const outlines = asRecord(seed)?.estimateOutlines;
  if (!Array.isArray(outlines)) return [];
  const out: EstimateOutlineSeed[] = [];
  for (const raw of outlines) {
    const outline = asRecord(raw);
    if (!outline || typeof outline.name !== "string" || outline.name.trim() === "") {
      continue;
    }
    if (!Array.isArray(outline.steps)) continue;
    const steps: EstimateOutlineStepSeed[] = [];
    for (const rawStep of outline.steps) {
      const step = asRecord(rawStep);
      if (!step || typeof step.title !== "string" || step.title.trim() === "") continue;
      const questions: EstimateOutlineQuestionSeed[] = [];
      if (Array.isArray(step.questions)) {
        for (const rawQuestion of step.questions) {
          const question = questionFrom(rawQuestion);
          if (question) questions.push(question);
        }
      }
      steps.push({
        title: step.title.trim(),
        costCode: typeof step.costCode === "string" ? step.costCode.trim() : undefined,
        guidance: typeof step.guidance === "string" ? step.guidance : undefined,
        questions,
      });
    }
    /** An outline with no readable step is not an outline. */
    if (steps.length === 0) continue;
    out.push({
      name: outline.name.trim(),
      notes: typeof outline.notes === "string" ? outline.notes : undefined,
      steps,
    });
  }
  return out;
}

/** One line for the console, before the button: what this seed would bring. */
export function summarizeJobsSeed(seed: unknown): string | null {
  const sets = costCodeSetsFrom(seed);
  const outlines = estimateOutlinesFrom(seed);
  const parts: string[] = [];
  if (sets.length > 0) {
    const codes = sets.reduce((n, s) => n + s.codes.length, 0);
    parts.push(
      `${sets.length} cost code ${sets.length === 1 ? "list" : "lists"} (${codes} codes)`,
    );
  }
  if (outlines.length > 0) {
    const steps = outlines.reduce((n, o) => n + o.steps.length, 0);
    parts.push(
      `${outlines.length} estimate ${outlines.length === 1 ? "outline" : "outlines"} (${steps} steps)`,
    );
  }
  return parts.length === 0 ? null : parts.join(", ");
}
