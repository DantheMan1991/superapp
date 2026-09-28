/**
 * A DAY OF A PROGRAM (docs/modules/fitness.md, F2c; the founder approved split
 * days from a mockup, 2026-09-27).
 *
 * The program says sets may be split, "1–2 in the morning, 1–2 at night", and
 * a day counts when its sessions TOGETHER meet every exercise's minimum. So a
 * day is a ledger: the sets each exercise needs (its minimum), the sets done
 * across the day's sessions, and what is left. A later session that day plans
 * only what is left (`aimFor`), and "Half now" plans the first share of it.
 *
 * - A set is a FULL set (`fullSets`): one of "1 × 15 rolls per side" is both
 *   sides.
 * - EVERY SET DONE COUNTS, however short it came up (the founder's call,
 *   2026-09-27): 12 of 15 rolls is still one of the day's sets, and the count
 *   stays on the log for the progress screens (F3).
 * - The day is the person's own: sessions carry the phone's `localDay`, and
 *   the pages ask for the space's today in its own timezone (`localDayIn`).
 *
 * Pure: the phone, the program page and the Workouts home all add a day up
 * with it, from the server's sessions and the phone's own.
 */

import { countOf, prescription } from "./program";
import { fullSets, type PlanItem, type SessionAim, type SessionDoc } from "./session";

/** One session, reduced to what a day adds up. */
export interface DaySession {
  id: string;
  localDay: string;
  startedAt: string;
  /** Its finish, else its last set, else its start: how long it took. */
  endedAt: string;
  finished: boolean;
  /** Full sets per program item it did. An item edited away since is not here. */
  items: { itemId: string; sets: number }[];
}

/** A session on the phone, as a day sees it. */
export function daySessionOf(doc: SessionDoc): DaySession {
  const times = doc.exercises.flatMap((exercise) => exercise.sets.map((set) => set.doneAt));
  const last = times.reduce((latest, at) => (at > latest ? at : latest), doc.startedAt);
  return {
    id: doc.id,
    localDay: doc.localDay,
    startedAt: doc.startedAt,
    endedAt: doc.finishedAt ?? last,
    finished: doc.finishedAt !== null,
    items: doc.exercises.flatMap((exercise) =>
      exercise.itemId === null
        ? []
        : [{ itemId: exercise.itemId, sets: fullSets(exercise.perSide, exercise.sets.map((set) => set.side)) }],
    ),
  };
}

/**
 * The sessions of one day: the server's and the phone's, the phone's copy of
 * a session winning (it may be newer than the one sent), oldest first.
 */
export function sessionsOn(
  localDay: string,
  server: readonly DaySession[],
  phone: readonly DaySession[],
): DaySession[] {
  const byId = new Map<string, DaySession>();
  for (const session of server) byId.set(session.id, session);
  for (const session of phone) byId.set(session.id, session);
  return [...byId.values()]
    .filter((session) => session.localDay === localDay)
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
}

/**
 * The day so far for a phase: the server's sessions of the last days and the
 * phone's own documents (sent or not), on `today`. `leaveOut` is a session to
 * add up without: the one going on now, when a screen wants what came before.
 */
export function dayOf(
  items: readonly DayItem[],
  today: string,
  server: readonly DaySession[],
  phone: readonly SessionDoc[],
  leaveOut: string | null = null,
): DayProgress {
  return dayProgress(
    items,
    sessionsOn(
      today,
      server.filter((session) => session.id !== leaveOut),
      phone.filter((doc) => doc.id !== leaveOut).map(daySessionOf),
    ),
  );
}

/** An item of the phase, as the day needs it. */
export interface DayItem {
  itemId: string;
  name: string;
  optional: boolean;
  setsMin: number;
  setsMax: number | null;
}

export function toDayItem(item: DayItem): DayItem {
  return {
    itemId: item.itemId,
    name: item.name,
    optional: item.optional,
    setsMin: item.setsMin,
    setsMax: item.setsMax,
  };
}

export interface DayItemProgress extends DayItem {
  /** Full sets done today, across the day's sessions. */
  done: number;
  /** Sets still needed today to reach the minimum. */
  left: number;
}

export interface DayPart {
  id: string;
  startedAt: string;
  /** Full sets done on this phase's items. */
  sets: number;
  minutes: number;
  finished: boolean;
}

export interface DayProgress {
  items: DayItemProgress[];
  /** The day's sessions that did any of this phase's sets, oldest first. */
  parts: DayPart[];
  /** Full sets done today on this phase. */
  done: number;
  /** Sets the exercises that are not optional still need today. */
  left: number;
  /** Every exercise that is not optional has had its minimum, and something was done. */
  complete: boolean;
}

