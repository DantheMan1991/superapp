import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobChangeOrder, JobSelection, JobSelectionChoice } from "@/db/schema";
import { attachmentCounts } from "@/modules/documents/attachments";
import {
  createWorkForEntity,
  listWorkForEntity,
  type EntityWorkRow,
} from "@/lib/work/entity-work";
import { unitLineCents } from "./billing-math";
import { JobsError, createChangeOrder, getProject, requireWrite, type JobsCtx } from "./ops";
import {
  CHOSEN_SELECTION_STATUSES,
  PACK,
  SELECTION_ENTITY,
  isSelectionStatus,
} from "./vocabulary";

/**
 * Selections and allowances — slice 8 of the construction plan, ADR 0067.
 *
 * A SELECTION is a decision the client owes: a room, a name, what the
 * contract set aside for it (the allowance), when it is needed by, and its
 * CHOICES — what is on offer, each priced, one of them chosen. A production
 * builder's option book and a custom builder's showroom samples are the same
 * two rows. The difference between the chosen price and the allowance is
 * computed wherever it is shown and never stored; once the builder has
 * approved the choice it is raised as a CHANGE ORDER on the selection's
 * contract, through slice 4's own verb, and the selection remembers which.
 *
 * **EVERYTHING HERE IS A CHORE — `member`, not `owner` — EXCEPT THE MONEY.**
 * Drawing up the list, listing the samples and recording what the client
 * chose is the office's work, as the daily log is. Raising the difference is
 * a change to a signed contract's value, and `createChangeOrder` holds the
 * owner gate for that.
 */

export interface SelectionChoiceInput {
  /** Present when editing a choice that exists; absent for a new one. */
  id?: string;
  description: string;
  partyId?: string | null;
  reference?: string;
  unit?: string;
  quantityThousandths?: number | null;
  unitPriceCents?: number | null;
  /** The extended price; ignored when priced by the unit, whose value is quantity × price. */
  priceCents: number;
  isSelected?: boolean;
  notes?: string;
}

export interface SelectionInput {
  projectId: string;
  contractId?: string | null;
  costCodeId?: string | null;
  /** The accepted estimate's item this came from (X12); absent for a hand-written one. */
  estimateGroupId?: string | null;
  name: string;
  location?: string;
  description?: string;
  allowanceCents?: number;
  neededBy?: string | null;
  status?: string;
  decidedOn?: string | null;
  notes?: string;
  choices?: SelectionChoiceInput[];
}

function validateSelectionShape(input: Partial<SelectionInput>): void {
  if (input.name !== undefined && input.name.trim() === "") {
    throw new JobsError("INVALID_VALUE", "a selection needs a name");
  }
  if (input.status !== undefined && !isSelectionStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  if (
    input.allowanceCents !== undefined &&
    (!Number.isInteger(input.allowanceCents) || input.allowanceCents < 0)
  ) {
    throw new JobsError("INVALID_VALUE", "an allowance cannot be negative");
  }
  let chosen = 0;
  for (const c of input.choices ?? []) {
    if (c.description.trim() === "") {
      throw new JobsError("INVALID_VALUE", "a choice needs a description");
    }
    if (!Number.isInteger(c.priceCents) || c.priceCents < 0) {
      throw new JobsError("INVALID_VALUE", "a choice's price cannot be negative");
    }
    const qty = c.quantityThousandths ?? null;
    const price = c.unitPriceCents ?? null;
    if ((qty === null) !== (price === null)) {
      throw new JobsError("INVALID_VALUE", "a choice priced by the unit needs both a quantity and a price per unit");
    }
    if (qty !== null && (!Number.isInteger(qty) || qty < 0)) {
      throw new JobsError("INVALID_VALUE", "a quantity cannot be negative");
    }
    if (price !== null && (!Number.isInteger(price) || price < 0)) {
      throw new JobsError("INVALID_VALUE", "a unit price cannot be negative");
    }
    if (c.isSelected) chosen += 1;
  }
  if (chosen > 1) {
    throw new JobsError("INVALID_VALUE", "one choice is chosen, not two");
  }
}

/** The contract an allowance sits in has to be this job's. */
async function assertSelectionLinks(
  tx: Tx,
  tenantId: string,
  projectId: string,
  contractId: string | null,
): Promise<void> {
  if (!contractId) return;
  const rows = await tx
    .select({ projectId: schema.jobContracts.projectId })
    .from(schema.jobContracts)
    .where(and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, contractId)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `contract ${contractId} not found`);
  if (rows[0].projectId !== projectId) {
    throw new JobsError("WRONG_PROJECT", "the contract named is on another job");
  }
}

