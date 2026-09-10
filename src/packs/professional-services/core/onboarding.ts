import { addDays } from "@/lib/timezone";

/**
 * The list an engagement starts with — PURE, no database.
 *
 * **THE PACK SHIPS NO LIST OF ITS OWN**, and that is the boundary rather than
 * an omission: a pack that knew a new client needs "W-9 on file" would know it
 * was an accounting firm in the United States. The steps are DATA an industry
 * profile contributes through `packConfig["professional-services"].onboarding`,
 * the same arrangement `livestock.species` and `production.runKinds` have.
 *
 * **AND NOTHING HERE IS A TASK ENGINE.** The steps become ordinary work items
 * through the Layer 0 verbs (`src/lib/work/`), linked to the engagement, so
 * they are ticked off in the same row and by the same rules as a CRM follow-up
 * or a tractor's service — docs/extension-model.md §4b, which a pack building
 * its own checklist table would break.
 *
 * Parsing is TOTAL and tolerant, like `resolveLabels`: `tenant_modules.config`
 * is jsonb with no shape constraint and a profile is hand-written, so anything
 * malformed is dropped individually and nothing throws. A broken config means
 * no steps offered, never a crashed page.
 */

export interface OnboardingStep {
  title: string;
  notes: string;
  /** Days after the start day this is due. Absent = no due date. */
  dueInDays: number | null;
}

export interface OnboardingList {
  name: string;
  /** Engagement kinds this applies to. Empty = every kind. */
  appliesTo: string[];
  steps: OnboardingStep[];
}

/**
 * A ceiling, because a profile is hand-written and a typo should not raise
 * five hundred items into somebody's work list. Generous enough that no real
 * onboarding list will meet it.
 */
export const MAX_STEPS = 50;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function parseStep(value: unknown): OnboardingStep | null {
  const row = asRecord(value);
  if (!row) return null;
  const title = stringOr(row.title, "");
  if (!title) return null;
  const days = row.dueInDays;
  return {
    title: title.slice(0, 500),
    notes: stringOr(row.notes, "").slice(0, 5000),
    dueInDays:
      typeof days === "number" && Number.isFinite(days) && days >= 0
        ? Math.round(days)
        : null,
  };
}

function parseList(value: unknown): OnboardingList | null {
  const row = asRecord(value);
  if (!row) return null;
  const steps = Array.isArray(row.steps)
    ? row.steps.map(parseStep).filter((s): s is OnboardingStep => s !== null)
    : [];
  if (steps.length === 0) return null;
  const appliesTo = Array.isArray(row.appliesTo)
    ? row.appliesTo.filter((k): k is string => typeof k === "string" && k !== "")
    : [];
  return { name: stringOr(row.name, "Onboarding"), appliesTo, steps };
}

/** Every list a profile (or the tenant's own config) contributes. */
export function onboardingListsFrom(config: unknown): OnboardingList[] {
  const root = asRecord(config);
  const raw = root?.onboarding;
  if (!Array.isArray(raw)) return [];
  return raw.map(parseList).filter((l): l is OnboardingList => l !== null);
}

/** The lists that apply to an engagement of this kind. */
export function listsForKind(lists: OnboardingList[], kind: string): OnboardingList[] {
  return lists.filter((l) => l.appliesTo.length === 0 || l.appliesTo.includes(kind));
}

/**
 * The day a step is due, given the day the list starts from.
 *
 * `from` is decided by the caller as the LATER of the engagement's start and
 * today: a future-dated engagement schedules ahead, and a list started late
 * schedules from now rather than arriving with every step already overdue.
 */
export function dueDateFor(step: OnboardingStep, from: string): string | null {
  return step.dueInDays === null ? null : addDays(from, step.dueInDays);
}

/**
 * What raising this engagement's onboarding would ADD, given what is already
 * on it.
 *
 * Matched by TITLE, and deliberately: it makes the button idempotent with no
 * column to store — press it twice and the second press adds nothing; add a
 * step to the profile next month and pressing it again adds only that step.
 * The same additive re-runnable shape `provisionAccounting` and the profile
 * seed applier have. Titles are compared trimmed and case-insensitively, so
 * somebody who retitled an item slightly does not get a duplicate.
 *
 * The cost of matching on title rather than an id is that RENAMING a raised
 * item makes it look missing. That is the right way round: a renamed step is
 * one somebody took charge of, and the original wording is what the profile
 * still says should happen.
 */
export function stepsToRaise(
  lists: OnboardingList[],
  kind: string,
  existingTitles: string[],
): OnboardingStep[] {
  const have = new Set(existingTitles.map((t) => t.trim().toLowerCase()));
  const out: OnboardingStep[] = [];
  for (const list of listsForKind(lists, kind)) {
    for (const step of list.steps) {
      const key = step.title.trim().toLowerCase();
      if (have.has(key)) continue;
      have.add(key);
      out.push(step);
      if (out.length >= MAX_STEPS) return out;
    }
  }
  return out;
}

/**
 * The day the list schedules from: the LATER of the engagement's start and
 * today. A future-dated engagement schedules ahead; a list started late
 * schedules from now rather than arriving with every step already overdue.
 */
export function scheduleFrom(startsOn: string, today: string): string {
  return startsOn > today ? startsOn : today;
}
