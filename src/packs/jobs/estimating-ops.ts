import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobEstimate, JobEstimateLine } from "@/db/schema";
import {
  estimateByCode,
  estimateTotals,
  lineCostCents,
  linePriceCents,
  type EstimateTotals,
  scheduleFromEstimate,
} from "./estimate-math";
import {
  JobsError,
  getProject,
  requireWrite,
  saveSovLines,
  setBudgetLines,
  updateContract,
  type JobsCtx,
} from "./ops";
import { customerForParty } from "@/modules/accounting/invoicing/customers";
import { RATE_PPM_MAX, isEstimateStatus, isProposalPresentation } from "./vocabulary";

/**
 * Estimates — slice 10 of the construction plan, ADR 0069: the front end of
 * every job. An estimate is lines of cost and price on a job; accepted, it
 * names the contract it priced, and from there the pack's other verbs take
 * over — the budget by code, the schedule of values by line, the value on
 * the contract. Nothing here bills, and nothing here is stored that the
 * lines already say.
 *
 * **WRITING ONE IS A CHORE; MAKING IT MONEY IS NOT.** Drafting, pricing and
 * sending are `member` — the estimator is rarely the owner. Accepting one
 * onto a contract, making it the budget or the schedule of values touch
 * signed money and are `owner`, held by the verbs they call.
 */

export interface EstimateLineInput {
  /** Present when editing a line that exists; absent for a new one. */
  id?: string;
  costCodeId?: string | null;
  description: string;
  unit?: string;
  /** In thousandths; 1,000 — one — for a lump sum. */
  quantityThousandths?: number;
  unitCostCents?: number;
  markupPpm?: number | null;
  unitPriceCents?: number | null;
  notes?: string;
}

export interface EstimateInput {
  projectId: string;
  number: string;
  title?: string;
  status?: string;
  sentOn?: string | null;
  decidedOn?: string | null;
  validUntil?: string | null;
  markupPpm?: number;
  overheadPpm?: number;
  profitPpm?: number;
  notes?: string;
  /** The proposal (ADR 0070): how the price is shown, and the client's three texts. */
  presentation?: string;
  scope?: string;
  exclusions?: string;
  terms?: string;
  lines?: EstimateLineInput[];
}

function validateRate(value: number | null | undefined, what: string): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > RATE_PPM_MAX) {
    throw new JobsError("INVALID_VALUE", `${what} must be between 0% and 1,000%`);
  }
}

function validateEstimateShape(input: Partial<EstimateInput>): void {
  if (input.number !== undefined && input.number.trim() === "") {
    throw new JobsError("INVALID_VALUE", "an estimate needs a number");
  }
  if (input.status !== undefined && !isEstimateStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  if (input.presentation !== undefined && !isProposalPresentation(input.presentation)) {
    throw new JobsError("INVALID_VALUE", "a proposal shows its price line by line, by cost code or as one sum");
  }
  validateRate(input.markupPpm, "a markup");
  validateRate(input.overheadPpm, "overhead");
  validateRate(input.profitPpm, "profit");
  for (const line of input.lines ?? []) {
    if (line.description.trim() === "") {
      throw new JobsError("INVALID_VALUE", "an estimate line needs a description");
    }
    const qty = line.quantityThousandths ?? 1000;
    if (!Number.isInteger(qty) || qty < 0) {
      throw new JobsError("INVALID_VALUE", "a quantity cannot be negative");
    }
    const cost = line.unitCostCents ?? 0;
    if (!Number.isInteger(cost) || cost < 0) {
      throw new JobsError("INVALID_VALUE", "a unit cost cannot be negative");
    }
    validateRate(line.markupPpm, "a line's markup");
    const price = line.unitPriceCents ?? null;
    if (price !== null && (!Number.isInteger(price) || price < 0)) {
      throw new JobsError("INVALID_VALUE", "a unit price cannot be negative");
    }
  }
}

async function loadEstimate(tx: Tx, tenantId: string, id: string): Promise<JobEstimate> {
  const rows = await tx
    .select()
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), eq(schema.jobEstimates.id, id)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `estimate ${id} not found`);
  return rows[0];
}

