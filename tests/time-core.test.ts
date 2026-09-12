import { describe, expect, it } from "vitest";
import {
  MAX_ENTRY_MINUTES,
  decimalHours,
  formatDuration,
  parseDuration,
} from "../src/modules/time/core/duration";
import {
  PAY_TYPES,
  countsAsPaid,
  countsAsWorked,
  isPayType,
  payTypeLabel,
} from "../src/modules/time/core/pay-types";
import {
  addDays,
  dayLabel,
  daysBetween,
  isDateString,
  startOfWeek,
  weekDays,
  weekLabel,
} from "../src/modules/time/core/week";

/**
 * The pure half of Time. Every one of these is arithmetic somebody's paycheck
 * depends on, and none of it needs a database — which is exactly why it is
 * worth a table-driven suite rather than a walk through the UI.
 *
 * The overtime evaluator lands in slice 2 and belongs in this file's successor.
 * The properties it will lean on — a week boundary that survives daylight
 * saving, and a pay type that says whether an hour counts toward the 40 — are
 * proved here first.
 */

describe("parseDuration", () => {
  const cases: [string, number][] = [
    // The clock spelling.
    ["1:30", 90],
    ["0:45", 45],
    ["12:00", 720],
    ["8:05", 485],
    // Both halves with units, in the spellings people actually type.
    ["1h30", 90],
    ["1h 30m", 90],
    ["1 hr 30 min", 90],
    ["2h05m", 125],
    // One number with a unit.
    ["1.5h", 90],
    ["90m", 90],
    ["45min", 45],
    ["8hours", 480],
    ["0.25h", 15],
    // Bare numbers: under 16 is hours, 16 and over is minutes.
    ["2", 120],
    ["7.5", 450],
    ["15", 900],
    ["16", 16],
    ["90", 90],
    // Whitespace and case are not the user's problem.
    ["  1:30  ", 90],
    ["1H30", 90],
    ["90M", 90],
  ];

  for (const [input, expected] of cases) {
    it(`reads ${JSON.stringify(input)} as ${expected} minutes`, () => {
      expect(parseDuration(input)).toBe(expected);
    });
  }

  const refused = [
    "",
    "   ",
    "lunch",
    "-1",
    "0",
    "0:00",
    // 75 minutes past an hour is not a duration anybody means. Refusing beats
    // inventing 2h15m out of it.
    "1h75m",
    "1:75",
    "half an hour",
  ];

  for (const input of refused) {
    it(`refuses ${JSON.stringify(input)} rather than guessing`, () => {
      expect(parseDuration(input)).toBe(0);
    });
  }

  it("round-trips what formatDuration prints", () => {
    for (const minutes of [1, 15, 45, 60, 90, 450, 480, 1439, MAX_ENTRY_MINUTES]) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });
});

describe("formatDuration", () => {
  it("reads as hours and minutes, not as a decimal", () => {
    expect(formatDuration(450)).toBe("7h 30m");
    expect(formatDuration(480)).toBe("8h");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(-5)).toBe("0m");
  });
});

describe("decimalHours", () => {
  it("trims the zeros a payroll export does not need", () => {
    expect(decimalHours(90)).toBe("1.5");
    expect(decimalHours(120)).toBe("2");
    expect(decimalHours(450)).toBe("7.5");
    expect(decimalHours(485)).toBe("8.08");
  });
});

describe("pay types", () => {
  it("only hours actually worked count toward overtime", () => {
    // THE PROPERTY THE WHOLE MODULE TURNS ON. Paid leave and holiday are on the
    // paycheck and are not hours worked; counting them toward the 40 overpays
    // every week anybody takes a day off.
    expect(countsAsWorked("worked")).toBe(true);
    expect(countsAsWorked("paid_leave")).toBe(false);
    expect(countsAsWorked("holiday")).toBe(false);
    expect(countsAsWorked("unpaid")).toBe(false);
  });

  it("paid is a different question from worked", () => {
    expect(countsAsPaid("worked")).toBe(true);
    expect(countsAsPaid("paid_leave")).toBe(true);
    expect(countsAsPaid("holiday")).toBe(true);
    expect(countsAsPaid("unpaid")).toBe(false);
  });

  it("an unknown code is neither worked nor paid", () => {
    // It cannot reach the database — the CHECK refuses it — but a predicate
    // that said "worked" for anything it did not recognise would be the wrong
    // failure mode if one ever did.
    expect(countsAsWorked("sick")).toBe(false);
    expect(countsAsPaid("sick")).toBe(false);
    expect(isPayType("sick")).toBe(false);
  });

  it("every declared type has a label and validates", () => {
    for (const type of PAY_TYPES) {
      expect(isPayType(type)).toBe(true);
      expect(payTypeLabel(type)).not.toBe(type);
    }
  });
});

