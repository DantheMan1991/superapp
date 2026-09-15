import "server-only";
import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobLienWaiver } from "@/db/schema";
import { attachmentCounts } from "@/modules/documents/attachments";
import { loadBill } from "@/modules/accounting/payables/bills";
import {
  createWorkForEntity,
  listWorkForEntity,
  type EntityWorkRow,
} from "@/lib/work/entity-work";
import { JobsError, getProject, requireWrite, type JobsCtx } from "./ops";
import {
  COMMITMENT_ENTITY,
  LIEN_WAIVER_ENTITY,
  PACK,
  isFinalWaiver,
  isLienWaiverKind,
  isLienWaiverStatus,
  isUnconditionalWaiver,
} from "./vocabulary";

/**
 * Lien waivers — slice 11a of the construction plan (`compliance`), ADR 0066.
 *
 * A waiver is a RECORD: who gives up the lien right, on which job and under
 * which of our orders, of which kind, through which date, for how much, and
 * whether the signed copy has arrived. The words on the form are the state's
 * or the lawyer's and are not here; the signed copy is a Documents attachment
 * on the row, as a daily log's photos are.
 *
 * **THE GAP IS DERIVED, NEVER STORED.** "Paid, and no unconditional waiver on
 * file" — the thing a bookkeeper actually looks for, and what the owner's
 * bank asks to see before the next draw — is computed at read time from the
 * subcontractor's applications (whose bill says whether money went out)
 * against the waivers received. Nothing here says "outstanding": a waiver
 * that arrives closes the gap by existing. The chase, when somebody wants one,
 * is a Work item linked to the ORDER — work raised where it lives, and not on
 * the job's punch list, which is what still needs fixing on site.
 *
 * Recording a waiver is a `member` chore, as the daily log is: the decision
 * it protects — paying — is Accounting's and an owner's.
 */

export interface LienWaiverInput {
  projectId: string;
  /** The claimant. Usually the order's party; a supplier of theirs may give one too. */
  partyId: string;
  commitmentId?: string | null;
  /** The billed application — the payment — it covers, when it is for one. Named with its order. */
  subApplicationId?: string | null;
  kind: string;
  throughDate: string;
  amountCents?: number;
  status?: string;
  requestedOn?: string | null;
  receivedOn?: string | null;
  signedBy?: string;
  reference?: string;
  notes?: string;
}

