import { describe, expect, it } from "vitest";
import {
  BUILT_IN_REPORTS,
  DEFAULT_DEFINITION,
  REPORT_TYPES,
  REPORT_TYPE_IDS,
  builtInReport,
  describeReport,
  measureFor,
  parseDefinition,
  reportType,
  share,
  summarise,
  type ReportGroupRow,
} from "../src/modules/crm/core/reports";
import { conditionProblem, filterField } from "../src/modules/crm/core/views";

/**
 * The reporting rules, without a database.
 *
 * The report TYPE is the whitelist this file mostly exists to pin: a type that
 * is not declared here has no base query in the ops layer, so an undeclared one
 * arriving from a browser must fall back rather than reach the database with a
 * shape nobody wrote. The rest is ordering and arithmetic that would be easy to
 * get quietly wrong — a summary whose groups do not add up to its own total is
 * a report that gets believed.
 */

describe("report types", () => {
  it("declares exactly the five ids the ops layer has base queries for", () => {
    // A sixth type is a code change in two places, on purpose. If this fails,
    // one of the two halves was changed without the other.
    expect(REPORT_TYPES.map((t) => t.id).sort()).toEqual(
      [...REPORT_TYPE_IDS].sort(),
    );
  });

  it("REFUSES A TYPE IT DOES NOT DECLARE", () => {
    expect(reportType("records; drop table crm_deals")).toBeNull();
    expect(parseDefinition({ type: "arbitrary_join" })).toEqual(
      DEFAULT_DEFINITION,
    );
  });

  it("every type answers a question, and asks it as one", () => {
    for (const type of REPORT_TYPES) {
      expect(type.question.endsWith("?")).toBe(true);
      expect(type.measures.length).toBeGreaterThan(0);
      expect(type.groupBy.length).toBeGreaterThan(0);
      expect(type.fields.length).toBeGreaterThan(0);
    }
  });

  it("the records type reuses the records list's own field registry", () => {
    // The two would be strange to disagree: a report over records is the
    // saved-views question asked a different way.
    const records = reportType("records")!;
    expect(filterField("stage", records.fields)).not.toBeNull();
    expect(filterField("deal_stage", records.fields)).toBeNull();
  });

  it("a deal report can filter on deal fields the records list cannot", () => {
    const deals = reportType("records_deals")!;
    expect(filterField("deal_stage", deals.fields)).not.toBeNull();
    // And the scoping is real: the same key is unknown to the default registry.
    expect(filterField("deal_stage")).toBeNull();
  });

  it("validates a condition against the TYPE's fields, not the default set", () => {
    const deals = reportType("records_deals")!;
    const condition = {
      field: "deal_open",
      operator: "equals" as const,
      value: "true",
    };
    expect(conditionProblem(condition, deals.fields)).toBeNull();
    expect(conditionProblem(condition)).toBe("Unknown field");
  });
});

describe("parseDefinition", () => {
  it("falls back whole when the stored value is not a definition", () => {
    expect(parseDefinition(null)).toEqual(DEFAULT_DEFINITION);
    expect(parseDefinition("nonsense")).toEqual(DEFAULT_DEFINITION);
  });

  it("drops a grouping the type does not offer", () => {
    // Dropping a grouping turns a summary into a total. It cannot expose a row,
    // which is the only property that has to hold.
    const parsed = parseDefinition({
      type: "records",
      groupBy: "deal_pipeline",
    });
    expect(parsed.groupBy).toBeNull();
  });

  it("drops a filter condition the type does not know", () => {
    const parsed = parseDefinition({
      type: "records",
      filter: [
        { field: "kind", operator: "equals", value: "person" },
        { field: "deal_stage", operator: "equals", value: "won" },
      ],
    });
    expect(parsed.filter.map((c) => c.field)).toEqual(["kind"]);
  });

  it("falls back to the type's first measure rather than an unknown one", () => {
    expect(parseDefinition({ type: "records", measure: "profit" }).measure).toBe(
      "count",
    );
  });

  it("keeps a definition that is entirely valid", () => {
    const parsed = parseDefinition({
      type: "records_deals",
      groupBy: "deal_stage",
      measure: "deal_amount_sum",
      showDetail: true,
      chart: "bar",
      filter: [{ field: "deal_open", operator: "equals", value: "true" }],
    });
    expect(parsed).toEqual({
      type: "records_deals",
      groupBy: "deal_stage",
      measure: "deal_amount_sum",
      showDetail: true,
      chart: "bar",
      filter: [{ field: "deal_open", operator: "equals", value: "true" }],
    });
  });
});

