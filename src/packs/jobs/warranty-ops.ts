import "server-only";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobProject, JobWarrantyClaim } from "@/db/schema";
import {
  createWorkForEntity,
  detachEntityType,
  listWorkByIds,
  setWorkComplete,
  updateEntityWork,
  type EntityWorkRow,
} from "@/lib/work/entity-work";
import { JobsError, getProject, requireWrite, type JobsCtx } from "./ops";
import { claimStanding, warrantyExpiresOn, withinWarranty, workTitleFor, type WarrantyPeriod } from "./warranty-math";
import {
  PACK,
  WARRANTY_CLAIM_ENTITY,
  WARRANTY_MONTHS_MAX,
  isWarrantyDecision,
  type ClaimStanding,
  type WarrantyDecision,
} from "./vocabulary";

/**
 * Warranty (ADR 0076): the period on the job, and the claims that come in
 * after it is done. A claim is the record of the call; the work it needs is
 * an ordinary Work item linked to the claim, raised the moment the claim is
 * recorded, so the digest chases it and the Work module assigns and dates
 * it. Where a claim stands is derived from the two and never stored.
 *
 * Member-wide: the person who takes the call records it, the person who
 * goes to look decides it. The period is a term of the contract, so it is
 * the owner's; so is deleting a claim, which is the record of a call.
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

const workCtx = (ctx: JobsCtx) => ({ tenantId: ctx.tenantId, userId: ctx.userId });

// ---------------------------------------------------------------- the period

export interface WarrantyPeriodInput {
  warrantyMonths: number | null;
  substantialCompletionOn: string | null;
}

/**
 * The warranty period, on the job. Either half may be blank — a job with a
 * completion date and no term is a job whose contract says nothing about a
 * warranty — and the expiry is derived from the two by `warrantyExpiresOn`.
 * Owner-only: it is a term of the agreement, the way a contract's value is.
 */
