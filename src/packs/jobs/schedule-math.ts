import { addDays, datesBetween } from "@/lib/timezone";

/**
 * The arithmetic of a job's schedule (ADR 0071), pure and pinned in the pure
 * suite: dates are `YYYY-MM-DD` keys and a phase runs from its first day to
 * its last day INCLUSIVE, so a one-day phase starts and ends on the same
 * key and a milestone is a phase whose two keys are equal.
 *
 * A dependency is finish-to-start with a lag in days: a successor may not
 * start before its predecessor's last day plus one plus the lag (a negative
 * lag is an overlap — the painter starts two days before the trim is
 * finished). Moving a phase PUSHES its successors forward to keep that
 * true, each keeping its own length; nothing is ever pulled earlier, because
 * a gap the business left is theirs to close.
 */

export interface PhaseDates {
  id: string;
  startOn: string;
  endOn: string;
  predecessorId: string | null;
  lagDays: number;
}

/** Days from `a` to `b`, negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? datesBetween(a, b).length - 1 : -(datesBetween(b, a).length - 1);
}

/** How many days a phase occupies: first to last day inclusive, never less than one. */
export function durationDays(startOn: string, endOn: string): number {
  return Math.max(1, daysBetween(startOn, endOn) + 1);
}

/** The first day a successor may start: the day after its predecessor's last, plus the lag. */
export function earliestStart(predecessorEndOn: string, lagDays: number): string {
  return addDays(predecessorEndOn, 1 + lagDays);
}

/**
 * Would naming `predecessorId` as `phaseId`'s predecessor close a loop? A
 * phase is its own ancestor when the chain of predecessors from the proposed
 * one leads back to it.
 */
export function wouldCycle(phases: readonly PhaseDates[], phaseId: string, predecessorId: string | null): boolean {
  const byId = new Map(phases.map((p) => [p.id, p]));
  let cursor: string | null = predecessorId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === phaseId) return true;
    if (seen.has(cursor)) return true; // an existing loop, which a good graph never has
    seen.add(cursor);
    cursor = byId.get(cursor)?.predecessorId ?? null;
  }
  return false;
}

export interface PhaseMove {
  id: string;
  startOn: string;
  endOn: string;
}

/**
 * Push every successor of the phases in `changed` forward until each starts
 * no earlier than its predecessor allows, keeping every phase's length. The
 * result lists only the phases that moved, in the order they were moved,
 * so the caller can write exactly those. `phases` must carry the changed
 * phases' NEW dates.
 */
export function cascade(phases: readonly PhaseDates[], changed: readonly string[]): PhaseMove[] {
  const state = new Map(phases.map((p) => [p.id, { ...p }]));
  const successorsOf = new Map<string, string[]>();
  for (const p of phases) {
    if (p.predecessorId !== null) {
      successorsOf.set(p.predecessorId, [...(successorsOf.get(p.predecessorId) ?? []), p.id]);
    }
  }
  const moved: PhaseMove[] = [];
  const queue = [...changed];
  const guard = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    const pred = state.get(id);
    if (!pred) continue;
    for (const sid of successorsOf.get(id) ?? []) {
      const s = state.get(sid);
      if (!s) continue;
      const earliest = earliestStart(pred.endOn, s.lagDays);
      if (s.startOn < earliest) {
        const length = daysBetween(s.startOn, s.endOn);
        s.startOn = earliest;
        s.endOn = addDays(earliest, length);
        moved.push({ id: sid, startOn: s.startOn, endOn: s.endOn });
        const key = `${sid}`;
        if (!guard.has(key)) {
          guard.add(key);
          queue.push(sid);
        }
      }
    }
  }
  // A phase pushed twice (two changed ancestors) is reported once, at its final dates.
  const last = new Map<string, PhaseMove>();
  for (const m of moved) last.set(m.id, m);
  return [...last.values()];
}

export interface ScheduleSummaryInput {
  startOn: string;
  endOn: string;
  status: string;
  kind: string;
}

export interface ScheduleSummary {
  count: number;
  milestones: number;
  done: number;
  underway: number;
  /** Planned or underway, and past its last day. */
  overdue: number;
  /** The first and last day of the whole schedule, or null with no phases. */
  startOn: string | null;
  endOn: string | null;
  /** Calendar days from the first day to the last, inclusive. */
  spanDays: number;
}

/** The numbers a job's page says about its schedule, as of `today`. */
export function summarise(phases: readonly ScheduleSummaryInput[], today: string): ScheduleSummary {
  const startOn = phases.reduce<string | null>((min, p) => (min === null || p.startOn < min ? p.startOn : min), null);
  const endOn = phases.reduce<string | null>((max, p) => (max === null || p.endOn > max ? p.endOn : max), null);
  return {
    count: phases.length,
    milestones: phases.filter((p) => p.kind === "milestone").length,
    done: phases.filter((p) => p.status === "done").length,
    underway: phases.filter((p) => p.status === "underway").length,
    overdue: phases.filter((p) => p.status !== "done" && p.endOn < today).length,
    startOn,
    endOn,
    spanDays: startOn !== null && endOn !== null ? durationDays(startOn, endOn) : 0,
  };
}

/** Sunday-to-Saturday weeks that cover the span, for a timeline's header: each week's first day. */
export function weeksCovering(startOn: string, endOn: string): string[] {
  const weeks: string[] = [];
  // Back up to the Sunday on or before the start.
  const dow = new Date(`${startOn}T00:00:00Z`).getUTCDay();
  let cursor = addDays(startOn, -dow);
  while (cursor <= endOn) {
    weeks.push(cursor);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}
