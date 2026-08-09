import { describe, expect, it } from "vitest";
import { dateInTimezone, minutesIntoDay } from "../src/lib/timezone";
import {
  describeRule,
  expandOccurrences,
  formatRule,
  parseRule,
  type RecurrenceRule,
} from "../src/lib/schedule/recurrence";

const NY = "America/New_York";
const HOUR = 60 * 60 * 1000;

/** Expand and return the local dates, which is what the assertions care about. */
function dates(
  rule: string,
  startDate: string,
  opts: { from?: string; to?: string; time?: string; tz?: string } = {},
): string[] {
  const parsed = parseRule(rule);
  if (!parsed) throw new Error(`unparseable: ${rule}`);
  return expandOccurrences({
    rule: parsed,
    startDate,
    timeOfDay: opts.time ?? "09:00",
    durationMs: HOUR,
    timeZone: opts.tz ?? NY,
    from: new Date(`${opts.from ?? "2026-01-01"}T00:00:00Z`),
    to: new Date(`${opts.to ?? "2027-01-01"}T00:00:00Z`),
  }).map((o) => o.date);
}

describe("parseRule", () => {
  it("reads the supported subset", () => {
    expect(parseRule("FREQ=DAILY")).toEqual({
      freq: "DAILY",
      interval: 1,
      byDay: [],
      count: undefined,
      until: undefined,
    });
    expect(parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH")).toMatchObject({
      freq: "WEEKLY",
      interval: 2,
      byDay: ["TU", "TH"],
    });
    expect(parseRule("FREQ=MONTHLY;COUNT=6")).toMatchObject({ count: 6 });
    expect(parseRule("FREQ=YEARLY;UNTIL=20301231T000000Z")).toMatchObject({
      until: "2030-12-31",
    });
  });

  it("REFUSES what it does not implement, rather than ignoring it", () => {
    // A rule that quietly dropped "the third Tuesday" would generate a series
    // on the wrong days, which is worse than not offering it.
    expect(parseRule("FREQ=MONTHLY;BYDAY=3TU")).toBeNull();
    expect(parseRule("FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR")).toBeNull();
    expect(parseRule("FREQ=MONTHLY;BYMONTHDAY=1,15")).toBeNull();
    // BYDAY only means anything on a weekly rule.
    expect(parseRule("FREQ=DAILY;BYDAY=MO")).toBeNull();
    // COUNT and UNTIL together is contradictory.
    expect(parseRule("FREQ=DAILY;COUNT=5;UNTIL=20301231T000000Z")).toBeNull();
    expect(parseRule("FREQ=FORTNIGHTLY")).toBeNull();
    expect(parseRule("")).toBeNull();
    expect(parseRule("FREQ=DAILY;INTERVAL=0")).toBeNull();
  });

  it("round-trips through formatRule", () => {
    for (const text of [
      "FREQ=DAILY",
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR",
      "FREQ=MONTHLY;COUNT=6",
      "FREQ=YEARLY;UNTIL=20301231T000000Z",
    ]) {
      expect(formatRule(parseRule(text) as RecurrenceRule)).toBe(text);
    }
  });
});

describe("expandOccurrences", () => {
  it("daily, bounded by COUNT", () => {
    expect(dates("FREQ=DAILY;COUNT=3", "2026-03-02")).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
    ]);
  });

  it("every other day", () => {
    expect(dates("FREQ=DAILY;INTERVAL=2;COUNT=3", "2026-03-02")).toEqual([
      "2026-03-02",
      "2026-03-04",
      "2026-03-06",
    ]);
  });

  it("weekly on named days, in week order", () => {
    // Starts on a Monday; TU and TH each week.
    expect(
      dates("FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4", "2026-03-02"),
    ).toEqual(["2026-03-03", "2026-03-05", "2026-03-10", "2026-03-12"]);
  });

  it("does not back-date BYDAY entries earlier in the starting week", () => {
    // Series starts Wednesday; MO is earlier in that same week and must not
    // appear before the start.
    const out = dates("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3", "2026-03-04");
    expect(out[0]).toBe("2026-03-04");
    expect(out).toEqual(["2026-03-04", "2026-03-09", "2026-03-11"]);
  });

  it("every other week keeps the gap", () => {
    expect(dates("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3", "2026-03-02")).toEqual([
      "2026-03-02",
      "2026-03-16",
      "2026-03-30",
    ]);
  });

  it("monthly CLAMPS to the month's length instead of rolling over", () => {
    // The 31st does not exist in April, June, September or November. Rolling
    // over would put it on 1 May and shift every later occurrence.
    expect(dates("FREQ=MONTHLY;COUNT=5", "2026-01-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("yearly handles a leap day by clamping", () => {
    expect(dates("FREQ=YEARLY;COUNT=2", "2024-02-29", { from: "2024-01-01", to: "2026-06-01" }))
      .toEqual(["2024-02-29", "2025-02-28"]);
  });

  it("UNTIL is inclusive of its date", () => {
    expect(dates("FREQ=DAILY;UNTIL=20260304T000000Z", "2026-03-02")).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
    ]);
  });

  it("returns only what overlaps the window", () => {
    const out = dates("FREQ=DAILY;COUNT=30", "2026-03-01", {
      from: "2026-03-10",
      to: "2026-03-13",
    });
    expect(out).toEqual(["2026-03-10", "2026-03-11", "2026-03-12"]);
  });

  it("an unbounded rule is still finite per query", () => {
    const out = dates("FREQ=DAILY", "2026-01-01", {
      from: "2026-01-01",
      to: "2026-02-01",
    });
    expect(out).toHaveLength(31);
  });
});

