import { daysFrom } from "./days";

/**
 * PROGRESS PHOTOS (H2b, docs/modules/health.md; the founder's calls from a
 * mockup, 2026-10-03): front, side and back, taken with the phone propped up
 * on a timer, the coach's voice saying when to turn; kept on this phone only,
 * never sent (ADR 0128); compared two days side by side with the trend on
 * each; a copy saved only when the person taps for one; and a line on Today
 * once the last are four weeks old. Pure: what the screens do with a camera
 * and the phone's storage is in `src/modules/health/photos/`.
 */

export const POSES = ["front", "side", "back"] as const;
export type Pose = (typeof POSES)[number];

export const POSE_WORDS: Record<Pose, string> = { front: "Front", side: "Side", back: "Back" };

/** The first count: time to set the phone down, step back and stand. */
export const FIRST_COUNT_S = 10;
/** Between poses: time to turn. */
export const TURN_COUNT_S = 5;
/** The beeps: one each second from this many seconds out. */
export const BEEP_FROM_S = 3;

/**
 * What the voice says, in order, for the three in a row; and for one taken
 * again on its own. The side is always the left side to the phone (a quarter
 * turn to the right), so two sides compare.
 */
export const PHOTO_LINES = {
  start: "Ten seconds. Step back and face the phone.",
  side: "Turn a quarter to your right.",
  back: "Turn again, so your back is to the phone.",
  done: "That's all three. Come and have a look.",
  again: {
    front: "Ten seconds. Face the phone.",
    side: "Ten seconds. Stand with your left side to the phone.",
    back: "Ten seconds. Stand with your back to the phone.",
  } satisfies Record<Pose, string>,
  gotIt: "Got it.",
} as const;

/** Every line, for the phone to fetch ahead in the recorded voice. */
export function photoLines(): string[] {
  return [
    PHOTO_LINES.start,
    PHOTO_LINES.side,
    PHOTO_LINES.back,
    PHOTO_LINES.done,
    ...POSES.map((p) => PHOTO_LINES.again[p]),
    PHOTO_LINES.gotIt,
  ];
}

/** A photo's longest side as kept: plenty to see a change, a few hundred kilobytes. */
export const PHOTO_EDGE = 2048;
export const PHOTO_QUALITY = 0.9;

/** A picture's size held to the longest side, its shape kept. */
export function fitEdge(width: number, height: number, edge: number = PHOTO_EDGE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Today's reminder: once the last photos are this many days old (the founder's call: every 4 weeks). */
export const PHOTO_NUDGE_DAYS = 28;

/** Whether Today says it is time; never before the first photos (Body has the way in). */
export function photoNudgeDue(lastDay: string | null, today: string): boolean {
  return lastDay !== null && daysFrom(lastDay, today) >= PHOTO_NUDGE_DAYS;
}

/** "4 weeks ago", "5 weeks ago", "3 months ago": how old the last photos are, in Today's line. */
export function photosAgo(lastDay: string, today: string): string {
  const days = daysFrom(lastDay, today);
  if (days < 7) return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }
  return `${Math.floor(days / 30)} months ago`;
}

export interface PhotoKey {
  day: string;
  pose: Pose;
}

/** The days with a photo of this pose, oldest first. */
export function daysWith(photos: readonly PhotoKey[], pose: Pose): string[] {
  return [...new Set(photos.filter((p) => p.pose === pose).map((p) => p.day))].sort();
}

/** Each day with photos, newest first, and which poses it has, in pose order. */
export function photoDays(photos: readonly PhotoKey[]): { day: string; poses: Pose[] }[] {
  const byDay = new Map<string, Set<Pose>>();
  for (const p of photos) {
    if (!byDay.has(p.day)) byDay.set(p.day, new Set());
    byDay.get(p.day)?.add(p.pose);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, poses]) => ({ day, poses: POSES.filter((p) => poses.has(p)) }));
}

/** Compare starts on the first day and the latest; with one day, that day alone. */
export function startPair(days: readonly string[]): { left: string; right: string } | null {
  if (days.length === 0) return null;
  return { left: days[0], right: days[days.length - 1] };
}

/** The day itself when it has photos; else the latest before it, else the first: a day deleted gives way. */
export function nearestDay(days: readonly string[], day: string): string {
  if (days.length === 0 || days.includes(day)) return day;
  return days.filter((d) => d < day).at(-1) ?? days[0];
}

/** One step through the days from a day (or the nearest there is), held at either end. */
export function stepDay(days: readonly string[], current: string, by: -1 | 1): string {
  if (days.length === 0) return current;
  const at = days.indexOf(nearestDay(days, current));
  return days[Math.min(days.length - 1, Math.max(0, at + by))];
}

/** The pair a person picked, held to days there are, the earlier on the left. */
export function keptPair(days: readonly string[], picked: { left: string; right: string } | null): { left: string; right: string } | null {
  const start = startPair(days);
  if (!start || !picked) return start;
  const a = nearestDay(days, picked.left);
  const b = nearestDay(days, picked.right);
  return a <= b ? { left: a, right: b } : { left: b, right: a };
}

/** A saved copy's name: "yosher-front-2026-10-03.jpg". */
export function copyName(day: string, pose: Pose): string {
  return `yosher-${pose}-${day}.jpg`;
}
