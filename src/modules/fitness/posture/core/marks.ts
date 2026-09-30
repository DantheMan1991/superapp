import { shiftDay } from "../../core/day";

/**
 * A PROGRAM'S POSTURE MARKS (docs/modules/posture.md, slice 3c). Pure.
 *
 * A posture check at the start of a workout program and at the end of each of
 * its phases shows what each phase changed: a before and an after for every
 * phase. This works out, from the program's sessions and the person's checks,
 * which marks there are, which check marked each, and the one to ask for now.
 * Nothing is stored: the program's progress is worked out the same way
 * (core/progress.ts, F3), and so are the checks' results (ADR 0120).
 *
 * - THE START is the day of the program's first workout. A check from a week
 *   before it to a week after marks it; before the first workout, a check in
 *   the past week.
 * - THE END OF A PHASE is the day its gate opened (its minimum of done days,
 *   the program's own measure), or the day the person moved on to a later
 *   phase if that came first. A check from three days before it marks it, up
 *   to a week after moving on. While the person has not moved on, and at the
 *   end of the last phase, it stays open.
 * - Checks and marks pair up nearest first: of the marks whose days a check
 *   falls in (short phases overlap them), it marks the one whose day it is
 *   nearest, and on a tie the one it came after. A check marks one at most,
 *   and a mark is marked once. A repeat never marks anything: it is the same
 *   day's check again.
 * - ASKED FOR is the latest mark, while it is open and unmet. Only a person who
 *   has taken a posture check before is asked: the check needs stickers, a
 *   plumb line and a tripod, and someone who never set it up is not nagged for
 *   it. A mark whose days passed unmet is left behind without a word.
 */

/** A check up to a week before the first workout marks the start. */
export const START_LEAD_DAYS = 7;
/** A check up to three days before a phase's gate opens marks its end: the last days of a phase change nothing a check can see. */
export const END_LEAD_DAYS = 3;
/** A mark still counts for a week after the first workout (the start) or after moving on (an end): the day itself and six more. */
export const GRACE_DAYS = 6;

export type MarkProgram = {
  id: string;
  name: string;
  phases: readonly { id: string; name: string; minDoneDays: number | null }[];
};

export type MarkSession = { localDay: string; phaseId: string | null };

/** A check as the marks see it: the account's list of checks will do. */
export type MarkCheck = { id: string; takenAt: string; localDay: string; repeatOf?: string | null };

export type Mark = {
  kind: "start" | "end";
  programId: string;
  programName: string;
  /** The phase that ends; null for the start. */
  phaseIndex: number | null;
  phaseName: string | null;
  /** The start: the first workout's day, null before it. An end: the day the phase ended. */
  day: string | null;
  /** An end: the day the person moved on to a later phase; null while they have not. */
  movedOn: string | null;
  /** An end: the program's last phase. */
  last: boolean;
  /** The days a check marks it on, inclusive; `to` is null while it stays open. */
  from: string;
  to: string | null;
  /** The check that marked it. */
  met: MarkCheck | null;
};

function byTime(a: MarkCheck, b: MarkCheck): number {
  return a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0;
}

