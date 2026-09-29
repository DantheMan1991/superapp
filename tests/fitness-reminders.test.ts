import { describe, expect, it } from "vitest";
import type { DayProgress } from "../src/modules/fitness/core/day";
import {
  clockWords,
  DEFAULT_REMINDER_MINUTE,
  handledOnWhenSaved,
  minuteIn,
  minuteOfTime,
  REMINDER_GRACE_MINUTES,
  reminderDue,
  reminderInputSchema,
  reminderMessage,
  reminderViews,
  timeOfMinute,
} from "../src/modules/fitness/core/reminders";

/**
 * WORKOUT REMINDERS (docs/modules/fitness.md, F4a; ADR 0116): when one goes,
 * what the phone shows, and the times the card keeps. The founder's rule: a
 * day whose sets are done is skipped.
 */

function day(overrides: Partial<DayProgress>): DayProgress {
  return { items: [], parts: [], done: 0, left: 0, complete: false, ...overrides };
}

describe("the times the card keeps", () => {
  it("reads a time input's value as a minute of the day, in tens", () => {
    expect(minuteOfTime("07:30")).toBe(450);
    expect(minuteOfTime("7:30")).toBe(450);
    expect(minuteOfTime("19:34")).toBe(1170);
    expect(minuteOfTime("19:35")).toBe(1180);
    expect(minuteOfTime("00:00")).toBe(0);
    // Rounding up past the last ten of the day stays on it.
    expect(minuteOfTime("23:56")).toBe(1430);
  });

  it("refuses anything that is not a time", () => {
    for (const value of ["", "7", "24:00", "12:60", "noon", "07:30:00", "-1:00"]) {
      expect(minuteOfTime(value)).toBeNull();
    }
  });

  it("writes a minute back as the input's value and in words", () => {
    expect(timeOfMinute(450)).toBe("07:30");
    expect(timeOfMinute(0)).toBe("00:00");
    expect(clockWords(450)).toBe("7:30 AM");
    expect(clockWords(1170)).toBe("7:30 PM");
    expect(clockWords(0)).toBe("12:00 AM");
    expect(clockWords(720)).toBe("12:00 PM");
  });

  it("starts both off, before work and after dinner", () => {
    expect(DEFAULT_REMINDER_MINUTE).toEqual({ morning: 420, evening: 1170 });
    expect(reminderViews([])).toEqual([
      { slot: "morning", atMinute: 420, enabled: false },
      { slot: "evening", atMinute: 1170, enabled: false },
    ]);
    expect(reminderViews([{ slot: "evening", atMinute: 1200, enabled: true }])).toEqual([
      { slot: "morning", atMinute: 420, enabled: false },
      { slot: "evening", atMinute: 1200, enabled: true },
    ]);
  });

  it("takes what the card sends and nothing else", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(reminderInputSchema.safeParse({ programId: id, slot: "evening", time: "19:30", enabled: true }).success).toBe(true);
    expect(reminderInputSchema.safeParse({ programId: id, slot: "noon", time: "12:00", enabled: true }).success).toBe(false);
    expect(reminderInputSchema.safeParse({ programId: "x", slot: "morning", time: "07:00", enabled: true }).success).toBe(false);
    expect(reminderInputSchema.safeParse({ programId: id, slot: "morning", time: "07:00" }).success).toBe(false);
  });
});

describe("the space's clock", () => {
  it("gives the minute of the day where the space is", () => {
    const at = new Date("2026-09-28T23:30:00Z");
    expect(minuteIn("UTC", at)).toBe(23 * 60 + 30);
    // New York is four hours behind in September.
    expect(minuteIn("America/New_York", at)).toBe(19 * 60 + 30);
    // Midnight is minute 0, never 24:00.
    expect(minuteIn("UTC", new Date("2026-09-28T00:05:00Z"))).toBe(5);
    // A zone nobody knows: UTC.
    expect(minuteIn("Nowhere/Else", at)).toBe(23 * 60 + 30);
  });
});

describe("when a reminder goes", () => {
  const evening = { atMinute: 1170, lastHandledOn: null };
  const on = (minute: number) => ({ day: "2026-09-28", minute });

  it("goes from its time, for an hour", () => {
    expect(reminderDue(evening, on(1160))).toBe(false);
    expect(reminderDue(evening, on(1170))).toBe(true);
    expect(reminderDue(evening, on(1170 + REMINDER_GRACE_MINUTES - 1))).toBe(true);
    // A cron down for an hour does not send it at bedtime.
    expect(reminderDue(evening, on(1170 + REMINDER_GRACE_MINUTES))).toBe(false);
  });

  it("goes once a day", () => {
    expect(reminderDue({ atMinute: 1170, lastHandledOn: "2026-09-28" }, on(1180))).toBe(false);
    expect(reminderDue({ atMinute: 1170, lastHandledOn: "2026-09-27" }, on(1180))).toBe(true);
  });

  it("never goes the moment it is set: a time already gone today starts tomorrow", () => {
    expect(handledOnWhenSaved(450, on(600), null)).toBe("2026-09-28");
    expect(handledOnWhenSaved(1170, on(600), null)).toBeNull();
    expect(handledOnWhenSaved(1170, on(600), "2026-09-20")).toBe("2026-09-20");
    // Already sent today, then moved later: not a second time today.
    expect(handledOnWhenSaved(1260, on(1200), "2026-09-28")).toBe("2026-09-28");
  });
});

describe("what the phone shows", () => {
  const context = { phaseName: "Phase 1: Weeks 1-2", exercises: 4 };

  it("the whole day, before anything is done", () => {
    expect(reminderMessage(day({ done: 0, left: 6 }), context)).toEqual({
      title: "Today's workout",
      body: "Phase 1: Weeks 1-2 · 4 exercises, 6 sets",
    });
  });

  it("what is left, once some of it is", () => {
    expect(reminderMessage(day({ done: 3, left: 3 }), context)).toEqual({
      title: "The rest of today",
      body: "3 sets left · Phase 1: Weeks 1-2",
    });
    expect(reminderMessage(day({ done: 5, left: 1 }), { phaseName: "Weeks 1-2", exercises: 1 })).toEqual({
      title: "The rest of today",
      body: "1 set left · Weeks 1-2",
    });
  });

  it("nothing for a day that is done, or a phase with nothing in it", () => {
    expect(reminderMessage(day({ done: 6, left: 0, complete: true }), context)).toBeNull();
    expect(reminderMessage(day({ done: 0, left: 0 }), { phaseName: "Empty", exercises: 0 })).toBeNull();
  });

  it("drops the phase when it has no name", () => {
    expect(reminderMessage(day({ done: 0, left: 2 }), { phaseName: " ", exercises: 1 })).toEqual({
      title: "Today's workout",
      body: "1 exercise, 2 sets",
    });
  });
});