describe("recurrence across a DST boundary", () => {
  it("KEEPS THE WALL CLOCK, which is the whole point", () => {
    // Weekly 08:00 across 2026-03-08. Adding 7 × 86,400,000ms to an instant
    // would land at 07:00 after the change.
    const parsed = parseRule("FREQ=WEEKLY;BYDAY=SU;COUNT=4") as RecurrenceRule;
    const out = expandOccurrences({
      rule: parsed,
      startDate: "2026-03-01",
      timeOfDay: "08:00",
      durationMs: HOUR,
      timeZone: NY,
      from: new Date("2026-02-01T00:00:00Z"),
      to: new Date("2026-04-30T00:00:00Z"),
    });
    expect(out.map((o) => o.date)).toEqual([
      "2026-03-01",
      "2026-03-08",
      "2026-03-15",
      "2026-03-22",
    ]);
    for (const occurrence of out) {
      expect(minutesIntoDay(occurrence.startsAt, NY), occurrence.date).toBe(8 * 60);
    }
    // And the UTC instants genuinely differ by the offset change: 13:00Z before,
    // 12:00Z after.
    expect(out[0].startsAt.toISOString()).toBe("2026-03-01T13:00:00.000Z");
    expect(out[1].startsAt.toISOString()).toBe("2026-03-08T12:00:00.000Z");
  });

  it("an occurrence inside the spring-forward GAP falls forward, not away", () => {
    // A weekly 02:30 series has exactly one occurrence a year that does not
    // exist. It must not vanish, and must not move to 01:30.
    const parsed = parseRule("FREQ=WEEKLY;BYDAY=SU;COUNT=3") as RecurrenceRule;
    const out = expandOccurrences({
      rule: parsed,
      startDate: "2026-03-01",
      timeOfDay: "02:30",
      durationMs: HOUR,
      timeZone: NY,
      from: new Date("2026-02-01T00:00:00Z"),
      to: new Date("2026-04-30T00:00:00Z"),
    });
    expect(out).toHaveLength(3);
    const gapDay = out.find((o) => o.date === "2026-03-08");
    expect(gapDay).toBeDefined();
    expect(minutesIntoDay(gapDay!.startsAt, NY)).toBe(3 * 60 + 30);
  });

  it("every occurrence lands on the local date it claims", () => {
    // The property that catches an off-by-one from a timezone conversion.
    const parsed = parseRule("FREQ=DAILY;COUNT=400") as RecurrenceRule;
    const out = expandOccurrences({
      rule: parsed,
      startDate: "2026-01-01",
      timeOfDay: "00:30",
      durationMs: HOUR,
      timeZone: NY,
      from: new Date("2025-12-01T00:00:00Z"),
      to: new Date("2027-06-01T00:00:00Z"),
    });
    expect(out.length).toBeGreaterThan(300);
    for (const occurrence of out) {
      expect(dateInTimezone(occurrence.startsAt, NY), occurrence.date).toBe(
        occurrence.date,
      );
    }
  });
});

describe("describeRule", () => {
  it("says it in words", () => {
    expect(describeRule(parseRule("FREQ=DAILY") as RecurrenceRule)).toBe("Every day");
    expect(
      describeRule(parseRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH") as RecurrenceRule),
    ).toBe("Every 2 weeks on Tue, Thu");
    expect(describeRule(parseRule("FREQ=MONTHLY;COUNT=6") as RecurrenceRule)).toBe(
      "Every month, 6 times",
    );
  });
});