export async function setWarrantyPeriod(
  tx: Tx,
  ctx: JobsCtx,
  projectId: string,
  input: WarrantyPeriodInput,
): Promise<JobProject> {
  requireWrite(ctx, "owner");
  const project = await getProject(tx, ctx.tenantId, projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${projectId} not found`);
  const months = input.warrantyMonths;
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > WARRANTY_MONTHS_MAX)) {
    throw new JobsError("INVALID_VALUE", `a warranty runs a whole number of months, from 1 to ${WARRANTY_MONTHS_MAX.toLocaleString("en-US")}`);
  }
  const completion = input.substantialCompletionOn === null || input.substantialCompletionOn.trim() === "" ? null : dateOrThrow(input.substantialCompletionOn, "substantial completion");
  const rows = await tx
    .update(schema.jobProjects)
    .set({ warrantyMonths: months, substantialCompletionOn: completion, version: sql`${schema.jobProjects.version} + 1`, updatedAt: new Date() })
    .where(and(eq(schema.jobProjects.tenantId, ctx.tenantId), eq(schema.jobProjects.id, projectId)))
    .returning();
  return rows[0];
}

// ------------------------------------------------------------------ a claim

export interface ClaimInput {
  title: string;
  location?: string;
  reportedOn: string;
  reportedBy?: string;
  partyId?: string | null;
  costCodeId?: string | null;
  notes?: string;
  /** When somebody should have looked at it by; the Work item's due date. */
  dueOn?: string | null;
}

async function partyOrThrow(tx: Tx, tenantId: string, partyId: string | null | undefined): Promise<string | null> {
  if (!partyId) return null;
  const rows = await tx
    .select({ id: schema.parties.id })
    .from(schema.parties)
    .where(and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, partyId)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("INVALID_VALUE", "that trade is not in the books");
  return partyId;
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

function checkedClaim(input: ClaimInput) {
  const title = bounded(input.title, 300, "what is wrong");
  if (title === "") throw new JobsError("INVALID_VALUE", "a claim needs saying what is wrong");
  return {
    title,
    location: bounded(input.location, 300, "where"),
    reportedOn: dateOrThrow(input.reportedOn, "a claim"),
    reportedBy: bounded(input.reportedBy, 200, "who reported it"),
    notes: bounded(input.notes, 4000, "the notes"),
  };
}

export async function getClaim(tx: Tx, tenantId: string, claimId: string): Promise<JobWarrantyClaim | null> {
  const rows = await tx
    .select()
    .from(schema.jobWarrantyClaims)
    .where(and(eq(schema.jobWarrantyClaims.tenantId, tenantId), eq(schema.jobWarrantyClaims.id, claimId)))
    .limit(1);
  return rows[0] ?? null;
}

async function claimOrThrow(tx: Tx, tenantId: string, claimId: string): Promise<JobWarrantyClaim> {
  const claim = await getClaim(tx, tenantId, claimId);
  if (!claim) throw new JobsError("NOT_FOUND", `warranty claim ${claimId} not found`);
  return claim;
}

/** The Work item's notes: where, who and when, then the claim's own notes. */
function workNotes(c: { location: string; reportedOn: string; reportedBy: string; notes: string }): string {
  return [
    c.location ? `Where: ${c.location}` : null,
    `Reported ${c.reportedOn}${c.reportedBy ? ` by ${c.reportedBy}` : ""}`,
    c.notes || null,
  ]
    .filter((x): x is string => x !== null)
    .join("\n");
}

/** Raise the claim's Work item and remember it. The link is to the CLAIM, so the punch list stays the punch list. */
async function raiseWork(tx: Tx, ctx: JobsCtx, claim: JobWarrantyClaim, project: JobProject, dueOn: string | null): Promise<string> {
  const itemId = await createWorkForEntity(
    tx,
    workCtx(ctx),
    { extensionSlug: PACK, entityType: WARRANTY_CLAIM_ENTITY, entityId: claim.id },
    { title: workTitleFor(claim.number, claim.title, project.number), notes: workNotes(claim), dueOn },
  );
  await tx
    .update(schema.jobWarrantyClaims)
    .set({ workItemId: itemId, updatedAt: new Date() })
    .where(and(eq(schema.jobWarrantyClaims.tenantId, ctx.tenantId), eq(schema.jobWarrantyClaims.id, claim.id)));
  return itemId;
}

async function workRow(tx: Tx, tenantId: string, itemId: string | null): Promise<EntityWorkRow | null> {
  if (!itemId) return null;
  const rows = await listWorkByIds(tx, { tenantId }, [itemId]);
  return rows[0] ?? null;
}

/**
 * Record a claim: the next number on the job, the call as reported, and the
 * Work item raised at once — somebody has to go and look whatever the
 * decision turns out to be. Any member; the person who takes the call
 * records it.
 */
export async function recordClaim(tx: Tx, ctx: JobsCtx, projectId: string, input: ClaimInput): Promise<JobWarrantyClaim> {
  requireWrite(ctx, "member");
  const project = await getProject(tx, ctx.tenantId, projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${projectId} not found`);
  const checked = checkedClaim(input);
  const partyId = await partyOrThrow(tx, ctx.tenantId, input.partyId);
  const costCodeId = await codeOrThrow(tx, ctx.tenantId, input.costCodeId);
  const dueOn = input.dueOn ? dateOrThrow(input.dueOn, "the day to look by") : null;
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(${schema.jobWarrantyClaims.number}), 0)`.mapWith(Number) })
    .from(schema.jobWarrantyClaims)
    .where(and(eq(schema.jobWarrantyClaims.tenantId, ctx.tenantId), eq(schema.jobWarrantyClaims.projectId, projectId)));
  const rows = await tx
    .insert(schema.jobWarrantyClaims)
    .values({
      tenantId: ctx.tenantId,
      projectId,
      number: max + 1,
      ...checked,
      partyId,
      costCodeId,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  const claim = rows[0];
  const workItemId = await raiseWork(tx, ctx, claim, project, dueOn);
  return { ...claim, workItemId };
}

export interface ClaimPatch {
  title?: string;
  location?: string;
  reportedOn?: string;
  reportedBy?: string;
  partyId?: string | null;
  costCodeId?: string | null;
  notes?: string;
}

/** Edit the call as recorded. The Work item's title follows the claim's. */
export async function updateClaim(
  tx: Tx,
  ctx: JobsCtx,
  claimId: string,
  patch: ClaimPatch,
  expectedVersion: number,
): Promise<JobWarrantyClaim> {
  requireWrite(ctx, "member");
  const claim = await claimOrThrow(tx, ctx.tenantId, claimId);
  if (claim.version !== expectedVersion) throw new JobsError("STALE_VERSION", "claim changed");
  const merged = checkedClaim({
    title: patch.title ?? claim.title,
    location: patch.location ?? claim.location,
    reportedOn: patch.reportedOn ?? claim.reportedOn,
    reportedBy: patch.reportedBy ?? claim.reportedBy,
    notes: patch.notes ?? claim.notes,
  });
  const partyId = patch.partyId === undefined ? claim.partyId : await partyOrThrow(tx, ctx.tenantId, patch.partyId);
  const costCodeId = patch.costCodeId === undefined ? claim.costCodeId : await codeOrThrow(tx, ctx.tenantId, patch.costCodeId);
  const rows = await tx
    .update(schema.jobWarrantyClaims)
    .set({ ...merged, partyId, costCodeId, version: claim.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.jobWarrantyClaims.tenantId, ctx.tenantId), eq(schema.jobWarrantyClaims.id, claimId)))
    .returning();
  const updated = rows[0];
  const work = await workRow(tx, ctx.tenantId, claim.workItemId);
  if (work) {
    const project = await getProject(tx, ctx.tenantId, claim.projectId);
    await updateEntityWork(tx, workCtx(ctx), work.id, work.version, {
      title: workTitleFor(updated.number, updated.title, project?.number ?? ""),
      notes: workNotes(updated),
    });
  }
  return updated;
}

export interface DecisionInput {
  decision: string;
  note?: string;
  /** Required for a decision; ignored for `pending`. */
  decidedOn?: string | null;
}

/**
 * Decide the claim. A decision carries the day it was made; putting it back
 * to undecided clears the day. Not covered closes the Work item — going to
 * look was the work, and the claim's own standing says the rest — while a
 * claim decided covered keeps its item open for the fix.
 */
export async function decideClaim(tx: Tx, ctx: JobsCtx, claimId: string, input: DecisionInput): Promise<JobWarrantyClaim> {
  requireWrite(ctx, "member");
  const claim = await claimOrThrow(tx, ctx.tenantId, claimId);
  if (!isWarrantyDecision(input.decision)) throw new JobsError("INVALID_VALUE", "a decision is covered, not covered or undecided");
  const decision: WarrantyDecision = input.decision;
  const decidedOn = decision === "pending" ? null : dateOrThrow(input.decidedOn, "a decision");
  const rows = await tx
    .update(schema.jobWarrantyClaims)
    .set({ decision, decidedOn, decisionNote: bounded(input.note, 2000, "the reason"), version: claim.version + 1, updatedAt: new Date() })
    .where(and(eq(schema.jobWarrantyClaims.tenantId, ctx.tenantId), eq(schema.jobWarrantyClaims.id, claimId)))
    .returning();
  if (decision === "not_covered") {
    const work = await workRow(tx, ctx.tenantId, claim.workItemId);
    if (work && work.completedAt === null) await setWorkComplete(tx, workCtx(ctx), work.id, true);
  }
  return rows[0];
}

/** Put a date on the claim's Work item — the day somebody will be there — raising the item again if Work had cleared it. */
export async function scheduleClaim(tx: Tx, ctx: JobsCtx, claimId: string, dueOn: string | null): Promise<void> {
  requireWrite(ctx, "member");
  const claim = await claimOrThrow(tx, ctx.tenantId, claimId);
  const due = dueOn ? dateOrThrow(dueOn, "the day") : null;
  const work = await workRow(tx, ctx.tenantId, claim.workItemId);
  if (!work) {
    const project = await getProject(tx, ctx.tenantId, claim.projectId);
    if (!project) throw new JobsError("NOT_FOUND", `project ${claim.projectId} not found`);
    await raiseWork(tx, ctx, claim, project, due);
    return;
  }
  await updateEntityWork(tx, workCtx(ctx), work.id, work.version, { dueOn: due });
}

/** Tick the claim done, or open it again: the Work item's own state, and one fact. */
export async function setClaimDone(tx: Tx, ctx: JobsCtx, claimId: string, done: boolean): Promise<void> {
  requireWrite(ctx, "member");
  const claim = await claimOrThrow(tx, ctx.tenantId, claimId);
  let itemId = claim.workItemId;
  if (itemId) {
    const work = await workRow(tx, ctx.tenantId, itemId);
    if (!work) itemId = null;
  }
  if (!itemId) {
    if (!done) return;
    const project = await getProject(tx, ctx.tenantId, claim.projectId);
    if (!project) throw new JobsError("NOT_FOUND", `project ${claim.projectId} not found`);
    itemId = await raiseWork(tx, ctx, claim, project, null);
  }
  await setWorkComplete(tx, workCtx(ctx), itemId, done);
}

/** Remove a claim recorded by mistake. Its Work item stays, unlinked, because it may already have been worked. */
export async function deleteClaim(tx: Tx, ctx: JobsCtx, claimId: string): Promise<void> {
  requireWrite(ctx, "owner");
  const claim = await claimOrThrow(tx, ctx.tenantId, claimId);
  if (claim.workItemId) await detachEntityType(tx, { tenantId: ctx.tenantId }, claim.workItemId, WARRANTY_CLAIM_ENTITY);
  await tx
    .delete(schema.jobWarrantyClaims)
    .where(and(eq(schema.jobWarrantyClaims.tenantId, ctx.tenantId), eq(schema.jobWarrantyClaims.id, claimId)));
}

// ------------------------------------------------------------------ reading

export interface ClaimRow {
  claim: JobWarrantyClaim;
  work: EntityWorkRow | null;
  partyName: string | null;
  codeLabel: string | null;
  standing: ClaimStanding;
  /** Inside the job's period by the day reported; null when the job has no period. */
  withinWarranty: boolean | null;
}

const claimColumns = {
  claim: schema.jobWarrantyClaims,
  partyName: schema.parties.displayName,
  code: schema.jobCostCodes.code,
  codeName: schema.jobCostCodes.name,
};

type ClaimSelect = { claim: JobWarrantyClaim; partyName: string | null; code: string | null; codeName: string | null };

async function decorate(tx: Tx, tenantId: string, rows: ClaimSelect[], periodOf: (projectId: string) => WarrantyPeriod): Promise<ClaimRow[]> {
  const work = new Map(
    (await listWorkByIds(tx, { tenantId }, rows.map((r) => r.claim.workItemId).filter((id): id is string => id !== null))).map((w) => [w.id, w]),
  );
  return rows.map((r) => {
    const w = r.claim.workItemId ? (work.get(r.claim.workItemId) ?? null) : null;
    return {
      claim: r.claim,
      work: w,
      partyName: r.partyName,
      codeLabel: r.code ? `${r.code} ${r.codeName ?? ""}`.trim() : null,
      standing: claimStanding(r.claim.decision as WarrantyDecision, w),
      withinWarranty: withinWarranty(r.claim.reportedOn, periodOf(r.claim.projectId)),
    };
  });
}

/** Drizzle's builder takes one `where`, so the tenant clause and the caller's are joined here. */
function claimQuery(tx: Tx, tenantId: string, where?: SQL) {
  return tx
    .select(claimColumns)
    .from(schema.jobWarrantyClaims)
    .leftJoin(schema.parties, and(eq(schema.parties.tenantId, schema.jobWarrantyClaims.tenantId), eq(schema.parties.id, schema.jobWarrantyClaims.partyId)))
    .leftJoin(schema.jobCostCodes, and(eq(schema.jobCostCodes.tenantId, schema.jobWarrantyClaims.tenantId), eq(schema.jobCostCodes.id, schema.jobWarrantyClaims.costCodeId)))
    .where(and(eq(schema.jobWarrantyClaims.tenantId, tenantId), where));
}

/** A job's claims, newest first. The project is passed in for its period. */
export async function listClaims(tx: Tx, tenantId: string, project: JobProject): Promise<ClaimRow[]> {
  const rows = await claimQuery(tx, tenantId, eq(schema.jobWarrantyClaims.projectId, project.id)).orderBy(desc(schema.jobWarrantyClaims.number));
  return decorate(tx, tenantId, rows, () => project);
}

export interface ClaimAcrossJobs extends ClaimRow {
  projectId: string;
  projectNumber: string;
  projectName: string;
}

/** Every claim in the workspace with its job, newest reported first — the Warranty page across jobs. */
export async function listClaimsAcrossJobs(tx: Tx, tenantId: string): Promise<ClaimAcrossJobs[]> {
  const rows = await tx
    .select({
      ...claimColumns,
      projectNumber: schema.jobProjects.number,
      projectName: schema.jobProjects.name,
      substantialCompletionOn: schema.jobProjects.substantialCompletionOn,
      warrantyMonths: schema.jobProjects.warrantyMonths,
    })
    .from(schema.jobWarrantyClaims)
    .innerJoin(schema.jobProjects, and(eq(schema.jobProjects.tenantId, schema.jobWarrantyClaims.tenantId), eq(schema.jobProjects.id, schema.jobWarrantyClaims.projectId)))
    .leftJoin(schema.parties, and(eq(schema.parties.tenantId, schema.jobWarrantyClaims.tenantId), eq(schema.parties.id, schema.jobWarrantyClaims.partyId)))
    .leftJoin(schema.jobCostCodes, and(eq(schema.jobCostCodes.tenantId, schema.jobWarrantyClaims.tenantId), eq(schema.jobCostCodes.id, schema.jobWarrantyClaims.costCodeId)))
    .where(eq(schema.jobWarrantyClaims.tenantId, tenantId))
    .orderBy(desc(schema.jobWarrantyClaims.reportedOn), desc(schema.jobWarrantyClaims.createdAt));
  const periods = new Map<string, WarrantyPeriod>();
  for (const r of rows) periods.set(r.claim.projectId, { substantialCompletionOn: r.substantialCompletionOn, warrantyMonths: r.warrantyMonths });
  const decorated = await decorate(tx, tenantId, rows, (projectId) => periods.get(projectId) ?? { substantialCompletionOn: null, warrantyMonths: null });
  return decorated.map((d, i) => ({ ...d, projectId: rows[i].claim.projectId, projectNumber: rows[i].projectNumber, projectName: rows[i].projectName }));
}

export interface WarrantyPeriodRow {
  projectId: string;
  projectNumber: string;
  projectName: string;
  substantialCompletionOn: string;
  warrantyMonths: number;
  expiresOn: string;
}

/** Every job with a warranty period set, soonest to end first. */
export async function listWarrantyPeriods(tx: Tx, tenantId: string): Promise<WarrantyPeriodRow[]> {
  const rows = await tx
    .select({
      projectId: schema.jobProjects.id,
      projectNumber: schema.jobProjects.number,
      projectName: schema.jobProjects.name,
      substantialCompletionOn: schema.jobProjects.substantialCompletionOn,
      warrantyMonths: schema.jobProjects.warrantyMonths,
    })
    .from(schema.jobProjects)
    .where(eq(schema.jobProjects.tenantId, tenantId))
    .orderBy(asc(schema.jobProjects.number));
  const out: WarrantyPeriodRow[] = [];
  for (const r of rows) {
    const expiresOn = warrantyExpiresOn({ substantialCompletionOn: r.substantialCompletionOn, warrantyMonths: r.warrantyMonths });
    if (!expiresOn) continue;
    out.push({ ...r, substantialCompletionOn: r.substantialCompletionOn!, warrantyMonths: r.warrantyMonths!, expiresOn });
  }
  return out.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || a.projectNumber.localeCompare(b.projectNumber));
}
