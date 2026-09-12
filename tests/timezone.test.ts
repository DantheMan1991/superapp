import { describe, expect, it } from "vitest";
import {
  COMMON_TIMEZONES,
  DEFAULT_TIMEZONE,
  addDays,
  dateInTimezone,
  datesBetween,
  isDateString,
  isValidTimeZone,
  localHourInTimezone,
  startOfWeek,
  todayInTimezone,
} from "../src/lib/timezone";

/**
 * The business day. Pure — no database, always runs.
 *
 * Every case below is a real bug this module exists to prevent, not a
 * restatement of what Intl does.
 */

describe("isValidTimeZone", () => {
  it("accepts real IANA zones", () => {
    for (const t of COMMON_TIMEZONES) expect(isValidTimeZone(t.value)).toBe(true);
  });

  it("rejects the things a form actually sends", () => {
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("EST5EDT nonsense")).toBe(false);
    // A plausible-looking near-miss is the dangerous case: it would pass a
    // regex and throw at format time, on whichever page next asked the date.
    expect(isValidTimeZone("America/New York")).toBe(false);
    expect(isValidTimeZone("america/new_york")).toBe(true); // Intl is case-insensitive
  });

  it("the default is valid", () => {
    expect(isValidTimeZone(DEFAULT_TIMEZONE)).toBe(true);
  });
});

