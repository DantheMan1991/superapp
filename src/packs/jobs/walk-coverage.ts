import { formatMoney } from "@/lib/money";
import { normalizedCode } from "./assembly-math";
import { outstanding, type WalkAnswer, type WalkQuestion, type WalkStep } from "./walk-math";

/**
 * A PHASE THE ESTIMATE ALREADY HAS (X17, ADR 0108). Pure.
 *
 * The takeoff off the model (X15) puts drywall, framing and roofing on the
 * estimate before the walk starts, and a person types items by hand. Until
 * this, the walk could not see any of it: it asked its drywall questions,
 * proposed drywall lines, and the estimate carried the drywall twice. The
 * walk's own lines it always knew about (X9 lands a phase in the item it
 * already made); these are everybody else's.
 *
 * ── WHAT COUNTS AS THE PHASE'S ──────────────────────────────────────────────
 *
 * A line is a phase's when it carries the phase's cost code, or when it sits
 * in an item named after the assembly the phase is pinned to (X11). Both are
 * facts the business stated — the code on the step, the pin on the step —
 * and neither is a guess about words. A line that matches nothing belongs to
 * no phase and the walk says nothing about it, which is right: the estimate
 * is the estimator's to fill however they like.
 *
 * ── AND WHAT THE WALK DOES ABOUT IT ─────────────────────────────────────────
 *
 * It is stated at the gate with the usual (X13): *"these phases are already
 * on the estimate, so I will move past them"*, one tap. Agreed, a covered
 * phase's questions are settled as skipped when it opens — every one but a
 * must-ask — and the phase ends in the money it already has rather than in a
 * second proposal. Refused, the questions are asked; the phase still ends in
 * the money it already has, because a refusal means *ask me*, not *price
 * the drywall twice*.
 */

/** A line on the estimate this walk did not write, as the rule reads it. */
export interface EstimateLineFacts {
  id: string;
  /** The code number on this job's set; blank when the line is uncoded. */
  costCode: string;
  /** The item it sits in; blank when it is loose. */
  groupName: string;
  description: string;
  costCents: number;
  basis: string;
  basisDetail: string;
}

export interface PhaseCoverage {
  stepId: string;
  title: string;
  lines: EstimateLineFacts[];
  costCents: number;
  /** Lines nothing could price — a basis of `none` at no cost. */
  unpriced: number;
  /** "off the model", "2 of 3 off the model", or blank when nothing says. */
  from: string;
}

const OFF_THE_MODEL = /\boff the model\b/i;

function fromWords(lines: readonly EstimateLineFacts[]): string {
  const off = lines.filter((l) => OFF_THE_MODEL.test(l.basisDetail)).length;
  if (off === 0) return "";
  if (off === lines.length) return "off the model";
  return `${off} of ${lines.length} off the model`;
}

/**
 * The lines on the estimate that are this phase's, or null when none are.
 * `assemblyNames` is the library by id, for the pin.
 */
export function coverageOf(
  step: Pick<WalkStep, "id" | "title" | "costCode" | "assemblyId">,
  lines: readonly EstimateLineFacts[],
  assemblyNames: ReadonlyMap<string, string> = new Map(),
): PhaseCoverage | null {
  const code = normalizedCode(step.costCode);
  const pinned = step.assemblyId ? (assemblyNames.get(step.assemblyId) ?? "") : "";
  const item = pinned.trim().toLowerCase();
  const mine = lines.filter((l) => {
    if (code !== "" && normalizedCode(l.costCode) === code) return true;
    if (item !== "" && l.groupName.trim().toLowerCase() === item) return true;
    return false;
  });
  if (mine.length === 0) return null;
  return {
    stepId: step.id,
    title: step.title,
    lines: mine,
    costCents: mine.reduce((n, l) => n + l.costCents, 0),
    unpriced: mine.filter((l) => l.costCents <= 0 && l.basis === "none").length,
    from: fromWords(mine),
  };
}

/** Every phase the estimate already has, in outline order. */
export function coveredPhases(
  steps: readonly WalkStep[],
  lines: readonly EstimateLineFacts[],
  assemblyNames: ReadonlyMap<string, string> = new Map(),
): PhaseCoverage[] {
  if (lines.length === 0) return [];
  return steps
    .map((s) => coverageOf(s, lines, assemblyNames))
    .filter((c): c is PhaseCoverage => c !== null);
}

function figure(c: PhaseCoverage, symbol: string | null): string {
  const n = c.lines.length;
  const money = c.unpriced === n ? "no prices yet" : formatMoney(c.costCents, symbol);
  const tail = c.from === "" ? "" : `, ${c.from}`;
  return `${money} in ${n} ${n === 1 ? "line" : "lines"}${tail}`;
}

/** What the gate says, one line a phase: "- Drywall — $6,952.50 in 2 lines, off the model". */
export function coverageLines(covered: readonly PhaseCoverage[], symbol: string | null): string[] {
  return covered.map((c) => `- ${c.title} — ${figure(c, symbol)}`);
}

/** The reason a covered phase's questions carry once settled. */
export function coverageReason(c: PhaseCoverage, symbol: string | null): string {
  return `already on the estimate — ${figure(c, symbol)}`;
}

/**
 * The questions a covered phase settles without asking: everything still
 * outstanding except a must-ask, which is asked whatever the estimate holds
 * — *"Is there asbestos?"* is not answered by the drywall being priced.
 */
export function questionsToSettle(step: WalkStep, answers: readonly WalkAnswer[]): WalkQuestion[] {
  return outstanding(step, answers).filter((q) => !q.alwaysAsk);
}
