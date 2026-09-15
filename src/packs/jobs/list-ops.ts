import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import {
  type ProjectRow,
  actualByProject,
  billedByProject,
  budgetByProject,
  listProjectRows,
  projectValues,
} from "./ops";
import { ledgerTermsByProject } from "./wip-ops";
import { VALUED_CONTRACT_STATUSES } from "./vocabulary";
import { type ProjectValuation, measureProject } from "./list-math";

/**
 * Everything the module home puts on a row, read for the whole list at once.
 *
 * ── SIX STATEMENTS, NOT SIX PER JOB ─────────────────────────────────────────
 *
 * The old list showed a value and needed two statements to do it. This one adds
 * cost to date, gross billings, the revised budget and the contract terms, and
 * still takes a fixed number of statements: every read below is grouped in the
 * database and keyed by project id, in the spirit of `listProjectRows`' single
 * four-join statement. The rule this file exists to hold is that a list of
 * sixty jobs costs the same number of round trips as a list of one.
 *
 * The WIP schedule is the other reader of these same helpers, and it is
 * deliberately NOT what this calls: `wipSchedule` is scoped to one company and
 * one period end, and it drops rows on purpose — a cancelled job, a job with
 * nothing on it at all, a finished job whose billings have caught up. Those are
 * the right exclusions for a schedule a bank reads and the wrong ones for a
 * list of what the business is building, where a job that vanishes is the one
 * nobody notices.
 */
export interface ProjectListEntry {
  row: ProjectRow;
  /** Revised value over counted contracts. Zero when nothing is signed. */
  contractCents: number;
  changesCents: number;
  signedCount: number;
  proposedCents: number;
  /** The revised budget, standing in as the estimated cost at completion. */
  budgetCents: number;
  costToDateCents: number;
  billedCents: number;
  /** Distinct billing methods across the job's counted contracts. */
  billingMethods: string[];
  valuation: ProjectValuation;
}

/**
 * How each job is billed, across the contracts that count toward its value.
 *
 * A list rather than one method because a job can carry several agreements —
 * a design agreement then the build — and they need not be billed the same
 * way. The cell says "Several" rather than picking the first and being quietly
 * wrong about the rest.
 */
async function billingMethodsByProject(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({
      projectId: schema.jobContracts.projectId,
      billingMethod: schema.jobContracts.billingMethod,
    })
    .from(schema.jobContracts)
    .where(
      and(
        eq(schema.jobContracts.tenantId, tenantId),
        inArray(schema.jobContracts.status, [...VALUED_CONTRACT_STATUSES]),
      ),
    );
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const seen = out.get(r.projectId) ?? [];
    if (!seen.includes(r.billingMethod)) seen.push(r.billingMethod);
    out.set(r.projectId, seen);
  }
  return out;
}

export async function projectListEntries(
  tx: Tx,
  tenantId: string,
): Promise<ProjectListEntry[]> {
  /**
   * COMBINED, not consolidated: this is a list of jobs across every company the
   * tenant runs, and consolidation eliminates intercompany legs — which would
   * quietly change what a job has cost depending on who paid the bill. A plain
   * row filter is the honest scope for a list (see `EntityScope`'s own note on
   * why the distinction is a compile error elsewhere).
   *
   * No `asOf`: the list is the state now, not a closed period. The WIP schedule
   * is where a figure is pinned to a period end.
   */
  const scope = { kind: "combined" } as const;
  const [rows, values, budgets, actual, billed, terms, methods] = await Promise.all([
    listProjectRows(tx, tenantId),
    projectValues(tx, tenantId),
    budgetByProject(tx, tenantId),
    actualByProject(tx, tenantId, scope),
    billedByProject(tx, tenantId, scope),
    ledgerTermsByProject(tx, tenantId),
    billingMethodsByProject(tx, tenantId),
  ]);

  return rows.map((row) => {
    const id = row.project.id;
    const value = values.get(id);
    const contractCents = value?.valueCents ?? 0;
    const signedCount = value?.signedCount ?? 0;
    const proposedCents = value?.proposedCents ?? 0;
    const budgetCents = budgets.get(id) ?? 0;
    const costToDateCents = actual.get(id) ?? 0;
    const billedCents = billed.get(id) ?? 0;
    return {
      row,
      contractCents,
      changesCents: value?.changesCents ?? 0,
      signedCount,
      proposedCents,
      budgetCents,
      costToDateCents,
      billedCents,
      billingMethods: methods.get(id) ?? [],
      valuation: measureProject({
        status: row.project.status,
        contractCents,
        signedCount,
        proposedCents,
        budgetCents,
        costToDateCents,
        billedCents,
        terms: terms.get(id) ?? null,
      }),
    };
  });
}
