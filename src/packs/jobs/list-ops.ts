import { and, asc, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
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
import { addDays, dateInTimezone } from "@/lib/timezone";
import { COMMITTED_STATUSES, EXPIRING_SOON_DAYS } from "./vocabulary";

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

/**
 * What the CARD view needs on top of a row, for every project at once.
 *
 * ── THREE STATEMENTS FOR THE WHOLE BOARD ────────────────────────────────────
 *
 * The table view needs none of this; the board shows what is coming up on each
 * job and what needs attention, and the obvious way to build it — call
 * `listPhases`, `selectionSummary` and the certificate reads per card — is
 * three queries per project. Sixty jobs would be a hundred and eighty round
 * trips to draw one screen. Each read below is grouped in the database and
 * keyed by project id, the same rule `projectListEntries` follows.
 */
export interface BoardExtras {
  /** The soonest phase that is not done. Past its date is still what is next — it is late. */
  nextItem: { name: string; startOn: string; isMilestone: boolean; late: boolean } | null;
  pendingSelections: number;
  /** Pending and past the date the client was asked for. */
  overdueSelections: number;
  /**
   * Certificates on this job's subcontractors that have expired or are about
   * to. A job's parties are the ones it has actually ORDERED from: a party in
   * the address book with a lapsed certificate is not this job's problem.
   */
  lapsedCertificates: number;
}

export async function boardExtras(
  tx: Tx,
  tenantId: string,
  projectIds: readonly string[],
  timeZone: string,
  today: string,
): Promise<Map<string, BoardExtras>> {
  const out = new Map<string, BoardExtras>();
  for (const id of projectIds) {
    out.set(id, {
      nextItem: null,
      pendingSelections: 0,
      overdueSelections: 0,
      lapsedCertificates: 0,
    });
  }
  if (projectIds.length === 0) return out;

  const soon = addDays(today, EXPIRING_SOON_DAYS);
  const ids = [...projectIds];

  const [phases, selections, certificates] = await Promise.all([
    /*
     * A phase's dates live on the scheduling module's calendar item, never on
     * the phase row (ADR 0071), so the date comes through the join. Ordered
     * soonest first and taken one per project below — one statement rather
     * than a `DISTINCT ON` this query planner would have to be talked into.
     */
    tx
      .select({
        projectId: schema.jobPhases.projectId,
        name: schema.jobPhases.name,
        kind: schema.jobPhases.kind,
        startsAt: schema.scheduleItems.startsAt,
      })
      .from(schema.jobPhases)
      .innerJoin(schema.scheduleItems, eq(schema.scheduleItems.id, schema.jobPhases.itemId))
      .where(
        and(
          eq(schema.jobPhases.tenantId, tenantId),
          inArray(schema.jobPhases.projectId, ids),
          ne(schema.jobPhases.status, "done"),
          isNull(schema.scheduleItems.cancelledAt),
        ),
      )
      .orderBy(asc(schema.scheduleItems.startsAt)),

    tx
      .select({
        projectId: schema.jobSelections.projectId,
        pending: sql<number>`count(*)`.mapWith(Number),
        overdue: sql<number>`count(*) filter (
          where ${schema.jobSelections.neededBy} is not null
            and ${schema.jobSelections.neededBy} < ${today}
        )`.mapWith(Number),
      })
      .from(schema.jobSelections)
      .where(
        and(
          eq(schema.jobSelections.tenantId, tenantId),
          inArray(schema.jobSelections.projectId, ids),
          eq(schema.jobSelections.status, "pending"),
        ),
      )
      .groupBy(schema.jobSelections.projectId),

    /*
     * DISTINCT, because one subcontractor can hold several orders on the same
     * job and a lapsed certificate is one problem, not one per order.
     */
    tx
      .selectDistinct({
        projectId: schema.jobCommitments.projectId,
        documentId: schema.jobPartyDocuments.id,
      })
      .from(schema.jobCommitments)
      .innerJoin(
        schema.jobPartyDocuments,
        and(
          eq(schema.jobPartyDocuments.tenantId, schema.jobCommitments.tenantId),
          eq(schema.jobPartyDocuments.partyId, schema.jobCommitments.partyId),
        ),
      )
      .where(
        and(
          eq(schema.jobCommitments.tenantId, tenantId),
          inArray(schema.jobCommitments.projectId, ids),
          inArray(schema.jobCommitments.status, [...COMMITTED_STATUSES]),
          lte(schema.jobPartyDocuments.expiresOn, soon),
        ),
      ),
  ]);

  for (const row of phases) {
    const entry = out.get(row.projectId);
    // Ordered soonest first, so the first one seen is the next one.
    if (!entry || entry.nextItem) continue;
    const startOn = dateInTimezone(row.startsAt, timeZone);
    entry.nextItem = {
      name: row.name,
      startOn,
      isMilestone: row.kind === "milestone",
      late: startOn < today,
    };
  }
  for (const row of selections) {
    const entry = out.get(row.projectId);
    if (!entry) continue;
    entry.pendingSelections = row.pending;
    entry.overdueSelections = row.overdue;
  }
  for (const row of certificates) {
    const entry = out.get(row.projectId);
    if (!entry) continue;
    entry.lapsedCertificates += 1;
  }
  return out;
}
