/**
 * What the weather has been over a piece of ground. PURE — no imports, no
 * database, no network. The fetch lives in `weather-service.ts`; this file
 * decides what to ask and what the answer means, the same split
 * `parcel-lookup.ts` uses.
 *
 * **THE QUESTION IT ANSWERS IS "IS TWENTY-ONE DAYS OF REST ENOUGH".** Rest days
 * and grazing days are already free, computed from occupancy. The number that
 * is missing is how much the grass actually GREW in those days, and measuring
 * that is the thing nobody keeps up. Growing degree days are a free proxy: a
 * season running 30% behind is a season where the same twenty-one days bought
 * you less.
 *
 * **AND IT MUST NEVER BECOME A SECOND DATA ENTRY** — the pack-wide rule from
 * the design brief. Nobody types a temperature. Open-Meteo serves history by
 * latitude and longitude for free and without a key, so the whole record is
 * derivable from a parcel's centroid and a date.
 *
 * **IT REPORTS; IT DOES NOT PREDICT.** The brief's own line —
 * *"you return to Paddock 4 in 16 days, not 21"* — is the destination, and it
 * is deliberately not this slice. Turning degree days into a regrowth date is a
 * correlation nobody here has validated, on ground nobody here has measured,
 * and the brief says the same thing in its own words: log from day one, insight
 * in year three. So this shows what the weather DID, next to the same window in
 * previous years, and lets the person draw the line.
 */

/** One day as the archive gives it. Nulls are real: gaps happen. */
export interface WeatherDay {
  /** ISO date, `YYYY-MM-DD`, in the parcel's own timezone. */
  date: string;
  maxC: number | null;
  minC: number | null;
  /** Millimetres. */
  rainMm: number | null;
}

export type TemperatureUnit = "celsius" | "fahrenheit";

export const DEFAULT_TEMPERATURE_UNIT: TemperatureUnit = "fahrenheit";

function isTemperatureUnit(value: unknown): value is TemperatureUnit {
  return value === "celsius" || value === "fahrenheit";
}

/**
 * The tenant's temperature unit.
 *
 * **DEFAULTS TO FAHRENHEIT, WHICH IS NOT THE HOUSE STYLE ANYWHERE ELSE IN THIS
 * PACK** — area and length both default metric-agnostic and are set per
 * profile. The reason is that a degree-day figure is only useful if it matches
 * the ones the person already reads, and every US extension service publishes
 * GDD in Fahrenheit days over a base of 50. A grower comparing our 900 against
 * their county's 1,600 would conclude the app is broken.
 */
export function temperatureUnitFrom(config: unknown): TemperatureUnit {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).temperatureUnit;
    if (isTemperatureUnit(value)) return value;
  }
  return DEFAULT_TEMPERATURE_UNIT;
}

/**
 * The base temperature degree days accumulate above, in Celsius.
 *
 * **TEN DEGREES — FIFTY FAHRENHEIT — WHICH IS THE COMMONEST AGRONOMIC BASE**
 * and the one every US extension service publishes corn and most forages
 * against. It is a property of what is GROWING, not of the ground, so it lives
 * in `packConfig` where the profile can set it: cool-season grass is often
 * computed over a base of 0C, and a profile that says so gets that.
 *
 * **INDUSTRY-BLIND, WHICH IS WHY IT IS CONFIG AND NOT A CROP TABLE** (ADR 0004).
 * Accumulated heat above a threshold is a fact about a place, like rainfall.
 * Which threshold matters to you is a fact about your business, and this pack
 * does not hold opinions about that.
 */
export const DEFAULT_GDD_BASE_C = 10;

export function gddBaseCFrom(config: unknown): number {
  if (config && typeof config === "object" && !Array.isArray(config)) {
    const value = (config as Record<string, unknown>).gddBaseC;
    if (typeof value === "number" && Number.isFinite(value) && value >= -20 && value <= 30) {
      return value;
    }
  }
  return DEFAULT_GDD_BASE_C;
}

export function toFahrenheit(celsius: number): number {
  return celsius * 1.8 + 32;
}

/**
 * Growing degree days for ONE day, by the simple average method.
 *
 * `max(0, (high + low) / 2 - base)`. A day whose average never reaches the base
 * contributes nothing — it does not subtract, which is the whole point of the
 * floor: a cold snap pauses the season, it does not undo it.
 *
 * **THERE IS NO UPPER CAP, AND THAT IS A DECISION RATHER THAN AN OMISSION.**
 * Many crops cap the high at 30C on the grounds that growth stops above it, and
 * corn is always computed that way. Adding the cap now would mean choosing a
 * number on behalf of every business this pack serves, and getting it wrong is
 * worse than leaving it out — an uncapped figure is simply the uncapped
 * convention, which plenty of extension services also publish. **What would
 * trigger adding it:** somebody comparing our number against a capped local
 * one and finding a gap in a hot month. It belongs beside `gddBaseC` in config
 * when it comes.
 */
export function degreeDays(
  day: WeatherDay,
  baseC: number = DEFAULT_GDD_BASE_C,
): number | null {
  if (day.maxC === null || day.minC === null) return null;
  return Math.max(0, (day.maxC + day.minC) / 2 - baseC);
}

/**
 * Degree days accumulated across a run of days, and how many days are missing.
 *
 * **THE GAPS ARE COUNTED, NOT FILLED.** A missing day is not zero growth — it
 * is an unknown — and quietly treating it as zero would make a patchy series
 * read as a cold season. The same rule `totalLength` follows for a feature
 * nobody has drawn.
 */
export interface Accumulation {
  gdd: number;
  /** Days that contributed. */
  days: number;
  /** Days in the range the archive had nothing for. */
  missing: number;
  rainMm: number;
}

