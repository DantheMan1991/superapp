import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobWipLine, JobWipPeriod } from "@/db/schema";
import { isValidIsoDate } from "@/lib/money";
import { getTenantTimezone } from "@/lib/tenant-timezone";
import { todayInTimezone } from "@/lib/timezone";
import {
  listDimensionMembers,
  postEntry,
  voidEntry,
  type EntryLineInput,
  type LedgerCtx,
} from "@/modules/accounting/core";
import { addDaysIso } from "@/modules/accounting/lib/dates";
import {
  JobsError,
  accountByCode,
  actualByProject,
  billedByProject,
  budgetByProject,
  projectValues,
  requireWrite,
  type JobsCtx,
} from "./ops";
import {
  OVERBILLING_ACCOUNT_CODE,
  PROJECT_DIMENSION,
  REVENUE_ACCOUNT_CODES,
  UNDERBILLING_ACCOUNT_CODE,
  VALUED_CONTRACT_STATUSES,
  WIP_ENTRY_SOURCE,
  isCostPlusMethod,
  type WipMethod,
  type WipReason,
} from "./vocabulary";
import { wipFigures, wipTotals, type WipFigures, type WipTotals } from "./wip-math";

/**
 * Work in progress — the schedule, the estimate, and the entry.
 *
 * THE SCHEDULE IS COMPUTED, THE ENTRY IS POSTED, AND THE TWO ARE ONE ACT
 * (ADR 0059). `wipSchedule` reads a company's jobs as of a period end from
 * what the other slices already hold — contract value from slice 1 and 4,
 * the budget from 3, cost and billings from the ledger through the project's
 * cost object — and `postWip` writes the figures down and posts the
 * adjustment through Accounting's own `postEntry`, with a reversal dated the
 * next day. Nothing here reads Accounting's tables; `getBalances`,
 * `postEntry` and `voidEntry` are the whole seam.
 *
 * ── WHICH JOBS ARE ON THE SCHEDULE ──────────────────────────────────────────
 *
 * Every job of the company that is not cancelled and has SOMETHING to say —
 * a contract value, a cost or a billing as of the date. A planned job with a
 * signed design contract is on it; a job with nothing on it is not. A
 * FINISHED job is 100% complete whatever its cost says, and stays on the
 * schedule only until its billings catch up with its value: a completed job
 * fully billed has nothing left to adjust, and a schedule that listed every
 * job ever finished would stop being readable within a year.
 *
 * ── WHAT CAN STOP A PERIOD POSTING ──────────────────────────────────────────
 *
 * A job with no budget and no estimate cannot be measured, and the period
 * refuses by name rather than posting the rest: a schedule missing a job is
 * exactly what a bank would not accept. A job with billings and no fixed
 * contract value — a cost-plus job billed some other way — cannot be measured
 * by this method either, and refuses likewise. A job with no value and no
 * billings (a spec home accumulating cost) is simply shown and left out.
 */

export interface WipRow {
  projectId: string;
  number: string;
  name: string;
  status: string;
  /** The revised budget: what the estimate falls back to. */
  budgetCents: number;
  /** The re-estimate typed for this period, or null when the budget stands. */
  estimateCents: number | null;
  notes: string;
  /** Why the job was, or would be, left out of the entry. Empty when it posts. */
  reason: WipReason;
  /** How earned was measured: the contract at its percent, or cost plus fee. */
  method: WipMethod;
  figures: WipFigures;
}

export interface WipSchedule {
  entityId: string;
  periodEnd: string;
  /** Null until an estimate is saved or the period posts. */
  period: JobWipPeriod | null;
  rows: WipRow[];
  /** Over the rows that post. */
  totals: WipTotals;
  /** Why the period cannot post as it stands; empty when it can. */
  blockers: string[];
  /** Account codes the chart lacks that this period's entry would need. */
  missingAccounts: string[];
}

