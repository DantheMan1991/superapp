import type { FilterCondition, FilterField } from "./views";
import { FILTER_FIELDS, conditionProblem, describeFilter } from "./views";

/**
 * Reports: a question about a set of records, grouped and counted.
 *
 * PURE — no database, no `server-only`, the same arrangement `core/views.ts`
 * has with `view-ops.ts`. This file declares what a report may ASK;
 * `report-ops.ts` is the only place that knows which tables answer it.
 *
 * THE REPORT TYPE IS THE WHOLE DESIGN, and it is the thing to understand before
 * changing anything here. A report does not begin by choosing a table and then
 * joining outward — it begins by choosing one of a handful of declared SHAPES,
 * each of which is a hand-written base query in `report-ops.ts`. That
 * constraint is what lets this module offer grouping and filtering without
 * inventing a query language, and it is the join-level version of the
 * whitelist `core/views.ts` already applies to columns:
 *
 *   `views.ts`   decides which COLUMNS a filter may name.
 *   this file    decides which JOINS a report may reach across.
 *
 * Neither lets an identifier arrive from outside the codebase. A report type
 * that a browser sent but this file does not declare has no base query, so it
 * cannot run at all.
 *
 * FIVE TYPES, AND ADDING A SIXTH IS A CODE CHANGE IN TWO PLACES — here and in
 * the ops file's base queries. That is deliberate, and it is the same
 * discipline `crm_field_type` and the filter operators follow: a closed
 * enumeration whose every member needs a branch somebody wrote on purpose.
 * The alternative — a generic join planner over the CRM schema — is a database
 * console with a nicer skin, and it would hand every tenant the ability to
 * write a query nobody can index for.
 */

/* -- Measures ------------------------------------------------------------- */

/**
 * What a report counts.
 *
 * `count` needs no column and is what most questions want. The others exist
 * because "how many deals" and "how much are they worth" are different
 * questions about the same rows, and a pipeline report that could only answer
 * the first would be a pipeline report nobody opens.
 */
export interface ReportMeasure {
  key: string;
  label: string;
  kind: "count" | "sum" | "avg";
  /** Money is rendered through `@/lib/money`, never formatted here. */
  format: "number" | "money";
}

const COUNT: ReportMeasure = {
  key: "count",
  label: "Number of records",
  kind: "count",
  format: "number",
};

const DEAL_VALUE: ReportMeasure = {
  key: "deal_amount_sum",
  label: "Total value",
  kind: "sum",
  format: "money",
};

const DEAL_AVERAGE: ReportMeasure = {
  key: "deal_amount_avg",
  label: "Average value",
  kind: "avg",
  format: "money",
};

/* -- Grouping ------------------------------------------------------------- */

/**
 * A column a report may group by.
 *
 * SEPARATE FROM THE FILTER FIELDS ON PURPOSE, even where the two overlap.
 * Grouping by a free-text column with a thousand distinct values produces a
 * thousand-row "summary" that answers nothing, so the groupable set is always
 * the small-cardinality one — and some things worth grouping by, like the month
 * a deal closed, are not columns at all.
 */
export interface ReportGroupField {
  key: string;
  label: string;
  /** A hint for the renderer, not a storage type. */
  shape: "text" | "enum" | "month";
}

/* -- The types ------------------------------------------------------------ */

export const REPORT_TYPE_IDS = [
  "records",
  "records_deals",
  "deal_stages",
  "records_activity",
  "followups",
] as const;

export type ReportTypeId = (typeof REPORT_TYPE_IDS)[number];

export interface ReportType {
  id: ReportTypeId;
  name: string;
  /**
   * WHAT IT ANSWERS, PHRASED AS A QUESTION. Every built-in report is named this
   * way too, and it is the cheapest good idea in this slice: somebody opening a
   * reports list is looking for an answer, not a table. "Which accounts have
   * gone quiet?" finds itself; "Party Activity Report" does not.
   */
  question: string;
  fields: readonly FilterField[];
  groupBy: readonly ReportGroupField[];
  measures: readonly ReportMeasure[];
}

/** Fields a deal-shaped report can filter on, beyond the record's own. */
const DEAL_FIELDS: readonly FilterField[] = [
  { key: "deal_title", label: "Deal", type: "text", table: "party" },
  { key: "deal_stage", label: "Deal stage", type: "text", table: "party" },
  { key: "deal_open", label: "Deal is open", type: "boolean", table: "party" },
];

const ACTIVITY_FIELDS: readonly FilterField[] = [
  {
    key: "activity_kind",
    label: "Kind",
    type: "enum",
    table: "party",
    options: [
      { value: "note", label: "Note" },
      { value: "call", label: "Call" },
      { value: "meeting", label: "Meeting" },
    ],
  },
  { key: "activity_on", label: "Happened", type: "date", table: "party" },
];

const TASK_FIELDS: readonly FilterField[] = [
  { key: "task_done", label: "Completed", type: "boolean", table: "party" },
  { key: "task_due", label: "Due", type: "date", table: "party" },
];

