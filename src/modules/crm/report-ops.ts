import "server-only";
import { and, eq, gt, gte, ilike, lt, lte, ne, not, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { type Tx } from "@/db";
import {
  conditionProblem,
  filterField,
  resolveDateValue,
  type FilterCondition,
} from "./core/views";
import {
  measureFor,
  reportType,
  summarise,
  type ReportDefinition,
  type ReportGroupRow,
  type ReportMeasure,
  type ReportSummary,
  type ReportType,
  type ReportTypeId,
} from "./core/reports";

/**
 * Running a report.
 *
 * FIVE HAND-WRITTEN BASE QUERIES, one per declared report type, and no sixth
 * without a sixth branch here. `core/reports.ts` explains why at length; the
 * short version is that a generic join planner over this schema would be a
 * database console, and this is a reporting feature.
 *
 * EVERY IDENTIFIER IN THE SQL BELOW IS A LITERAL IN THIS FILE. The report type,
 * the group expression and the measure all arrive as KEYS which are looked up
 * in whitelists; an unrecognised key falls back rather than reaching a query
 * builder. Filter values are bound as parameters by the same helpers
 * `view-ops.ts` uses. Nothing a browser sent is ever concatenated into SQL
 * text, and the only reason that is true by construction rather than by care is
 * that the switch statements below have no default branch that builds anything.
 *
 * AGGREGATION HAPPENS IN POSTGRES, NEVER HERE. `core/reports.ts` sums nothing —
 * summing in TypeScript means fetching every row to count it, which is the
 * mistake that makes a reporting feature collapse on the first tenant with real
 * data. This file returns groups already counted.
 *
 * RLS APPLIES THROUGHOUT, because these run inside the caller's transaction.
 * A staff member's pipeline report silently omits the deals on restricted
 * records, and that is correct: a report is a question about the rows somebody
 * may see, so two people running one report legitimately get different totals —
 * the same property that makes a shared saved view safe.
 */

/* -- The five shapes ------------------------------------------------------ */

/**
 * The FROM and JOINs for a type.
 *
 * Aliases are fixed and short — `p` party, `d` details, `dl` deal, `st` stage,
 * `pl` pipeline, `a` activity, `t` task, `e` stage event — because the group and
 * filter expressions below name them, and three places agreeing about an alias
 * is easier to check when the alias is one letter.
 */
function baseFrom(type: ReportTypeId): SQL {
  switch (type) {
    case "records":
      return sql`
        from parties p
        left join crm_party_details d
          on d.tenant_id = p.tenant_id and d.party_id = p.id`;

    case "records_deals":
      // Deals lead, because the question is about work rather than about
      // records that happen to have some. A record with no deal contributes
      // nothing, which is what "where is the work?" means.
      return sql`
        from crm_deals dl
        join parties p on p.tenant_id = dl.tenant_id and p.id = dl.party_id
        left join crm_party_details d
          on d.tenant_id = dl.tenant_id and d.party_id = dl.party_id
        left join crm_pipeline_stages st
          on st.tenant_id = dl.tenant_id and st.id = dl.stage_id
        left join crm_pipelines pl
          on pl.tenant_id = dl.tenant_id and pl.id = dl.pipeline_id`;

    case "deal_stages":
      return sql`
        from crm_deal_stage_events e
        join crm_deals dl on dl.tenant_id = e.tenant_id and dl.id = e.deal_id
        left join crm_pipeline_stages st
          on st.tenant_id = e.tenant_id and st.id = e.to_stage_id`;

    case "records_activity":
      return sql`
        from crm_activities a
        join parties p on p.tenant_id = a.tenant_id and p.id = a.party_id
        left join crm_party_details d
          on d.tenant_id = a.tenant_id and d.party_id = a.party_id`;

    case "followups":
      // LEFT join to details: an unattached follow-up ("ring the accountant
      // back") has no record, and a report that dropped those would understate
      // somebody's workload — which is the one thing this report is for.
      return sql`
        from crm_tasks t
        left join crm_party_details d
          on d.tenant_id = t.tenant_id and d.party_id = t.party_id`;
  }
}

/** The tenant predicate, on the type's own driving table. */
function tenantColumn(type: ReportTypeId): SQL {
  switch (type) {
    case "records":
      return sql`p.tenant_id`;
    case "records_deals":
      return sql`dl.tenant_id`;
    case "deal_stages":
      return sql`e.tenant_id`;
    case "records_activity":
      return sql`a.tenant_id`;
    case "followups":
      return sql`t.tenant_id`;
  }
}

/* -- Group expressions ---------------------------------------------------- */

/**
 * What a group key is, per type.
 *
 * A LOOKUP, NEVER AN INTERPOLATION. The caller supplies a key; an unknown one
 * returns null and the report runs ungrouped. `to_char(..., 'YYYY-MM')` is the
 * month shape the summariser sorts lexically, which works precisely because
 * that format sorts the same way time does.
 */
function groupExpression(type: ReportTypeId, key: string): SQL | null {
  const shared: Record<string, SQL> = {
    assigned: sql`d.owner_clerk_user_id`,
  };

  switch (type) {
    case "records":
      return (
        {
          kind: sql`p.kind::text`,
          stage: sql`nullif(d.lifecycle_stage, '')`,
          lead_source: sql`nullif(d.source, '')`,
          created_month: sql`to_char(p.created_at, 'YYYY-MM')`,
          ...shared,
        }[key] ?? null
      );

    case "records_deals":
      return (
        {
          deal_stage: sql`st.name`,
          deal_pipeline: sql`pl.name`,
          deal_closed_month: sql`to_char(dl.closed_at, 'YYYY-MM')`,
          ...shared,
        }[key] ?? null
      );

    case "deal_stages":
      return (
        {
          stage_to: sql`st.name`,
          stage_month: sql`to_char(e.changed_at, 'YYYY-MM')`,
          moved_by: sql`e.changed_by_clerk_user_id`,
        }[key] ?? null
      );

    case "records_activity":
      return (
        {
          activity_kind: sql`a.kind::text`,
          activity_month: sql`to_char(a.occurred_at, 'YYYY-MM')`,
          ...shared,
        }[key] ?? null
      );

    case "followups":
      return (
        {
          task_assignee: sql`nullif(t.assignee_clerk_user_id, '')`,
          task_due_month: sql`to_char(t.due_on, 'YYYY-MM')`,
          // A boolean rendered as text, so the group key is a string like
          // every other one and the renderer needs no special case.
          task_done: sql`case when t.completed_at is null then 'Outstanding' else 'Done' end`,
        }[key] ?? null
      );
  }
}

/* -- Measures ------------------------------------------------------------- */

/**
 * What is being counted.
 *
 * `count(*)` for everything except the two money measures, which exist only on
 * the deal type — and `coalesce(sum(...), 0)` because a group whose deals are
 * all unpriced sums to NULL, and a report showing an empty cell where it means
 * "nothing priced yet" is a report somebody misreads.
 */
function measureExpression(type: ReportTypeId, measure: ReportMeasure): SQL {
  if (type !== "records_deals" || measure.kind === "count") {
    return sql`count(*)::bigint`;
  }
  return measure.kind === "sum"
    ? sql`coalesce(sum(dl.amount_cents), 0)::bigint`
    : sql`coalesce(round(avg(dl.amount_cents)), 0)::bigint`;
}

/* -- Filters -------------------------------------------------------------- */

/** A field key's column, per type. Unknown keys compile to nothing. */
function filterColumn(type: ReportTypeId, key: string): SQL | null {
  const record: Record<string, SQL> = {
    name: sql`p.display_name`,
    kind: sql`p.kind::text`,
    active: sql`p.is_active`,
    created: sql`p.created_at`,
    stage: sql`d.lifecycle_stage`,
    lead_source: sql`d.source`,
    assigned: sql`d.owner_clerk_user_id`,
    visibility: sql`d.visibility::text`,
  };
  const deal: Record<string, SQL> = {
    deal_title: sql`dl.title`,
    deal_stage: sql`st.name`,
    deal_open: sql`(st.outcome = 'open')`,
  };

  switch (type) {
    case "records":
      return record[key] ?? null;
    case "records_deals":
      return record[key] ?? deal[key] ?? null;
    case "deal_stages":
      return deal[key] ?? null;
    case "records_activity":
      return (
        record[key] ??
        { activity_kind: sql`a.kind::text`, activity_on: sql`a.occurred_at` }[key] ??
        null
      );
    case "followups":
      return (
        {
          task_done: sql`(t.completed_at is not null)`,
          task_due: sql`t.due_on`,
        }[key] ?? null
      );
  }
}

/** One `%term%` fragment with LIKE's wildcards escaped, bound as a parameter. */
function contains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Conditions as predicates, against the type's own registry.
 *
 * The same shape as `view-ops.compileConditions` and for the same reasons —
 * dropped conditions widen, values are bound, negatives keep the unknowns. It
 * is a separate function rather than a shared one because the column lookup is
 * per report type and the join aliases differ; sharing it would have meant
 * passing a column resolver into a function whose whole job is resolving
 * columns.
 */
export function compileReportConditions(
  type: ReportType,
  conditions: readonly FilterCondition[],
  now: Date,
): SQL[] {
  const out: SQL[] = [];

  for (const condition of conditions) {
    if (conditionProblem(condition, type.fields) !== null) continue;
    const field = filterField(condition.field, type.fields);
    const column = filterColumn(type.id, condition.field);
    if (!field || !column) continue;

    if (field.type === "date") {
      const at = resolveDateValue(condition.value, now);
      if (!at) continue;
      switch (condition.operator) {
        case "less_than":
          out.push(lt(column, at));
          break;
        case "greater_than":
          out.push(gt(column, at));
          break;
        case "less_or_equal":
          out.push(lte(column, at));
          break;
        case "greater_or_equal":
          out.push(gte(column, at));
          break;
      }
      continue;
    }

    if (field.type === "boolean") {
      const wanted = condition.value === "true";
      // `is [not] true` rather than `= true`, because these columns are
      // sometimes expressions over a LEFT JOIN and therefore nullable — and
      // `null = false` is null, which would drop the rows the question is
      // usually about.
      out.push(wanted ? sql`${column} is true` : sql`${column} is not true`);
      continue;
    }

    switch (condition.operator) {
      case "equals":
        out.push(eq(column, condition.value));
        break;
      case "not_equals":
        out.push(or(ne(column, condition.value), sql`${column} is null`) as SQL);
        break;
      case "contains":
        out.push(ilike(column, contains(condition.value)));
        break;
      case "not_contains":
        out.push(
          or(not(ilike(column, contains(condition.value))), sql`${column} is null`) as SQL,
        );
        break;
      case "starts_with":
        out.push(ilike(column, `${contains(condition.value).slice(1)}`));
        break;
    }
  }

  return out;
}

/* -- Running -------------------------------------------------------------- */

export interface ReportResult {
  summary: ReportSummary;
  measure: ReportMeasure;
  /** Null when the report is a plain total rather than a breakdown. */
  groupLabel: string | null;
  /** Rows behind the summary, only when the definition asked for them. */
  detail: ReportDetailRow[];
}

export interface ReportDetailRow {
  id: string;
  title: string;
  group: string | null;
  value: number | null;
}

export const DETAIL_LIMIT = 200;

/**
 * Run a report.
 *
 * UNGROUPED IS A REAL REPORT, not a degenerate case: "how many open deals are
 * there" wants one number, and forcing a grouping to get it would make the
 * commonest question the awkward one. A null `groupBy` produces a single row
 * whose key is null, which the summariser totals exactly as it totals anything
 * else.
 */
export async function runReport(
  tx: Tx,
  tenantId: string,
  definition: ReportDefinition,
  now = new Date(),
): Promise<ReportResult> {
  const type = reportType(definition.type);
  // Unreachable through the actions, which parse first — but a null here would
  // mean building SQL from an undeclared shape, so it refuses rather than
  // guessing.
  if (!type) throw new Error(`unknown report type: ${definition.type}`);

  const measure = measureFor(type, definition.measure);
  const group = type.groupBy.find((g) => g.key === definition.groupBy) ?? null;
  const groupSql = group ? groupExpression(type.id, group.key) : null;

  const where = and(
    eq(tenantColumn(type.id), tenantId),
    ...compileReportConditions(type, definition.filter, now),
  );

  const from = baseFrom(type.id);
  const value = measureExpression(type.id, measure);

  const rows = groupSql
    ? await tx.execute(sql`
        select ${groupSql} as key, ${value} as value
        ${from}
        where ${where}
        group by 1`)
    : await tx.execute(sql`
        select null::text as key, ${value} as value
        ${from}
        where ${where}`);

  const groupRows: ReportGroupRow[] = (
    rows.rows as { key: string | null; value: string | number }[]
  ).map((row) => ({
    key: row.key === null || row.key === "" ? null : String(row.key),
    // `count(*)::bigint` and `sum(...)` come back as strings from the driver,
    // because a bigint does not fit a JS number safely. These are counts and
    // cents at business scale, so Number() is correct here and would not be for
    // an id.
    value: Number(row.value),
  }));

  return {
    summary: summarise(groupRows, group?.shape ?? null),
    measure,
    groupLabel: group?.label ?? null,
    detail: definition.showDetail
      ? await runDetail(tx, type, definition, where, groupSql)
      : [],
  };
}

/**
 * The rows behind the summary.
 *
 * CAPPED, AND THE CAP IS SHOWN BY THE CALLER. A report is a summary; the detail
 * is there to answer "which ones?" for a group somebody is looking at, not to
 * be a second records list. Two hundred rows is enough to check a number and
 * few enough that nobody waits.
 */
async function runDetail(
  tx: Tx,
  type: ReportType,
  definition: ReportDefinition,
  where: SQL | undefined,
  groupSql: SQL | null,
): Promise<ReportDetailRow[]> {
  const title = detailTitle(type.id);
  const from = baseFrom(type.id);
  const key = groupSql ?? sql`null::text`;
  const amount =
    type.id === "records_deals" ? sql`dl.amount_cents` : sql`null::bigint`;

  const rows = await tx.execute(sql`
    select ${detailId(type.id)} as id, ${title} as title, ${key} as key, ${amount} as amount
    ${from}
    where ${where}
    order by 2
    limit ${DETAIL_LIMIT}`);

  return (
    rows.rows as {
      id: string;
      title: string | null;
      key: string | null;
      amount: string | number | null;
    }[]
  ).map((row) => ({
    id: String(row.id),
    title: row.title ?? "—",
    group: row.key === null || row.key === "" ? null : String(row.key),
    value: row.amount === null ? null : Number(row.amount),
  }));
}

function detailId(type: ReportTypeId): SQL {
  switch (type) {
    case "records":
      return sql`p.id`;
    case "records_deals":
      return sql`dl.id`;
    case "deal_stages":
      return sql`e.id`;
    case "records_activity":
      return sql`a.id`;
    case "followups":
      return sql`t.id`;
  }
}

function detailTitle(type: ReportTypeId): SQL {
  switch (type) {
    case "records":
      return sql`p.display_name`;
    case "records_deals":
      return sql`dl.title`;
    case "deal_stages":
      return sql`dl.title`;
    case "records_activity":
      return sql`coalesce(nullif(a.subject, ''), a.kind::text)`;
    case "followups":
      return sql`t.title`;
  }
}
