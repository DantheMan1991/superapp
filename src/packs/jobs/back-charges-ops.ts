import "server-only";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobBackCharge } from "@/db/schema";
import { JobsError, requireWrite, type JobsCtx } from "./ops";
import { backChargeStanding } from "./back-charges-math";
import { BACK_CHARGE_DESCRIPTION_MAX, type BackChargeStanding } from "./vocabulary";

/**
 * Back-charges (ADR 0077): money the business spent that was the
 * subcontractor's to spend, kept back from what it pays them.
 *
 * Every verb here is the OWNER's, as every verb on a subcontract's money
 * already is (`sub-billing-ops.ts` is owner-only throughout): a back-charge
 * reduces somebody's payment, and the person who notices the mess is rarely
 * the person who decides to charge for it.
 *
 * Nothing here posts anything. The deduction reaches the books exactly once,
 * when the application it rides on is approved and becomes a bill — see
 * `approveSubApplication`, which asks this file what is riding.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateOrThrow(value: string | null | undefined, what: string): string {
  const v = (value ?? "").trim();
  if (!ISO_DATE.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new JobsError("INVALID_VALUE", `${what} needs a date`);
  }
  return v;
}

function bounded(value: string | undefined, max: number, what: string): string {
  const v = (value ?? "").trim();
  if (v.length > max) throw new JobsError("INVALID_VALUE", `${what} is at most ${max.toLocaleString("en-US")} characters`);
  return v;
}

export interface BackChargeInput {
  description: string;
  amountCents: number;
  incurredOn: string;
  costCodeId?: string | null;
  warrantyClaimId?: string | null;
  notes?: string;
}

function checkedAmount(amountCents: number): number {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new JobsError("INVALID_VALUE", "a back-charge is an amount of more than nothing");
  }
  return amountCents;
}

function checkedFields(input: BackChargeInput) {
  const description = bounded(input.description, BACK_CHARGE_DESCRIPTION_MAX, "what was paid for");
  if (description === "") throw new JobsError("INVALID_VALUE", "a back-charge needs saying what was paid for");
  return {
    description,
    amountCents: checkedAmount(input.amountCents),
    incurredOn: dateOrThrow(input.incurredOn, "a back-charge"),
    notes: bounded(input.notes, 4000, "the notes"),
  };
}

async function codeOrThrow(tx: Tx, tenantId: string, codeId: string | null | undefined): Promise<string | null> {
  if (!codeId) return null;
  const rows = await tx
    .select({ id: schema.jobCostCodes.id })
    .from(schema.jobCostCodes)
    .where(and(eq(schema.jobCostCodes.tenantId, tenantId), eq(schema.jobCostCodes.id, codeId)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("INVALID_VALUE", "that cost code is not on any list");
  return codeId;
}

/** A claim from THIS job, or none: a back-charge cannot cite somebody else's call. */
async function claimOrThrow(tx: Tx, tenantId: string, projectId: string, claimId: string | null | undefined): Promise<string | null> {
  if (!claimId) return null;
  const rows = await tx
    .select({ id: schema.jobWarrantyClaims.id })
    .from(schema.jobWarrantyClaims)
    .where(
      and(
        eq(schema.jobWarrantyClaims.tenantId, tenantId),
        eq(schema.jobWarrantyClaims.id, claimId),
        eq(schema.jobWarrantyClaims.projectId, projectId),
      ),
    )
    .limit(1);
  if (rows.length === 0) throw new JobsError("INVALID_VALUE", "that warranty claim is not on this job");
  return claimId;
}

/**
 * The order, read here rather than through `sub-billing-ops`'s `getCommitment`.
 * That file imports THIS one to build its bill, so importing it back would
 * make a cycle; the query is four lines and the direction stays one-way.
 */
