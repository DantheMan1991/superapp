/**
 * Rest and rotation arithmetic. PURE — no imports, no database, no
 * `server-only`.
 *
 * **REST IS AN OUTCOME, NEVER A SETTING.** Nothing in this file schedules
 * anything or refuses anything. It measures what each zone actually got and
 * reports it, which is the whole reason the numbers are free: every one of
 * them falls out of an occupancy record somebody was going to make anyway.
 *
 * The pack-wide rule this serves, from the Land design: *anything derivable
 * from a record already being made must never become a second data entry.*
 *
 * Dates are `YYYY-MM-DD` strings throughout. Day arithmetic goes through
 * `Date.UTC`, which is exact — no timezone, no DST, no month-end surprise. The
 * house rule about never doing MONTH arithmetic through `Date` still stands and
 * is not what this is: adding a month is ambiguous, adding a day is not.
 */

/** `YYYY-MM-DD` → days since the epoch. Exact: UTC has no DST. */
function toEpochDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Days since the epoch → `YYYY-MM-DD`. */
function fromEpochDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The day before — which is the LAST DAY ON a paddock when the next stay starts
 * the following morning.
 *
 * `ended_on` is inclusive, so a move on the 16th means the old stay ended on
 * the 15th. Using the 16th for both would count that day's grazing on two
 * paddocks and inflate every rotation figure that reads them.
 */
export function dayBefore(iso: string): string {
  return fromEpochDay(toEpochDay(iso) - 1);
}

/**
 * How many days a stay covered, counting BOTH ends.
 *
 * In on Monday, out on Monday is one day of grazing, not zero — the animals
 * ate. This matches `ended_on` being inclusive everywhere else in the pack, and
 * it is the number that feeds the paddock arithmetic, so an off-by-one here
 * propagates into every rotation figure.
 */
export function daysOccupied(startedOn: string, endedOn: string): number {
  return daysBetween(startedOn, endedOn) + 1;
}

export interface OccupancySpan {
  startedOn: string;
  /** Null means still there. */
  endedOn: string | null;
}

export type RestStatus = "occupied" | "resting" | "never_grazed";

export interface ZoneRest {
  status: RestStatus;
  /** Days since the last stay ended. Null while occupied or never used. */
  restDays: number | null;
  /** The day the rest clock started. Null while occupied or never used. */
  restingSince: string | null;
  /** Total days of occupancy ever recorded on this zone. */
  grazingDays: number;
  /** How many separate stays. Distinguishes one long stay from ten short ones. */
  stays: number;
}

/**
 * What a zone's occupancy history says about its rest, as of `today`.
 *
 * **The rest clock starts at the end of the last stay**, which is the single
 * rule that serves a strip grazer and a fixed-paddock user without a branch:
 * it does not care how much of the zone was used or how the stay was shaped.
 *
 * `never_grazed` is deliberately not "infinitely rested". A paddock nobody has
 * ever used and a paddock resting 200 days are different facts, and collapsing
 * them would put every new zone at the top of a "most rested" list on the day
 * it was created.
 */
export function zoneRest(spans: OccupancySpan[], today: string): ZoneRest {
  /**
   * REST DESCRIBES WHAT HAS HAPPENED, NOT WHAT IS PLANNED.
   *
   * A stay can be recorded ahead — the move dialog has an "On" date, so
   * "they go to Creek Paddock on Monday" is a Friday entry. Counting it read
   * that paddock as **occupied** from the moment it was typed, which stopped
   * its rest clock days early and understated the rest on ground nothing was
   * standing on. Rest is the number this pack exists to produce, and nothing on
   * the page looked wrong. Found by clicking, 2026-08-16.
   *
   * So every span is clipped to `today`: one that has not begun contributes
   * nothing at all, and one that has begun contributes only the part that has
   * actually elapsed.
   */
  const begun = spans.filter((span) => span.startedOn <= today);

  if (begun.length === 0) {
    // Including the case where every stay is in the future. Nothing has been on
    // it, which is exactly what `never_grazed` means.
    return {
      status: "never_grazed",
      restDays: null,
      restingSince: null,
      grazingDays: 0,
      stays: 0,
    };
  }

  let grazingDays = 0;
  let occupied = false;
  let lastEnd: string | null = null;

  for (const span of begun) {
    // Still running: no end, OR an end that has not arrived yet. The second
    // case is a planned departure — they are standing on it now, so treating
    // that future date as the start of rest would have the clock running while
    // the herd is still eating.
    if (span.endedOn === null || span.endedOn > today) {
      occupied = true;
      // Counts the days it has run SO FAR — a herd three weeks into a stay
      // reading zero grazing days would be worse than the arithmetic being
      // slightly behind. Never negative now: `begun` guarantees it started.
      grazingDays += daysOccupied(span.startedOn, today);
      continue;
    }
    grazingDays += daysOccupied(span.startedOn, span.endedOn);
    if (lastEnd === null || span.endedOn > lastEnd) lastEnd = span.endedOn;
  }

  if (occupied) {
    return {
      status: "occupied",
      restDays: null,
      restingSince: null,
      grazingDays,
      stays: begun.length,
    };
  }

  return {
    status: "resting",
    // lastEnd is non-null here: every begun span is closed, and there is one.
    restDays: Math.max(0, daysBetween(lastEnd as string, today)),
    restingSince: lastEnd,
    grazingDays,
    stays: begun.length,
  };
}

