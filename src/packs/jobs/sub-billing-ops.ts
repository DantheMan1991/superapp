import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type {
  JobBackCharge,
  JobCommitment,
  JobCommitmentLine,
  JobSubApplication,
  JobSubApplicationLine,
} from "@/db/schema";
import { listDimensionMembers } from "@/modules/accounting/core";
import {
  approveBill,
  createBillDraft,
  loadBill,
  voidBill,
} from "@/modules/accounting/payables/bills";
import { dueDateFromVendorTerms, ensureVendorForParty } from "@/modules/accounting/payables/vendors";
import {
  payApplicationTotals,
  ppmToPercentString,
  type PayApplicationTotals,
  type PayLineFigures,
} from "./billing-math";
import { JobsError, accountByCode, getProject, requireWrite, type JobsCtx } from "./ops";
import { backChargesOn, freeBackChargesFrom } from "./back-charges-ops";
import { backChargeBillDescription, backChargesExceedMessage, netDueCents } from "./back-charges-math";
import {
  APPROVED_CHANGE_STATUSES,
  COST_CODE_DIMENSION,
  PROJECT_DIMENSION,
  RETAINAGE_PAYABLE_CODE,
  RETAINAGE_PPM_MAX,
  SUBCONTRACT_EXPENSE_CODES,
} from "./vocabulary";

/**
 * Subcontractor pay applications — the payable-side mirror of slice 5, and
 * where retainage held FROM a subcontractor lives (ADR 0061).
 *
 * Everything here has a twin in `ops.ts`'s billing section, deliberately:
 * the subcontract's lines are the schedule of values, the arithmetic is
 * `payApplicationTotals` unchanged, one draft at a time per subcontract,
 * numbered after the last, frozen at approval, void only the latest. What
 * differs is the document it becomes — a BILL, through Accounting's
 * `createBillDraft` + `approveBill` — and the accounts: subcontract expense
 * for the work, tagged with the job and the line's cost code, and `2120
 * Retainage Payable` for what is held back.
 */

export interface SubApplicationLineRow extends JobSubApplicationLine {
  description: string;
  costCodeId: string | null;
  /** "06 10 00 · Rough carpentry", or null when the line carries no code. */
  codeLabel: string | null;
  /** The subcontract line's amount NOW; equals `scheduledCents` on a billed application. */
  commitmentAmountCents: number;
  /** The change order that added the line — its number — or null for a line the order was placed with. */
  changeNumber: string | null;
}

export interface SubApplicationRow {
  app: JobSubApplication;
  lines: SubApplicationLineRow[];
  totals: PayApplicationTotals;
  /** The bill a billed application became, in Accounting's own words. */
  bill: { id: string; billNumber: string; status: string; totalCents: number } | null;
  /**
   * The back-charges riding on this application (ADR 0077). They come off the
   * BOTTOM: `totals` is the certificate and is untouched by them, and
   * `netDueCents` is what the subcontractor is actually paid.
   */
  backCharges: JobBackCharge[];
  backChargesCents: number;
  netDueCents: number;
}