/** Days from one `YYYY-MM-DD` to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function postureMarks(input: {
  program: MarkProgram;
  /** Each phase's done days, oldest first (core/progress.ts `programDays`). */
  doneDays: readonly (readonly string[])[];
  sessions: readonly MarkSession[];
  checks: readonly MarkCheck[];
  /** The personal space's today, `YYYY-MM-DD`. */
  today: string;
}): { marks: Mark[]; due: Mark | null } {
  const { program, doneDays, sessions, checks, today } = input;
  const first = sessions.map((s) => s.localDay).sort()[0] ?? null;
  const open: Omit<Mark, "met">[] = [
    {
      kind: "start",
      programId: program.id,
      programName: program.name,
      phaseIndex: null,
      phaseName: null,
      day: first,
      movedOn: null,
      last: false,
      from: shiftDay(first ?? today, -START_LEAD_DAYS),
      to: first === null ? null : shiftDay(first, GRACE_DAYS),
    },
  ];

  program.phases.forEach((phase, i) => {
    const on = sessions.filter((s) => s.phaseId === phase.id).map((s) => s.localDay).sort();
    // A phase never done has no end.
    if (on.length === 0) return;
    const done = doneDays[i] ?? [];
    const min = phase.minDoneDays;
    const gate = min !== null && min >= 1 && done.length >= min ? done[min - 1] : null;
    const later = new Set(program.phases.slice(i + 1).map((p) => p.id));
    const movedOn =
      sessions
        .filter((s) => s.phaseId !== null && later.has(s.phaseId) && s.localDay >= on[0])
        .map((s) => s.localDay)
        .sort()[0] ?? null;
    const day = gate !== null && movedOn !== null ? (gate < movedOn ? gate : movedOn) : (gate ?? movedOn);
    // Not over yet: its gate is still closed and the person is still on it.
    if (day === null) return;
    open.push({
      kind: "end",
      programId: program.id,
      programName: program.name,
      phaseIndex: i,
      phaseName: phase.name,
      day,
      movedOn,
      last: i === program.phases.length - 1,
      from: shiftDay(day, -END_LEAD_DAYS),
      to: movedOn === null ? null : shiftDay(movedOn, GRACE_DAYS),
    });
  });

  const ordinary = checks.filter((c) => !c.repeatOf).sort(byTime);
  const sorted = open.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  // Every check that could mark each mark, nearest its day first; a tie goes
  // to the mark the check came after, then the earlier mark, then the earlier check.
  const pairs: { mark: number; check: number; apart: number; after: boolean }[] = [];
  sorted.forEach((m, mi) =>
    ordinary.forEach((c, ci) => {
      if (c.localDay < m.from || (m.to !== null && c.localDay > m.to)) return;
      const on = m.day ?? today;
      pairs.push({ mark: mi, check: ci, apart: Math.abs(daysBetween(on, c.localDay)), after: c.localDay >= on });
    }),
  );
  pairs.sort((a, b) => a.apart - b.apart || Number(b.after) - Number(a.after) || a.mark - b.mark || a.check - b.check);
  const met = new Map<number, MarkCheck>();
  const used = new Set<number>();
  for (const p of pairs) {
    if (met.has(p.mark) || used.has(p.check)) continue;
    met.set(p.mark, ordinary[p.check]);
    used.add(p.check);
  }
  const marks = sorted.map((m, mi): Mark => ({ ...m, met: met.get(mi) ?? null }));

  const latest = marks[marks.length - 1];
  const due =
    ordinary.length > 0 && latest && !latest.met && (latest.to === null || today <= latest.to) ? latest : null;
  return { marks, due };
}

/** In a list of checks: "Start of Morning Mobility", "End of Phase 1". */
export function markLabel(m: Mark): string {
  return m.kind === "start" ? `Start of ${m.programName}` : `End of ${m.phaseName}`;
}

/** In a sentence: "the start of Morning Mobility", "the end of Phase 1". */
export function markName(m: Mark): string {
  return m.kind === "start" ? `the start of ${m.programName}` : `the end of ${m.phaseName}`;
}

/** Asking for a mark: what to do, and why, where there is room for it. */
export function askWords(m: Mark): { ask: string; why: string | null } {
  if (m.kind === "start") {
    return m.day === null
      ? { ask: "Take a posture check before your first workout.", why: "Every later check is compared with it." }
      : { ask: `Take a posture check this week, to mark ${markName(m)}.`, why: "Every later check is compared with it." };
  }
  if (m.last) {
    return { ask: `Take a posture check to see what ${m.programName} changed.`, why: `It marks ${markName(m)}, the last phase.` };
  }
  if (m.movedOn === null) {
    return {
      ask: "Take a posture check before you move on.",
      why: "One at the end of each phase shows what that phase changed.",
    };
  }
  return { ask: `Take a posture check this week, to mark ${markName(m)}.`, why: "One at the end of each phase shows what that phase changed." };
}

/** On the posture page, beside Start: what a check now would mark. */
export function dueWords(m: Mark): string {
  return m.kind === "start"
    ? `A check now marks ${markName(m)}.`
    : `A check now marks ${markName(m)}, in ${m.programName}.`;
}

/** What a check marked: short for a list, full (the program named once) for its report and the spreadsheet. */
export type MarkLabel = { label: string; full: string };

/** Every check that marked something, with what it marked; a check two programs share has both. */
export function markLabels(all: readonly Mark[]): Record<string, MarkLabel[]> {
  const out: Record<string, MarkLabel[]> = {};
  for (const m of all) {
    if (!m.met) continue;
    const label = markLabel(m);
    (out[m.met.id] ??= []).push({ label, full: m.kind === "start" ? label : `${label}, in ${m.programName}` });
  }
  return out;
}
