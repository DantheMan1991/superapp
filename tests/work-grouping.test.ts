import { describe, expect, it } from "vitest";
import {
  groupByUrgency,
  isDeferred,
  urgencyLabel,
  urgencyOf,
  URGENCY_ORDER,
} from "../src/modules/work/core/grouping";

/**
 * How "my work" is ordered. Pure, and every comparison is between date STRINGS
 * — the bug crm.md records is a `date` column compared against a server `Date`,
 * which is wrong by up to a day for anybody off UTC.
 */
describe("work urgency", () => {
  const TODAY = "2026-08-09";

  it("splits by the reader's today, not the server's", () => {
    expect(urgencyOf("2026-08-08", TODAY)).toBe("overdue");
    expect(urgencyOf("2026-08-09", TODAY)).toBe("today");
    expect(urgencyOf("2026-08-12", TODAY)).toBe("soon");
    expect(urgencyOf("2026-09-30", TODAY)).toBe("later");
    expect(urgencyOf(null, TODAY)).toBe("undated");
  });

  it("puts the last day of the window in `soon` and the next in `later`", () => {
    // Off-by-one at the boundary is the whole risk in a function like this.
    expect(urgencyOf("2026-08-16", TODAY)).toBe("soon");
    expect(urgencyOf("2026-08-17", TODAY)).toBe("later");
  });

  it("crosses a month and a year end without arithmetic going odd", () => {
    expect(urgencyOf("2026-01-02", "2025-12-29")).toBe("soon");
    expect(urgencyOf("2025-12-31", "2026-01-01")).toBe("overdue");
  });

  it("holds work back until it starts", () => {
    expect(isDeferred("2026-08-10", TODAY)).toBe(true);
    expect(isDeferred("2026-08-09", TODAY)).toBe(false);
    expect(isDeferred(null, TODAY)).toBe(false);
  });

  it("groups in section order and drops the empty sections", () => {
    const groups = groupByUrgency(
      [
        { dueOn: "2026-09-30", id: "later" },
        { dueOn: "2026-08-08", id: "overdue" },
        { dueOn: null, id: "undated" },
        { dueOn: "2026-08-07", id: "overdue2" },
      ],
      TODAY,
    );
    expect(groups.map((g) => g.urgency)).toEqual([
      "overdue",
      "later",
      "undated",
    ]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["overdue", "overdue2"]);
  });

  it("keeps the input order inside a section", () => {
    // The server already sorted by due date; grouping must not reshuffle it.
    const groups = groupByUrgency(
      [
        { dueOn: "2026-08-01", id: "a" },
        { dueOn: "2026-08-02", id: "b" },
        { dueOn: "2026-08-03", id: "c" },
      ],
      TODAY,
    );
    expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("names every section it can produce", () => {
    for (const urgency of URGENCY_ORDER) {
      expect(urgencyLabel(urgency).length).toBeGreaterThan(0);
    }
  });
});