async function loadCommitment(tx: Tx, tenantId: string, id: string): Promise<JobCommitment> {
  const rows = await tx
    .select()
    .from(schema.jobCommitments)
    .where(and(eq(schema.jobCommitments.tenantId, tenantId), eq(schema.jobCommitments.id, id)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `commitment ${id} not found`);
  return rows[0];
}

/** One commitment, or null. The page's loader; `loadCommitment` throws for the verbs. */
export async function getCommitment(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<JobCommitment | null> {
  const rows = await tx
    .select()
    .from(schema.jobCommitments)
    .where(and(eq(schema.jobCommitments.tenantId, tenantId), eq(schema.jobCommitments.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** The change order that added a line, if any — the join every read of the schedule shares. */
function joinChange() {
  return and(
    eq(schema.jobCommitmentChangeOrders.tenantId, schema.jobCommitmentLines.tenantId),
    eq(schema.jobCommitmentChangeOrders.id, schema.jobCommitmentLines.changeOrderId),
  );
}

/** The original lines first, then each change's in the order the changes were raised. */
function scheduleOrder() {
  return [
    sql`${schema.jobCommitmentChangeOrders.createdAt} asc nulls first`,
    asc(schema.jobCommitmentLines.sortOrder),
    asc(schema.jobCommitmentLines.createdAt),
  ];
}

/**
 * THE SUBCONTRACT'S SCHEDULE: the lines it was placed with, and the lines of
 * its APPROVED change orders (ADR 0065) — `countedCommitmentLine` in ops.ts,
 * read here through the same join. A proposed change's lines are not yet the
 * subcontractor's to bill.
 */
async function commitmentLines(tx: Tx, tenantId: string, commitmentId: string): Promise<JobCommitmentLine[]> {
  const rows = await tx
    .select({ line: schema.jobCommitmentLines })
    .from(schema.jobCommitmentLines)
    .leftJoin(schema.jobCommitmentChangeOrders, joinChange())
    .where(
      and(
        eq(schema.jobCommitmentLines.tenantId, tenantId),
        eq(schema.jobCommitmentLines.commitmentId, commitmentId),
        or(
          isNull(schema.jobCommitmentLines.changeOrderId),
          inArray(schema.jobCommitmentChangeOrders.status, [...APPROVED_CHANGE_STATUSES]),
        ),
      ),
    )
    .orderBy(...scheduleOrder());
  return rows.map((r) => r.line);
}

/**
 * The latest BILLED application on a subcontract before a given number — the
 * one whose figures the next carries forward. A void one is skipped: its bill
 * was voided, so nothing it certified stands.
 */
async function lastBilledBefore(
  tx: Tx,
  tenantId: string,
  commitmentId: string,
  beforeNumber: number | null,
): Promise<JobSubApplication | null> {
  const rows = await tx
    .select()
    .from(schema.jobSubApplications)
    .where(
      and(
        eq(schema.jobSubApplications.tenantId, tenantId),
        eq(schema.jobSubApplications.commitmentId, commitmentId),
        eq(schema.jobSubApplications.status, "billed"),
        ...(beforeNumber === null ? [] : [sql`${schema.jobSubApplications.number} < ${beforeNumber}`]),
      ),
    )
    .orderBy(desc(schema.jobSubApplications.number))
    .limit(1);
  return rows[0] ?? null;
}

function certifiedCents(app: JobSubApplication | null): number {
  return app ? app.completedToDateCents - app.retainageCents : 0;
}

function figuresOf(lines: SubApplicationLineRow[], live: boolean): PayLineFigures[] {
  return lines.map((l) => ({
    sovLineId: l.commitmentLineId,
    scheduledCents: live ? l.commitmentAmountCents : l.scheduledCents,
    previousCents: l.previousCents,
    thisPeriodCents: l.thisPeriodCents,
    storedCents: l.storedCents,
  }));
}

async function loadAppLines(
  tx: Tx,
  tenantId: string,
  appIds: string[],
): Promise<Map<string, SubApplicationLineRow[]>> {
  const out = new Map<string, SubApplicationLineRow[]>();
  if (appIds.length === 0) return out;
  const rows = await tx
    .select({
      line: schema.jobSubApplicationLines,
      description: schema.jobCommitmentLines.description,
      costCodeId: schema.jobCommitmentLines.costCodeId,
      commitmentAmountCents: schema.jobCommitmentLines.amountCents,
      sortOrder: schema.jobCommitmentLines.sortOrder,
      code: schema.jobCostCodes.code,
      codeName: schema.jobCostCodes.name,
      changeNumber: schema.jobCommitmentChangeOrders.number,
    })
    .from(schema.jobSubApplicationLines)
    .innerJoin(
      schema.jobCommitmentLines,
      and(
        eq(schema.jobCommitmentLines.tenantId, schema.jobSubApplicationLines.tenantId),
        eq(schema.jobCommitmentLines.id, schema.jobSubApplicationLines.commitmentLineId),
      ),
    )
    .leftJoin(
      schema.jobCostCodes,
      and(
        eq(schema.jobCostCodes.tenantId, schema.jobCommitmentLines.tenantId),
        eq(schema.jobCostCodes.id, schema.jobCommitmentLines.costCodeId),
      ),
    )
    .leftJoin(schema.jobCommitmentChangeOrders, joinChange())
    .where(
      and(
        eq(schema.jobSubApplicationLines.tenantId, tenantId),
        inArray(schema.jobSubApplicationLines.subApplicationId, appIds),
      ),
    )
    .orderBy(...scheduleOrder());
  for (const r of rows) {
    const list = out.get(r.line.subApplicationId) ?? [];
    list.push({
      ...r.line,
      description: r.description,
      costCodeId: r.costCodeId,
      codeLabel: r.code ? `${r.code} · ${r.codeName}` : null,
      commitmentAmountCents: r.commitmentAmountCents,
      changeNumber: r.changeNumber ?? null,
    });
    out.set(r.line.subApplicationId, list);
  }
  return out;
}

/**
 * Every application on a subcontract, oldest first, each with its lines and
 * its certificate — a draft computed live from the subcontract's lines as they
 * are now, a billed one from the totals frozen at approval. The bill is read
 * through Accounting's own verb, never its table.
 */
export async function listSubApplications(
  tx: Tx,
  tenantId: string,
  commitmentId: string,
): Promise<SubApplicationRow[]> {
  const apps = await tx
    .select()
    .from(schema.jobSubApplications)
    .where(
      and(
        eq(schema.jobSubApplications.tenantId, tenantId),
        eq(schema.jobSubApplications.commitmentId, commitmentId),
      ),
    )
    .orderBy(asc(schema.jobSubApplications.number));
  const linesByApp = await loadAppLines(
    tx,
    tenantId,
    apps.map((a) => a.id),
  );
  // Every application's back-charges in one pass, keyed by the application.
  const byApp = new Map<string, JobBackCharge[]>();
  if (apps.length > 0) {
    const charges = await tx
      .select()
      .from(schema.jobBackCharges)
      .where(
        and(
          eq(schema.jobBackCharges.tenantId, tenantId),
          eq(schema.jobBackCharges.status, "open"),
          inArray(
            schema.jobBackCharges.subApplicationId,
            apps.map((a) => a.id),
          ),
        ),
      )
      .orderBy(asc(schema.jobBackCharges.number));
    for (const c of charges) {
      const list = byApp.get(c.subApplicationId!) ?? [];
      list.push(c);
      byApp.set(c.subApplicationId!, list);
    }
  }
  const out: SubApplicationRow[] = [];
  for (const app of apps) {
    const lines = linesByApp.get(app.id) ?? [];
    let totals: PayApplicationTotals;
    if (app.status === "draft") {
      const previous = await lastBilledBefore(tx, tenantId, commitmentId, app.number);
      totals = payApplicationTotals(figuresOf(lines, true), app.retainagePpm, certifiedCents(previous));
    } else {
      totals = {
        scheduledCents: app.scheduledCents,
        completedToDateCents: app.completedToDateCents,
        retainageCents: app.retainageCents,
        earnedLessRetainageCents: app.completedToDateCents - app.retainageCents,
        previousCertificatesCents: app.previousCertificatesCents,
        dueCents: app.dueCents,
        balanceToFinishCents: app.scheduledCents - app.completedToDateCents,
      };
    }
    let bill: SubApplicationRow["bill"] = null;
    if (app.billId) {
      const b = await loadBill(tx, tenantId, app.billId);
      bill = { id: b.id, billNumber: b.billNumber, status: b.status, totalCents: b.totalCents };
    }
    const backCharges = byApp.get(app.id) ?? [];
    const backChargesCents = backCharges.reduce((total, b) => total + b.amountCents, 0);
    out.push({ app, lines, totals, bill, backCharges, backChargesCents, netDueCents: netDueCents(totals.dueCents, backChargesCents) });
  }
  return out;
}

function validateRetainage(ppm: number): void {
  if (!Number.isInteger(ppm) || ppm < 0 || ppm > RETAINAGE_PPM_MAX) {
    throw new JobsError("INVALID_VALUE", "retainage must be between 0% and 100%");
  }
}

/**
 * Give a draft a line for every subcontract line it lacks, carrying forward
 * what the last billed application completed on each — work only, never
 * stored materials. Called when a draft is made and again whenever it is
 * edited, so a subcontract that grew after the draft did reaches it.
 *
 * Two more things a change order made necessary (ADR 0065): a draft line
 * whose change has stopped counting — approved when the draft was made, taken
 * back since — is dropped, whatever was typed on it, because it is a draft's
 * figure on a line the subcontractor may no longer bill; and every draft
 * line's `scheduled_cents` is kept equal to the subcontract line's amount
 * now, so the sign the database floors on is the line's own.
 */
async function syncDraftLines(tx: Tx, tenantId: string, app: JobSubApplication): Promise<void> {
  const [lines, have, previous] = await Promise.all([
    commitmentLines(tx, tenantId, app.commitmentId),
    tx
      .select({
        id: schema.jobSubApplicationLines.id,
        commitmentLineId: schema.jobSubApplicationLines.commitmentLineId,
        scheduledCents: schema.jobSubApplicationLines.scheduledCents,
      })
      .from(schema.jobSubApplicationLines)
      .where(
        and(
          eq(schema.jobSubApplicationLines.tenantId, tenantId),
          eq(schema.jobSubApplicationLines.subApplicationId, app.id),
        ),
      ),
    lastBilledBefore(tx, tenantId, app.commitmentId, app.number),
  ]);
  const amountOf = new Map(lines.map((l) => [l.id, l.amountCents]));
  const stale = have.filter((h) => !amountOf.has(h.commitmentLineId));
  if (stale.length > 0) {
    await tx.delete(schema.jobSubApplicationLines).where(
      and(
        eq(schema.jobSubApplicationLines.tenantId, tenantId),
        inArray(
          schema.jobSubApplicationLines.id,
          stale.map((h) => h.id),
        ),
      ),
    );
  }
  for (const h of have) {
    const now = amountOf.get(h.commitmentLineId);
    if (now !== undefined && now !== h.scheduledCents) {
      await tx
        .update(schema.jobSubApplicationLines)
        .set({ scheduledCents: now, updatedAt: new Date() })
        .where(eq(schema.jobSubApplicationLines.id, h.id));
    }
  }
  const has = new Set(have.map((h) => h.commitmentLineId));
  const missing = lines.filter((l) => !has.has(l.id));
  if (missing.length === 0) return;
  const carried = new Map<string, number>();
  if (previous) {
    const prior = await tx
      .select()
      .from(schema.jobSubApplicationLines)
      .where(
        and(
          eq(schema.jobSubApplicationLines.tenantId, tenantId),
          eq(schema.jobSubApplicationLines.subApplicationId, previous.id),
        ),
      );
    for (const p of prior) carried.set(p.commitmentLineId, p.previousCents + p.thisPeriodCents);
  }
  await tx.insert(schema.jobSubApplicationLines).values(
    missing.map((l) => ({
      tenantId,
      subApplicationId: app.id,
      commitmentLineId: l.id,
      scheduledCents: l.amountCents,
      previousCents: carried.get(l.id) ?? 0,
      thisPeriodCents: 0,
      storedCents: 0,
    })),
  );
}

export interface SubApplicationInput {
  commitmentId: string;
  periodTo: string;
  retainagePpm?: number;
  reference?: string;
  notes?: string;
}

/**
 * Start a subcontractor's application. SUBCONTRACTS ONLY — a purchase order
 * is billed with an ordinary bill, and retainage attaches to bought labour,
 * not bought material. One draft at a time per subcontract; numbered after the
 * last, void ones included.
 */
export async function createSubApplication(
  tx: Tx,
  ctx: JobsCtx,
  input: SubApplicationInput,
): Promise<JobSubApplication> {
  requireWrite(ctx, "owner");
  const commitment = await loadCommitment(tx, ctx.tenantId, input.commitmentId);
  if (commitment.kind !== "subcontract") {
    throw new JobsError("NOT_SUBCONTRACT", "a purchase order is billed with an ordinary bill");
  }
  const lines = await commitmentLines(tx, ctx.tenantId, commitment.id);
  if (lines.length === 0) {
    throw new JobsError("NO_LINES", "the subcontract has no lines to bill against");
  }
  const existing = await tx
    .select({
      max: sql<number>`coalesce(max(${schema.jobSubApplications.number}), 0)`.mapWith(Number),
      drafts: sql<number>`count(*) filter (where ${schema.jobSubApplications.status} = 'draft')`.mapWith(
        Number,
      ),
    })
    .from(schema.jobSubApplications)
    .where(
      and(
        eq(schema.jobSubApplications.tenantId, ctx.tenantId),
        eq(schema.jobSubApplications.commitmentId, commitment.id),
      ),
    );
  if (existing[0].drafts > 0) {
    throw new JobsError("ONE_DRAFT", "this subcontract already has a draft application open");
  }
  const last = await lastBilledBefore(tx, ctx.tenantId, commitment.id, null);
  const retainagePpm = input.retainagePpm ?? last?.retainagePpm ?? 0;
  validateRetainage(retainagePpm);
  const rows = await tx
    .insert(schema.jobSubApplications)
    .values({
      tenantId: ctx.tenantId,
      commitmentId: commitment.id,
      number: existing[0].max + 1,
      periodTo: input.periodTo,
      retainagePpm,
      reference: input.reference?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  await syncDraftLines(tx, ctx.tenantId, rows[0]);
  return rows[0];
}

async function loadSubApplication(tx: Tx, tenantId: string, id: string): Promise<JobSubApplication> {
  const rows = await tx
    .select()
    .from(schema.jobSubApplications)
    .where(and(eq(schema.jobSubApplications.tenantId, tenantId), eq(schema.jobSubApplications.id, id)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `subcontractor application ${id} not found`);
  return rows[0];
}

export interface SubApplicationLineInput {
  commitmentLineId: string;
  thisPeriodCents: number;
  storedCents: number;
}

/** Change a draft: the period, the rate, the reference, the notes, and the lines. */
export async function updateSubApplication(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: {
    periodTo?: string;
    retainagePpm?: number;
    reference?: string;
    notes?: string;
    lines?: SubApplicationLineInput[];
    version?: number;
  },
): Promise<JobSubApplication> {
  requireWrite(ctx, "owner");
  const app = await loadSubApplication(tx, ctx.tenantId, id);
  if (app.status !== "draft") {
    throw new JobsError("INVALID_STATUS", "only a draft application can be changed");
  }
  if (input.version !== undefined && input.version !== app.version) {
    throw new JobsError("STALE_VERSION", "application changed since loaded");
  }
  if (input.retainagePpm !== undefined) validateRetainage(input.retainagePpm);
  await syncDraftLines(tx, ctx.tenantId, app);

  if (input.lines) {
    const current = (await loadAppLines(tx, ctx.tenantId, [id])).get(id) ?? [];
    const byLine = new Map(current.map((l) => [l.commitmentLineId, l]));
    for (const line of input.lines) {
      const row = byLine.get(line.commitmentLineId);
      if (!row) throw new JobsError("NOT_FOUND", `subcontract line ${line.commitmentLineId} is not on this application`);
      if (!Number.isInteger(line.thisPeriodCents) || !Number.isInteger(line.storedCents)) {
        throw new JobsError("INVALID_VALUE", "amounts must be whole cents");
      }
      if (line.storedCents < 0) {
        throw new JobsError("INVALID_VALUE", "stored materials cannot be negative");
      }
      // A DEDUCTIVE line — a change order's negative line — runs backwards:
      // completed to less than nothing and never more, and nothing is stored
      // against it. The database's floors flip on the same sign.
      const deductive = row.commitmentAmountCents < 0;
      if (deductive && line.storedCents > 0) {
        throw new JobsError("INVALID_VALUE", "nothing is stored against a deduction");
      }
      const toDate = row.previousCents + line.thisPeriodCents + line.storedCents;
      if (deductive ? toDate > 0 : toDate < 0) {
        throw new JobsError(
          "INVALID_VALUE",
          deductive
            ? "a deduction cannot be completed to more than nothing"
            : "a line cannot be completed to less than nothing",
        );
      }
      await tx
        .update(schema.jobSubApplicationLines)
        .set({ thisPeriodCents: line.thisPeriodCents, storedCents: line.storedCents, updatedAt: new Date() })
        .where(eq(schema.jobSubApplicationLines.id, row.id));
    }
  }
  const patch: Record<string, unknown> = { updatedAt: new Date(), version: app.version + 1 };
  if (input.periodTo !== undefined) patch.periodTo = input.periodTo;
  if (input.retainagePpm !== undefined) patch.retainagePpm = input.retainagePpm;
  if (input.reference !== undefined) patch.reference = input.reference.trim();
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  const rows = await tx
    .update(schema.jobSubApplications)
    .set(patch)
    .where(and(eq(schema.jobSubApplications.tenantId, ctx.tenantId), eq(schema.jobSubApplications.id, id)))
    .returning();
  return rows[0];
}

export async function deleteSubApplication(tx: Tx, ctx: JobsCtx, id: string): Promise<void> {
  requireWrite(ctx, "owner");
  const app = await loadSubApplication(tx, ctx.tenantId, id);
  if (app.status !== "draft") {
    throw new JobsError("INVALID_STATUS", "only a draft application can be deleted; a billed one is voided");
  }
  await tx
    .delete(schema.jobSubApplications)
    .where(and(eq(schema.jobSubApplications.tenantId, ctx.tenantId), eq(schema.jobSubApplications.id, id)));
}

/**
 * APPROVE A SUBCONTRACTOR'S APPLICATION: freeze its certificate and post it as
 * an ordinary bill (ADR 0061).
 *
 * The bill is for the CURRENT PAYMENT DUE, in lines the ledger can read: the
 * work completed this period on each subcontract line, to subcontract
 * expense, tagged with the job and the line's cost code — which is what puts
 * it in the job cost report's `Spent` column and on the next cost-plus
 * application — and the retainage held this period as a NEGATIVE line to
 * `2120 Retainage Payable`. Dr expense (gross) · Cr Retainage Payable (held)
 * · Cr AP (net). A later application at a lower rate runs the line the other
 * way and RELEASES what was held; the final one at 0% releases it all.
 */
export async function approveSubApplication(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: { billDate: string; version?: number },
): Promise<{ app: JobSubApplication; billId: string }> {
  requireWrite(ctx, "owner");
  const app = await loadSubApplication(tx, ctx.tenantId, id);
  if (app.status !== "draft") {
    throw new JobsError("INVALID_STATUS", "only a draft application can be approved");
  }
  if (input.version !== undefined && input.version !== app.version) {
    throw new JobsError("STALE_VERSION", "application changed since loaded");
  }
  await syncDraftLines(tx, ctx.tenantId, app);
  const lines = (await loadAppLines(tx, ctx.tenantId, [app.id])).get(app.id) ?? [];
  if (lines.length === 0) {
    throw new JobsError("NO_LINES", "the subcontract has no lines to bill against");
  }
  const previous = await lastBilledBefore(tx, ctx.tenantId, app.commitmentId, app.number);
  const totals = payApplicationTotals(figuresOf(lines, true), app.retainagePpm, certifiedCents(previous));
  if (totals.dueCents <= 0) {
    throw new JobsError("NOTHING_DUE", "nothing is due on this application");
  }
  // What is being kept back from this payment (ADR 0077). It never touches the
  // certificate above — `certifiedCents` stays gross, so the next application
  // does not hand the money back — and it cannot take the payment to nothing.
  const backCharges = await backChargesOn(tx, ctx.tenantId, app.id);
  const backChargesCents = backCharges.reduce((total, b) => total + b.amountCents, 0);
  if (backChargesCents > 0 && netDueCents(totals.dueCents, backChargesCents) <= 0) {
    throw new JobsError(
      "BACK_CHARGES_EXCEED",
      backChargesExceedMessage(totals.dueCents, backChargesCents, backCharges.length),
    );
  }
  const retainageThisPeriod = totals.retainageCents - (previous?.retainageCents ?? 0);

  const commitment = await loadCommitment(tx, ctx.tenantId, app.commitmentId);
  const project = await getProject(tx, ctx.tenantId, commitment.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${commitment.projectId} not found`);

  const expenseAccountId = await accountByCode(tx, ctx.tenantId, SUBCONTRACT_EXPENSE_CODES);
  if (!expenseAccountId) {
    throw new JobsError(
      "ACCOUNT_MISSING",
      `the chart has no ${SUBCONTRACT_EXPENSE_CODES.join(" or ")} Subcontractor Expense account`,
    );
  }
  let retainageAccountId: string | null = null;
  if (retainageThisPeriod !== 0) {
    retainageAccountId = await accountByCode(tx, ctx.tenantId, [RETAINAGE_PAYABLE_CODE]);
    if (!retainageAccountId) {
      throw new JobsError(
        "ACCOUNT_MISSING",
        `the chart has no ${RETAINAGE_PAYABLE_CODE} Retainage Payable account`,
      );
    }
  }
  // The job's cost object and each line's cost code, so the bill lands on the
  // job cost report by code. An archived member is simply not tagged.
  const jobMember = (await listDimensionMembers(tx, ctx.tenantId, PROJECT_DIMENSION)).find(
    (m) => m.packEntityId === project.id && m.isActive,
  );
  const codeMembers = new Map(
    (await listDimensionMembers(tx, ctx.tenantId, COST_CODE_DIMENSION))
      .filter((m) => m.isActive)
      .map((m) => [m.packEntityId, m.id]),
  );
  const dimsFor = (costCodeId: string | null) =>
    [jobMember?.id, costCodeId ? codeMembers.get(costCodeId) : undefined].filter(
      (d): d is string => !!d,
    );

  // What each line billed BEFORE, so the bill carries this period only.
  const priorByLine = new Map<string, number>();
  if (previous) {
    const prior = await tx
      .select()
      .from(schema.jobSubApplicationLines)
      .where(
        and(
          eq(schema.jobSubApplicationLines.tenantId, ctx.tenantId),
          eq(schema.jobSubApplicationLines.subApplicationId, previous.id),
        ),
      );
    for (const p of prior) priorByLine.set(p.commitmentLineId, p.previousCents + p.thisPeriodCents + p.storedCents);
  }

  const vendor = await ensureVendorForParty(tx, ctx, commitment.partyId);
  const dueDate = await dueDateFromVendorTerms(tx, ctx.tenantId, vendor, input.billDate);
  const ratePct = ppmToPercentString(app.retainagePpm);
  const billLines = lines
    .map((l) => {
      const toDate = l.previousCents + l.thisPeriodCents + l.storedCents;
      const thisPeriod = toDate - (priorByLine.get(l.commitmentLineId) ?? 0);
      return {
        // The line's own words, else its cost code — never "subcontract line" on a
        // bill a bookkeeper reads — and the change order that added it, by number.
        description: `Application ${app.number} — ${l.changeNumber ? `${l.changeNumber} · ` : ""}${l.description || l.codeLabel || "subcontract line"} through ${app.periodTo}`,
        amountCents: thisPeriod,
        accountId: expenseAccountId,
        dimensionMemberIds: dimsFor(l.costCodeId),
      };
    })
    .filter((l) => l.amountCents !== 0);
  if (retainageThisPeriod !== 0 && retainageAccountId) {
    billLines.push({
      description: retainageThisPeriod > 0 ? `Retainage held (${ratePct}%)` : "Retainage released",
      amountCents: -retainageThisPeriod,
      accountId: retainageAccountId,
      dimensionMemberIds: dimsFor(null),
    });
  }
  // Each back-charge as its own negative line, against the subcontract expense
  // account and tagged with the job AND the code the cost landed on — so the
  // job cost report's spend on that code nets out, which is the figure a
  // builder reads. One line each, never one lump: the bill has to say what for.
  for (const charge of backCharges) {
    billLines.push({
      description: backChargeBillDescription(charge.number, charge.description, app.number),
      amountCents: -charge.amountCents,
      accountId: expenseAccountId,
      dimensionMemberIds: dimsFor(charge.costCodeId),
    });
  }

  const draft = await createBillDraft(tx, ctx, {
    entityId: project.entityId,
    vendorId: vendor.id,
    billNumber: app.reference,
    billDate: input.billDate,
    dueDate,
    memo: `Subcontractor application ${app.number} · ${project.number} · ${commitment.number}`,
    lines: billLines,
  });
  const approved = await approveBill(tx, ctx, { billId: draft.id, expectedVersion: draft.version });

  for (const line of lines) {
    await tx
      .update(schema.jobSubApplicationLines)
      .set({ scheduledCents: line.commitmentAmountCents, updatedAt: new Date() })
      .where(eq(schema.jobSubApplicationLines.id, line.id));
  }
  const rows = await tx
    .update(schema.jobSubApplications)
    .set({
      status: "billed",
      billId: approved.id,
      billedOn: input.billDate,
      scheduledCents: totals.scheduledCents,
      completedToDateCents: totals.completedToDateCents,
      retainageCents: totals.retainageCents,
      previousCertificatesCents: totals.previousCertificatesCents,
      dueCents: totals.dueCents,
      version: app.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobSubApplications.tenantId, ctx.tenantId), eq(schema.jobSubApplications.id, id)))
    .returning();
  return { app: rows[0], billId: approved.id };
}

/**
 * Void a billed application: its bill is voided through Accounting (which
 * refuses one with payments) and the application stops counting. ONLY THE
 * LATEST billed one on a subcontract can go, because every later certificate
 * was computed from it.
 */
export async function voidSubApplication(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: { version?: number } = {},
): Promise<JobSubApplication> {
  requireWrite(ctx, "owner");
  const app = await loadSubApplication(tx, ctx.tenantId, id);
  if (app.status !== "billed") {
    throw new JobsError("INVALID_STATUS", "only a billed application can be voided");
  }
  if (input.version !== undefined && input.version !== app.version) {
    throw new JobsError("STALE_VERSION", "application changed since loaded");
  }
  const latest = await lastBilledBefore(tx, ctx.tenantId, app.commitmentId, null);
  if (!latest || latest.id !== app.id) {
    throw new JobsError("NOT_LAST", "only the latest billed application can be voided");
  }
  if (app.billId) {
    const bill = await loadBill(tx, ctx.tenantId, app.billId);
    if (bill.status !== "void") {
      await voidBill(tx, ctx, { billId: bill.id, expectedVersion: bill.version });
    }
  }
  // The bill is void, so the deduction has been unwound: the back-charges it
  // carried are owed again and free for the next application (ADR 0077).
  await freeBackChargesFrom(tx, ctx.tenantId, app.id);
  const rows = await tx
    .update(schema.jobSubApplications)
    .set({ status: "void", version: app.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.jobSubApplications.tenantId, ctx.tenantId), eq(schema.jobSubApplications.id, id)))
    .returning();
  return rows[0];
}

export interface CommitmentBilling {
  commitmentId: string;
  /** Σ current payment due over billed applications: what the subcontractor has been billed for. */
  billedCents: number;
  /** What the latest billed application holds back. */
  retainageHeldCents: number;
  billedCount: number;
  hasDraft: boolean;
}

/** Per commitment on a project: what the subcontractor has billed and what is held. */
export async function commitmentBilling(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<Map<string, CommitmentBilling>> {
  const out = new Map<string, CommitmentBilling>();
  const apps = await tx
    .select({ app: schema.jobSubApplications })
    .from(schema.jobSubApplications)
    .innerJoin(
      schema.jobCommitments,
      and(
        eq(schema.jobCommitments.tenantId, schema.jobSubApplications.tenantId),
        eq(schema.jobCommitments.id, schema.jobSubApplications.commitmentId),
      ),
    )
    .where(
      and(eq(schema.jobSubApplications.tenantId, tenantId), eq(schema.jobCommitments.projectId, projectId)),
    )
    .orderBy(asc(schema.jobSubApplications.number));
  for (const { app } of apps) {
    const row = out.get(app.commitmentId) ?? {
      commitmentId: app.commitmentId,
      billedCents: 0,
      retainageHeldCents: 0,
      billedCount: 0,
      hasDraft: false,
    };
    if (app.status === "billed") {
      row.billedCents += app.dueCents;
      row.retainageHeldCents = app.retainageCents; // ascending by number: the latest wins
      row.billedCount += 1;
    } else if (app.status === "draft") {
      row.hasDraft = true;
    }
    out.set(app.commitmentId, row);
  }
  return out;
}