function validateWaiverShape(input: Partial<LienWaiverInput>): void {
  if (input.kind !== undefined && !isLienWaiverKind(input.kind)) {
    throw new JobsError("INVALID_KIND", `invalid waiver kind: ${input.kind}`);
  }
  if (input.status !== undefined && !isLienWaiverStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  if (
    input.amountCents !== undefined &&
    (!Number.isInteger(input.amountCents) || input.amountCents < 0)
  ) {
    throw new JobsError("INVALID_VALUE", "a waiver's amount cannot be negative");
  }
}

/**
 * Received has the date it arrived, requested has none, and void keeps what it
 * had — the date is the evidence, as a change order's approval date is, and
 * `job_lien_waivers_received_has_date` is the backstop.
 */
function receiptDateFor(status: string, receivedOn: string | null): string | null {
  if (status === "received") {
    if (!receivedOn) {
      throw new JobsError("RECEIVED_DATE_REQUIRED", "a received waiver needs the date it arrived");
    }
    return receivedOn;
  }
  if (status === "requested") return null;
  return receivedOn;
}

/**
 * The order a waiver names has to be this job's, and the application named
 * has to be that order's and BILLED: a waiver covers a payment, and a draft is
 * not one yet.
 */
async function assertWaiverLinks(
  tx: Tx,
  tenantId: string,
  projectId: string,
  commitmentId: string | null,
  subApplicationId: string | null,
): Promise<void> {
  if (commitmentId) {
    const rows = await tx
      .select({ projectId: schema.jobCommitments.projectId })
      .from(schema.jobCommitments)
      .where(and(eq(schema.jobCommitments.tenantId, tenantId), eq(schema.jobCommitments.id, commitmentId)))
      .limit(1);
    if (rows.length === 0) throw new JobsError("NOT_FOUND", `commitment ${commitmentId} not found`);
    if (rows[0].projectId !== projectId) {
      throw new JobsError("WRONG_PROJECT", "the order named is on another job");
    }
  }
  if (subApplicationId) {
    if (!commitmentId) {
      throw new JobsError("INVALID_VALUE", "an application is named together with its order");
    }
    const rows = await tx
      .select({ commitmentId: schema.jobSubApplications.commitmentId, status: schema.jobSubApplications.status })
      .from(schema.jobSubApplications)
      .where(
        and(eq(schema.jobSubApplications.tenantId, tenantId), eq(schema.jobSubApplications.id, subApplicationId)),
      )
      .limit(1);
    if (rows.length === 0) throw new JobsError("NOT_FOUND", `application ${subApplicationId} not found`);
    if (rows[0].commitmentId !== commitmentId) {
      throw new JobsError("INVALID_VALUE", "the application named is not on that order");
    }
    if (rows[0].status !== "billed") {
      throw new JobsError("INVALID_VALUE", "a waiver covers a billed application; this one is not billed");
    }
  }
}

export async function createLienWaiver(
  tx: Tx,
  ctx: JobsCtx,
  input: LienWaiverInput,
): Promise<JobLienWaiver> {
  requireWrite(ctx, "member");
  validateWaiverShape(input);
  const project = await getProject(tx, ctx.tenantId, input.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${input.projectId} not found`);
  const commitmentId = input.commitmentId ?? null;
  const subApplicationId = input.subApplicationId ?? null;
  await assertWaiverLinks(tx, ctx.tenantId, project.id, commitmentId, subApplicationId);
  const status = input.status ?? "requested";
  const rows = await tx
    .insert(schema.jobLienWaivers)
    .values({
      tenantId: ctx.tenantId,
      projectId: project.id,
      partyId: input.partyId,
      commitmentId,
      subApplicationId,
      kind: input.kind,
      throughDate: input.throughDate,
      amountCents: input.amountCents ?? 0,
      status,
      requestedOn: input.requestedOn ?? null,
      receivedOn: receiptDateFor(status, input.receivedOn ?? null),
      signedBy: input.signedBy?.trim() ?? "",
      reference: input.reference?.trim() ?? "",
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

async function loadWaiver(tx: Tx, tenantId: string, id: string): Promise<JobLienWaiver> {
  const rows = await tx
    .select()
    .from(schema.jobLienWaivers)
    .where(and(eq(schema.jobLienWaivers.tenantId, tenantId), eq(schema.jobLienWaivers.id, id)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `lien waiver ${id} not found`);
  return rows[0];
}

/** One waiver, or null: the page's loader and the photo actions' check. */
export async function getLienWaiver(tx: Tx, tenantId: string, id: string): Promise<JobLienWaiver | null> {
  const rows = await tx
    .select()
    .from(schema.jobLienWaivers)
    .where(and(eq(schema.jobLienWaivers.tenantId, tenantId), eq(schema.jobLienWaivers.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** Change a waiver: everything but the job it is on. Void is a status, not a delete. */
export async function updateLienWaiver(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<Omit<LienWaiverInput, "projectId">> & { version?: number },
): Promise<JobLienWaiver> {
  requireWrite(ctx, "member");
  validateWaiverShape(input);
  const existing = await loadWaiver(tx, ctx.tenantId, id);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "lien waiver changed since loaded");
  }
  const commitmentId = input.commitmentId !== undefined ? input.commitmentId : existing.commitmentId;
  const subApplicationId =
    input.subApplicationId !== undefined ? input.subApplicationId : existing.subApplicationId;
  await assertWaiverLinks(tx, ctx.tenantId, existing.projectId, commitmentId, subApplicationId);
  const status = input.status ?? existing.status;
  const receivedOn = input.receivedOn !== undefined ? input.receivedOn : existing.receivedOn;
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing.version + 1,
    status,
    receivedOn: receiptDateFor(status, receivedOn),
    commitmentId,
    subApplicationId,
  };
  if (input.partyId !== undefined) patch.partyId = input.partyId;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.throughDate !== undefined) patch.throughDate = input.throughDate;
  if (input.amountCents !== undefined) patch.amountCents = input.amountCents;
  if (input.requestedOn !== undefined) patch.requestedOn = input.requestedOn;
  if (input.signedBy !== undefined) patch.signedBy = input.signedBy.trim();
  if (input.reference !== undefined) patch.reference = input.reference.trim();
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  const rows = await tx
    .update(schema.jobLienWaivers)
    .set(patch)
    .where(and(eq(schema.jobLienWaivers.tenantId, ctx.tenantId), eq(schema.jobLienWaivers.id, id)))
    .returning();
  return rows[0];
}

export interface LienWaiverRow {
  waiver: JobLienWaiver;
  partyName: string;
  commitmentNumber: string | null;
  applicationNumber: number | null;
  /** Signed copies attached through Documents. */
  attachmentCount: number;
}

/** Every waiver on a project, latest through date first, with who gave it and what it names. */
export async function listLienWaivers(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<LienWaiverRow[]> {
  const rows = await tx
    .select({
      waiver: schema.jobLienWaivers,
      partyName: schema.parties.displayName,
      commitmentNumber: schema.jobCommitments.number,
      applicationNumber: schema.jobSubApplications.number,
    })
    .from(schema.jobLienWaivers)
    .leftJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.jobLienWaivers.tenantId),
        eq(schema.parties.id, schema.jobLienWaivers.partyId),
      ),
    )
    .leftJoin(
      schema.jobCommitments,
      and(
        eq(schema.jobCommitments.tenantId, schema.jobLienWaivers.tenantId),
        eq(schema.jobCommitments.id, schema.jobLienWaivers.commitmentId),
      ),
    )
    .leftJoin(
      schema.jobSubApplications,
      and(
        eq(schema.jobSubApplications.tenantId, schema.jobLienWaivers.tenantId),
        eq(schema.jobSubApplications.id, schema.jobLienWaivers.subApplicationId),
      ),
    )
    .where(and(eq(schema.jobLienWaivers.tenantId, tenantId), eq(schema.jobLienWaivers.projectId, projectId)))
    .orderBy(desc(schema.jobLienWaivers.throughDate), desc(schema.jobLienWaivers.createdAt));
  if (rows.length === 0) return [];
  const counts = await attachmentCounts(
    tx,
    tenantId,
    LIEN_WAIVER_ENTITY,
    rows.map((r) => r.waiver.id),
  );
  return rows.map((r) => ({
    waiver: r.waiver,
    partyName: r.partyName ?? "—",
    commitmentNumber: r.commitmentNumber ?? null,
    applicationNumber: r.applicationNumber ?? null,
    attachmentCount: counts.get(r.waiver.id) ?? 0,
  }));
}

export interface WaiverCoverage {
  commitmentId: string;
  /** The latest date an unconditional waiver on file covers, or null. */
  unconditionalThrough: string | null;
  /** The latest date a conditional waiver on file covers, or null. */
  conditionalThrough: string | null;
  /** An unconditional final waiver is on file: nothing more to ask for on this order. */
  finalOnFile: boolean;
}

const later = (a: string | null, b: string): string => (a === null || b > a ? b : a);

/** What each order on a project has on file, from RECEIVED waivers only. */
export async function waiverCoverage(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<Map<string, WaiverCoverage>> {
  const rows = await receivedWaivers(tx, tenantId, projectId);
  const out = new Map<string, WaiverCoverage>();
  for (const w of rows) {
    if (!w.commitmentId) continue;
    const cov = out.get(w.commitmentId) ?? {
      commitmentId: w.commitmentId,
      unconditionalThrough: null,
      conditionalThrough: null,
      finalOnFile: false,
    };
    if (isUnconditionalWaiver(w.kind)) {
      cov.unconditionalThrough = later(cov.unconditionalThrough, w.throughDate);
      if (isFinalWaiver(w.kind)) cov.finalOnFile = true;
    } else {
      cov.conditionalThrough = later(cov.conditionalThrough, w.throughDate);
    }
    out.set(w.commitmentId, cov);
  }
  return out;
}

async function receivedWaivers(tx: Tx, tenantId: string, projectId: string): Promise<JobLienWaiver[]> {
  return tx
    .select()
    .from(schema.jobLienWaivers)
    .where(
      and(
        eq(schema.jobLienWaivers.tenantId, tenantId),
        eq(schema.jobLienWaivers.projectId, projectId),
        eq(schema.jobLienWaivers.status, "received"),
        isNotNull(schema.jobLienWaivers.commitmentId),
      ),
    );
}

export interface WaiverGap {
  commitmentId: string;
  commitmentNumber: string;
  partyId: string;
  partyName: string;
  subApplicationId: string;
  applicationNumber: number;
  periodTo: string;
  dueCents: number;
  /** The bill has been paid, partly or wholly — money went out. */
  paid: boolean;
  /** The unconditional waiver a paid application needs, or the conditional one a billed one should carry. */
  missing: "unconditional" | "conditional";
}

/**
 * A waiver covers an application when it names it, when it is a final one, or
 * when its through date is on or after the application's period end.
 */
function covers(w: JobLienWaiver, app: { id: string; commitmentId: string; periodTo: string }): boolean {
  return (
    w.commitmentId === app.commitmentId &&
    (w.subApplicationId === app.id || isFinalWaiver(w.kind) || w.throughDate >= app.periodTo)
  );
}

/**
 * THE QUESTION A BOOKKEEPER ASKS: which subcontractors have been paid with no
 * unconditional waiver on file — and, softer, which billed applications have
 * not yet been paid and carry no waiver at all. Billed applications, oldest
 * first; a void application is nothing; whether money went out is the bill's
 * word, read through Accounting's own verb.
 */
export async function waiverGaps(tx: Tx, tenantId: string, projectId: string): Promise<WaiverGap[]> {
  const apps = await tx
    .select({
      app: schema.jobSubApplications,
      commitmentNumber: schema.jobCommitments.number,
      partyId: schema.jobCommitments.partyId,
      partyName: schema.parties.displayName,
    })
    .from(schema.jobSubApplications)
    .innerJoin(
      schema.jobCommitments,
      and(
        eq(schema.jobCommitments.tenantId, schema.jobSubApplications.tenantId),
        eq(schema.jobCommitments.id, schema.jobSubApplications.commitmentId),
      ),
    )
    .leftJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.jobCommitments.tenantId),
        eq(schema.parties.id, schema.jobCommitments.partyId),
      ),
    )
    .where(
      and(
        eq(schema.jobSubApplications.tenantId, tenantId),
        eq(schema.jobCommitments.projectId, projectId),
        eq(schema.jobSubApplications.status, "billed"),
      ),
    )
    .orderBy(asc(schema.jobCommitments.number), asc(schema.jobSubApplications.number));
  if (apps.length === 0) return [];
  const waivers = await receivedWaivers(tx, tenantId, projectId);
  const out: WaiverGap[] = [];
  for (const row of apps) {
    const app = row.app;
    let paid = false;
    if (app.billId) {
      const bill = await loadBill(tx, tenantId, app.billId);
      paid = bill.status === "paid" || bill.status === "partial";
    }
    const unconditional = waivers.some((w) => isUnconditionalWaiver(w.kind) && covers(w, app));
    const conditional = waivers.some((w) => !isUnconditionalWaiver(w.kind) && covers(w, app));
    let missing: WaiverGap["missing"] | null = null;
    if (paid && !unconditional) missing = "unconditional";
    else if (!paid && !unconditional && !conditional) missing = "conditional";
    if (!missing) continue;
    out.push({
      commitmentId: app.commitmentId,
      commitmentNumber: row.commitmentNumber,
      partyId: row.partyId,
      partyName: row.partyName ?? "—",
      subApplicationId: app.id,
      applicationNumber: app.number,
      periodTo: app.periodTo,
      dueCents: app.dueCents,
      paid,
      missing,
    });
  }
  return out;
}

/**
 * Raise the chase in Work, linked to the ORDER: "Lien waiver from Pleasant
 * Valley Feed Mill: unconditional through 2026-10-31 (SC-24109-1)". It is not
 * on the job's punch list, which is what still needs fixing on site; it is in
 * Work beside everything else the office has to do.
 */
export async function askForWaiver(
  tx: Tx,
  ctx: JobsCtx,
  input: { commitmentId: string; missing: "unconditional" | "conditional"; throughDate: string; dueOn?: string | null },
): Promise<string> {
  requireWrite(ctx, "member");
  const rows = await tx
    .select({
      commitment: schema.jobCommitments,
      partyName: schema.parties.displayName,
      projectNumber: schema.jobProjects.number,
      projectName: schema.jobProjects.name,
    })
    .from(schema.jobCommitments)
    .leftJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.jobCommitments.tenantId),
        eq(schema.parties.id, schema.jobCommitments.partyId),
      ),
    )
    .innerJoin(
      schema.jobProjects,
      and(
        eq(schema.jobProjects.tenantId, schema.jobCommitments.tenantId),
        eq(schema.jobProjects.id, schema.jobCommitments.projectId),
      ),
    )
    .where(and(eq(schema.jobCommitments.tenantId, ctx.tenantId), eq(schema.jobCommitments.id, input.commitmentId)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `commitment ${input.commitmentId} not found`);
  const { commitment, partyName, projectNumber, projectName } = rows[0];
  return createWorkForEntity(
    tx,
    { tenantId: ctx.tenantId, userId: ctx.userId },
    { extensionSlug: PACK, entityType: COMMITMENT_ENTITY, entityId: commitment.id },
    {
      title: `Lien waiver from ${partyName ?? "the subcontractor"}: ${input.missing} through ${input.throughDate} (${commitment.number})`,
      notes: `${projectNumber} · ${projectName}`,
      dueOn: input.dueOn ?? null,
    },
  );
}

/** What is being chased on an order: its open Work items. */
export async function listWaiverWork(tx: Tx, tenantId: string, commitmentId: string): Promise<EntityWorkRow[]> {
  const rows = await listWorkForEntity(tx, { tenantId }, { entityType: COMMITMENT_ENTITY, entityId: commitmentId });
  return rows.filter((r) => r.completedAt === null);
}

/** The ids of every waiver on a project, for a page attaching photos. */
export async function lienWaiverIds(tx: Tx, tenantId: string, projectId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.jobLienWaivers.id })
    .from(schema.jobLienWaivers)
    .where(and(eq(schema.jobLienWaivers.tenantId, tenantId), eq(schema.jobLienWaivers.projectId, projectId)));
  return rows.map((r) => r.id);
}

