import { z } from "zod";
import type { ProgressRow, ProgressWindow } from "@/lib/progress-sources/types";
import { dayField, daysFrom, shortDay } from "./days";
import { inWindow, mean, shiftDay } from "./progress";

/**
 * THE BODY (H2, docs/modules/health.md; the founder's calls from a mockup,
 * 2026-10-03): a weigh-in typed in, read as a TREND that smooths out the
 * day-to-day swings of water and food; a goal weight and about how fast to get
 * there; and the tape measures the person chooses (the waist, and others).
 * Kept in kilograms and centimetres, read in pounds and inches, as the plunge's
 * water is read in °F. Pure.
 */

/* -- units ------------------------------------------------------------------- */

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export function kgFromPounds(pounds: number): number {
  return pounds * KG_PER_LB;
}

export function poundsFromKg(kg: number): number {
  return kg / KG_PER_LB;
}

export function cmFromInches(inches: number): number {
  return inches * CM_PER_IN;
}

export function inchesFromCm(cm: number): number {
  return cm / CM_PER_IN;
}

/** What a weigh-in may be, in pounds (the table holds 20 to 320 kg). */
export const WEIGHT_LB_MIN = 50;
export const WEIGHT_LB_MAX = 700;

/** What a tape measure may be, in inches (the table holds 1 to 400 cm). */
export const LENGTH_IN_MIN = 1;
export const LENGTH_IN_MAX = 150;

/** The paces a goal can be set at, in pounds a week, either way. */
export const PACES_LB = [0.25, 0.5, 0.75, 1, 1.5, 2] as const;

/* -- words ------------------------------------------------------------------- */