async function linesOf(tx: Tx, tenantId: string, estimateId: string): Promise<JobEstimateLine[]> {
  return tx
    .select()
    .from(schema.jobEstimateLines)
    .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), eq(schema.jobEstimateLines.estimateId, estimateId)))
    .orderBy(asc(schema.jobEstimateLines.sortOrder), asc(schema.jobEstimateLines.createdAt));
}

/**
 * Write an estimate's lines: the ones given, in the order given — updated by
 * id, inserted when new, removed when left out. The schedule of values' rule,
 * so a line keeps its identity across an edit. Nothing points at an estimate
 * line, so nothing holds one.
 */
async function saveLines(tx: Tx, tenantId: string, estimateId: string, lines: EstimateLineInput[]): Promise<void> {
  const existing = await linesOf(tx, tenantId, estimateId);
  const keep = new Set(lines.map((l) => l.id).filter((id): id is string => !!id));
  for (const id of keep) {
    if (!existing.some((e) => e.id === id)) {
      throw new JobsError("NOT_FOUND", `estimate line ${id} is not on this estimate`);
    }
  }
  const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (removed.length > 0) {
    await tx
      .delete(schema.jobEstimateLines)
      .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), inArray(schema.jobEstimateLines.id, removed)));
  }
  for (const [i, l] of lines.entries()) {
    const values = {
      costCodeId: l.costCodeId ?? null,
      description: l.description.trim(),
      unit: l.unit?.trim() ?? "",
      quantityThousandths: l.quantityThousandths ?? 1000,
      unitCostCents: l.unitCostCents ?? 0,
      markupPpm: l.markupPpm ?? null,
      unitPriceCents: l.unitPriceCents ?? null,
      notes: l.notes?.trim() ?? "",
      sortOrder: (i + 1) * 10,
    };
    if (l.id) {
      await tx
        .update(schema.jobEstimateLines)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), eq(schema.jobEstimateLines.id, l.id)));
    } else {
      await tx.insert(schema.jobEstimateLines).values({ tenantId, estimateId, ...values });
    }
  }
}

/** The terms of the newest estimate that has any: a business's terms are mostly boilerplate, so a new estimate starts with them. */
async function lastTerms(tx: Tx, tenantId: string): Promise<string> {
  const rows = await tx
    .select({ terms: schema.jobEstimates.terms })
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), sql`${schema.jobEstimates.terms} <> ''`))
    .orderBy(desc(schema.jobEstimates.createdAt))
    .limit(1);
  return rows[0]?.terms ?? "";
}

