import { MEASURE_ORDER, MEASURES, type MeasureKey, type Tier, type ViewCapture } from "./measures";
import { buildReport, type Report } from "./report";

/**
 * A PERSON'S CHECKS OVER TIME (docs/modules/posture.md, slice 3; ADR 0119).
 * Pure.
 *
 * - `summarize`: one check down to its measures' values, in each measure's
 *   lead unit, with each round's value (the check's own repeat).
 * - `noiseFor`: how big a change between two checks must be before it is
 *   called real. The published figure (a full re-test, stickers put back on
 *   another day) to begin with; the person's own, from the gap between their
 *   rounds, once there are enough checks to say, and only when it is bigger.
 *   Rounds are read minutes apart with the stickers left on, so they can show
 *   a person is less steady than the studies' people, never that they are
 *   steadier across days: the published figure stays the floor.
 * - `compare`: one measure in two checks, the change in plain words, and
 *   whether it is more than that noise. Never better or worse: a change is a
 *   change (ADR 0119).
 * - `trend`: one measure across every check, for the posture page.
 * - `historyCsv`: every check's measures as rows, for a spreadsheet.
 */

export type HistoryCheck = { id: string; takenAt: string; localDay: string; captures: ViewCapture[] };

export type MeasurePoint = {
  /** In `unit`: the value the report leads with. */
  value: number;
  unit: "deg" | "mm";
  words: string;
  tier: Tier;
  /** Each round's value, in `unit`. */
  rounds: number[];
};

export type CheckSummary = {
  id: string;
  takenAt: string;
  localDay: string;
  views: number;
  rounds: number;
  vertical: Report["vertical"];
  measures: Partial<Record<MeasureKey, MeasurePoint>>;
};

export function summarize(check: HistoryCheck): CheckSummary {
  const report = buildReport(check.captures);
  const measures: Partial<Record<MeasureKey, MeasurePoint>> = {};
  for (const m of report.measures) {
    const mm = m.unit === "mm" && m.mm !== null;
    measures[m.key] = {
      value: mm ? (m.mm as number) : m.deg,
      unit: mm ? "mm" : "deg",
      words: m.words,
      tier: m.tier,
      rounds: m.rounds,
    };
  }
  return {
    id: check.id,
    takenAt: check.takenAt,
    localDay: check.localDay,
    views: report.views.length,
    rounds: report.rounds,
    vertical: report.vertical,
    measures,
  };
}

/** Oldest first. */
export function chronological<T extends { takenAt: string }>(checks: readonly T[]): T[] {
  return [...checks].sort((a, b) => (a.takenAt < b.takenAt ? -1 : a.takenAt > b.takenAt ? 1 : 0));
}

/** How many checks with two rounds before the person's own figure is used. */
export const OWN_NOISE_AFTER = 3;

export type Noise = {
  key: MeasureKey;
  /** The published smallest real change, in the lead unit. */
  published: number;
  /** From the gap between the person's rounds, once there is any. */
  own: { checks: number; mdc: number } | null;
  /** The one a change is held to. */
  used: number;
  from: "published" | "yours";
};

/**
 * The smallest real change for one measure, from a person's checks. Each
 * check read twice gives one gap between its rounds; their spread is the
 * measurement's own error for this person (SEM = √(Σd² / 2n)), and a change
 * between two checks needs to be 1.96 × √2 × SEM to be more than it at 95%.
 */
export function noiseFor(key: MeasureKey, history: readonly CheckSummary[]): Noise {
  const published = MEASURES[key].mdc;
  const gaps = history
    .map((c) => c.measures[key])
    .filter((m): m is MeasurePoint => !!m && m.rounds.length >= 2 && m.unit === MEASURES[key].unit)
    .map((m) => m.rounds[0] - m.rounds[1]);
  if (gaps.length === 0) return { key, published, own: null, used: published, from: "published" };
  const sem = Math.sqrt(gaps.reduce((s, d) => s + d * d, 0) / (2 * gaps.length));
  const mdc = 1.96 * Math.SQRT2 * sem;
  const own = { checks: gaps.length, mdc };
  if (gaps.length < OWN_NOISE_AFTER || mdc <= published) return { key, published, own, used: published, from: "published" };
  return { key, published, own, used: mdc, from: "yours" };
}

function amount(value: number, unit: "deg" | "mm"): string {
  return unit === "mm" ? `${Math.round(Math.abs(value))} mm` : `${Math.abs(value).toFixed(1)}°`;
}

