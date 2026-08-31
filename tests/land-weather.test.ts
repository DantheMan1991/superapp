import { describe, expect, it } from "vitest";
import {
  accumulate,
  compareSeason,
  DEFAULT_GDD_BASE_C,
  DEFAULT_TEMPERATURE_UNIT,
  degreeDays,
  formatBase,
  formatDegreeDays,
  formatRain,
  gddBaseCFrom,
  recentRain,
  seasonToDate,
  temperatureUnitFrom,
  toFahrenheit,
  WETTING_RAIN_MM,
  type WeatherDay,
} from "../src/packs/land/core/weather";

/**
 * Weather and growing degree days — the pure half of land slice 3.
 *
 * The failures worth writing down are the ones that produce a PLAUSIBLE wrong
 * number, because nobody checks a weather figure against anything:
 *
 *   - converting a degree DAY as if it were a temperature, which adds 32 to
 *     every day of the season
 *   - treating a missing day as zero growth, so a patchy archive reads as a
 *     cold year
 *   - comparing this year to date against previous WHOLE years, so every
 *     season is behind until December
 *   - a cold day subtracting from the total instead of contributing nothing
 */

const day = (
  date: string,
  maxC: number | null,
  minC: number | null,
  rainMm: number | null = 0,
): WeatherDay => ({ date, maxC, minC, rainMm });

describe("degreeDays", () => {
  it("is the average above the base", () => {
    // (20 + 10) / 2 = 15, less a base of 10.
    expect(degreeDays(day("2026-05-01", 20, 10), 10)).toBe(5);
  });

  /**
   * **A COLD DAY CONTRIBUTES NOTHING; IT DOES NOT SUBTRACT.** Without the floor
   * a frost in May would undo a week of growth, which is not how a season
   * works and would make the total wander back down.
   */
  it("floors at zero rather than going negative", () => {
    expect(degreeDays(day("2026-03-01", 4, -2), 10)).toBe(0);
  });

  it("is null when the day is missing, not zero", () => {
    expect(degreeDays(day("2026-05-01", null, 10), 10)).toBeNull();
    expect(degreeDays(day("2026-05-01", 20, null), 10)).toBeNull();
  });

  it("uses the standard base when none is given", () => {
    expect(DEFAULT_GDD_BASE_C).toBe(10);
    expect(degreeDays(day("2026-05-01", 20, 10))).toBe(5);
  });

  it("moves with the base", () => {
    // Cool-season grass is often computed over a base of zero.
    expect(degreeDays(day("2026-05-01", 20, 10), 0)).toBe(15);
  });
});

describe("accumulate", () => {
  const RUN: WeatherDay[] = [
    day("2026-05-01", 20, 10, 3),
    day("2026-05-02", 22, 12, 0),
    day("2026-05-03", null, null, 8),
    day("2026-05-04", 8, 2, 1),
  ];

  /**
   * **THE GAPS ARE COUNTED, NOT FILLED.** A missing day is an unknown, not zero
   * growth, and averaging it in as zero would make a patchy archive read as a
   * cold season — the same rule `totalLength` follows for an undrawn feature.
   */
  it("counts what it could not measure instead of calling it zero", () => {
    const total = accumulate(RUN, 10);
    expect(total.gdd).toBe(5 + 7 + 0);
    expect(total.days).toBe(3);
    expect(total.missing).toBe(1);
  });

  it("still totals the rain on a day with no temperature", () => {
    expect(accumulate(RUN, 10).rainMm).toBe(12);
  });

  it("is zero over nothing, without dividing by it", () => {
    expect(accumulate([], 10)).toEqual({
      gdd: 0,
      days: 0,
      missing: 0,
      rainMm: 0,
    });
  });
});

describe("seasonToDate", () => {
  const YEARS: WeatherDay[] = [
    day("2024-06-15", 20, 10),
    day("2025-03-01", 20, 10),
    day("2025-06-15", 20, 10),
    day("2025-09-01", 20, 10),
    day("2026-06-15", 20, 10),
  ];

  it("takes one year up to a day", () => {
    const window = seasonToDate(YEARS, 2025, "06-15");
    expect(window.map((d) => d.date)).toEqual(["2025-03-01", "2025-06-15"]);
  });
});

/**
 * **THE COMPARISON IS THE PRODUCT.** A degree-day total on its own means
 * nothing to anybody; "30% behind the five-year average" is the sentence that
 * changes a decision.
 */