export function dayProgress(items: readonly DayItem[], sessions: readonly DaySession[]): DayProgress {
  const ids = new Set(items.map((item) => item.itemId));
  const progress = items.map((item) => {
    const done = sessions.reduce(
      (n, session) => n + session.items.reduce((m, i) => (i.itemId === item.itemId ? m + i.sets : m), 0),
      0,
    );
    return { ...item, done, left: Math.max(0, item.setsMin - done) };
  });
  const parts = sessions
    .map((session) => ({
      id: session.id,
      startedAt: session.startedAt,
      sets: session.items.reduce((n, i) => (ids.has(i.itemId) ? n + i.sets : n), 0),
      minutes: Math.max(
        0,
        Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60_000),
      ),
      finished: session.finished,
    }))
    .filter((part) => part.sets > 0);
  const done = progress.reduce((n, item) => n + item.done, 0);
  const left = progress.reduce((n, item) => (item.optional ? n : n + item.left), 0);
  return { items: progress, parts, done, left, complete: done > 0 && left === 0 };
}

/**
 * How a session sets out on a split day:
 *
 *   all    everything the day still needs (the whole minimum, on a fresh day)
 *   half   the first share of it: half of each exercise's sets, rounded up
 *   again  a whole session again, once the day is complete ("more is better")
 */
export type SplitChoice = "all" | "half" | "again";

/** Whether halving changes anything: some exercise has two or more sets to go. */
export function canHalve(progress: DayProgress): boolean {
  return !progress.complete && progress.items.some((item) => item.left >= 2);
}

/**
 * The session's aim per item (`SessionDoc.aim`). "One more set" may reach the
 * program's maximum for the DAY, less what the day has already done.
 */
export function aimFor(progress: DayProgress, choice: SplitChoice): SessionAim[] {
  return progress.items.map((item) => {
    const top = item.setsMax ?? item.setsMin;
    if (choice === "again") return { itemId: item.itemId, sets: item.setsMin, max: top };
    const sets = choice === "half" ? Math.ceil(item.left / 2) : item.left;
    return { itemId: item.itemId, sets, max: Math.max(sets, top - item.done) };
  });
}

/**
 * What this session asks of an item, for the start screen's list: the
 * prescription on a whole session ("2 × 8 breaths"), the share on a split
 * one ("1 of 2 sets"), what is left when the day has started ("1 more set"),
 * or that the day's earlier sessions did it ("done today").
 */
export function aimWords(item: PlanItem, progress: DayItemProgress, aim: SessionAim, choice: SplitChoice): string {
  if (choice === "again") return prescription(item);
  if (aim.sets === 0) return "done today";
  if (progress.done > 0) {
    return aim.sets === progress.left
      ? countOf(aim.sets, "more set", "more sets")
      : `${aim.sets} of the ${progress.left} sets left`;
  }
  if (choice === "all") return prescription(item);
  return aim.sets === item.setsMin ? countOf(aim.sets, "set", "sets") : `${aim.sets} of ${item.setsMin} sets`;
}

/** When in the day a session was, by the hour it started on the person's clock. */
export type PartOfDay = "Morning" | "Afternoon" | "Evening" | "Night";

export function partOfDay(hour: number): PartOfDay {
  if (hour < 5) return "Night";
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  if (hour < 21) return "Evening";
  return "Night";
}

/**
 * "Morning · 4 sets, Evening · 2 sets": the day's sessions, by when each
 * started. `hourOf` is the space's clock (`hourIn`), never the device's: a
 * screen that says this is rendered on the server first, and the device's
 * clock there is the server's, so the phone would disagree with it.
 */
export function dayPartsWords(day: DayProgress, hourOf: (iso: string) => number): string {
  return day.parts
    .map((part) => `${partOfDay(hourOf(part.startedAt))} · ${countOf(part.sets, "set", "sets")}`)
    .join(", ");
}

/** A day in the person's own clock, `YYYY-MM-DD`. The clock is the caller's to read. */
export function localDayIn(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The hour an instant falls in, in a timezone: 0–23. */
export function hourIn(timeZone: string, iso: string): number {
  try {
    const hour = Number(
      new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)),
    );
    return Number.isFinite(hour) ? hour : new Date(iso).getUTCHours();
  } catch {
    return new Date(iso).getUTCHours();
  }
}

/** The day `delta` days from a `YYYY-MM-DD` day. */
export function shiftDay(localDay: string, delta: number): string {
  const at = new Date(`${localDay}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + delta);
  return at.toISOString().slice(0, 10);
}
