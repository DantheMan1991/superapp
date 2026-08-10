import { describe, expect, it } from "vitest";
import { daysBetween, describeDue } from "../src/modules/work/core/due";

/**
 * How a due date is said out loud. Pure — the phrasing is the part a person
 * actually reads in the morning email, and it is the part with no database in
 * it, so it gets tested where it lives.
 */
describe("work due phrasing", () => {
  const TODAY = "2026-09-15";

  it("uses the words people use for the two dates they hold in their head", () => {
    expect(describeDue(TODAY, TODAY)).toBe("Due today");
    expect(describeDue("2026-09-16", TODAY)).toBe("Due tomorrow");
  });

  it("counts overdue days, singular and plural", () => {
    expect(describeDue("2026-09-14", TODAY)).toBe("1 day overdue");
    expect(describeDue("2026-09-10", TODAY)).toBe("5 days overdue");
  });

  it("falls back to the date itself further out", () => {
    expect(describeDue("2026-09-22", TODAY)).toBe("Due 2026-09-22");
  });

  it("counts across a month and a year boundary", () => {
    // Both endpoints are midnight UTC, so this is exact arithmetic rather than
    // date maths in a real zone with a DST transition in the middle.
    expect(daysBetween("2026-08-31", "2026-09-01")).toBe(1);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-09-01", "2026-10-01")).toBe(30);
  });

  it("crosses a spring-forward without losing a day", () => {
    // 2026-03-08 is the US DST transition. Adding 86,400,000ms to a local
    // instant would land an hour short; these are UTC midnights, so it does not.
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(describeDue("2026-03-07", "2026-03-08")).toBe("1 day overdue");
  });
});