/** A choice's extended price: quantity at the unit price when priced by the unit, else as typed. */
function choicePrice(c: SelectionChoiceInput): number {
  const qty = c.quantityThousandths ?? null;
  const price = c.unitPriceCents ?? null;
  return qty !== null && price !== null ? unitLineCents(qty, price) : c.priceCents;
}

async function loadSelection(tx: Tx, tenantId: string, id: string): Promise<JobSelection> {
  const rows = await tx
    .select()
    .from(schema.jobSelections)
    .where(and(eq(schema.jobSelections.tenantId, tenantId), eq(schema.jobSelections.id, id)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `selection ${id} not found`);
  return rows[0];
}

/** One selection, or null: the page's loader and the photo actions' check. */
export async function getSelection(tx: Tx, tenantId: string, id: string): Promise<JobSelection | null> {
  const rows = await tx
    .select()
    .from(schema.jobSelections)
    .where(and(eq(schema.jobSelections.tenantId, tenantId), eq(schema.jobSelections.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

async function choicesOf(tx: Tx, tenantId: string, selectionId: string): Promise<JobSelectionChoice[]> {
  return tx
    .select()
    .from(schema.jobSelectionChoices)
    .where(
      and(
        eq(schema.jobSelectionChoices.tenantId, tenantId),
        eq(schema.jobSelectionChoices.selectionId, selectionId),
      ),
    )
    .orderBy(asc(schema.jobSelectionChoices.sortOrder), asc(schema.jobSelectionChoices.createdAt));
}

/**
 * Write a selection's choices: the ones given, in the order given. A choice
 * with an id is updated in place, a new one inserted, one left out removed —
 * the schedule of values' rule, so a chosen choice keeps its identity across
 * an edit. Nothing else points at a choice, so nothing holds one.
 */
async function saveChoices(
  tx: Tx,
  tenantId: string,
  selectionId: string,
  choices: SelectionChoiceInput[],
): Promise<void> {
  const existing = await choicesOf(tx, tenantId, selectionId);
  const keep = new Set(choices.map((c) => c.id).filter((id): id is string => !!id));
  for (const id of keep) {
    if (!existing.some((e) => e.id === id)) {
      throw new JobsError("NOT_FOUND", `choice ${id} is not on this selection`);
    }
  }
  const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (removed.length > 0) {
    await tx
      .delete(schema.jobSelectionChoices)
      .where(and(eq(schema.jobSelectionChoices.tenantId, tenantId), inArray(schema.jobSelectionChoices.id, removed)));
  }
  // Clear every chosen flag first, so the partial unique index cannot trip on
  // the order the rows are written in.
  await tx
    .update(schema.jobSelectionChoices)
    .set({ isSelected: false })
    .where(
      and(
        eq(schema.jobSelectionChoices.tenantId, tenantId),
        eq(schema.jobSelectionChoices.selectionId, selectionId),
      ),
    );
  for (const [i, c] of choices.entries()) {
    const values = {
      partyId: c.partyId ?? null,
      description: c.description.trim(),
      reference: c.reference?.trim() ?? "",
      unit: c.unit?.trim() ?? "",
      quantityThousandths: c.quantityThousandths ?? null,
      unitPriceCents: c.unitPriceCents ?? null,
      priceCents: choicePrice(c),
      isSelected: c.isSelected ?? false,
      notes: c.notes?.trim() ?? "",
      sortOrder: (i + 1) * 10,
    };
    if (c.id) {
      await tx
        .update(schema.jobSelectionChoices)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(schema.jobSelectionChoices.tenantId, tenantId), eq(schema.jobSelectionChoices.id, c.id)));
    } else {
      await tx.insert(schema.jobSelectionChoices).values({ tenantId, selectionId, ...values });
    }
  }
}

/** A selected or approved selection has a chosen choice; the verb says so before the page has to. */
function assertChosenFor(status: string, choices: readonly { isSelected?: boolean }[]): void {
  if (
    (CHOSEN_SELECTION_STATUSES as readonly string[]).includes(status) &&
    !choices.some((c) => c.isSelected)
  ) {
    throw new JobsError("INVALID_VALUE", "mark the choice the client made before calling the selection selected");
  }
}

export async function createSelection(
  tx: Tx,
  ctx: JobsCtx,
  input: SelectionInput,
): Promise<JobSelection> {
  requireWrite(ctx, "member");
  validateSelectionShape(input);
  if (input.name.trim() === "") throw new JobsError("INVALID_VALUE", "a selection needs a name");
  const project = await getProject(tx, ctx.tenantId, input.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${input.projectId} not found`);
  const contractId = input.contractId ?? null;
  await assertSelectionLinks(tx, ctx.tenantId, project.id, contractId);
  const status = input.status ?? "pending";
  assertChosenFor(status, input.choices ?? []);
  const last = await tx
    .select({ sortOrder: schema.jobSelections.sortOrder })
    .from(schema.jobSelections)
    .where(and(eq(schema.jobSelections.tenantId, ctx.tenantId), eq(schema.jobSelections.projectId, project.id)))
    .orderBy(asc(schema.jobSelections.sortOrder))
    .limit(1000);
  const sortOrder = last.reduce((max, r) => Math.max(max, r.sortOrder), 0) + 10;
  const rows = await tx
    .insert(schema.jobSelections)
    .values({
      tenantId: ctx.tenantId,
      projectId: project.id,
      contractId,
      costCodeId: input.costCodeId ?? null,
      estimateGroupId: input.estimateGroupId ?? null,
      name: input.name.trim(),
      location: input.location?.trim() ?? "",
      description: input.description?.trim() ?? "",
      allowanceCents: input.allowanceCents ?? 0,
      neededBy: input.neededBy ?? null,
      status,
      decidedOn: input.decidedOn ?? null,
      notes: input.notes?.trim() ?? "",
      sortOrder,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  if (input.choices && input.choices.length > 0) {
    await saveChoices(tx, ctx.tenantId, rows[0].id, input.choices);
  }
  return rows[0];
}

/** Whether the change order raised for a selection still stands: raised and not void. */
async function standingChangeOrder(tx: Tx, tenantId: string, changeOrderId: string | null): Promise<JobChangeOrder | null> {
  if (!changeOrderId) return null;
  const rows = await tx
    .select()
    .from(schema.jobChangeOrders)
    .where(and(eq(schema.jobChangeOrders.tenantId, tenantId), eq(schema.jobChangeOrders.id, changeOrderId)))
    .limit(1);
  const co = rows[0];
  return co && co.status !== "void" ? co : null;
}

/**
 * Change a selection: everything but the job it is on. **Once the difference
 * has been raised as a change order that still stands, the money is fixed** —
 * the allowance and the choices — because the change order was priced from
 * them; the words, the dates and the status still move. Void the change
 * order to re-price.
 */
export async function updateSelection(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<Omit<SelectionInput, "projectId">> & { version?: number },
): Promise<JobSelection> {
  requireWrite(ctx, "member");
  validateSelectionShape(input);
  const existing = await loadSelection(tx, ctx.tenantId, id);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "selection changed since loaded");
  }
  const contractId = input.contractId !== undefined ? input.contractId : existing.contractId;
  await assertSelectionLinks(tx, ctx.tenantId, existing.projectId, contractId);
  const raised = await standingChangeOrder(tx, ctx.tenantId, existing.changeOrderId);
  if (raised) {
    const allowanceMoves = input.allowanceCents !== undefined && input.allowanceCents !== existing.allowanceCents;
    if (allowanceMoves || input.choices !== undefined) {
      throw new JobsError(
        "SELECTION_RAISED",
        `the difference was raised as change order ${raised.number}; void it to re-price`,
      );
    }
  }
  const status = input.status ?? existing.status;
  if (input.choices !== undefined) {
    await saveChoices(tx, ctx.tenantId, id, input.choices);
  }
  assertChosenFor(status, await choicesOf(tx, ctx.tenantId, id));
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing.version + 1,
    status,
    contractId,
  };
  if (input.costCodeId !== undefined) patch.costCodeId = input.costCodeId;
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.location !== undefined) patch.location = input.location.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.allowanceCents !== undefined) patch.allowanceCents = input.allowanceCents;
  if (input.neededBy !== undefined) patch.neededBy = input.neededBy;
  if (input.decidedOn !== undefined) patch.decidedOn = input.decidedOn;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  const rows = await tx
    .update(schema.jobSelections)
    .set(patch)
    .where(and(eq(schema.jobSelections.tenantId, ctx.tenantId), eq(schema.jobSelections.id, id)))
    .returning();
  return rows[0];
}

export interface SelectionRow {
  selection: JobSelection;
  contract: { id: string; kind: string; name: string } | null;
  codeLabel: string | null;
  choices: JobSelectionChoice[];
  /** The chosen choice, or null while the client still owes the decision. */
  chosen: JobSelectionChoice | null;
  /** Chosen price less allowance, when the status counts it; null otherwise. Negative is an underage. */
  differenceCents: number | null;
  /** The change order raised for the difference, if it stands. */
  changeOrder: { id: string; number: string; status: string; valueCents: number } | null;
  /** Pending, and needed by a date that has passed. */
  overdue: boolean;
  /** Samples and spec sheets attached through Documents. */
  attachmentCount: number;
}

/**
 * Every selection on a job, in the order they were drawn up, each with its
 * choices, the contract its allowance sits in, the difference, and the change
 * order raised for it.
 */
export async function listSelections(
  tx: Tx,
  tenantId: string,
  projectId: string,
  /** Today, for what counts as overdue. */
  asOf: string,
): Promise<SelectionRow[]> {
  const selections = await tx
    .select()
    .from(schema.jobSelections)
    .where(and(eq(schema.jobSelections.tenantId, tenantId), eq(schema.jobSelections.projectId, projectId)))
    .orderBy(asc(schema.jobSelections.sortOrder), asc(schema.jobSelections.createdAt));
  if (selections.length === 0) return [];
  const ids = selections.map((s) => s.id);
  const contractIds = [...new Set(selections.map((s) => s.contractId).filter((x): x is string => !!x))];
  const codeIds = [...new Set(selections.map((s) => s.costCodeId).filter((x): x is string => !!x))];
  const coIds = [...new Set(selections.map((s) => s.changeOrderId).filter((x): x is string => !!x))];
  const [choices, contracts, codes, changeOrders, counts] = await Promise.all([
    tx
      .select()
      .from(schema.jobSelectionChoices)
      .where(and(eq(schema.jobSelectionChoices.tenantId, tenantId), inArray(schema.jobSelectionChoices.selectionId, ids)))
      .orderBy(asc(schema.jobSelectionChoices.sortOrder), asc(schema.jobSelectionChoices.createdAt)),
    contractIds.length === 0
      ? Promise.resolve([])
      : tx
          .select({ id: schema.jobContracts.id, kind: schema.jobContracts.kind, name: schema.jobContracts.name })
          .from(schema.jobContracts)
          .where(and(eq(schema.jobContracts.tenantId, tenantId), inArray(schema.jobContracts.id, contractIds))),
    codeIds.length === 0
      ? Promise.resolve([])
      : tx
          .select({ id: schema.jobCostCodes.id, code: schema.jobCostCodes.code, name: schema.jobCostCodes.name })
          .from(schema.jobCostCodes)
          .where(and(eq(schema.jobCostCodes.tenantId, tenantId), inArray(schema.jobCostCodes.id, codeIds))),
    coIds.length === 0
      ? Promise.resolve([])
      : tx
          .select({
            id: schema.jobChangeOrders.id,
            number: schema.jobChangeOrders.number,
            status: schema.jobChangeOrders.status,
            valueCents: schema.jobChangeOrders.valueCents,
          })
          .from(schema.jobChangeOrders)
          .where(and(eq(schema.jobChangeOrders.tenantId, tenantId), inArray(schema.jobChangeOrders.id, coIds))),
    attachmentCounts(tx, tenantId, SELECTION_ENTITY, ids),
  ]);
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  const codeById = new Map(codes.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const coById = new Map(changeOrders.map((c) => [c.id, c]));
  return selections.map((s) => {
    const own = choices.filter((c) => c.selectionId === s.id);
    const chosen = own.find((c) => c.isSelected) ?? null;
    const counted = (CHOSEN_SELECTION_STATUSES as readonly string[]).includes(s.status) && chosen !== null;
    const co = s.changeOrderId ? (coById.get(s.changeOrderId) ?? null) : null;
    return {
      selection: s,
      contract: s.contractId ? (contractById.get(s.contractId) ?? null) : null,
      codeLabel: s.costCodeId ? (codeById.get(s.costCodeId) ?? null) : null,
      choices: own,
      chosen,
      differenceCents: counted && chosen ? chosen.priceCents - s.allowanceCents : null,
      changeOrder: co && co.status !== "void" ? co : null,
      overdue: s.status === "pending" && s.neededBy !== null && s.neededBy < asOf,
      attachmentCount: counts.get(s.id) ?? 0,
    };
  });
}

export interface SelectionSummary {
  count: number;
  pending: number;
  overdue: number;
  /** Allowances on every selection that is not cancelled. */
  allowancesCents: number;
  /** The chosen prices, where the status counts them. */
  chosenCents: number;
  /** Σ chosen − allowance over the selections that count; negative is under. */
  differenceCents: number;
  /** Approved differences not yet raised as a change order, signed. */
  toRaiseCents: number;
  /** The change orders raised, whatever their status short of void. */
  raisedCents: number;
}

/** The five numbers a custom builder watches, from `listSelections`. */
export function summarise(rows: readonly SelectionRow[]): SelectionSummary {
  const live = rows.filter((r) => r.selection.status !== "cancelled");
  const out: SelectionSummary = {
    count: live.length,
    pending: 0,
    overdue: 0,
    allowancesCents: 0,
    chosenCents: 0,
    differenceCents: 0,
    toRaiseCents: 0,
    raisedCents: 0,
  };
  for (const r of live) {
    out.allowancesCents += r.selection.allowanceCents;
    if (r.selection.status === "pending") out.pending += 1;
    if (r.overdue) out.overdue += 1;
    if (r.differenceCents !== null && r.chosen) {
      out.chosenCents += r.chosen.priceCents;
      out.differenceCents += r.differenceCents;
      if (r.selection.status === "approved" && !r.changeOrder && r.differenceCents !== 0) {
        out.toRaiseCents += r.differenceCents;
      }
    }
    if (r.changeOrder) out.raisedCents += r.changeOrder.valueCents;
  }
  return out;
}

export async function selectionSummary(tx: Tx, tenantId: string, projectId: string, asOf: string): Promise<SelectionSummary> {
  return summarise(await listSelections(tx, tenantId, projectId, asOf));
}

const dollars = (cents: number): string =>
  (Math.abs(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * RAISE THE DIFFERENCE AS A CHANGE ORDER on the selection's contract: the
 * chosen price less the allowance, as the change's price to the client, and
 * — when the selection has a cost code — one line moving that code's budget
 * by the same amount. Slice 4's row through slice 4's verb, which holds the
 * owner gate. The selection remembers the change order, so the difference
 * cannot be raised twice while it stands; a voided one may be raised again.
 */
export async function raiseSelectionChangeOrder(
  tx: Tx,
  ctx: JobsCtx,
  selectionId: string,
  input: { number: string; title?: string; status?: string; approvedOn?: string | null; requestedOn?: string | null },
): Promise<JobChangeOrder> {
  const selection = await loadSelection(tx, ctx.tenantId, selectionId);
  if (selection.status !== "approved") {
    throw new JobsError("INVALID_STATUS", "approve the selection before raising its difference");
  }
  if (!selection.contractId) {
    throw new JobsError("INVALID_VALUE", "the selection names no contract to raise the change on");
  }
  const standing = await standingChangeOrder(tx, ctx.tenantId, selection.changeOrderId);
  if (standing) {
    throw new JobsError("SELECTION_RAISED", `already raised as change order ${standing.number}`);
  }
  const chosen = (await choicesOf(tx, ctx.tenantId, selectionId)).find((c) => c.isSelected);
  if (!chosen) throw new JobsError("INVALID_VALUE", "mark the choice the client made first");
  const difference = chosen.priceCents - selection.allowanceCents;
  if (difference === 0) {
    throw new JobsError("INVALID_VALUE", "the choice is within its allowance to the cent; there is nothing to raise");
  }
  const over = difference > 0;
  const changeOrder = await createChangeOrder(tx, ctx, {
    contractId: selection.contractId,
    number: input.number,
    title: input.title?.trim() || `${selection.name}: allowance ${over ? "overage" : "credit"}`,
    description: `${chosen.description} at ${dollars(chosen.priceCents)} against a ${dollars(selection.allowanceCents)} allowance${selection.location ? ` — ${selection.location}` : ""}.`,
    status: input.status,
    approvedOn: input.approvedOn,
    requestedOn: input.requestedOn,
    valueCents: difference,
    lines: selection.costCodeId
      ? [{ costCodeId: selection.costCodeId, description: selection.name, amountCents: difference }]
      : [],
  });
  await tx
    .update(schema.jobSelections)
    .set({ changeOrderId: changeOrder.id, updatedAt: new Date(), version: selection.version + 1 })
    .where(and(eq(schema.jobSelections.tenantId, ctx.tenantId), eq(schema.jobSelections.id, selectionId)));
  return changeOrder;
}

/**
 * The reminder, as a Work item linked to the SELECTION — "Selection needed:
 * Master bath tile by 2026-10-15 (24-108)" — beside everything else the
 * office has to do, and not on the job's punch list, which is the site's.
 */
export async function remindSelection(
  tx: Tx,
  ctx: JobsCtx,
  selectionId: string,
  input: { dueOn?: string | null } = {},
): Promise<string> {
  requireWrite(ctx, "member");
  const selection = await loadSelection(tx, ctx.tenantId, selectionId);
  const project = await getProject(tx, ctx.tenantId, selection.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${selection.projectId} not found`);
  return createWorkForEntity(
    tx,
    { tenantId: ctx.tenantId, userId: ctx.userId },
    { extensionSlug: PACK, entityType: SELECTION_ENTITY, entityId: selection.id },
    {
      title: `Selection needed: ${selection.name}${selection.neededBy ? ` by ${selection.neededBy}` : ""} (${project.number})`,
      notes: `${project.number} · ${project.name}${selection.location ? ` · ${selection.location}` : ""}`,
      dueOn: input.dueOn ?? selection.neededBy ?? null,
    },
  );
}

/** What is being chased about one selection: its open Work items. */
export async function listSelectionWork(tx: Tx, tenantId: string, selectionId: string): Promise<EntityWorkRow[]> {
  const rows = await listWorkForEntity(tx, { tenantId }, { entityType: SELECTION_ENTITY, entityId: selectionId });
  return rows.filter((r) => r.completedAt === null);
}
