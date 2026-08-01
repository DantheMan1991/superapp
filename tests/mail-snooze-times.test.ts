import { describe, expect, it } from "vitest";
import {
  isAcceptableDueAt,
  MAX_SNOOZE_MS,
  snoozeDueAt,
} from "@/modules/email/triage/snooze-times";

/** Local time, because that is the whole point of computing these in a browser. */
function at(iso: string): Date {
  return new Date(iso);
}

describe("snoozeDueAt", () => {
  it("puts 'later today' three hours out", () => {
    const due = snoozeDueAt("later_today", at("2026-08-03T10:00:00"));
    expect(due.getHours()).toBe(13);
    expect(due.getDate()).toBe(3);
  });

  it("moves 'later today' to the morning when it would land at night", () => {
    // 23:00 + 3h is 2am. A reminder that fires then is not "later today" in
    // any sense the person meant, so the label has to stop being a lie.
    const due = snoozeDueAt("later_today", at("2026-08-03T23:00:00"));
    expect(due.getDate()).toBe(4);
    expect(due.getHours()).toBe(8);
  });

  it("moves 'later today' to the morning at the evening boundary", () => {
    // 19:00 + 3h = 22:00, past the cutoff.
    const due = snoozeDueAt("later_today", at("2026-08-03T19:00:00"));
    expect(due.getDate()).toBe(4);
    expect(due.getHours()).toBe(8);
  });

  it("wakes 'tomorrow' in the morning, not 24 hours later", () => {
    // Snoozing at 4pm and being reminded at 4pm tomorrow is a different
    // feature, and a worse one.
    const due = snoozeDueAt("tomorrow", at("2026-08-03T16:20:00"));
    expect(due.getDate()).toBe(4);
    expect(due.getHours()).toBe(8);
    expect(due.getMinutes()).toBe(0);
  });

  it("finds the coming Saturday for 'this weekend'", () => {
    // 2026-08-03 is a Monday.
    const due = snoozeDueAt("this_weekend", at("2026-08-03T09:00:00"));
    expect(due.getDay()).toBe(6);
    expect(due.getDate()).toBe(8);
  });

  it("means NEXT Saturday when it already is the weekend", () => {
    // The edge that makes the feature silently do nothing: resolving to today
    // gives a time already past, so the sweep wakes it on the next tick.
    const saturday = at("2026-08-08T10:00:00");
    expect(saturday.getDay()).toBe(6);
    const due = snoozeDueAt("this_weekend", saturday);
    expect(due.getDay()).toBe(6);
    expect(due.getTime()).toBeGreaterThan(saturday.getTime());
    expect(due.getDate()).toBe(15);
  });

  it("finds the coming Monday for 'next week'", () => {
    const due = snoozeDueAt("next_week", at("2026-08-05T14:00:00"));
    expect(due.getDay()).toBe(1);
    expect(due.getDate()).toBe(10);
  });

  it("means NEXT Monday when asked on a Monday", () => {
    const monday = at("2026-08-03T09:00:00");
    expect(monday.getDay()).toBe(1);
    const due = snoozeDueAt("next_week", monday);
    expect(due.getDate()).toBe(10);
  });

  it("always returns a future time, whatever the preset or the hour", () => {
    // The property that matters more than any individual case: a due time in
    // the past means the sweep wakes it immediately and the snooze did nothing.
    const moments = [
      "2026-08-03T00:01:00",
      "2026-08-03T08:00:00",
      "2026-08-03T12:00:00",
      "2026-08-03T20:59:00",
      "2026-08-03T23:59:00",
      "2026-08-08T23:00:00",
      "2026-08-09T07:00:00",
    ];
    const presets = ["later_today", "tomorrow", "this_weekend", "next_week"] as const;
    for (const iso of moments) {
      const now = at(iso);
      for (const preset of presets) {
        const due = snoozeDueAt(preset, now);
        expect(
          due.getTime(),
          `${preset} at ${iso} resolved to the past`,
        ).toBeGreaterThan(now.getTime());
      }
    }
  });
});

describe("isAcceptableDueAt", () => {
  const now = at("2026-08-03T10:00:00");

  it("accepts an ordinary future time", () => {
    expect(isAcceptableDueAt(at("2026-08-04T08:00:00"), now)).toBe(true);
  });

  it("rejects the past and the present", () => {
    // Rejected rather than clamped: silently rewriting to "now" would move
    // somebody's mail into a folder and straight back out, which reads as the
    // feature flickering rather than as a bug worth reporting.
    expect(isAcceptableDueAt(at("2026-08-03T09:59:00"), now)).toBe(false);
    expect(isAcceptableDueAt(now, now)).toBe(false);
  });

  it("rejects further out than a year", () => {
    const tooFar = new Date(now.getTime() + MAX_SNOOZE_MS + 1000);
    expect(isAcceptableDueAt(tooFar, now)).toBe(false);
    const justInside = new Date(now.getTime() + MAX_SNOOZE_MS - 1000);
    expect(isAcceptableDueAt(justInside, now)).toBe(true);
  });

  it("rejects a date that is not a date", () => {
    expect(isAcceptableDueAt(new Date("nonsense"), now)).toBe(false);
  });
});
