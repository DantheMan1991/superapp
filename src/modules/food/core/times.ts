/**
 * THE TIMES IN A STEP (D1b, cook mode): "bake 25 to 30 minutes", "simmer for
 * 1 hour 15 minutes", "rest 5 min", "about 1½ hours", "half an hour", found in
 * the step's own words so cook mode can offer a timer for each. Only a number
 * (or "an hour", "half an hour", "a minute") followed by a unit of time
 * counts: "400°F", "2-inch" and "overnight" are not timers. A range keeps both
 * ends; the timer rings at the shorter (the founder's call: check it then).
 *
 * Pure and import-free, like `amounts.ts`.
 */

export interface StepTime {
  /** Where it sits in the step's text. */
  start: number;
  end: number;
  text: string;
  /** Seconds: the shorter end, and the longer when the step gives a range. */
  lo: number;
  hi: number | null;
}

export type StepPiece = { kind: "text"; text: string } | ({ kind: "time" } & StepTime);

const VULGAR: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

const NUM = String.raw`\d+\s+\d+\/\d+|\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔]?|\d+\/\d+|[½¼¾⅓⅔]`;
const UNIT = String.raw`hours?|hrs?\.?|h|minutes?|mins?\.?|seconds?|secs?\.?`;
const SMALL_UNIT = String.raw`minutes?|mins?\.?|seconds?|secs?\.?`;
const NUMERIC = new RegExp(
  String.raw`(?<![\w./°])(${NUM})(?:\s*(?:-|–|—|to|or)\s*(${NUM}))?\s*(${UNIT})(?:,?\s+(?:and\s+)?(${NUM})\s*(${SMALL_UNIT}))?(?![A-Za-z])`,
  "gi",
);
const WORDS = /\b(half an hour|an hour|a minute)\b/gi;

/** Twenty-four hours: a longer "timer" is a day, not something to ring. */
const LONGEST = 24 * 60 * 60;

function number(text: string): number {
  const value = text.trim().replace(",", ".");
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(value);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(value);
  if (fraction) return Number(fraction[2]) > 0 ? Number(fraction[1]) / Number(fraction[2]) : Number.NaN;
  const glued = /^(\d+(?:\.\d+)?)?\s*([½¼¾⅓⅔])$/.exec(value);
  if (glued) return Number(glued[1] ?? 0) + VULGAR[glued[2]];
  return Number(value);
}

function seconds(unit: string): number {
  const u = unit.toLowerCase();
  if (u.startsWith("h")) return 3600;
  if (u.startsWith("m")) return 60;
  return 1;
}

/** Every time in a step, in order. */
export function findTimes(step: string): StepTime[] {
  const found: StepTime[] = [];
  for (const m of step.matchAll(NUMERIC)) {
    const unit = seconds(m[3]);
    let lo = number(m[1]) * unit;
    let hi = m[2] ? number(m[2]) * unit : null;
    if (m[4] && m[5]) {
      const extra = number(m[4]) * seconds(m[5]);
      lo += extra;
      if (hi !== null) hi += extra;
    }
    if (!Number.isFinite(lo) || lo <= 0 || lo > LONGEST) continue;
    if (hi !== null && (!Number.isFinite(hi) || hi <= lo || hi > LONGEST)) hi = null;
    const start = m.index ?? 0;
    found.push({ start, end: start + m[0].length, text: m[0], lo: Math.round(lo), hi: hi === null ? null : Math.round(hi) });
  }
  for (const m of step.matchAll(WORDS)) {
    const start = m.index ?? 0;
    if (found.some((t) => start < t.end && start + m[0].length > t.start)) continue;
    const phrase = m[1].toLowerCase();
    const lo = phrase === "half an hour" ? 1800 : phrase === "an hour" ? 3600 : 60;
    found.push({ start, end: start + m[0].length, text: m[0], lo, hi: null });
  }
  return found.sort((a, b) => a.start - b.start);
}

/** The step as pieces: its words, with each time marked for a timer button. */
export function stepPieces(step: string): StepPiece[] {
  const pieces: StepPiece[] = [];
  let at = 0;
  for (const time of findTimes(step)) {
    if (time.start > at) pieces.push({ kind: "text", text: step.slice(at, time.start) });
    pieces.push({ kind: "time", ...time });
    at = time.end;
  }
  if (at < step.length) pieces.push({ kind: "text", text: step.slice(at) });
  return pieces;
}

/** "25 min", "1 hr 15 min", "30 sec", "1 hr". */
export function durationWords(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  if (s < 60) return `${s} sec`;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  const parts = [hours ? `${hours} hr` : "", minutes ? `${minutes} min` : "", !hours && rest ? `${rest} sec` : ""];
  return parts.filter(Boolean).join(" ");
}

/** "25–30 min", or one duration when there is no range. */
export function rangeWords(lo: number, hi: number | null): string {
  if (hi === null) return durationWords(lo);
  if (lo % 60 === 0 && hi % 60 === 0 && hi < 3600) return `${lo / 60}–${hi / 60} min`;
  return `${durationWords(lo)} to ${durationWords(hi)}`;
}

/** A countdown as a clock face: "24:59", "1:04:59", never below "0:00". */
export function clockFace(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}