function tenths(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** Up to two decimals, the zeros left off: "36.25", "36.5", "36". */
function hundredths(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** A weight to a tenth of a pound: "184.6 lb", "185.0 lb". */
export function poundsWords(kg: number): string {
  return `${tenths(poundsFromKg(kg))} lb`;
}

/** A goal, as the person set it: "175 lb", "172.5 lb". */
export function goalWords(kg: number): string {
  return `${String(Math.round(poundsFromKg(kg) * 10) / 10)} lb`;
}

/** A tape measure as read off the tape: "36.25 in", "36.5 in". */
export function inchesWords(cm: number): string {
  return `${hundredths(inchesFromCm(cm))} in`;
}

/** "down 0.6 lb", "up 1.2 lb", "no change". */
export function poundsChange(kg: number): string {
  const pounds = Math.round(poundsFromKg(kg) * 10) / 10;
  if (pounds === 0) return "no change";
  return `${pounds < 0 ? "down" : "up"} ${tenths(Math.abs(pounds))} lb`;
}

/** "down 0.5 in", "up 0.25 in", "no change". */
export function inchesChange(cm: number): string {
  const inches = Math.round(inchesFromCm(cm) * 100) / 100;
  if (inches === 0) return "no change";
  return `${inches < 0 ? "down" : "up"} ${hundredths(Math.abs(inches))} in`;
}

/** "1 lb a week", "0.25 lb a week". */
export function paceWords(kgPerWeek: number): string {
  return `${hundredths(Math.abs(poundsFromKg(kgPerWeek)))} lb a week`;
}

/* -- typed in ---------------------------------------------------------------- */

function decimal(text: string): number | null {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed) && !/^\.\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/** A weight as typed, in pounds to a tenth; null when it is not one Health keeps. */
export function typedPounds(text: string): number | null {
  const value = decimal(text);
  if (value === null || value < WEIGHT_LB_MIN || value > WEIGHT_LB_MAX) return null;
  return Math.round(value * 10) / 10;
}

/**
 * A tape measure as typed, in inches to a hundredth: "36.25", or as a tape
 * reads, "36 1/4"; null when it is not one Health keeps.
 */
export function typedInches(text: string): number | null {
  const fraction = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(text.trim());
  let value: number | null;
  if (fraction) {
    const [whole, top, bottom] = fraction.slice(1).map(Number);
    value = bottom === 0 || top >= bottom ? null : whole + top / bottom;
  } else {
    value = decimal(text);
  }
  if (value === null || value < LENGTH_IN_MIN || value > LENGTH_IN_MAX) return null;
  return Math.round(value * 100) / 100;
}

/* -- what the actions take ----------------------------------------------------- */

export const weighinInputSchema = z.object({
  day: dayField,
  pounds: z.number().min(WEIGHT_LB_MIN).max(WEIGHT_LB_MAX),
  /** The page showed the day as today: refused once the space's day has moved on. */
  asToday: z.boolean().default(true),
});

export type WeighinInput = z.infer<typeof weighinInputSchema>;

/** A weigh-in already kept, changed on Body: any day it was kept on. */
export const weighinChangeSchema = z.object({
  day: dayField,
  pounds: z.number().min(WEIGHT_LB_MIN).max(WEIGHT_LB_MAX),
});

export const weighinDaySchema = z.object({ day: dayField });

export const weightGoalSchema = z.object({
  goalPounds: z.number().min(WEIGHT_LB_MIN).max(WEIGHT_LB_MAX),
  pacePounds: z.number().refine((p) => (PACES_LB as readonly number[]).includes(p)),
});

export type WeightGoalInput = z.infer<typeof weightGoalSchema>;

/* -- the trend ----------------------------------------------------------------- */

export interface Weighin {
  /** The space's own day. */
  day: string;
  kg: number;
}

export interface TrendPoint extends Weighin {
  /** The trend through this weigh-in, in kg. */
  trend: number;
}

/**
 * Each weigh-in moves the trend this share of the way towards it, a day after
 * the last; after a gap of `n` days, `1 - 0.9^n` of the way, so a weekly
 * weigh-in counts for about half and a daily one for a tenth. The swings of
 * water and food from one morning to the next mostly cancel out.
 */
export const TREND_SHARE = 0.1;

/** The trend through the weigh-ins, oldest first. The first weigh-in starts it. */
export function weightTrend(weighins: readonly Weighin[]): TrendPoint[] {
  const sorted = [...weighins].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  const points: TrendPoint[] = [];
  for (const w of sorted) {
    const before = points.at(-1);
    if (!before) {
      points.push({ ...w, trend: w.kg });
      continue;
    }
    const share = 1 - Math.pow(1 - TREND_SHARE, Math.max(1, daysFrom(before.day, w.day)));
    points.push({ ...w, trend: before.trend + share * (w.kg - before.trend) });
  }
  return points;
}

/** The trend as of a day: through the last weigh-in on or before it; null before the first. */
export function trendOn(points: readonly TrendPoint[], day: string): number | null {
  let found: number | null = null;
  for (const p of points) {
    if (p.day > day) break;
    found = p.trend;
  }
  return found;
}

/** How the trend moved in the seven days ending `day`; null without a weigh-in a week or more before. */
export function weekChange(points: readonly TrendPoint[], day: string): number | null {
  const now = trendOn(points, day);
  const before = trendOn(points, shiftDay(day, -7));
  return now === null || before === null ? null : now - before;
}

/* -- the pace and the goal ------------------------------------------------------ */

/** The pace is read over the last four weeks... */
export const PACE_DAYS = 28;
/** ...once there are at least four weigh-ins in them, at least ten days apart first to last. */
export const PACE_MIN_WEIGHINS = 4;
export const PACE_MIN_SPAN = 10;

/**
 * Kilograms a week over the four weeks ending `today`: the slope of the
 * straight line closest to the weigh-ins (least squares), so no one morning
 * moves it much. Null until there are enough weigh-ins to say.
 */
export function weeklyPace(weighins: readonly Weighin[], today: string): number | null {
  const from = shiftDay(today, -(PACE_DAYS - 1));
  const recent = weighins.filter((w) => w.day >= from && w.day <= today);
  if (recent.length < PACE_MIN_WEIGHINS) return null;
  const xs = recent.map((w) => daysFrom(from, w.day));
  if (Math.max(...xs) - Math.min(...xs) < PACE_MIN_SPAN) return null;
  const mx = mean(xs) as number;
  const my = mean(recent.map((w) => w.kg)) as number;
  let top = 0;
  let bottom = 0;
  recent.forEach((w, i) => {
    top += (xs[i] - mx) * (w.kg - my);
    bottom += (xs[i] - mx) ** 2;
  });
  return bottom === 0 ? null : (top / bottom) * 7;
}

export interface WeightGoal {
  goalKg: number;
  /** About how much a week, either way. */
  paceKg: number;
}

/** Within half a pound of the goal is at it. */
export const AT_GOAL_KG = kgFromPounds(0.5);
/** A pace under a tenth of a pound a week is level. */
export const LEVEL_KG = kgFromPounds(0.1);
/** A date further off than three years is not given. */
const FAR_DAYS = 3 * 365;

export type Aim = "lose" | "gain" | "there";

export interface GoalReading {
  /** Whether the goal is below the trend, above it, or at it; null with no weigh-in yet. */
  aim: Aim | null;
  /** How far the trend is from the goal, in kg, never negative; null with no weigh-in yet. */
  toGoKg: number | null;
  /** The recent pace against the goal; null when there is no pace yet, or nowhere to go. */
  heading: "towards" | "away" | "level" | null;
  /** The day the goal is reached at the recent pace, when it is heading there and not too far off. */
  reachedOn: string | null;
  /** Heading there, but more than three years off at this pace. */
  far: boolean;
}

/** Where the trend stands against the goal, and when it gets there at the last four weeks' pace. */
export function readGoal(goal: WeightGoal, trendKg: number | null, paceKg: number | null, today: string): GoalReading {
  if (trendKg === null) return { aim: null, toGoKg: null, heading: null, reachedOn: null, far: false };
  const left = goal.goalKg - trendKg;
  if (Math.abs(left) <= AT_GOAL_KG) return { aim: "there", toGoKg: Math.abs(left), heading: null, reachedOn: null, far: false };
  const aim: Aim = left < 0 ? "lose" : "gain";
  if (paceKg === null) return { aim, toGoKg: Math.abs(left), heading: null, reachedOn: null, far: false };
  if (Math.abs(paceKg) < LEVEL_KG) return { aim, toGoKg: Math.abs(left), heading: "level", reachedOn: null, far: false };
  if (Math.sign(paceKg) !== Math.sign(left)) return { aim, toGoKg: Math.abs(left), heading: "away", reachedOn: null, far: false };
  // Pounds turned to kilograms and back leave a trillionth over: 70 days is not 71.
  const days = Math.ceil((Math.abs(left) / Math.abs(paceKg)) * 7 - 1e-9);
  return days > FAR_DAYS
    ? { aim, toGoKg: Math.abs(left), heading: "towards", reachedOn: null, far: true }
    : { aim, toGoKg: Math.abs(left), heading: "towards", reachedOn: shiftDay(today, days), far: false };
}

/** "Lose to 175 lb, about 1 lb a week"; "Gain to…"; "Reach…" before a weigh-in; at it, "Your goal: 175 lb". */
export function goalTitle(goal: WeightGoal, aim: Aim | null): string {
  const to = goalWords(goal.goalKg);
  if (aim === "there") return `Your goal: ${to}`;
  const verb = aim === "lose" ? "Lose to" : aim === "gain" ? "Gain to" : "Reach";
  return `${verb} ${to}, about ${paceWords(goal.paceKg)}`;
}

/**
 * What the recent pace says about the goal, in a sentence. "Recent" is the
 * last four weeks of weigh-ins, however few of them there are yet: the drive
 * (2026-10-03) read "the last 4 weeks' pace" off twelve days of them.
 */
export function goalLine(goal: WeightGoal, reading: GoalReading, paceKg: number | null, today: string): string {
  const to = goalWords(goal.goalKg);
  if (reading.aim === null) return "Weigh in to see how far you have to go.";
  if (reading.aim === "there") return "Your trend is within half a pound of it.";
  const left = `${poundsWords(reading.toGoKg ?? 0)} to go.`;
  if (paceKg === null || reading.heading === null) {
    return `${left} Two weeks of weigh-ins give a pace and a date.`;
  }
  const pace = `${tenths(Math.abs(poundsFromKg(paceKg)))} lb a week`;
  if (reading.heading === "level") return `${left} Your recent pace is about level, so there is no date yet.`;
  if (reading.heading === "away") {
    return `${left} Your recent pace is ${paceKg < 0 ? "down" : "up"} ${pace}, away from ${to}.`;
  }
  if (reading.far || reading.reachedOn === null) return `${left} At your recent pace (${pace}), more than three years off.`;
  return `${left} At your recent pace (${pace}), ${to} around ${shortDay(reading.reachedOn, today)}.`;
}

/** Which way is better for the weight row in Progress: towards the goal; neither without one, or at it. */
export function weightBetter(reading: GoalReading | null): "up" | "down" | null {
  if (!reading || reading.aim === null || reading.aim === "there") return null;
  return reading.aim === "lose" ? "down" : "up";
}

/* -- tape measures --------------------------------------------------------------- */

export const MEASURE_NAME_MAX = 40;
/** Enough for every place a tape goes round, twice over. */
export const MEASURES_MAX = 12;

export type Better = "smaller" | "bigger";

/** Offered on Your tape measures, in this order; the waist is better smaller, the rest are the person's call. */
export const MEASURE_SUGGESTIONS: readonly { name: string; better: Better | null }[] = [
  { name: "Waist", better: "smaller" },
  { name: "Chest", better: null },
  { name: "Hips", better: null },
  { name: "Arm", better: null },
  { name: "Thigh", better: null },
  { name: "Neck", better: null },
  { name: "Calf", better: null },
];

export function betterWords(better: Better | null): string {
  return better === "smaller" ? "Smaller is better" : better === "bigger" ? "Bigger is better" : "Neither way is better";
}

export const measureInputSchema = z.object({
  name: z.string().trim().min(1).max(MEASURE_NAME_MAX),
  better: z.enum(["smaller", "bigger"]).nullable(),
});

export type MeasureInput = z.infer<typeof measureInputSchema>;

export const measurementsInputSchema = z.object({
  day: dayField,
  /** Each measure's inches that day, or null to take it off. */
  values: z
    .array(z.object({ measureId: z.string().uuid(), inches: z.number().min(LENGTH_IN_MIN).max(LENGTH_IN_MAX).nullable() }))
    .min(1)
    .max(MEASURES_MAX),
  asToday: z.boolean().default(true),
});

export type MeasurementsInput = z.infer<typeof measurementsInputSchema>;

export interface MeasureIn {
  id: string;
  name: string;
  better: Better | null;
}

export interface MeasurementIn {
  measureId: string;
  day: string;
  cm: number;
}

/** A measure's first and latest, for "36.5 in, down 0.5 in since Sep 7". */
export function measureSpan(measurements: readonly MeasurementIn[]): { first: MeasurementIn; latest: MeasurementIn } | null {
  if (measurements.length === 0) return null;
  const sorted = [...measurements].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  return { first: sorted[0], latest: sorted[sorted.length - 1] };
}

/* -- Progress -------------------------------------------------------------------- */

/**
 * The body's rows on Progress: the weight (the trend as of each week's last
 * weigh-in, in pounds) and each tape measure (the week's mean, in inches),
 * read as levels (`measure`), so the bars span the four weeks' range rather
 * than start at zero. `weighins` may start before the first week: the trend
 * needs its warm-up. Which way is better: towards the goal for the weight, the
 * person's own call for a measure.
 */
export function bodyRows(
  windows: readonly ProgressWindow[],
  weighins: readonly Weighin[],
  goal: WeightGoal | null,
  measures: readonly MeasureIn[],
  measurements: readonly MeasurementIn[],
): ProgressRow[] {
  const points = weightTrend(weighins);
  const end = windows.at(-1)?.to ?? null;
  const reading = goal && end ? readGoal(goal, trendOn(points, end), null, end) : null;
  const rows: ProgressRow[] = [
    {
      key: "health.weight",
      name: "Weight",
      values: windows.map((w) => {
        const inWeek = points.filter((p) => inWindow(p.day, w));
        const last = inWeek.at(-1);
        return last ? poundsFromKg(last.trend) : null;
      }),
      format: "measure",
      unit: "lb",
      better: weightBetter(reading),
    },
  ];
  for (const measure of measures) {
    rows.push({
      key: `health.measure.${measure.id}`,
      name: measure.name,
      values: windows.map((w) =>
        mean(measurements.filter((m) => m.measureId === measure.id && inWindow(m.day, w)).map((m) => inchesFromCm(m.cm))),
      ),
      format: "measure",
      unit: "in",
      better: measure.better === "smaller" ? "down" : measure.better === "bigger" ? "up" : null,
    });
  }
  return rows;
}

/* -- the chart on Body -------------------------------------------------------------- */

/** The ranges the chart shows: the last 30 or 90 days, or everything. */
export const CHART_RANGES = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "all", label: "All", days: null },
] as const;

export interface ChartScale {
  /** The bottom and top of the chart, in pounds. */
  low: number;
  high: number;
  /** Lines across, in pounds, each a round number. */
  ticks: number[];
}

/**
 * The chart's pounds: the weigh-ins and the trend with a little room, the goal
 * too when it is near enough not to flatten the line, and three to six lines
 * across at a round step.
 */
export function chartScale(pounds: readonly number[], goalPounds: number | null): ChartScale | null {
  if (pounds.length === 0) return null;
  let low = Math.min(...pounds);
  let high = Math.max(...pounds);
  if (goalPounds !== null && goalPounds >= low - 5 && goalPounds <= high + 5) {
    low = Math.min(low, goalPounds);
    high = Math.max(high, goalPounds);
  }
  const room = Math.max(0.5, (high - low) * 0.1);
  low -= room;
  high += room;
  const step = [1, 2, 5, 10, 20, 50].find((s) => (high - low) / s <= 5) ?? 100;
  const ticks: number[] = [];
  for (let t = Math.ceil(low / step) * step; t <= high; t += step) ticks.push(t);
  return { low, high, ticks };
}