describe("compareSeason", () => {
  /** Three Junes, each warmer than the last, one day per year for clarity. */
  const HISTORY: WeatherDay[] = [
    day("2024-06-01", 20, 10), // 5
    day("2025-06-01", 24, 14), // 9
    day("2026-06-01", 16, 6), // 1
  ];

  it("compares this year to date against the SAME window in past years", () => {
    const out = compareSeason(HISTORY, "2026-06-01", 10);
    expect(out.gdd).toBe(1);
    expect(out.years).toBe(2);
    expect(out.averageGdd).toBe(7);
    expect(out.difference).toBeCloseTo((1 - 7) / 7, 5);
  });

  /**
   * **NOT AGAINST PREVIOUS WHOLE YEARS**, which would have every season behind
   * until December. A previous year's later days must be ignored.
   */
  it("ignores days later in the year than today", () => {
    const withLater = [...HISTORY, day("2025-11-01", 30, 20)];
    expect(compareSeason(withLater, "2026-06-01", 10).averageGdd).toBe(7);
  });

  it("says it has nothing to compare rather than inventing an average", () => {
    const out = compareSeason([day("2026-06-01", 20, 10)], "2026-06-01", 10);
    expect(out.averageGdd).toBeNull();
    expect(out.years).toBe(0);
    expect(out.difference).toBeNull();
  });

  it("leaves a year with no usable days out of the average", () => {
    const gappy = [...HISTORY, day("2023-06-01", null, null)];
    const out = compareSeason(gappy, "2026-06-01", 10);
    expect(out.years).toBe(2);
    expect(out.averageGdd).toBe(7);
  });
});

describe("recentRain", () => {
  const WEEK: WeatherDay[] = [
    day("2026-06-01", 20, 10, 12),
    day("2026-06-02", 20, 10, 0),
    day("2026-06-03", 20, 10, 1),
    day("2026-06-04", 20, 10, 0),
    day("2026-06-05", 20, 10, 0),
  ];

  it("totals the window", () => {
    expect(recentRain(WEEK, "2026-06-05", 7).mm).toBe(13);
  });

  /**
   * **HOW MUCH AND HOW LONG AGO ARE DIFFERENT QUESTIONS.** A week of drizzle
   * and one thunderstorm total the same and mean opposite things for whether
   * you can cut hay.
   */
  it("says how long since it rained enough to matter", () => {
    expect(recentRain(WEEK, "2026-06-05", 7).sinceWetting).toBe(4);
    expect(WETTING_RAIN_MM).toBe(5);
  });

  it("does not count a drizzle as a wetting rain", () => {
    const drizzle = WEEK.map((d) => ({ ...d, rainMm: 1 }));
    expect(recentRain(drizzle, "2026-06-05", 7).sinceWetting).toBeNull();
  });

  it("never looks into the future", () => {
    const withTomorrow = [...WEEK, day("2026-06-06", 20, 10, 40)];
    const out = recentRain(withTomorrow, "2026-06-05", 7);
    expect(out.mm).toBe(13);
    expect(out.sinceWetting).toBe(4);
  });
});

/**
 * **A DEGREE DAY IS NOT A TEMPERATURE, SO IT DOES NOT CONVERT LIKE ONE.** The
 * 32 in the Fahrenheit formula is an offset between two zero points; a degree
 * day is already a difference. Adding 32 would add 32 degree days to every day
 * of the season — a wrong number that looks entirely reasonable.
 */
describe("formatDegreeDays", () => {
  it("scales without the offset", () => {
    expect(formatDegreeDays(100, "fahrenheit")).toBe("180 °F-days");
    expect(formatDegreeDays(100, "celsius")).toBe("100 °C-days");
  });

  it("is not the temperature conversion", () => {
    expect(toFahrenheit(100)).toBe(212);
    expect(formatDegreeDays(100, "fahrenheit")).not.toContain("212");
  });

  it("groups a season-sized number", () => {
    expect(formatDegreeDays(1000, "fahrenheit")).toBe("1,800 °F-days");
  });
});

describe("formatBase and formatRain", () => {
  it("says the base the way an extension page does", () => {
    expect(formatBase(10, "fahrenheit")).toBe("50°F");
    expect(formatBase(10, "celsius")).toBe("10°C");
  });

  it("reports rain in the matching unit", () => {
    expect(formatRain(25.4, "fahrenheit")).toBe("1 in");
    expect(formatRain(25.4, "celsius")).toBe("25 mm");
  });
});

describe("config readers", () => {
  it("default to the units a US extension service publishes", () => {
    expect(DEFAULT_TEMPERATURE_UNIT).toBe("fahrenheit");
    expect(temperatureUnitFrom(null)).toBe("fahrenheit");
    expect(gddBaseCFrom(undefined)).toBe(10);
  });

  it("take a profile's own answer", () => {
    expect(temperatureUnitFrom({ temperatureUnit: "celsius" })).toBe("celsius");
    expect(gddBaseCFrom({ gddBaseC: 0 })).toBe(0);
  });

  it("refuse nonsense rather than trusting it", () => {
    expect(temperatureUnitFrom({ temperatureUnit: "kelvin" })).toBe("fahrenheit");
    expect(gddBaseCFrom({ gddBaseC: "warm" })).toBe(10);
    expect(gddBaseCFrom({ gddBaseC: 500 })).toBe(10);
    expect(gddBaseCFrom([{ gddBaseC: 0 }])).toBe(10);
  });
});