export const REPORT_TYPES: readonly ReportType[] = [
  {
    id: "records",
    name: "Records",
    question: "How are the people and companies we deal with distributed?",
    // The records list's own registry, unchanged. The `records` type IS the
    // saved-views question asked a different way, so it would be strange for
    // the two to disagree about which fields exist.
    fields: FILTER_FIELDS,
    groupBy: [
      { key: "kind", label: "Type", shape: "enum" },
      { key: "stage", label: "Stage", shape: "text" },
      { key: "lead_source", label: "Source", shape: "text" },
      { key: "assigned", label: "Assigned to", shape: "text" },
      { key: "created_month", label: "Month added", shape: "month" },
    ],
    measures: [COUNT],
  },
  {
    id: "records_deals",
    name: "Records with deals",
    question: "Where is the work, and what is it worth?",
    fields: [...FILTER_FIELDS, ...DEAL_FIELDS],
    groupBy: [
      { key: "deal_stage", label: "Stage", shape: "text" },
      { key: "deal_pipeline", label: "Pipeline", shape: "text" },
      { key: "assigned", label: "Assigned to", shape: "text" },
      { key: "deal_closed_month", label: "Month closed", shape: "month" },
    ],
    measures: [COUNT, DEAL_VALUE, DEAL_AVERAGE],
  },
  {
    id: "deal_stages",
    name: "Deal stage history",
    question: "How does work actually move through the pipeline?",
    fields: DEAL_FIELDS,
    groupBy: [
      { key: "stage_to", label: "Moved into", shape: "text" },
      { key: "stage_month", label: "Month moved", shape: "month" },
      { key: "moved_by", label: "Moved by", shape: "text" },
    ],
    measures: [COUNT],
  },
  {
    id: "records_activity",
    name: "Records with activity",
    question: "Who have we actually spoken to, and who has gone quiet?",
    fields: [...FILTER_FIELDS, ...ACTIVITY_FIELDS],
    groupBy: [
      { key: "activity_kind", label: "Kind", shape: "enum" },
      { key: "activity_month", label: "Month", shape: "month" },
      { key: "assigned", label: "Assigned to", shape: "text" },
    ],
    measures: [COUNT],
  },
  {
    id: "followups",
    name: "Follow-ups",
    question: "What is outstanding, and who is carrying it?",
    fields: TASK_FIELDS,
    groupBy: [
      { key: "task_assignee", label: "Assigned to", shape: "text" },
      { key: "task_due_month", label: "Month due", shape: "month" },
      { key: "task_done", label: "Completed", shape: "enum" },
    ],
    measures: [COUNT],
  },
];

export function reportType(id: string): ReportType | null {
  return REPORT_TYPES.find((t) => t.id === id) ?? null;
}

/* -- A report definition -------------------------------------------------- */

export type ReportChart = "none" | "bar" | "donut";

export interface ReportDefinition {
  type: ReportTypeId;
  filter: FilterCondition[];
  /**
   * ONE GROUPING LEVEL, and the restraint is deliberate. Salesforce allows
   * three; almost every question a small business actually asks is answered by
   * one, and each extra level multiplies the rendering, the chart's meaning and
   * the empty-group edge cases. A second level is a later slice with a real
   * question behind it, not a checkbox added now.
   *
   * Null means no grouping: a plain filtered list with a total, which is a
   * perfectly good report and the one a "how many" question wants.
   */
  groupBy: string | null;
  measure: string;
  /**
   * The Detail Rows toggle. OFF turns a row listing into a summary table —
   * the same definition read two ways, which is the reporting version of the
   * saved-view/rendering split noted in the dossier.
   */
  showDetail: boolean;
  chart: ReportChart;
}

export const DEFAULT_DEFINITION: ReportDefinition = {
  type: "records",
  filter: [],
  groupBy: null,
  measure: "count",
  showDetail: false,
  chart: "bar",
};

/**
 * A stored definition, validated. Anything unusable falls back rather than
 * throwing — a report saved when a field existed must still open once the field
 * is gone, exactly as `parseFilter` promises for views.
 *
 * THE FALLBACK DIRECTION IS DIFFERENT HERE AND WORTH NOTICING. A dropped filter
 * condition widens the rows a report covers, which is safe because RLS decides
 * what the caller may see. A dropped GROUPING does not widen anything — it
 * turns a summary into a total. Neither can expose a row, which is the only
 * property that has to hold.
 */
export function parseDefinition(stored: unknown): ReportDefinition {
  if (typeof stored !== "object" || stored === null) return DEFAULT_DEFINITION;
  const candidate = stored as Record<string, unknown>;

  const type = reportType(candidate.type as string);
  if (!type) return DEFAULT_DEFINITION;

  const filter = Array.isArray(candidate.filter)
    ? (candidate.filter as FilterCondition[]).filter(
        (condition) =>
          typeof condition?.field === "string" &&
          conditionProblem(condition, type.fields) === null,
      )
    : [];

  const groupBy =
    typeof candidate.groupBy === "string" &&
    type.groupBy.some((g) => g.key === candidate.groupBy)
      ? candidate.groupBy
      : null;

  const measure = type.measures.some((m) => m.key === candidate.measure)
    ? (candidate.measure as string)
    : type.measures[0].key;

  const chart: ReportChart =
    candidate.chart === "donut" || candidate.chart === "none"
      ? candidate.chart
      : "bar";

  return {
    type: type.id,
    filter,
    groupBy,
    measure,
    showDetail: candidate.showDetail === true,
    chart,
  };
}