describe("todayInTimezone", () => {
  it("returns yyyy-mm-dd, which is what date columns compare against", () => {
    expect(todayInTimezone("UTC")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("gives a DIFFERENT day either side of midnight — the whole point", () => {
    // 03:30 UTC on the 15th is still the 14th in New York. A server computing
    // "today" as UTC would call a task due on the 15th overdue tonight.
    const at = new Date("2026-03-15T03:30:00Z");
    expect(todayInTimezone("UTC", at)).toBe("2026-03-15");
    expect(todayInTimezone("America/New_York", at)).toBe("2026-03-14");
    expect(todayInTimezone("America/Los_Angeles", at)).toBe("2026-03-14");
    expect(todayInTimezone("Australia/Sydney", at)).toBe("2026-03-15");
  });

  it("handles the DST spring-forward day", () => {
    // 2026-03-08 is the US spring-forward. 07:30 UTC is 02:30 EST → but 2am
    // does not exist that morning, so this lands on the 8th either way. The
    // assertion is that it does not throw and does not skip a day.
    const at = new Date("2026-03-08T07:30:00Z");
    expect(todayInTimezone("America/New_York", at)).toBe("2026-03-08");
  });

  it("Arizona does not observe DST and still resolves", () => {
    const summer = new Date("2026-07-04T05:30:00Z");
    expect(todayInTimezone("America/Phoenix", summer)).toBe("2026-07-03");
    expect(todayInTimezone("America/Denver", summer)).toBe("2026-07-03");
  });

  it("dateInTimezone is the same question asked of a past instant", () => {
    const at = new Date("2026-01-01T04:00:00Z");
    expect(dateInTimezone(at, "UTC")).toBe("2026-01-01");
    expect(dateInTimezone(at, "America/New_York")).toBe("2025-12-31");
  });
});

describe("localHourInTimezone", () => {
  it("reports the local hour, which is how one cron serves every tenant", () => {
    const at = new Date("2026-03-15T12:00:00Z");
    expect(localHourInTimezone("UTC", at)).toBe(12);
    expect(localHourInTimezone("America/New_York", at)).toBe(8); // EDT, UTC-4
    expect(localHourInTimezone("America/Los_Angeles", at)).toBe(5);
  });

  it("normalises midnight to 0, never 24", () => {
    // en-GB renders midnight as "24" in some ICU builds. A cron comparing
    // hour === 0 would then never fire for a midnight send.
    const at = new Date("2026-03-15T05:00:00Z");
    expect(localHourInTimezone("America/New_York", at)).toBe(1);
    const midnightUtc = new Date("2026-03-15T00:00:00Z");
    expect(localHourInTimezone("UTC", midnightUtc)).toBe(0);
  });

  it("tracks the DST offset shift without any stored offset", () => {
    // Same wall-clock intent, opposite sides of the US DST boundary. A tenant
    // whose send time was stored as a fixed UTC hour would drift by an hour
    // twice a year; asking the zone never does.
    const winter = new Date("2026-01-15T12:00:00Z");
    const summer = new Date("2026-07-15T12:00:00Z");
    expect(localHourInTimezone("America/New_York", winter)).toBe(7); // EST
    expect(localHourInTimezone("America/New_York", summer)).toBe(8); // EDT
    // Phoenix stays put all year — the case a fixed-offset design gets wrong.
    expect(localHourInTimezone("America/Phoenix", winter)).toBe(5);
    expect(localHourInTimezone("America/Phoenix", summer)).toBe(5);
  });
});

describe("COMMON_TIMEZONES", () => {
  it("has no duplicate values and every entry is labelled", () => {
    const values = COMMON_TIMEZONES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
    for (const t of COMMON_TIMEZONES) expect(t.label.length).toBeGreaterThan(0);
  });

  it("includes the default, so the picker can always show the current value", () => {
    expect(COMMON_TIMEZONES.some((t) => t.value === DEFAULT_TIMEZONE)).toBe(true);
  });
});

/**
 * Calendar arithmetic. Added when the Time module widened `startOfWeek` from
 * `0 | 1` to any day of the week — an owner picks the day their week runs from
 * (`time_settings.week_starts_on`), and before that only Sunday and Monday had
 * a test.
 */

describe("isDateString", () => {
  it("accepts real days", () => {
    expect(isDateString("2026-09-11")).toBe(true);
    expect(isDateString("2024-02-29")).toBe(true); // a leap year
  });

  it("refuses days that do not exist", () => {
    // The format alone accepts these; a `Date` silently rolls them forward,
    // which is why the round trip is the test.
    expect(isDateString("2026-02-31")).toBe(false);
    expect(isDateString("2025-02-29")).toBe(false);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString("2026-9-11")).toBe(false);
    expect(isDateString("11/09/2026")).toBe(false);
    expect(isDateString("")).toBe(false);
  });
});

describe("addDays", () => {
  it("crosses months, years and a leap day", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("steps over both daylight-saving transitions", () => {
    // US DST began 2026-03-08 and ended 2026-11-01, both Sundays. Adding
    // 86,400,000 ms to a LOCAL instant skips or repeats an hour and lands on
    // the wrong date; this runs in UTC, which has no transitions.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });
});

describe("startOfWeek", () => {
  // 2026-09-11 is a Friday.
  it("finds the start for a Sunday week and a Monday week", () => {
    expect(startOfWeek("2026-09-11", 0)).toBe("2026-09-06");
    expect(startOfWeek("2026-09-11", 1)).toBe("2026-09-07");
  });

  it("a day that IS the start returns itself", () => {
    expect(startOfWeek("2026-09-06", 0)).toBe("2026-09-06");
    expect(startOfWeek("2026-09-07", 1)).toBe("2026-09-07");
  });

  it("a Sunday in a Monday week belongs to the week before", () => {
    // What the `+ 7) % 7` is for: without it this lands six days into the
    // future, and every Sunday's hours are counted in the wrong week.
    expect(startOfWeek("2026-09-13", 1)).toBe("2026-09-07");
  });

  it("works for all seven start days", () => {
    // The reason the annotation was widened. Tuesday through Saturday had no
    // coverage while Scheduling was the only caller.
    for (let start = 0; start < 7; start++) {
      for (const day of datesBetween("2026-09-06", "2026-09-12")) {
        const s = startOfWeek(day, start);
        expect(s <= day).toBe(true);
        expect(datesBetween(s, day).length).toBeLessThanOrEqual(7);
        expect(startOfWeek(s, start)).toBe(s); // idempotent
      }
    }
  });

  it("survives the days daylight saving moves", () => {
    expect(startOfWeek("2026-03-08", 0)).toBe("2026-03-08");
    expect(startOfWeek("2026-03-09", 0)).toBe("2026-03-08");
    expect(startOfWeek("2026-03-14", 0)).toBe("2026-03-08");
    expect(startOfWeek("2026-11-01", 0)).toBe("2026-11-01");
    expect(startOfWeek("2026-11-07", 0)).toBe("2026-11-01");
  });
});