export function accumulate(
  days: readonly WeatherDay[],
  baseC: number = DEFAULT_GDD_BASE_C,
): Accumulation {
  let gdd = 0;
  let counted = 0;
  let missing = 0;
  let rainMm = 0;
  for (const day of days) {
    const value = degreeDays(day, baseC);
    if (value === null) missing += 1;
    else {
      gdd += value;
      counted += 1;
    }
    if (day.rainMm !== null) rainMm += day.rainMm;
  }
  return { gdd, days: counted, missing, rainMm };
}

/** The days of one calendar year, up to and including `throughMonthDay`. */
export function seasonToDate(
  days: readonly WeatherDay[],
  year: number,
  throughMonthDay: string,
): WeatherDay[] {
  const from = `${year}-01-01`;
  const to = `${year}-${throughMonthDay}`;
  return days.filter((day) => day.date >= from && day.date <= to);
}

/** `YYYY-MM-DD` → `MM-DD`. */
export function monthDayOf(isoDate: string): string {
  return isoDate.slice(5, 10);
}

export function yearOf(isoDate: string): number {
  return Number(isoDate.slice(0, 4));
}

/**
 * This season's heat against the same window in previous years.
 *
 * **THE SAME WINDOW, NOT THE WHOLE YEAR.** Comparing January-to-August against
 * a full previous year would say every season is behind until December. The
 * comparison a person means is "how does today compare with this date last
 * year", and that is what this computes.
 *
 * A year with no usable days is left out rather than averaged in as zero — the
 * gap rule again. `years` is how many are behind the average, so a caller can
 * say "five-year average" honestly or refuse to.
 */
export interface SeasonComparison {
  /** This year to date. */
  gdd: number;
  /** Mean of the same window across the previous years that had data. */
  averageGdd: number | null;
  /** How many previous years contributed. */
  years: number;
  /** Fraction above (+) or below (-) the average, or null with nothing to compare. */
  difference: number | null;
}

export function compareSeason(
  days: readonly WeatherDay[],
  today: string,
  baseC: number = DEFAULT_GDD_BASE_C,
): SeasonComparison {
  const thisYear = yearOf(today);
  const monthDay = monthDayOf(today);
  const current = accumulate(seasonToDate(days, thisYear, monthDay), baseC);

  const previous: number[] = [];
  for (let year = thisYear - 1; year >= thisYear - 10; year -= 1) {
    const window = seasonToDate(days, year, monthDay);
    if (window.length === 0) continue;
    const past = accumulate(window, baseC);
    if (past.days > 0) previous.push(past.gdd);
  }

  if (previous.length === 0) {
    return { gdd: current.gdd, averageGdd: null, years: 0, difference: null };
  }
  const averageGdd =
    previous.reduce((sum, value) => sum + value, 0) / previous.length;
  return {
    gdd: current.gdd,
    averageGdd,
    years: previous.length,
    difference: averageGdd > 0 ? (current.gdd - averageGdd) / averageGdd : null,
  };
}

/**
 * How wet it has been lately, which is the "can I get on the ground" question.
 *
 * Two facts, because they answer different halves of it: how much has fallen in
 * the window, and how long since it last rained enough to matter. A week of
 * drizzle and one thunderstorm total the same and mean opposite things for
 * whether you can cut hay.
 */
export const WETTING_RAIN_MM = 5;

export interface RecentRain {
  mm: number;
  days: number;
  /** Days since the last day with at least `WETTING_RAIN_MM`, or null. */
  sinceWetting: number | null;
}

export function recentRain(
  days: readonly WeatherDay[],
  today: string,
  window = 7,
): RecentRain {
  const sorted = [...days]
    .filter((day) => day.date <= today)
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const recent = sorted.slice(0, window);
  const mm = recent.reduce((sum, day) => sum + (day.rainMm ?? 0), 0);

  let sinceWetting: number | null = null;
  for (let i = 0; i < sorted.length; i += 1) {
    if ((sorted[i].rainMm ?? 0) >= WETTING_RAIN_MM) {
      sinceWetting = i;
      break;
    }
  }
  return { mm, days: recent.length, sinceWetting };
}

/** Millimetres → inches, for a tenant reading in feet. */
export function toInches(mm: number): number {
  return mm / 25.4;
}

export function formatRain(mm: number, unit: TemperatureUnit): string {
  return unit === "fahrenheit"
    ? `${(Math.round(toInches(mm) * 100) / 100).toLocaleString("en-US")} in`
    : `${Math.round(mm)} mm`;
}

/**
 * Degree days in the unit the person reads them in.
 *
 * **A DEGREE DAY IS NOT A TEMPERATURE, so it does not convert like one.** The
 * 32 in the Fahrenheit formula is an offset between two zero points, and a
 * degree day is already a difference — adding 32 to it would add 32 degree days
 * to every single day of the season. Only the 1.8 applies. Getting this wrong
 * is the kind of error that produces a plausible number, which is why it is
 * written down here rather than inlined.
 */
export function formatDegreeDays(gdd: number, unit: TemperatureUnit): string {
  const value = unit === "fahrenheit" ? gdd * 1.8 : gdd;
  return `${Math.round(value).toLocaleString("en-US")} ${
    unit === "fahrenheit" ? "°F-days" : "°C-days"
  }`;
}

/** The base, said the way somebody would read it on an extension page. */
export function formatBase(baseC: number, unit: TemperatureUnit): string {
  return unit === "fahrenheit"
    ? `${Math.round(toFahrenheit(baseC))}°F`
    : `${Math.round(baseC)}°C`;
}
