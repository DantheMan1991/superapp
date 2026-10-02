import { z } from "zod";
import type { FoodLine } from "@/db/schema/food";

/**
 * COOK MODE'S STATE (D1b, docs/modules/food.md): where the person is in a
 * recipe, what they have ticked off, and the timers they started, kept ON THE
 * PHONE per recipe (`cook-store.ts`) so a reload, a locked screen or another
 * app in between loses nothing. Pure: the screen and the tests run the same
 * transitions.
 *
 * A timer is an end time, not a count: a phone that slept or a tab that was
 * hidden comes back to the right time left, and to a timer that is already
 * ringing if it ended meanwhile.
 */

/** How long a cook mode left open is picked up again; after it, it starts afresh. */
export const SESSION_HOURS = 12;

export interface CookTimer {
  id: string;
  /** "Step 4 · 25–30 min": where it came from and how long it is. */
  label: string;
  /** Seconds, the shorter end and the longer (a range rings at the shorter). */
  lo: number;
  hi: number | null;
  /** When it rings, in the phone's epoch milliseconds. */
  endsAt: number;
}

export type CookScreen = "gather" | "step" | "done";

export interface CookSession {
  v: 1;
  /** The phone's id for this time cooking: "Log that you made it" sends it, so twice is once. */
  cookId: string;
  startedAt: number;
  screen: CookScreen;
  /** The real step being shown, headings not counted. */
  step: number;
  servings: number | null;
  /** Ingredient lines ticked off, by their index in the recipe. */
  ticked: number[];
  timers: CookTimer[];
  /** Set once "Log that you made it" has been saved: the day it was logged for. */
  logged: { madeOn: string } | null;
}

const timerSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120),
  lo: z.number().positive(),
  hi: z.number().positive().nullable(),
  endsAt: z.number(),
});

/** What is read back from the phone's storage: anything else is a fresh start. */
export const cookSessionSchema = z.object({
  v: z.literal(1),
  cookId: z.string().uuid(),
  startedAt: z.number(),
  screen: z.enum(["gather", "step", "done"]),
  step: z.number().int().min(0).max(999),
  servings: z.number().positive().nullable(),
  ticked: z.array(z.number().int().min(0).max(999)).max(999),
  timers: z.array(timerSchema).max(20),
  logged: z.object({ madeOn: z.string() }).nullable(),
});

export function freshSession(cookId: string, now: number, servings: number | null): CookSession {
  return { v: 1, cookId, startedAt: now, screen: "gather", step: 0, servings, ticked: [], timers: [], logged: null };
}

/** Left too long ago to pick up: a recipe cooked yesterday is a new cook today. */
export function isStale(session: CookSession, now: number): boolean {
  return now - session.startedAt > SESSION_HOURS * 60 * 60 * 1000;
}

export interface RealStep {
  text: string;
  /** The heading of the group the step is in ("For the sauce"), if any. */
  heading: string | null;
}

/** The steps to show one at a time: headings fold into the steps under them. */
export function realSteps(steps: readonly FoodLine[]): RealStep[] {
  const out: RealStep[] = [];
  let heading: string | null = null;
  for (const line of steps) {
    if (line.heading) heading = line.text;
    else out.push({ text: line.text, heading });
  }
  return out;
}

/** The step to show, kept inside the recipe if it lost a step since. */
export function clampStep(step: number, count: number): number {
  return Math.min(Math.max(0, step), Math.max(0, count - 1));
}

export function toggleTick(session: CookSession, index: number): CookSession {
  const ticked = session.ticked.includes(index)
    ? session.ticked.filter((i) => i !== index)
    : [...session.ticked, index];
  return { ...session, ticked };
}

export function startTimer(
  session: CookSession,
  timer: { label: string; lo: number; hi: number | null },
  now: number,
  id: string,
): CookSession {
  if (session.timers.length >= 20) return session;
  return { ...session, timers: [...session.timers, { id, ...timer, endsAt: now + timer.lo * 1000 }] };
}

/** One more minute: from now when it is already ringing, otherwise on top of what is left. */
export function addMinute(session: CookSession, id: string, now: number): CookSession {
  return {
    ...session,
    timers: session.timers.map((t) =>
      t.id === id ? { ...t, endsAt: (t.endsAt <= now ? now : t.endsAt) + 60_000 } : t,
    ),
  };
}

export function stopTimer(session: CookSession, id: string): CookSession {
  return { ...session, timers: session.timers.filter((t) => t.id !== id) };
}

export function isRinging(timer: CookTimer, now: number): boolean {
  return timer.endsAt <= now;
}

/** "Sep 30", or "Dec 24, 2025" when it is not this year: a stored day, shown as itself. */
export function dayWords(day: string, today: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(today.slice(0, 4) === day.slice(0, 4) ? {} : { year: "numeric" }),
  });
}

/** "Made once, on Sep 30." / "Made 3 times, last on Sep 30." / "Made once, today." */
export function madeWords(count: number, lastOn: string | null, today: string): string | null {
  if (count <= 0 || !lastOn) return null;
  if (lastOn === today) return count === 1 ? "Made once, today." : `Made ${count} times, last today.`;
  const words = dayWords(lastOn, today);
  return count === 1 ? `Made once, on ${words}.` : `Made ${count} times, last on ${words}.`;
}

/** The finish screen once logged: "Logged: made today, for 8 wedges." */
export function loggedWords(madeOn: string, today: string, making: string | null): string {
  const when = madeOn === today ? "today" : `on ${dayWords(madeOn, today)}`;
  return `Logged: made ${when}${making ? `, for ${making}` : ""}.`;
}