/**
 * The standard grazier's formula: `paddocks = (rest ÷ graze) + 1`.
 *
 * The `+ 1` is the paddock the herd is standing in — it cannot be resting at
 * the same time. Rounded UP, because two-thirds of a paddock does not exist and
 * rounding down quietly returns an answer that misses the target.
 */
export function paddocksForTarget(
  restTargetDays: number,
  grazeDaysPerZone: number,
): number | null {
  if (restTargetDays <= 0 || grazeDaysPerZone <= 0) return null;
  return Math.ceil(restTargetDays / grazeDaysPerZone) + 1;
}

/** The inverse: the rest a given number of paddocks can actually deliver. */
export function restFromPaddocks(
  paddockCount: number,
  grazeDaysPerZone: number,
): number | null {
  if (paddockCount <= 1 || grazeDaysPerZone <= 0) return null;
  return (paddockCount - 1) * grazeDaysPerZone;
}

export interface RotationFinding {
  /** Zones in the rotation — those with occupancy history, not every zone. */
  paddocks: number;
  /** Mean days per stay, from the record. */
  grazeDaysPerZone: number;
  restTargetDays: number;
  /** What this many paddocks at this pace can actually deliver. */
  achievableRestDays: number;
  /** How many paddocks the target would need. */
  paddocksNeeded: number;
  /** Positive means the target is out of reach at the current pace. */
  shortfallDays: number;
  shortfallPaddocks: number;
}

/**
 * The finding this whole category was argued for.
 *
 * Run against the pilot's own numbers it says: at ~1 day per paddock a 21-day
 * target needs 22 paddocks, and a 12-paddock summer loop yields 11 days. The
 * stated difficulty hitting three weeks is **arithmetically unavoidable rather
 * than a management failure** — and every input came from records the app was
 * already holding.
 *
 * Returns null rather than guessing when there is not enough history. A
 * rotation figure computed from one stay is noise wearing a decimal point.
 */
export function rotationFinding(input: {
  paddocks: number;
  restTargetDays: number | null;
  /** Days per completed stay, across the parcel. */
  staysDays: number[];
  /** Below this many completed stays, say nothing. */
  minStays?: number;
}): RotationFinding | null {
  const { paddocks, restTargetDays, staysDays } = input;
  const minStays = input.minStays ?? 3;
  if (
    restTargetDays === null ||
    restTargetDays <= 0 ||
    paddocks < 2 ||
    staysDays.length < minStays
  ) {
    return null;
  }

  const total = staysDays.reduce((sum, d) => sum + d, 0);
  // Rounded to a tenth: "1.2 days a paddock" is honest, and the extra decimals
  // would imply a precision that a handful of stays does not support.
  const grazeDaysPerZone = Math.round((total / staysDays.length) * 10) / 10;
  if (grazeDaysPerZone <= 0) return null;

  const achievableRestDays = restFromPaddocks(paddocks, grazeDaysPerZone) ?? 0;
  const paddocksNeeded = paddocksForTarget(restTargetDays, grazeDaysPerZone) ?? 0;

  return {
    paddocks,
    grazeDaysPerZone,
    restTargetDays,
    achievableRestDays: Math.round(achievableRestDays * 10) / 10,
    paddocksNeeded,
    shortfallDays: Math.round((restTargetDays - achievableRestDays) * 10) / 10,
    shortfallPaddocks: Math.max(0, paddocksNeeded - paddocks),
  };
}

/** "12 days", "1 day", "—". Rest is counted in whole days; nobody grazes to the hour. */
export function formatDays(days: number | null): string {
  if (days === null) return "—";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/**
 * Stocking, as area per occupant-day. Land supplies the acreage; it knows
 * nothing about head, so this stops short of animal units on purpose —
 * head count belongs to `livestock` and inventing a column for it here would
 * be this pack growing an opinion about its neighbours.
 */
export function areaGrazed(
  occupancyArea: number | null,
  zoneArea: number | null,
): number | null {
  // Null on the occupancy means the whole zone, which is the fixed-paddock
  // case and the majority of records.
  return occupancyArea ?? zoneArea;
}
