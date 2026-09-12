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
  LONG_PUNCH_MINUTES,
  ROUNDING_CHOICES,
  isRoundingChoice,
  minutesBetween,
  roundMinutes,
  roundingLabel,
} from "../src/modules/time/core/rounding";
import { dayLabel, weekDays, weekLabel } from "../src/modules/time/core/week";

/**
 * The pure half of Time. Every one of these is arithmetic somebody's paycheck
 * depends on, and none of it needs a database — which is exactly why it is
 * worth a table-driven suite rather than a walk through the UI.
 *
 * The calendar arithmetic this module leans on — `addDays`, `startOfWeek`,
 * `isDateString` — is NOT here: it lives in `src/lib/timezone.ts` and is proved
 * in `tests/timezone.test.ts`. Slice 0 wrote a second copy of it inside this
 * module before noticing; slice 1 deleted that copy.
 *
 * The overtime evaluator lands in slice 2 and belongs in this file. The
 * property it will lean on hardest — a pay type that says whether an hour
 * counts toward the 40 — is proved here first.
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

describe("roundMinutes", () => {
  it("to the minute is the default and changes nothing", () => {
    for (const raw of [1, 7, 53, 473, 1440]) {
      expect(roundMinutes(raw, 0)).toBe(raw);
    }
  });

  it("goes to the NEAREST increment, up as well as down", () => {
    // The whole legal argument for rounding a timesheet is that it is
    // neutral. These two lines are that neutrality.
    expect(roundMinutes(473, 15)).toBe(480); // 7h53m up to 8h
    expect(roundMinutes(487, 15)).toBe(480); // 8h07m down to 8h
    // The midpoint between 45 and 60 is 52.5, so 53 goes up and 52 goes down.
    expect(roundMinutes(53, 15)).toBe(60);
    expect(roundMinutes(52, 15)).toBe(45);
  });

  it("is neutral across a run of spans", () => {
    // Over the 60 possible minute offsets in an hour, rounding to a quarter
    // gains exactly as much as it loses. If this ever fails, the policy has
    // stopped being lawful, not just inaccurate.
    let drift = 0;
    for (let raw = 1; raw <= 60; raw++) drift += roundMinutes(raw, 15) - raw;
    expect(drift).toBe(0);
  });

  it("rounds a tie up, toward the worker", () => {
    expect(roundMinutes(8, 15)).toBe(15);
    expect(roundMinutes(7, 15)).toBe(0);
    expect(roundMinutes(3, 6)).toBe(6);
  });

  it("handles a tenth of an hour, which is how services bill", () => {
    expect(roundMinutes(8, 6)).toBe(6);
    expect(roundMinutes(10, 6)).toBe(12);
    expect(roundMinutes(63, 6)).toBe(66);
  });

  it("can return zero, which is the policy working rather than a bug", () => {
    // Five minutes on a quarter-hour policy is worth nothing, by the same rule
    // that pays a full quarter hour for eight. The caller writes no entry and
    // says so; forcing a minimum would break the neutrality above.
    expect(roundMinutes(5, 15)).toBe(0);
    expect(roundMinutes(2, 6)).toBe(0);
    expect(roundMinutes(0, 15)).toBe(0);
    expect(roundMinutes(-10, 15)).toBe(0);
  });

  it("every offered choice is a real one and has a label", () => {
    for (const choice of ROUNDING_CHOICES) {
      expect(isRoundingChoice(choice)).toBe(true);
      expect(roundingLabel(choice).length).toBeGreaterThan(0);
    }
    expect(isRoundingChoice(7)).toBe(false);
    expect(isRoundingChoice(60)).toBe(false);
  });
});

describe("minutesBetween", () => {
  it("counts whole minutes", () => {
    const from = new Date("2026-09-11T08:00:00Z");
    expect(minutesBetween(from, new Date("2026-09-11T16:00:00Z"))).toBe(480);
    expect(minutesBetween(from, new Date("2026-09-11T08:00:29Z"))).toBe(0);
    expect(minutesBetween(from, new Date("2026-09-11T08:00:31Z"))).toBe(1);
  });

  it("is unaffected by daylight saving, because a span is not a date", () => {
    // 2026-11-01 is the fall-back Sunday in the US. These two instants are
    // three hours apart on the world's timeline whatever a local clock shows,
    // which is why the elapsed figure needs no timezone at all.
    const from = new Date("2026-11-01T04:30:00Z");
    const to = new Date("2026-11-01T07:30:00Z");
    expect(minutesBetween(from, to)).toBe(180);
  });

  it("the long-punch threshold is under a day, so a stuck clock is catchable", () => {
    expect(LONG_PUNCH_MINUTES).toBeLessThan(1440);
    expect(LONG_PUNCH_MINUTES).toBeGreaterThan(12 * 60);
  });
});