async function loadPeriod(
  tx: Tx,
  tenantId: string,
  entityId: string,
  periodEnd: string,
): Promise<JobWipPeriod | null> {
  const rows = await tx
    .select()
    .from(schema.jobWipPeriods)
    .where(
      and(
        eq(schema.jobWipPeriods.tenantId, tenantId),
        eq(schema.jobWipPeriods.entityId, entityId),
        eq(schema.jobWipPeriods.periodEnd, periodEnd),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

async function loadPeriodById(tx: Tx, tenantId: string, id: string): Promise<JobWipPeriod> {
  const rows = await tx
    .select()
    .from(schema.jobWipPeriods)
    .where(and(eq(schema.jobWipPeriods.tenantId, tenantId), eq(schema.jobWipPeriods.id, id)))
    .limit(1);
  if (!rows[0]) throw new JobsError("NOT_FOUND", `WIP period ${id} not found`);
  return rows[0];
}

async function loadLines(tx: Tx, tenantId: string, periodId: string): Promise<JobWipLine[]> {
  return tx
    .select()
    .from(schema.jobWipLines)
    .where(and(eq(schema.jobWipLines.tenantId, tenantId), eq(schema.jobWipLines.periodId, periodId)));
}

/** The latest POSTED period of a company, or null. */
export async function latestPostedPeriod(
  tx: Tx,
  tenantId: string,
  entityId: string,
): Promise<JobWipPeriod | null> {
  const rows = await tx
    .select()
    .from(schema.jobWipPeriods)
    .where(
      and(
        eq(schema.jobWipPeriods.tenantId, tenantId),
        eq(schema.jobWipPeriods.entityId, entityId),
        eq(schema.jobWipPeriods.status, "posted"),
      ),
    )
    .orderBy(desc(schema.jobWipPeriods.periodEnd))
    .limit(1);
  return rows[0] ?? null;
}

/** Every period of a company, newest first — the history under the schedule. */
export async function listWipPeriods(
  tx: Tx,
  tenantId: string,
  entityId: string,
): Promise<JobWipPeriod[]> {
  return tx
    .select()
    .from(schema.jobWipPeriods)
    .where(
      and(eq(schema.jobWipPeriods.tenantId, tenantId), eq(schema.jobWipPeriods.entityId, entityId)),
    )
    .orderBy(desc(schema.jobWipPeriods.periodEnd));
}

/**
 * A posted line's figures, AS WRITTEN DOWN. Not recomputed: the percent and
 * the earned figure are the frozen ones, so the schedule a bank was shown
 * reads the same whatever the project's status or the ledger has become.
 */
function frozenFigures(line: JobWipLine): WipFigures {
  const overUnder = line.earnedCents - line.billedCents;
  return {
    contractCents: line.contractCents,
    estimatedCostCents: line.estimatedCostCents,
    costToDateCents: line.costToDateCents,
    billedCents: line.billedCents,
    percentCompletePpm: line.reason === "no_estimate" ? null : line.percentCompletePpm,
    earnedCents: line.earnedCents,
    overUnderCents: overUnder,
    underBilledCents: overUnder > 0 ? overUnder : 0,
    overBilledCents: overUnder < 0 ? -overUnder : 0,
    grossProfitToDateCents: line.earnedCents - line.costToDateCents,
    estimatedGrossProfitCents: line.contractCents - line.estimatedCostCents,
    costToCompleteCents: Math.max(line.estimatedCostCents - line.costToDateCents, 0),
    backlogCents: Math.max(line.contractCents - line.earnedCents, 0),
  };
}

function reasonFor(contractCents: number, figures: WipFigures, method: WipMethod): WipReason {
  // A cost-plus job earns what it has spent plus its fee: no value to compare
  // against and no estimate needed.
  if (method === "cost_plus") return "";
  if (contractCents <= 0) return "no_value";
  if (figures.percentCompletePpm === null) return "no_estimate";
  return "";
}

/**
 * THE COST-PLUS TERMS OF A JOB, when it has exactly ONE counted contract and
 * that contract bills cost plus a fee. Cost belongs to the project, so a job
 * mixing methods or carrying two cost-plus agreements cannot be measured this
 * way and falls through to the fixed-value rule — which leaves it out with
 * `no_value` and says so.
 */
async function costPlusTermsByProject(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, { feePpm: number | null; feeCents: number | null; gmaxCents: number | null }>> {
  const rows = await tx
    .select({
      projectId: schema.jobContracts.projectId,
      billingMethod: schema.jobContracts.billingMethod,
      feePpm: schema.jobContracts.feePpm,
      feeCents: schema.jobContracts.feeCents,
      gmaxCents: schema.jobContracts.gmaxCents,
    })
    .from(schema.jobContracts)
    .where(
      and(
        eq(schema.jobContracts.tenantId, tenantId),
        inArray(schema.jobContracts.status, [...VALUED_CONTRACT_STATUSES]),
      ),
    );
  const byProject = new Map<string, typeof rows>();
  for (const r of rows) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  const out = new Map<string, { feePpm: number | null; feeCents: number | null; gmaxCents: number | null }>();
  for (const [projectId, contracts] of byProject) {
    if (contracts.length === 1 && isCostPlusMethod(contracts[0].billingMethod)) {
      const c = contracts[0];
      out.set(projectId, { feePpm: c.feePpm, feeCents: c.feeCents, gmaxCents: c.gmaxCents });
    }
  }
  return out;
}

function blockersOf(rows: WipRow[]): string[] {
  return [
    ...rows
      .filter((r) => r.reason === "no_estimate")
      .map((r) => `${r.number} has no budget and no estimate`),
    ...rows
      .filter((r) => r.reason === "no_value" && r.figures.billedCents > 0)
      .map((r) => `${r.number} has billings but no fixed contract value`),
  ];
}

/** Which of the accounts this schedule's entry would need are missing from the chart. */
async function missingAccountsFor(tx: Tx, tenantId: string, rows: WipRow[]): Promise<string[]> {
  const posting = rows.filter((r) => r.reason === "");
  const missing: string[] = [];
  if (posting.some((r) => r.figures.overUnderCents !== 0)) {
    if (!(await accountByCode(tx, tenantId, REVENUE_ACCOUNT_CODES))) {
      missing.push(REVENUE_ACCOUNT_CODES[0]);
    }
  }
  if (posting.some((r) => r.figures.underBilledCents > 0)) {
    if (!(await accountByCode(tx, tenantId, [UNDERBILLING_ACCOUNT_CODE]))) {
      missing.push(UNDERBILLING_ACCOUNT_CODE);
    }
  }
  if (posting.some((r) => r.figures.overBilledCents > 0)) {
    if (!(await accountByCode(tx, tenantId, [OVERBILLING_ACCOUNT_CODE]))) {
      missing.push(OVERBILLING_ACCOUNT_CODE);
    }
  }
  return missing;
}

/**
 * The schedule for one company as of a period end: live while the period is
 * a draft (or does not exist yet), frozen once it has posted.
 */
export async function wipSchedule(
  tx: Tx,
  tenantId: string,
  args: { entityId: string; periodEnd: string },
): Promise<WipSchedule> {
  const { entityId, periodEnd } = args;
  const period = await loadPeriod(tx, tenantId, entityId, periodEnd);
  const projects = await tx
    .select()
    .from(schema.jobProjects)
    .where(and(eq(schema.jobProjects.tenantId, tenantId), eq(schema.jobProjects.entityId, entityId)))
    .orderBy(asc(schema.jobProjects.number));
  const projectById = new Map(projects.map((p) => [p.id, p]));

  if (period && period.status === "posted") {
    const lines = await loadLines(tx, tenantId, period.id);
    const rows: WipRow[] = [];
    for (const line of lines) {
      const p = projectById.get(line.projectId);
      if (!p) continue;
      rows.push({
        projectId: p.id,
        number: p.number,
        name: p.name,
        status: p.status,
        budgetCents: line.estimateCents === null ? line.estimatedCostCents : 0,
        estimateCents: line.estimateCents,
        notes: line.notes,
        reason: line.reason as WipReason,
        method: line.method as WipMethod,
        figures: frozenFigures(line),
      });
    }
    rows.sort((a, b) => a.number.localeCompare(b.number));
    return {
      entityId,
      periodEnd,
      period,
      rows,
      totals: wipTotals(rows.filter((r) => r.reason === "").map((r) => r.figures)),
      blockers: [],
      missingAccounts: [],
    };
  }

  const scope = { kind: "one", entityId } as const;
  const [values, budgets, actual, billed, costPlusTerms] = await Promise.all([
    projectValues(tx, tenantId),
    budgetByProject(tx, tenantId),
    actualByProject(tx, tenantId, scope, periodEnd),
    billedByProject(tx, tenantId, scope, periodEnd),
    costPlusTermsByProject(tx, tenantId),
  ]);
  const overrides = period ? await loadLines(tx, tenantId, period.id) : [];
  const overrideOf = new Map(overrides.map((l) => [l.projectId, l]));

  const rows: WipRow[] = [];
  for (const p of projects) {
    if (p.status === "cancelled") continue;
    const contractCents = values.get(p.id)?.valueCents ?? 0;
    const costToDateCents = actual.get(p.id) ?? 0;
    const billedCents = billed.get(p.id) ?? 0;
    if (contractCents === 0 && costToDateCents === 0 && billedCents === 0) continue;
    const override = overrideOf.get(p.id);
    const budgetCents = budgets.get(p.id) ?? 0;
    const estimateCents = override?.estimateCents ?? null;
    const terms = costPlusTerms.get(p.id);
    const method: WipMethod = terms ? "cost_plus" : "cost_to_cost";
    const figures = wipFigures({
      contractCents,
      estimatedCostCents: estimateCents ?? budgetCents,
      costToDateCents,
      billedCents,
      complete: p.status === "complete",
      costPlus: terms,
    });
    if (p.status === "complete" && figures.overUnderCents === 0) continue;
    rows.push({
      projectId: p.id,
      number: p.number,
      name: p.name,
      status: p.status,
      budgetCents,
      estimateCents,
      notes: override?.notes ?? "",
      reason: reasonFor(contractCents, figures, method),
      method,
      figures,
    });
  }

  return {
    entityId,
    periodEnd,
    period,
    rows,
    totals: wipTotals(rows.filter((r) => r.reason === "").map((r) => r.figures)),
    blockers: blockersOf(rows),
    missingAccounts: await missingAccountsFor(tx, tenantId, rows),
  };
}

async function ensureDraftPeriod(
  tx: Tx,
  ctx: JobsCtx,
  entityId: string,
  periodEnd: string,
): Promise<JobWipPeriod> {
  const existing = await loadPeriod(tx, ctx.tenantId, entityId, periodEnd);
  if (existing) {
    if (existing.status !== "draft") {
      throw new JobsError("INVALID_STATUS", "a posted period's figures are frozen");
    }
    return existing;
  }
  const entity = await tx.query.entities.findFirst({
    where: and(eq(schema.entities.tenantId, ctx.tenantId), eq(schema.entities.id, entityId)),
    columns: { id: true },
  });
  if (!entity) throw new JobsError("NOT_FOUND", `company ${entityId} not found`);
  const rows = await tx
    .insert(schema.jobWipPeriods)
    .values({
      tenantId: ctx.tenantId,
      entityId,
      periodEnd,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

/**
 * THE ONE HUMAN INPUT: what this job is now expected to cost in total. Null
 * puts the revised budget back. Owner-only, because a re-estimate moves
 * earned revenue, and only while the period is a draft.
 */
export async function saveWipEstimate(
  tx: Tx,
  ctx: JobsCtx,
  input: {
    entityId: string;
    periodEnd: string;
    projectId: string;
    estimateCents: number | null;
    notes?: string;
  },
): Promise<JobWipLine> {
  requireWrite(ctx, "owner");
  if (!isValidIsoDate(input.periodEnd)) {
    throw new JobsError("INVALID_VALUE", "a period end must be a date");
  }
  if (
    input.estimateCents !== null &&
    (!Number.isInteger(input.estimateCents) || input.estimateCents < 0)
  ) {
    throw new JobsError("INVALID_VALUE", "an estimate cannot be negative");
  }
  const project = await tx.query.jobProjects.findFirst({
    where: and(
      eq(schema.jobProjects.tenantId, ctx.tenantId),
      eq(schema.jobProjects.id, input.projectId),
      eq(schema.jobProjects.entityId, input.entityId),
    ),
    columns: { id: true },
  });
  if (!project) throw new JobsError("NOT_FOUND", `project ${input.projectId} not found`);

  const period = await ensureDraftPeriod(tx, ctx, input.entityId, input.periodEnd);
  const existing = (await loadLines(tx, ctx.tenantId, period.id)).find(
    (l) => l.projectId === project.id,
  );
  if (existing) {
    const rows = await tx
      .update(schema.jobWipLines)
      .set({
        estimateCents: input.estimateCents,
        notes: input.notes ?? existing.notes,
        updatedAt: new Date(),
      })
      .where(eq(schema.jobWipLines.id, existing.id))
      .returning();
    return rows[0];
  }
  const rows = await tx
    .insert(schema.jobWipLines)
    .values({
      tenantId: ctx.tenantId,
      periodId: period.id,
      projectId: project.id,
      estimateCents: input.estimateCents,
      notes: input.notes ?? "",
    })
    .returning();
  return rows[0];
}

/**
 * POST THE PERIOD: write every job's figures down and post the adjustment —
 * one pair of lines per job, tagged with the job — dated the period end,
 * and its reversal dated the next day. Owner-only.
 *
 * FORWARD ONLY. A period must come after the company's latest posted one,
 * because the reversal arrangement depends on it: a period posted BEHIND a
 * later one would have its reversal dated inside a window the later period
 * already measured. Unpost the later one first, the way a close is reopened
 * latest-first.
 */
export async function postWip(
  tx: Tx,
  ctx: JobsCtx,
  input: { entityId: string; periodEnd: string; version?: number },
): Promise<{ period: JobWipPeriod; entryId: string; reversalEntryId: string }> {
  requireWrite(ctx, "owner");
  if (!isValidIsoDate(input.periodEnd)) {
    throw new JobsError("INVALID_VALUE", "a period end must be a date");
  }
  const schedule = await wipSchedule(tx, ctx.tenantId, input);
  if (schedule.period?.status === "posted") {
    throw new JobsError("INVALID_STATUS", "this period has already posted");
  }
  if (
    input.version !== undefined &&
    schedule.period &&
    input.version !== schedule.period.version
  ) {
    throw new JobsError("STALE_VERSION", "period changed since loaded");
  }
  const latest = await latestPostedPeriod(tx, ctx.tenantId, input.entityId);
  if (latest && latest.periodEnd >= input.periodEnd) {
    throw new JobsError("NOT_FORWARD", latest.periodEnd);
  }
  const unmeasured = schedule.rows.filter((r) => r.reason === "no_estimate");
  if (unmeasured.length > 0) {
    throw new JobsError("ESTIMATE_REQUIRED", unmeasured.map((r) => r.number).join(", "));
  }
  const billedNoValue = schedule.rows.filter(
    (r) => r.reason === "no_value" && r.figures.billedCents > 0,
  );
  if (billedNoValue.length > 0) {
    throw new JobsError("BILLED_NO_VALUE", billedNoValue.map((r) => r.number).join(", "));
  }
  const posting = schedule.rows.filter((r) => r.reason === "" && r.figures.overUnderCents !== 0);
  if (posting.length === 0) {
    throw new JobsError("NOTHING_TO_POST", "billings equal earned revenue on every job");
  }

  const revenueAccountId = await accountByCode(tx, ctx.tenantId, REVENUE_ACCOUNT_CODES);
  if (!revenueAccountId) {
    throw new JobsError(
      "ACCOUNT_MISSING",
      `the chart has no ${REVENUE_ACCOUNT_CODES.join(" or ")} account to recognise revenue in`,
    );
  }
  let underAccountId: string | null = null;
  if (posting.some((r) => r.figures.underBilledCents > 0)) {
    underAccountId = await accountByCode(tx, ctx.tenantId, [UNDERBILLING_ACCOUNT_CODE]);
    if (!underAccountId) {
      throw new JobsError(
        "ACCOUNT_MISSING",
        `the chart has no ${UNDERBILLING_ACCOUNT_CODE} Costs in Excess of Billings account`,
      );
    }
  }
  let overAccountId: string | null = null;
  if (posting.some((r) => r.figures.overBilledCents > 0)) {
    overAccountId = await accountByCode(tx, ctx.tenantId, [OVERBILLING_ACCOUNT_CODE]);
    if (!overAccountId) {
      throw new JobsError(
        "ACCOUNT_MISSING",
        `the chart has no ${OVERBILLING_ACCOUNT_CODE} Billings in Excess of Costs account`,
      );
    }
  }

  // Every line carries the job, so a P&L by job reads earned revenue at the
  // period end. An archived member is simply not tagged — posting must not
  // fail on a tag, the rule billing set.
  const members = await listDimensionMembers(tx, ctx.tenantId, PROJECT_DIMENSION);
  const memberOf = new Map(members.filter((m) => m.isActive).map((m) => [m.packEntityId, m.id]));

  const lines: EntryLineInput[] = [];
  for (const row of posting) {
    const memo = `${row.number} · ${row.name}`;
    const member = memberOf.get(row.projectId);
    const dimensionMemberIds = member ? [member] : undefined;
    if (row.figures.underBilledCents > 0) {
      // Work done and not yet billed: Dr the asset, Cr revenue.
      lines.push(
        { accountId: underAccountId!, amountCents: row.figures.underBilledCents, memo, dimensionMemberIds },
        { accountId: revenueAccountId, amountCents: -row.figures.underBilledCents, memo, dimensionMemberIds },
      );
    } else {
      // Billed ahead of the work: Dr revenue, Cr the liability.
      lines.push(
        { accountId: revenueAccountId, amountCents: row.figures.overBilledCents, memo, dimensionMemberIds },
        { accountId: overAccountId!, amountCents: -row.figures.overBilledCents, memo, dimensionMemberIds },
      );
    }
  }

  const period = schedule.period ?? (await ensureDraftPeriod(tx, ctx, input.entityId, input.periodEnd));
  const entity = await tx.query.entities.findFirst({
    where: and(eq(schema.entities.tenantId, ctx.tenantId), eq(schema.entities.id, input.entityId)),
    columns: { name: true },
  });
  const ledger: LedgerCtx = { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
  const { entry } = await postEntry(tx, ledger, {
    entityId: input.entityId,
    status: "posted",
    entryDate: input.periodEnd,
    memo: `Work in progress through ${input.periodEnd} — ${entity?.name ?? "the company"}`,
    source: WIP_ENTRY_SOURCE,
    sourceId: period.id,
    // The version is part of the key: a period unposted and posted again is a
    // NEW pair, and the voided pair's key must not answer for it.
    idempotencyKey: `wip:${period.id}:${period.version}`,
    lines,
  });
  const { entry: reversal } = await postEntry(tx, ledger, {
    entityId: input.entityId,
    status: "posted",
    entryDate: addDaysIso(input.periodEnd, 1),
    memo: `Reversal of the work-in-progress adjustment through ${input.periodEnd}`,
    source: WIP_ENTRY_SOURCE,
    sourceId: period.id,
    reversesEntryId: entry.id,
    idempotencyKey: `wip-reversal:${period.id}:${period.version}`,
    lines: lines.map((l) => ({ ...l, amountCents: -l.amountCents })),
  });

  // Freeze what the schedule said, every job on it, the skipped ones included.
  const existing = new Map((await loadLines(tx, ctx.tenantId, period.id)).map((l) => [l.projectId, l]));
  for (const row of schedule.rows) {
    const frozen = {
      reason: row.reason,
      method: row.method,
      contractCents: row.figures.contractCents,
      estimatedCostCents: row.figures.estimatedCostCents,
      costToDateCents: row.figures.costToDateCents,
      billedCents: row.figures.billedCents,
      percentCompletePpm: row.figures.percentCompletePpm ?? 0,
      earnedCents: row.figures.earnedCents,
      updatedAt: new Date(),
    };
    const line = existing.get(row.projectId);
    if (line) {
      await tx.update(schema.jobWipLines).set(frozen).where(eq(schema.jobWipLines.id, line.id));
    } else {
      await tx.insert(schema.jobWipLines).values({
        tenantId: ctx.tenantId,
        periodId: period.id,
        projectId: row.projectId,
        estimateCents: row.estimateCents,
        notes: row.notes,
        ...frozen,
      });
    }
  }

  const today = todayInTimezone(await getTenantTimezone(tx, ctx.tenantId));
  const rows = await tx
    .update(schema.jobWipPeriods)
    .set({
      status: "posted",
      entryId: entry.id,
      reversalEntryId: reversal.id,
      postedOn: today,
      postedByClerkUserId: ctx.userId,
      version: period.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobWipPeriods.tenantId, ctx.tenantId), eq(schema.jobWipPeriods.id, period.id)))
    .returning();
  return { period: rows[0], entryId: entry.id, reversalEntryId: reversal.id };
}

/**
 * UNPOST: void both entries through Accounting (which refuses a closed
 * period or a reconciled line, in its own words) and put the period back to
 * a draft with its estimates kept and its frozen figures cleared. Only the
 * LATEST posted period of the company, for the reason `postWip` is forward
 * only.
 */
export async function unpostWip(
  tx: Tx,
  ctx: JobsCtx,
  periodId: string,
  input: { version?: number } = {},
): Promise<JobWipPeriod> {
  requireWrite(ctx, "owner");
  const period = await loadPeriodById(tx, ctx.tenantId, periodId);
  if (period.status !== "posted" || !period.entryId) {
    throw new JobsError("INVALID_STATUS", "only a posted period can be unposted");
  }
  if (input.version !== undefined && input.version !== period.version) {
    throw new JobsError("STALE_VERSION", "period changed since loaded");
  }
  const latest = await latestPostedPeriod(tx, ctx.tenantId, period.entityId);
  if (latest && latest.id !== period.id) {
    throw new JobsError("NOT_LATEST_PERIOD", latest.periodEnd);
  }

  const ledger: LedgerCtx = { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role };
  for (const entryId of [period.reversalEntryId, period.entryId]) {
    if (!entryId) continue;
    const entry = await tx.query.journalEntries.findFirst({
      where: and(eq(schema.journalEntries.tenantId, ctx.tenantId), eq(schema.journalEntries.id, entryId)),
      columns: { id: true, status: true, version: true },
    });
    if (!entry || entry.status !== "posted") continue;
    await voidEntry(tx, ledger, { entryId: entry.id, expectedVersion: entry.version });
  }

  await tx
    .update(schema.jobWipLines)
    .set({
      reason: "",
      method: "cost_to_cost",
      contractCents: 0,
      estimatedCostCents: 0,
      costToDateCents: 0,
      billedCents: 0,
      percentCompletePpm: 0,
      earnedCents: 0,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobWipLines.tenantId, ctx.tenantId), eq(schema.jobWipLines.periodId, period.id)));
  const rows = await tx
    .update(schema.jobWipPeriods)
    .set({
      status: "draft",
      entryId: null,
      reversalEntryId: null,
      postedOn: null,
      postedByClerkUserId: null,
      version: period.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobWipPeriods.tenantId, ctx.tenantId), eq(schema.jobWipPeriods.id, period.id)))
    .returning();
  return rows[0];
}