export function measureFor(
  type: ReportType,
  key: string,
): ReportMeasure {
  return type.measures.find((m) => m.key === key) ?? type.measures[0];
}

/** The report as a sentence, for the line under its title. */
export function describeReport(definition: ReportDefinition): string {
  const type = reportType(definition.type);
  if (!type) return "";
  const measure = measureFor(type, definition.measure);
  const group = type.groupBy.find((g) => g.key === definition.groupBy);

  const parts = [measure.label];
  if (group) parts.push(`by ${group.label.toLowerCase()}`);
  if (definition.filter.length > 0) {
    parts.push(`· ${describeFilter(definition.filter, type.fields)}`);
  }
  return parts.join(" ");
}

/* -- Summarising ---------------------------------------------------------- */

/**
 * One row of a grouped result, as the ops layer produces it.
 *
 * `value` is already aggregated by Postgres — this file never sums anything,
 * because summing in TypeScript would mean fetching every row to count them,
 * which is the mistake that makes a reporting feature fall over on the first
 * tenant with real data.
 */
export interface ReportGroupRow {
  /** Null for records with no value — rendered as "Not set", never dropped. */
  key: string | null;
  value: number;
}

export interface ReportSummary {
  rows: ReportGroupRow[];
  total: number;
  /** The largest group's value, so a bar chart has a scale. */
  peak: number;
}

/**
 * Order the groups and total them.
 *
 * BIGGEST FIRST, because a summary is read top-down and the answer to "where is
 * it all?" should be the first line. The exception is a month grouping, which
 * is ordered by time — a chronology sorted by size is not a chronology.
 *
 * NULLS ARE KEPT AND LABELLED. "37 records with no stage set" is usually the
 * most actionable line in the whole report, and dropping it would make the
 * groups silently fail to add up to the total.
 */
export function summarise(
  rows: readonly ReportGroupRow[],
  shape: ReportGroupField["shape"] | null,
): ReportSummary {
  const ordered = [...rows];
  if (shape === "month") {
    ordered.sort((a, b) => (a.key ?? "").localeCompare(b.key ?? ""));
  } else {
    ordered.sort(
      (a, b) => b.value - a.value || (a.key ?? "").localeCompare(b.key ?? ""),
    );
  }

  const total = ordered.reduce((sum, row) => sum + row.value, 0);
  const peak = ordered.reduce((max, row) => Math.max(max, row.value), 0);
  return { rows: ordered, total, peak };
}

/** A group's share of the total, for a bar's width. 0 when the total is 0. */
export function share(value: number, peak: number): number {
  if (peak <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / peak) * 100)));
}

/* -- Built-in reports ----------------------------------------------------- */

/**
 * The reports every tenant has without building one.
 *
 * CODE RATHER THAN SEEDED ROWS, for the reasons `BUILT_IN_VIEWS` sets out at
 * length: no migration per new default, no backfill, and no half-renamed copy
 * in one tenant. The Salesforce org this was modelled on ships fifty-nine, and
 * the point of them is to show what a report IS before anybody builds one.
 *
 * NAMED AS QUESTIONS, deliberately and without exception.
 */
export interface BuiltInReport {
  id: string;
  name: string;
  definition: ReportDefinition;
}

export const BUILT_IN_REPORTS: readonly BuiltInReport[] = [
  {
    id: "builtin:by-stage",
    name: "Where is everybody in the pipeline?",
    definition: {
      ...DEFAULT_DEFINITION,
      type: "records",
      groupBy: "stage",
      chart: "bar",
    },
  },
  {
    id: "builtin:new-by-month",
    name: "How many records are we adding each month?",
    definition: {
      ...DEFAULT_DEFINITION,
      type: "records",
      groupBy: "created_month",
      chart: "bar",
    },
  },
  {
    id: "builtin:pipeline-value",
    name: "What is the open work worth, by stage?",
    definition: {
      ...DEFAULT_DEFINITION,
      type: "records_deals",
      groupBy: "deal_stage",
      measure: "deal_amount_sum",
      filter: [{ field: "deal_open", operator: "equals", value: "true" }],
      chart: "bar",
    },
  },
  {
    id: "builtin:workload",
    name: "Who is carrying what?",
    definition: {
      ...DEFAULT_DEFINITION,
      type: "followups",
      groupBy: "task_assignee",
      filter: [{ field: "task_done", operator: "equals", value: "false" }],
      chart: "donut",
    },
  },
];

export function builtInReport(id: string): BuiltInReport | null {
  return BUILT_IN_REPORTS.find((r) => r.id === id) ?? null;
}