describe("summarise", () => {
  const rows: ReportGroupRow[] = [
    { key: "lead", value: 3 },
    { key: "customer", value: 9 },
    { key: null, value: 5 },
  ];

  it("puts the biggest group first, because that is the answer", () => {
    expect(summarise(rows, "text").rows.map((r) => r.key)).toEqual([
      "customer",
      null,
      "lead",
    ]);
  });

  it("ORDERS A MONTH GROUPING BY TIME instead", () => {
    // A chronology sorted by size is not a chronology.
    const months: ReportGroupRow[] = [
      { key: "2026-03", value: 10 },
      { key: "2026-01", value: 2 },
      { key: "2026-02", value: 7 },
    ];
    expect(summarise(months, "month").rows.map((r) => r.key)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });

  it("KEEPS THE NULL GROUP, so the parts add up to the total", () => {
    // "5 records with no stage set" is usually the most actionable line in the
    // report, and dropping it would make the groups silently fail to sum.
    const summary = summarise(rows, "text");
    expect(summary.rows).toHaveLength(3);
    expect(summary.total).toBe(17);
    expect(summary.rows.reduce((n, r) => n + r.value, 0)).toBe(summary.total);
  });

  it("reports the peak so a bar has a scale", () => {
    expect(summarise(rows, "text").peak).toBe(9);
  });

  it("survives having nothing to summarise", () => {
    const empty = summarise([], "text");
    expect(empty).toEqual({ rows: [], total: 0, peak: 0 });
  });
});

describe("share", () => {
  it("scales against the peak rather than the total", () => {
    // Bars are read against the longest one; scaling by the total would make
    // every bar short as soon as there are many groups.
    expect(share(9, 9)).toBe(100);
    expect(share(3, 9)).toBe(33);
  });

  it("never divides by zero or leaves the range", () => {
    expect(share(5, 0)).toBe(0);
    expect(share(-1, 10)).toBe(0);
    expect(share(99, 10)).toBe(100);
  });
});

describe("built-in reports", () => {
  it("every built-in is named as a QUESTION", () => {
    for (const report of BUILT_IN_REPORTS) {
      expect(report.name.endsWith("?")).toBe(true);
    }
  });

  it("every built-in survives its own parser unchanged", () => {
    // A built-in that failed validation would silently become the default
    // report — the same shape of bug as a seeded view that shows everything.
    for (const report of BUILT_IN_REPORTS) {
      expect(parseDefinition(report.definition)).toEqual(report.definition);
    }
  });

  it("resolves by id and refuses one it does not have", () => {
    expect(builtInReport("builtin:workload")).not.toBeNull();
    expect(builtInReport("builtin:nope")).toBeNull();
  });
});

describe("describeReport", () => {
  it("reads as a sentence about what is being counted", () => {
    expect(
      describeReport({
        ...DEFAULT_DEFINITION,
        type: "records",
        groupBy: "stage",
      }),
    ).toBe("Number of records by stage");
  });

  it("names the measure when it is not a count", () => {
    const description = describeReport({
      ...DEFAULT_DEFINITION,
      type: "records_deals",
      measure: "deal_amount_sum",
      groupBy: "deal_stage",
    });
    expect(description).toBe("Total value by stage");
  });

  it("appends the filter when there is one", () => {
    const description = describeReport({
      ...DEFAULT_DEFINITION,
      type: "records",
      groupBy: "stage",
      filter: [{ field: "kind", operator: "equals", value: "person" }],
    });
    expect(description).toContain("Type is Person");
  });
});

describe("measureFor", () => {
  it("falls back to the type's first measure", () => {
    const records = reportType("records")!;
    expect(measureFor(records, "deal_amount_sum").key).toBe("count");
  });
});
