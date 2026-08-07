import { describe, expect, it } from "vitest";
import {
  COMMON_TIMEZONES,
  DEFAULT_TIMEZONE,
  dateInTimezone,
  isValidTimeZone,
  localHourInTimezone,
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
