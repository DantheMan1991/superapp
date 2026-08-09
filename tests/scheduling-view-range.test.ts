import { describe, expect, it } from "vitest";
import { dayOfWeek } from "../src/lib/timezone";
import {
  resolveViewRange,
  shiftAnchor,
} from "../src/modules/scheduling/core/range";

describe("resolveViewRange", () => {
  it("day is one column", () => {
    const range = resolveViewRange("day", "2026-08-12");
    expect(range.days).toEqual(["2026-08-12"]);
    expect(range.rows).toEqual([["2026-08-12"]]);
  });

  it("week is seven columns starting Sunday, wherever the anchor falls", () => {
    for (const anchor of ["2026-08-09", "2026-08-12", "2026-08-15"]) {
      const range = resolveViewRange("week", anchor);
      expect(range.days, anchor).toHaveLength(7);
      expect(range.from, anchor).toBe("2026-08-09");
      expect(range.to, anchor).toBe("2026-08-15");
      expect(dayOfWeek(range.from)).toBe(0);
    }
  });

  it("a week spanning the DST change is still seven columns", () => {
    expect(resolveViewRange("week", "2026-03-08").days).toHaveLength(7);
    expect(resolveViewRange("week", "2026-11-01").days).toHaveLength(7);
  });

  it("month shows whole weeks and contains every day of the month", () => {
    const range = resolveViewRange("month", "2026-08-15");
    expect(dayOfWeek(range.from)).toBe(0);
    expect(dayOfWeek(range.to)).toBe(6);
    expect(range.days).toContain("2026-08-01");
    expect(range.days).toContain("2026-08-31");
    expect(range.rows.every((row) => row.length === 7)).toBe(true);
  });

  it("row count follows the month, and is not assumed to be five", () => {
    // The bug every hand-rolled month grid ships with. A 31-day month that
    // starts on a Saturday needs six rows; February can need four.
    for (const month of [
      "2026-01-15",
      "2026-02-15",
      "2026-08-15",
      "2027-02-15",
      "2024-02-15", // leap
    ]) {
      const range = resolveViewRange("month", month);
      expect(range.rows.length, month).toBeGreaterThanOrEqual(4);
      expect(range.rows.length, month).toBeLessThanOrEqual(6);
      expect(range.days.length, month).toBe(range.rows.length * 7);
    }
  });

  it("covers a leap day", () => {
    expect(resolveViewRange("month", "2024-02-10").days).toContain("2024-02-29");
    expect(resolveViewRange("month", "2026-02-10").days).not.toContain(
      "2026-02-29",
    );
  });
});

describe("shiftAnchor", () => {
  it("steps a day and a week", () => {
    expect(shiftAnchor("day", "2026-08-12", 1)).toBe("2026-08-13");
    expect(shiftAnchor("day", "2026-08-12", -1)).toBe("2026-08-11");
    expect(shiftAnchor("week", "2026-08-12", 1)).toBe("2026-08-19");
    expect(shiftAnchor("week", "2026-08-12", -1)).toBe("2026-08-05");
  });

  it("steps a month WITHOUT skipping one from the 31st", () => {
    // +30 days from Jan 31 lands in March. Stepping months has to land in the
    // next month by name, which is why this is not addDays.
    expect(shiftAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-03-31", -1)).toBe("2026-02-01");
    expect(shiftAnchor("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftAnchor("month", "2026-01-15", -1)).toBe("2025-12-01");
  });
});