async function commitmentOrNull(tx: Tx, tenantId: string, id: string): Promise<{ id: string; projectId: string; kind: string } | null> {
  const rows = await tx
    .select({ id: schema.jobCommitments.id, projectId: schema.jobCommitments.projectId, kind: schema.jobCommitments.kind })
    .from(schema.jobCommitments)
    .where(and(eq(schema.jobCommitments.tenantId, tenantId), eq(schema.jobCommitments.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getBackCharge(tx: Tx, tenantId: string, id: string): Promise<JobBackCharge | null> {
  const rows = await tx
    .select()
    .from(schema.jobBackCharges)
    .where(and(eq(schema.jobBackCharges.tenantId, tenantId), eq(schema.jobBackCharges.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

async function backChargeOrThrow(tx: Tx, tenantId: string, id: string): Promise<JobBackCharge> {
  const row = await getBackCharge(tx, tenantId, id);
  if (!row) throw new JobsError("NOT_FOUND", `back-charge ${id} not found`);
  return row;
}

/** The application a back-charge sits on, as the standing needs it. */
async function applicationOf(tx: Tx, tenantId: string, appId: string | null): Promise<{ id: string; number: number; status: string } | null> {
  if (!appId) return null;
  const rows = await tx
    .select({
      id: schema.jobSubApplications.id,
      number: schema.jobSubApplications.number,
      status: schema.jobSubApplications.status,
    })
    .from(schema.jobSubApplications)
    .where(and(eq(schema.jobSubApplications.tenantId, tenantId), eq(schema.jobSubApplications.id, appId)))
    .limit(1);
  return rows[0] ?? null;
}

async function standingOf(tx: Tx, tenantId: string, row: JobBackCharge): Promise<BackChargeStanding> {
  return backChargeStanding(row.status, await applicationOf(tx, tenantId, row.subApplicationId));
}

/** Once the money has gone out on a bill, the back-charge is history and not a form. */
async function refuseIfDeducted(tx: Tx, tenantId: string, row: JobBackCharge, verb: string): Promise<void> {
  if ((await standingOf(tx, tenantId, row)) === "deducted") {
    throw new JobsError("INVALID_STATUS", `back-charge ${row.number} has been deducted on a billed application, so it cannot be ${verb}`);
  }
}

/**
 * Raise one against an order. SUBCONTRACTS ONLY, for the reason applications
 * are: a purchase order is billed with an ordinary bill in Accounting and has
 * no application for a deduction to ride on. The database does not know the
 * difference, which is the compensating control the ops test proves.
 */
export async function raiseBackCharge(
  tx: Tx,
  ctx: JobsCtx,
  commitmentId: string,
  input: BackChargeInput,
): Promise<JobBackCharge> {
  requireWrite(ctx, "owner");
  const commitment = await commitmentOrNull(tx, ctx.tenantId, commitmentId);
  if (!commitment) throw new JobsError("NOT_FOUND", `commitment ${commitmentId} not found`);
  if (commitment.kind !== "subcontract") {
    throw new JobsError("INVALID_KIND", "a back-charge comes off a subcontractor's application, so it needs a subcontract");
  }
  const checked = checkedFields(input);
  const costCodeId = await codeOrThrow(tx, ctx.tenantId, input.costCodeId);
  const warrantyClaimId = await claimOrThrow(tx, ctx.tenantId, commitment.projectId, input.warrantyClaimId);
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${schema.jobBackCharges.number}), 0)`.mapWith(Number) })
    .from(schema.jobBackCharges)
    .where(and(eq(schema.jobBackCharges.tenantId, ctx.tenantId), eq(schema.jobBackCharges.commitmentId, commitmentId)));
  const rows = await tx
    .insert(schema.jobBackCharges)
    .values({
      tenantId: ctx.tenantId,
      commitmentId,
      number: max + 1,
      ...checked,
      costCodeId,
      warrantyClaimId,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

export interface BackChargePatch {
  description?: string;
  amountCents?: number;
  incurredOn?: string;
  costCodeId?: string | null;
  warrantyClaimId?: string | null;
  notes?: string;
}

export async function updateBackCharge(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  patch: BackChargePatch,
  expectedVersion: number,
): Promise<JobBackCharge> {
  requireWrite(ctx, "owner");
  const row = await backChargeOrThrow(tx, ctx.tenantId, id);
  if (row.version !== expectedVersion) throw new JobsError("STALE_VERSION", "back-charge changed");
  await refuseIfDeducted(tx, ctx.tenantId, row, "changed");
  const commitment = await commitmentOrNull(tx, ctx.tenantId, row.commitmentId);
  if (!commitment) throw new JobsError("NOT_FOUND", `commitment ${row.commitmentId} not found`);
  const checked = checkedFields({
    description: patch.description ?? row.description,
    amountCents: patch.amountCents ?? row.amountCents,
    incurredOn: patch.incurredOn ?? row.incurredOn,
    notes: patch.notes ?? row.notes,
  });
  const costCodeId = patch.costCodeId === undefined ? row.costCodeId : await codeOrThrow(tx, ctx.tenantId, patch.costCodeId);
  const warrantyClaimId =
    patch.warrantyClaimId === undefined
      ? row.warrantyClaimId
      : await claimOrThrow(tx, ctx.tenantId, commitment.projectId, patch.warrantyClaimId);
  const rows = await tx
    .update(schema.jobBackCharges)
    .set({ ...checked, costCodeId, warrantyClaimId, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.jobBackCharges.tenantId, ctx.tenantId), eq(schema.jobBackCharges.id, id)))
    .returning();
  return rows[0];
}

/**
 * Drop one, or put a dropped one back. Dropping takes it off whatever draft
 * it was riding, because a back-charge nobody is charging cannot be half on
 * an application — which the CHECK also refuses.
 */
export async function setBackChargeVoid(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  isVoid: boolean,
  reason?: string,
): Promise<JobBackCharge> {
  requireWrite(ctx, "owner");
  const row = await backChargeOrThrow(tx, ctx.tenantId, id);
  await refuseIfDeducted(tx, ctx.tenantId, row, "dropped");
  const rows = await tx
    .update(schema.jobBackCharges)
    .set({
      status: isVoid ? "void" : "open",
      voidReason: isVoid ? bounded(reason, 2000, "the reason") : "",
      subApplicationId: isVoid ? null : row.subApplicationId,
      version: row.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobBackCharges.tenantId, ctx.tenantId), eq(schema.jobBackCharges.id, id)))
    .returning();
  return rows[0];
}

/**
 * Put it on a draft application, or take it off. The application has to be a
 * DRAFT of the same order: a billed one is a bill, and another order's
 * application would deduct this subcontractor's money from somebody else.
 */
export async function setBackChargeApplication(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  subApplicationId: string | null,
): Promise<JobBackCharge> {
  requireWrite(ctx, "owner");
  const row = await backChargeOrThrow(tx, ctx.tenantId, id);
  await refuseIfDeducted(tx, ctx.tenantId, row, "moved");
  if (subApplicationId !== null) {
    if (row.status === "void") {
      throw new JobsError("INVALID_STATUS", `back-charge ${row.number} has been dropped, so there is nothing to deduct`);
    }
    const app = await applicationOf(tx, ctx.tenantId, subApplicationId);
    if (!app) throw new JobsError("NOT_FOUND", `application ${subApplicationId} not found`);
    if (app.status !== "draft") {
      throw new JobsError("INVALID_STATUS", "a back-charge comes off a draft application, not one already billed");
    }
    const owns = await tx
      .select({ id: schema.jobSubApplications.id })
      .from(schema.jobSubApplications)
      .where(
        and(
          eq(schema.jobSubApplications.tenantId, ctx.tenantId),
          eq(schema.jobSubApplications.id, subApplicationId),
          eq(schema.jobSubApplications.commitmentId, row.commitmentId),
        ),
      )
      .limit(1);
    if (owns.length === 0) {
      throw new JobsError("INVALID_VALUE", "that application is against a different order");
    }
  }
  const rows = await tx
    .update(schema.jobBackCharges)
    .set({ subApplicationId, version: row.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.jobBackCharges.tenantId, ctx.tenantId), eq(schema.jobBackCharges.id, id)))
    .returning();
  return rows[0];
}

// ------------------------------------------------------------------ reading

export interface BackChargeRow {
  backCharge: JobBackCharge;
  standing: BackChargeStanding;
  /** "01 74 00 · Cleaning", or null when it carries no code. */
  codeLabel: string | null;
  /** The warranty claim it came from, by number and words, while that claim exists. */
  claimNumber: number | null;
  claimTitle: string | null;
  /** The application it rides, by number, while it rides one. */
  applicationNumber: number | null;
  applicationStatus: string | null;
}

const columns = {
  backCharge: schema.jobBackCharges,
  code: schema.jobCostCodes.code,
  codeName: schema.jobCostCodes.name,
  claimNumber: schema.jobWarrantyClaims.number,
  claimTitle: schema.jobWarrantyClaims.title,
  applicationNumber: schema.jobSubApplications.number,
  applicationStatus: schema.jobSubApplications.status,
};

function query(tx: Tx, tenantId: string, where: SQL | undefined) {
  return tx
    .select(columns)
    .from(schema.jobBackCharges)
    .leftJoin(
      schema.jobCostCodes,
      and(eq(schema.jobCostCodes.tenantId, schema.jobBackCharges.tenantId), eq(schema.jobCostCodes.id, schema.jobBackCharges.costCodeId)),
    )
    .leftJoin(
      schema.jobWarrantyClaims,
      and(
        eq(schema.jobWarrantyClaims.tenantId, schema.jobBackCharges.tenantId),
        eq(schema.jobWarrantyClaims.id, schema.jobBackCharges.warrantyClaimId),
      ),
    )
    .leftJoin(
      schema.jobSubApplications,
      and(
        eq(schema.jobSubApplications.tenantId, schema.jobBackCharges.tenantId),
        eq(schema.jobSubApplications.id, schema.jobBackCharges.subApplicationId),
      ),
    )
    .where(and(eq(schema.jobBackCharges.tenantId, tenantId), where))
    .orderBy(asc(schema.jobBackCharges.number));
}

type Selected = {
  backCharge: JobBackCharge;
  code: string | null;
  codeName: string | null;
  claimNumber: number | null;
  claimTitle: string | null;
  applicationNumber: number | null;
  applicationStatus: string | null;
};

function toRow(r: Selected): BackChargeRow {
  return {
    backCharge: r.backCharge,
    standing: backChargeStanding(r.backCharge.status, r.applicationStatus ? { status: r.applicationStatus } : null),
    codeLabel: r.code ? `${r.code} · ${r.codeName ?? ""}`.trim() : null,
    claimNumber: r.claimNumber,
    claimTitle: r.claimTitle,
    applicationNumber: r.applicationNumber,
    applicationStatus: r.applicationStatus,
  };
}

/** One order's back-charges, in the order they were raised. */
export async function listBackCharges(tx: Tx, tenantId: string, commitmentId: string): Promise<BackChargeRow[]> {
  return (await query(tx, tenantId, eq(schema.jobBackCharges.commitmentId, commitmentId))).map(toRow);
}

/**
 * Every back-charge on a job, across its orders — what the warranty tab reads
 * to say a claim has been charged back to the trade that caused it.
 */
export async function listBackChargesForProject(tx: Tx, tenantId: string, projectId: string): Promise<BackChargeRow[]> {
  const commitments = await tx
    .select({ id: schema.jobCommitments.id })
    .from(schema.jobCommitments)
    .where(and(eq(schema.jobCommitments.tenantId, tenantId), eq(schema.jobCommitments.projectId, projectId)));
  if (commitments.length === 0) return [];
  return (
    await query(
      tx,
      tenantId,
      inArray(
        schema.jobBackCharges.commitmentId,
        commitments.map((c) => c.id),
      ),
    )
  ).map(toRow);
}

/**
 * What is riding on one application — asked by `approveSubApplication` as it
 * builds the bill, and by the order's page to show what a draft will take.
 * Open ones only: a dropped back-charge cannot be on an application anyway,
 * and the CHECK says so.
 */
export async function backChargesOn(tx: Tx, tenantId: string, subApplicationId: string): Promise<JobBackCharge[]> {
  return tx
    .select()
    .from(schema.jobBackCharges)
    .where(
      and(
        eq(schema.jobBackCharges.tenantId, tenantId),
        eq(schema.jobBackCharges.subApplicationId, subApplicationId),
        eq(schema.jobBackCharges.status, "open"),
      ),
    )
    .orderBy(asc(schema.jobBackCharges.number));
}

/**
 * Let go of an application's back-charges — what voiding one does. The bill
 * has been voided, so the deduction has been unwound in the books; the money
 * is owed again and the next application can take it.
 */
export async function freeBackChargesFrom(tx: Tx, tenantId: string, subApplicationId: string): Promise<void> {
  await tx
    .update(schema.jobBackCharges)
    .set({ subApplicationId: null, updatedAt: new Date() })
    .where(and(eq(schema.jobBackCharges.tenantId, tenantId), eq(schema.jobBackCharges.subApplicationId, subApplicationId)));
}