export async function createEstimate(tx: Tx, ctx: JobsCtx, input: EstimateInput): Promise<JobEstimate> {
  requireWrite(ctx, "member");
  validateEstimateShape(input);
  const project = await getProject(tx, ctx.tenantId, input.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${input.projectId} not found`);
  const terms = input.terms === undefined ? await lastTerms(tx, ctx.tenantId) : input.terms.trim();
  const rows = await tx
    .insert(schema.jobEstimates)
    .values({
      tenantId: ctx.tenantId,
      projectId: project.id,
      number: input.number.trim(),
      title: input.title?.trim() ?? "",
      status: input.status ?? "draft",
      sentOn: input.sentOn ?? null,
      decidedOn: input.decidedOn ?? null,
      validUntil: input.validUntil ?? null,
      markupPpm: input.markupPpm ?? 0,
      overheadPpm: input.overheadPpm ?? 0,
      profitPpm: input.profitPpm ?? 0,
      notes: input.notes?.trim() ?? "",
      presentation: input.presentation ?? "lines",
      scope: input.scope?.trim() ?? "",
      exclusions: input.exclusions?.trim() ?? "",
      terms,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  if (input.lines && input.lines.length > 0) {
    await saveLines(tx, ctx.tenantId, rows[0].id, input.lines);
  }
  return rows[0];
}

/**
 * Change an estimate: the header, the rates, and the lines when given. **An
 * accepted estimate is fixed** — its lines became a contract's value, a
 * budget or a schedule — so it refuses everything but the notes; revise by
 * making a new one and marking this one superseded.
 */
export async function updateEstimate(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<Omit<EstimateInput, "projectId">> & { version?: number },
): Promise<JobEstimate> {
  requireWrite(ctx, "member");
  validateEstimateShape(input);
  const existing = await loadEstimate(tx, ctx.tenantId, id);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "estimate changed since loaded");
  }
  const status = input.status ?? existing.status;
  if (existing.status === "accepted") {
    // The money, and the proposal's words — they are the agreement. The presentation is a printing choice and stays free.
    const moneyMoves =
      input.lines !== undefined ||
      (input.markupPpm !== undefined && input.markupPpm !== existing.markupPpm) ||
      (input.overheadPpm !== undefined && input.overheadPpm !== existing.overheadPpm) ||
      (input.profitPpm !== undefined && input.profitPpm !== existing.profitPpm) ||
      (input.scope !== undefined && input.scope.trim() !== existing.scope) ||
      (input.exclusions !== undefined && input.exclusions.trim() !== existing.exclusions) ||
      (input.terms !== undefined && input.terms.trim() !== existing.terms);
    if (moneyMoves || (status !== "accepted" && status !== "superseded")) {
      throw new JobsError("ESTIMATE_ACCEPTED", `estimate ${existing.number} was accepted; revise it as a new one`);
    }
  }
  if (input.lines !== undefined) {
    await saveLines(tx, ctx.tenantId, id, input.lines);
  }
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing.version + 1,
    status,
  };
  if (input.number !== undefined) patch.number = input.number.trim();
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.sentOn !== undefined) patch.sentOn = input.sentOn;
  if (input.decidedOn !== undefined) patch.decidedOn = input.decidedOn;
  if (input.validUntil !== undefined) patch.validUntil = input.validUntil;
  if (input.markupPpm !== undefined) patch.markupPpm = input.markupPpm;
  if (input.overheadPpm !== undefined) patch.overheadPpm = input.overheadPpm;
  if (input.profitPpm !== undefined) patch.profitPpm = input.profitPpm;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.presentation !== undefined) patch.presentation = input.presentation;
  if (input.scope !== undefined) patch.scope = input.scope.trim();
  if (input.exclusions !== undefined) patch.exclusions = input.exclusions.trim();
  if (input.terms !== undefined) patch.terms = input.terms.trim();
  const rows = await tx
    .update(schema.jobEstimates)
    .set(patch)
    .where(and(eq(schema.jobEstimates.tenantId, ctx.tenantId), eq(schema.jobEstimates.id, id)))
    .returning();
  return rows[0];
}

export interface EstimateLineRow extends JobEstimateLine {
  codeLabel: string | null;
  /** Quantity at the unit cost, rounded once. */
  costCents: number;
  /** Quantity at the explicit unit price, or the cost marked up by the line's rate or the estimate's. */
  priceCents: number;
}

export interface EstimateCodeRow {
  costCodeId: string | null;
  codeLabel: string | null;
  costCents: number;
  priceCents: number;
}

export interface EstimateRow {
  estimate: JobEstimate;
  lines: EstimateLineRow[];
  totals: EstimateTotals;
  /** Cost and price by cost code, the no-code line last. */
  byCode: EstimateCodeRow[];
  contract: { id: string; kind: string; name: string; status: string } | null;
}

/** Every estimate on a job, newest first, each with its lines and its arithmetic. */
export async function listEstimates(tx: Tx, tenantId: string, projectId: string): Promise<EstimateRow[]> {
  const estimates = await tx
    .select()
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), eq(schema.jobEstimates.projectId, projectId)))
    .orderBy(desc(schema.jobEstimates.createdAt));
  if (estimates.length === 0) return [];
  const ids = estimates.map((e) => e.id);
  const contractIds = [...new Set(estimates.map((e) => e.contractId).filter((x): x is string => !!x))];
  const [lines, codes, contracts] = await Promise.all([
    tx
      .select()
      .from(schema.jobEstimateLines)
      .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), inArray(schema.jobEstimateLines.estimateId, ids)))
      .orderBy(asc(schema.jobEstimateLines.sortOrder), asc(schema.jobEstimateLines.createdAt)),
    tx
      .select({ id: schema.jobCostCodes.id, code: schema.jobCostCodes.code, name: schema.jobCostCodes.name })
      .from(schema.jobCostCodes)
      .where(eq(schema.jobCostCodes.tenantId, tenantId)),
    contractIds.length === 0
      ? Promise.resolve([])
      : tx
          .select({
            id: schema.jobContracts.id,
            kind: schema.jobContracts.kind,
            name: schema.jobContracts.name,
            status: schema.jobContracts.status,
          })
          .from(schema.jobContracts)
          .where(and(eq(schema.jobContracts.tenantId, tenantId), inArray(schema.jobContracts.id, contractIds))),
  ]);
  const codeLabel = new Map(codes.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  return estimates.map((estimate) => {
    const own = lines.filter((l) => l.estimateId === estimate.id);
    const rows: EstimateLineRow[] = own.map((l) => ({
      ...l,
      codeLabel: l.costCodeId ? (codeLabel.get(l.costCodeId) ?? null) : null,
      costCents: lineCostCents(l),
      priceCents: linePriceCents(l, estimate.markupPpm),
    }));
    const byCode: EstimateCodeRow[] = [...estimateByCode(own, estimate.markupPpm).entries()]
      .map(([costCodeId, figures]) => ({
        costCodeId,
        codeLabel: costCodeId ? (codeLabel.get(costCodeId) ?? null) : null,
        ...figures,
      }))
      .sort((a, b) => (a.costCodeId === null ? 1 : b.costCodeId === null ? -1 : (a.codeLabel ?? "").localeCompare(b.codeLabel ?? "")));
    return {
      estimate,
      lines: rows,
      totals: estimateTotals(own, estimate),
      byCode,
      contract: estimate.contractId ? (contractById.get(estimate.contractId) ?? null) : null,
    };
  });
}

/** One estimate with its arithmetic, or null. */
export async function getEstimate(tx: Tx, tenantId: string, id: string): Promise<EstimateRow | null> {
  const rows = await tx
    .select({ projectId: schema.jobEstimates.projectId })
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), eq(schema.jobEstimates.id, id)))
    .limit(1);
  if (rows.length === 0) return null;
  return (await listEstimates(tx, tenantId, rows[0].projectId)).find((r) => r.estimate.id === id) ?? null;
}

export interface ProposalData {
  row: EstimateRow;
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
  /** The client the proposal is made to, and the only postal address the product keeps for them, Accounting's. */
  toName: string;
  toAddress: string;
}

/**
 * What the proposal prints (ADR 0070): the estimate with its arithmetic,
 * the job, and the client — the contract's counterparty when the estimate
 * names a contract, else the job's client party; a party never billed
 * prints as a name alone, the certificate's rule.
 */
export async function proposalData(tx: Tx, tenantId: string, id: string): Promise<ProposalData | null> {
  const row = await getEstimate(tx, tenantId, id);
  if (!row) return null;
  const project = await getProject(tx, tenantId, row.estimate.projectId);
  if (!project) return null;
  let partyId: string | null = project.partyId ?? null;
  if (row.estimate.contractId) {
    const contract = await tx
      .select({ counterpartyPartyId: schema.jobContracts.counterpartyPartyId })
      .from(schema.jobContracts)
      .where(and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, row.estimate.contractId)))
      .limit(1);
    partyId = contract[0]?.counterpartyPartyId ?? partyId;
  }
  let toName = "";
  let toAddress = "";
  if (partyId) {
    const party = await tx
      .select({ name: schema.parties.displayName })
      .from(schema.parties)
      .where(and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, partyId)))
      .limit(1);
    toName = party[0]?.name ?? "";
    toAddress = (await customerForParty(tx, tenantId, partyId))?.address ?? "";
  }
  return { row, project, toName, toAddress };
}

/** The contract an estimate is applied to has to be this job's. */
async function assertContractOnProject(tx: Tx, tenantId: string, contractId: string, projectId: string) {
  const rows = await tx
    .select({ projectId: schema.jobContracts.projectId })
    .from(schema.jobContracts)
    .where(and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, contractId)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `contract ${contractId} not found`);
  if (rows[0].projectId !== projectId) throw new JobsError("WRONG_PROJECT", "the contract named is on another job");
}

/**
 * ACCEPT an estimate onto a contract: the status, the date, the link, and
 * the contract's value set to the estimate's total — through `updateContract`,
 * which refuses a signed value (`VALUE_LOCKED`) as it refuses it from a form.
 * Any other estimate on the job still `sent` is left as it is: two bids may
 * both be out, and only the business knows which the other one was for.
 */
export async function acceptEstimate(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: { contractId: string; decidedOn: string; version?: number },
): Promise<JobEstimate> {
  requireWrite(ctx, "owner");
  const existing = await loadEstimate(tx, ctx.tenantId, id);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "estimate changed since loaded");
  }
  if (existing.status === "accepted") {
    throw new JobsError("ESTIMATE_ACCEPTED", `estimate ${existing.number} was already accepted`);
  }
  await assertContractOnProject(tx, ctx.tenantId, input.contractId, existing.projectId);
  const totals = estimateTotals(await linesOf(tx, ctx.tenantId, id), existing);
  const contract = await tx
    .select({ valueCents: schema.jobContracts.valueCents })
    .from(schema.jobContracts)
    .where(and(eq(schema.jobContracts.tenantId, ctx.tenantId), eq(schema.jobContracts.id, input.contractId)))
    .limit(1);
  if (contract[0].valueCents !== totals.totalCents) {
    await updateContract(tx, ctx, input.contractId, { valueCents: totals.totalCents });
  }
  const rows = await tx
    .update(schema.jobEstimates)
    .set({
      status: "accepted",
      contractId: input.contractId,
      decidedOn: input.decidedOn,
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(and(eq(schema.jobEstimates.tenantId, ctx.tenantId), eq(schema.jobEstimates.id, id)))
    .returning();
  return rows[0];
}

/**
 * MAKE THE ESTIMATE THE BUDGET: its cost by code, written as each code's
 * original through `setBudgetLines` (slice 3's rule: one line per code, the
 * original kept). Cost on lines with no code has nowhere to land and is
 * returned so the page can say so; nothing is written for it.
 */
export async function applyEstimateToBudget(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
): Promise<{ codes: number; budgetCents: number; uncodedCents: number }> {
  requireWrite(ctx, "owner");
  const estimate = await loadEstimate(tx, ctx.tenantId, id);
  const byCode = estimateByCode(await linesOf(tx, ctx.tenantId, id), estimate.markupPpm);
  const lines = [...byCode.entries()]
    .filter((entry): entry is [string, { costCents: number; priceCents: number }] => entry[0] !== null)
    .map(([costCodeId, figures]) => ({ costCodeId, originalCents: figures.costCents }));
  if (lines.length > 0) await setBudgetLines(tx, ctx, estimate.projectId, lines);
  return {
    codes: lines.length,
    budgetCents: lines.reduce((sum, l) => sum + l.originalCents, 0),
    uncodedCents: byCode.get(null)?.costCents ?? 0,
  };
}

/**
 * MAKE THE ESTIMATE THE SCHEDULE OF VALUES on a contract: one schedule line
 * per estimate line at its PRICE with overhead and profit spread across the
 * lines in proportion (`scheduleFromEstimate`), so the schedule totals the
 * estimate's total — the contract sum an accepted estimate set, which is
 * what a G703 requires and what every application is measured against.
 * Each line carries its code; a line sold at an explicit unit price keeps
 * its unit and quantity with the unit price raised by the same share, so a
 * unit-price contract bills by the quantity (ADR 0064). The schedule is
 * replaced, through `saveSovLines`, which refuses to remove a line an
 * application has billed against.
 */
export async function applyEstimateToSchedule(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  contractId: string,
): Promise<{ lines: number; scheduledCents: number }> {
  requireWrite(ctx, "owner");
  const estimate = await loadEstimate(tx, ctx.tenantId, id);
  await assertContractOnProject(tx, ctx.tenantId, contractId, estimate.projectId);
  const lines = await linesOf(tx, ctx.tenantId, id);
  const schedule = scheduleFromEstimate(lines, estimate);
  const saved = await saveSovLines(
    tx,
    ctx,
    contractId,
    lines.map((l, i) => ({
      description: l.description,
      scheduledCents: schedule[i].scheduledCents,
      costCodeId: l.costCodeId,
      unit: l.unit,
      quantityThousandths: schedule[i].quantityThousandths,
      unitPriceCents: schedule[i].unitPriceCents,
    })),
  );
  return { lines: saved.length, scheduledCents: saved.reduce((sum, l) => sum + l.scheduledCents, 0) };
}
