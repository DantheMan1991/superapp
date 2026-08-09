import { describe, expect, it } from "vitest";
import {
  addDays,
  datesBetween,
  dayOfWeek,
  formatTimeInTimezone,
  minutesIntoDay,
  offsetMinutes,
  startOfDayInTimezone,
  startOfWeek,
  zonedTimeToInstant,
} from "../src/lib/timezone";

/**
 * The calendar arithmetic the scheduling grid stands on.
 *
 * Weighted heavily toward the two mornings a year when this is hard, because
 * every other day of the year any implementation looks correct. 2026's US
 * transitions: forward on **March 8**, back on **November 1**.
 */
const NY = "America/New_York";
const PHX = "America/Phoenix"; // no DST, ever — the control
const UTC = "UTC";

describe("offsetMinutes", () => {
  it("is a fact about an INSTANT, not about a zone", () => {
    expect(offsetMinutes(new Date("2026-01-15T12:00:00Z"), NY)).toBe(-300);
    expect(offsetMinutes(new Date("2026-07-15T12:00:00Z"), NY)).toBe(-240);
    // Arizona does not observe it, so both are the same.
    expect(offsetMinutes(new Date("2026-01-15T12:00:00Z"), PHX)).toBe(-420);
    expect(offsetMinutes(new Date("2026-07-15T12:00:00Z"), PHX)).toBe(-420);
    expect(offsetMinutes(new Date("2026-07-15T12:00:00Z"), UTC)).toBe(0);
  });
});

describe("zonedTimeToInstant", () => {
  it("round-trips an ordinary time", () => {
    const at = zonedTimeToInstant("2026-06-10", "14:30", NY);
    expect(at.toISOString()).toBe("2026-06-10T18:30:00.000Z");
    expect(minutesIntoDay(at, NY)).toBe(14 * 60 + 30);
  });

  it("round-trips across a whole year in a DST zone", () => {
    // The property that matters: whatever wall clock goes in comes back out.
    for (let day = 0; day < 365; day += 7) {
      const date = addDays("2026-01-01", day);
      const at = zonedTimeToInstant(date, "09:15", NY);
      expect(minutesIntoDay(at, NY), `${date} 09:15`).toBe(9 * 60 + 15);
    }
  });

  it("moves a time inside the spring-forward GAP forwards, never back", () => {
    // 02:30 does not exist on 2026-03-08: clocks go 02:00 -> 03:00.
    const at = zonedTimeToInstant("2026-03-08", "02:30", NY);
    expect(at.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // Renders as 03:30 — forward, like Google and Outlook. A naive two-pass
    // implementation lands on 06:30Z, which renders as 01:30: EARLIER than
    // asked for, which is the answer that silently moves somebody's morning.
    expect(minutesIntoDay(at, NY)).toBe(3 * 60 + 30);
  });

  it("times either side of the gap are untouched", () => {
    expect(minutesIntoDay(zonedTimeToInstant("2026-03-08", "01:30", NY), NY)).toBe(90);
    expect(minutesIntoDay(zonedTimeToInstant("2026-03-08", "03:30", NY), NY)).toBe(210);
  });

  it("picks the first occurrence of an AMBIGUOUS autumn time, deterministically", () => {
    // 01:30 happens twice on 2026-11-01. Either is defensible; changing which
    // one silently moves existing events, so it is pinned.
    const at = zonedTimeToInstant("2026-11-01", "01:30", NY);
    expect(at.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(minutesIntoDay(at, NY)).toBe(90);
  });
});

describe("startOfDayInTimezone", () => {
  it("is the local midnight, and the offset it uses is that day's", () => {
    expect(startOfDayInTimezone("2026-01-15", NY).toISOString()).toBe(
      "2026-01-15T05:00:00.000Z",
    );
    expect(startOfDayInTimezone("2026-07-15", NY).toISOString()).toBe(
      "2026-07-15T04:00:00.000Z",
    );
  });

  it("is still midnight on the day the clocks change", () => {
    // The transition is at 2am, so midnight is still EST.
    expect(startOfDayInTimezone("2026-03-08", NY).toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(minutesIntoDay(startOfDayInTimezone("2026-03-08", NY), NY)).toBe(0);
    // And the day AFTER is an hour earlier in UTC terms.
    expect(startOfDayInTimezone("2026-03-09", NY).toISOString()).toBe(
      "2026-03-09T04:00:00.000Z",
    );
  });

  it("every day of a DST year starts at local midnight", () => {
    for (let day = 0; day < 365; day++) {
      const date = addDays("2026-01-01", day);
      expect(minutesIntoDay(startOfDayInTimezone(date, NY), NY), date).toBe(0);
    }
  });
});

describe("addDays", () => {
  it("stays in calendar-land across a DST boundary", () => {
    // The bug this guards: adding 86,400,000ms to a local instant lands on the
    // wrong clock time when a transition intervenes.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });

  it("crosses months, years and leap days", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("weeks and ranges", () => {
  it("dayOfWeek counts from Sunday", () => {
    expect(dayOfWeek("2026-08-09")).toBe(0);
    expect(dayOfWeek("2026-08-10")).toBe(1);
  });

  it("startOfWeek respects where the week begins", () => {
    expect(startOfWeek("2026-08-12", 0)).toBe("2026-08-09");
    expect(startOfWeek("2026-08-12", 1)).toBe("2026-08-10");
    // A date already on the boundary is its own week start.
    expect(startOfWeek("2026-08-09", 0)).toBe("2026-08-09");
  });

  it("datesBetween is inclusive and a week is seven columns", () => {
    const week = datesBetween("2026-08-09", "2026-08-15");
    expect(week).toHaveLength(7);
    expect(week[0]).toBe("2026-08-09");
    expect(week[6]).toBe("2026-08-15");
    // Including the week the clocks change — a 7-column grid must stay 7.
    expect(datesBetween("2026-03-08", "2026-03-14")).toHaveLength(7);
  });
});

describe("presentation", () => {
  it("formats in the tenant's zone, not the server's", () => {
    const at = new Date("2026-06-10T18:30:00Z");
    expect(formatTimeInTimezone(at, NY)).toBe("2:30 PM");
    expect(formatTimeInTimezone(at, UTC)).toBe("6:30 PM");
  });
});