describe("isDateString", () => {
  it("accepts real days", () => {
    expect(isDateString("2026-09-11")).toBe(true);
    expect(isDateString("2024-02-29")).toBe(true); // a leap year
  });

  it("refuses days that do not exist", () => {
    // The format check alone accepts these; a `Date` silently rolls them
    // forward, which is why the round trip is the test.
    expect(isDateString("2026-02-31")).toBe(false);
    expect(isDateString("2025-02-29")).toBe(false);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString("2026-9-11")).toBe(false);
    expect(isDateString("11/09/2026")).toBe(false);
    expect(isDateString("")).toBe(false);
  });
});

describe("startOfWeek", () => {
  // 2026-09-11 is a Friday.
  it("finds the Sunday of a Sunday-start week", () => {
    expect(startOfWeek("2026-09-11", 0)).toBe("2026-09-06");
  });

  it("finds the Monday of a Monday-start week", () => {
    expect(startOfWeek("2026-09-11", 1)).toBe("2026-09-07");
  });

  it("a day that IS the start returns itself", () => {
    expect(startOfWeek("2026-09-06", 0)).toBe("2026-09-06");
    expect(startOfWeek("2026-09-07", 1)).toBe("2026-09-07");
  });

  it("a Sunday in a Monday-start week belongs to the week before", () => {
    // The case the `+ 7) % 7` exists for: without it this lands six days into
    // the future and every Sunday's hours are counted in the wrong week.
    expect(startOfWeek("2026-09-13", 1)).toBe("2026-09-07");
  });

  it("works for every start day, every day of one week", () => {
    for (let start = 0; start < 7; start++) {
      const starts = weekDays("2026-09-06").map((d) => startOfWeek(d, start));
      // Seven consecutive days always span exactly two weeks under any start
      // day, and the boundary falls exactly once.
      expect(new Set(starts).size).toBe(start === 0 ? 1 : 2);
      for (const s of starts) {
        expect(daysBetween(s, "2026-09-06")).toBeLessThanOrEqual(6);
      }
    }
  });

  it("survives the days daylight saving moves", () => {
    // US DST began 2026-03-08 and ends 2026-11-01, both Sundays. Local-zone
    // arithmetic loses or gains an hour across them and lands on the wrong
    // date; UTC has no DST, which is why this file does all its sums there.
    expect(startOfWeek("2026-03-08", 0)).toBe("2026-03-08");
    expect(startOfWeek("2026-03-09", 0)).toBe("2026-03-08");
    expect(startOfWeek("2026-03-14", 0)).toBe("2026-03-08");
    expect(startOfWeek("2026-11-01", 0)).toBe("2026-11-01");
    expect(startOfWeek("2026-11-07", 0)).toBe("2026-11-01");
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
  });
});

describe("addDays and daysBetween", () => {
  it("crosses months and years", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("counts whole days in both directions", () => {
    expect(daysBetween("2026-09-06", "2026-09-13")).toBe(7);
    expect(daysBetween("2026-09-13", "2026-09-06")).toBe(-7);
    expect(daysBetween("2026-09-06", "2026-09-06")).toBe(0);
  });
});

describe("weekDays", () => {
  it("is seven days from the start, in order", () => {
    expect(weekDays("2026-09-06")).toEqual([
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
    ]);
  });
});

describe("labels", () => {
  it("names the day without the reader's own timezone getting involved", () => {
    // Formatted in UTC deliberately: let a browser re-interpret the string in
    // its own zone and a date west of Greenwich shows as the day before.
    expect(dayLabel("2026-09-11")).toBe("Fri, Sep 11");
    expect(weekLabel("2026-09-06")).toBe("Sep 6 – Sep 12");
  });
});