/** A change in one measure between two checks, in its own terms: `change` is later minus earlier. */
export function changeWords(key: MeasureKey, change: number, unit: "deg" | "mm"): string {
  const a = amount(change, unit);
  if (unit === "mm" ? Math.abs(change) < 0.5 : Math.abs(change) < 0.05) return "No change";
  const up = change > 0;
  switch (key) {
    case "shoulder-level":
    case "front-hip-level":
    case "back-hip-level":
      // Positive means the right side is the lower one, so a rise in it is the right side dropping.
      return `${up ? "Right" : "Left"} side dropped ${a} against the ${up ? "left" : "right"}`;
    case "head-tilt":
      return `Tilted ${a} more to your ${up ? "right" : "left"}`;
    case "trunk-lean":
      return `Shifted ${a} more to your ${up ? "right" : "left"}`;
    case "knee-in-right":
    case "knee-in-left":
      return `${a} more ${up ? "inward" : "outward"}`;
    case "head-forward":
      return `${a} ${up ? "higher" : "lower"}`;
    case "body-line":
      return `${a} more ${up ? "forward" : "back"}`;
    case "pelvic-tilt":
      return `Tipped ${a} more ${up ? "forward" : "back"}`;
    case "shoulder-forward-right":
    case "shoulder-forward-left":
      return `${a} further ${up ? "ahead of" : "behind"} the line`;
    case "knee-back-right":
    case "knee-back-left":
      return `Bends back ${a} ${up ? "more" : "less"}`;
  }
}

export type Comparison = {
  key: MeasureKey;
  then: MeasurePoint;
  now: MeasurePoint;
  change: number;
  words: string;
  noise: Noise;
  /** More than the noise: a real change. */
  beyond: boolean;
};

/** One measure in a later check against an earlier one; null when either lacks it, or they are in different units. */
export function compare(
  key: MeasureKey,
  now: CheckSummary,
  then: CheckSummary,
  history: readonly CheckSummary[],
): Comparison | null {
  const a = then.measures[key];
  const b = now.measures[key];
  if (!a || !b || a.unit !== b.unit) return null;
  const change = b.value - a.value;
  const noise = noiseFor(key, history);
  return { key, then: a, now: b, change, words: changeWords(key, change, b.unit), noise, beyond: Math.abs(change) > noise.used };
}

/** The check to compare with by default: the one just before, if there is one. */
export function previousOf(id: string, history: readonly CheckSummary[]): CheckSummary | null {
  const ordered = chronological(history);
  const i = ordered.findIndex((c) => c.id === id);
  return i > 0 ? ordered[i - 1] : null;
}

export function firstOf(history: readonly CheckSummary[]): CheckSummary | null {
  return chronological(history)[0] ?? null;
}

export type Trend = {
  key: MeasureKey;
  points: { id: string; takenAt: string; value: number }[];
  unit: "deg" | "mm";
  tier: Tier;
  latestWords: string;
  /** The latest against the first. */
  change: number;
  changeWords: string;
  noise: Noise;
  beyond: boolean;
};

/** One measure across every check that has it, oldest first; null with fewer than two. */
export function trend(key: MeasureKey, history: readonly CheckSummary[]): Trend | null {
  const ordered = chronological(history).filter((c) => c.measures[key]);
  if (ordered.length < 2) return null;
  const unit = ordered[ordered.length - 1].measures[key]!.unit;
  const same = ordered.filter((c) => c.measures[key]!.unit === unit);
  if (same.length < 2) return null;
  const first = same[0].measures[key]!;
  const latest = same[same.length - 1].measures[key]!;
  const change = latest.value - first.value;
  const noise = noiseFor(key, history);
  return {
    key,
    points: same.map((c) => ({ id: c.id, takenAt: c.takenAt, value: c.measures[key]!.value })),
    unit,
    tier: latest.tier,
    latestWords: latest.words,
    change,
    changeWords: changeWords(key, change, unit),
    noise,
    beyond: Math.abs(change) > noise.used,
  };
}

/** Every measure with at least two checks, in the report's order (reliable first). */
export function trends(history: readonly CheckSummary[]): Trend[] {
  return MEASURE_ORDER.map((key) => trend(key, history)).filter((t): t is Trend => t !== null);
}

function cell(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Every check's measures, one row each, oldest first: what "Download the
 * numbers" gives. Numbers and the report's words only.
 */
export function historyCsv(history: readonly CheckSummary[]): string {
  const rows: (string | number | null)[][] = [
    ["taken_at", "day", "measure", "value", "unit", "round_1", "round_2", "tier", "words"],
  ];
  for (const c of chronological(history)) {
    for (const key of MEASURE_ORDER) {
      const m = c.measures[key];
      if (!m) continue;
      const fixed = (n: number | undefined) => (n === undefined ? null : m.unit === "mm" ? Math.round(n) : Number(n.toFixed(2)));
      rows.push([
        c.takenAt,
        c.localDay,
        MEASURES[key].name,
        fixed(m.value),
        m.unit === "mm" ? "mm" : "degrees",
        fixed(m.rounds[0]),
        fixed(m.rounds[1]),
        m.tier === "reliable" ? "reliable" : "trend only",
        m.words,
      ]);
    }
  }
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
