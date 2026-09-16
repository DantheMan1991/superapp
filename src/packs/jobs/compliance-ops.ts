import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobLienWaiver, JobPartyDocument } from "@/db/schema";
import { attachmentCounts } from "@/modules/documents/attachments";
import { loadBill } from "@/modules/accounting/payables/bills";
import {
  createWorkForEntity,
  listWorkForEntity,
  type EntityWorkRow,
} from "@/lib/work/entity-work";
import { JobsError, getProject, requireWrite, type JobsCtx } from "./ops";
import { addDays } from "@/lib/timezone";
import {
  COMMITMENT_ENTITY,
  COMMITTED_STATUSES,
  EXPIRING_SOON_DAYS,
  LIEN_WAIVER_ENTITY,
  PACK,
  PARTY_DOCUMENT_ENTITY,
  PARTY_ENTITY,
  isFinalWaiver,
  isLienWaiverKind,
  isLienWaiverStatus,
  isPartyDocumentKind,
  isPartyDocumentStatus,
  isUnconditionalWaiver,
  partyDocumentKindLabel,
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
      throw new JobsError("RECEIVED_DATE_REQUIRED", "a received document needs the date it arrived");
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


// -------------------------------------------------------------- party documents

/**
 * Party documents — slice 11b, ADR 0068: what a subcontractor or supplier
 * has on file with the business, and whether it is current.
 *
 * PER PARTY, NOT PER JOB. A framer's certificate of insurance covers every
 * job he is on; the row hangs off the party, and the page reads every party
 * with an order on a live job. The KIND is the business's (an open taxonomy,
 * format-checked, three suggested), the REQUIRED list is the tenant's config
 * or the pack's default, and the only behaviour a kind carries is its expiry:
 * a certificate past its date is as good as missing, one within a month is
 * worth a sentence. Missing, expired and expiring are computed at read time,
 * never stored — the waiver's rule, one level up.
 */

export interface PartyDocumentInput {
  partyId: string;
  kind: string;
  title?: string;
  reference?: string;
  issuer?: string;
  issuedOn?: string | null;
  expiresOn?: string | null;
  limitCents?: number | null;
  status?: string;
  requestedOn?: string | null;
  receivedOn?: string | null;
  notes?: string;
}

function validatePartyDocumentShape(input: Partial<PartyDocumentInput>): void {
  if (input.kind !== undefined && !isPartyDocumentKind(input.kind)) {
    throw new JobsError("INVALID_KIND", `invalid document kind: ${input.kind}`);
  }
  if (input.status !== undefined && !isPartyDocumentStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  const limit = input.limitCents ?? null;
  if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
    throw new JobsError("INVALID_VALUE", "a coverage limit cannot be negative");
  }
}

export async function createPartyDocument(
  tx: Tx,
  ctx: JobsCtx,
  input: PartyDocumentInput,
): Promise<JobPartyDocument> {
  requireWrite(ctx, "member");
  validatePartyDocumentShape(input);
  const status = input.status ?? "received";
  const rows = await tx
    .insert(schema.jobPartyDocuments)
    .values({
      tenantId: ctx.tenantId,
      partyId: input.partyId,
      kind: input.kind,
      title: input.title?.trim() ?? "",
      reference: input.reference?.trim() ?? "",
      issuer: input.issuer?.trim() ?? "",
      issuedOn: input.issuedOn ?? null,
      expiresOn: input.expiresOn ?? null,
      limitCents: input.limitCents ?? null,
      status,
      requestedOn: input.requestedOn ?? null,
      receivedOn: receiptDateFor(status, input.receivedOn ?? null),
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

/** One document, or null: the photo actions' check. */
export async function getPartyDocument(tx: Tx, tenantId: string, id: string): Promise<JobPartyDocument | null> {
  const rows = await tx
    .select()
    .from(schema.jobPartyDocuments)
    .where(and(eq(schema.jobPartyDocuments.tenantId, tenantId), eq(schema.jobPartyDocuments.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** Change a document: everything but whose it is. Void is a status, not a delete. */
export async function updatePartyDocument(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<Omit<PartyDocumentInput, "partyId">> & { version?: number },
): Promise<JobPartyDocument> {
  requireWrite(ctx, "member");
  validatePartyDocumentShape(input);
  const existing = await getPartyDocument(tx, ctx.tenantId, id);
  if (!existing) throw new JobsError("NOT_FOUND", `party document ${id} not found`);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "document changed since loaded");
  }
  const status = input.status ?? existing.status;
  const receivedOn = input.receivedOn !== undefined ? input.receivedOn : existing.receivedOn;
  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing.version + 1,
    status,
    receivedOn: receiptDateFor(status, receivedOn),
  };
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.reference !== undefined) patch.reference = input.reference.trim();
  if (input.issuer !== undefined) patch.issuer = input.issuer.trim();
  if (input.issuedOn !== undefined) patch.issuedOn = input.issuedOn;
  if (input.expiresOn !== undefined) patch.expiresOn = input.expiresOn;
  if (input.limitCents !== undefined) patch.limitCents = input.limitCents;
  if (input.requestedOn !== undefined) patch.requestedOn = input.requestedOn;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  const rows = await tx
    .update(schema.jobPartyDocuments)
    .set(patch)
    .where(and(eq(schema.jobPartyDocuments.tenantId, ctx.tenantId), eq(schema.jobPartyDocuments.id, id)))
    .returning();
  return rows[0];
}

export interface PartyDocumentRow {
  document: JobPartyDocument;
  /** Scanned copies attached through Documents. */
  attachmentCount: number;
}

/** Every document of the given parties (or of every party), newest expiry first. */
export async function listPartyDocuments(
  tx: Tx,
  tenantId: string,
  partyIds?: readonly string[],
): Promise<PartyDocumentRow[]> {
  if (partyIds && partyIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(schema.jobPartyDocuments)
    .where(
      and(
        eq(schema.jobPartyDocuments.tenantId, tenantId),
        ...(partyIds ? [inArray(schema.jobPartyDocuments.partyId, [...partyIds])] : []),
      ),
    )
    .orderBy(desc(schema.jobPartyDocuments.expiresOn), desc(schema.jobPartyDocuments.createdAt));
  if (rows.length === 0) return [];
  const counts = await attachmentCounts(
    tx,
    tenantId,
    PARTY_DOCUMENT_ENTITY,
    rows.map((r) => r.id),
  );
  return rows.map((document) => ({ document, attachmentCount: counts.get(document.id) ?? 0 }));
}

export type StandingState = "ok" | "expiring" | "expired" | "missing";

export interface RequiredStanding {
  kind: string;
  state: StandingState;
  /** The document that answers the kind — the one that runs longest — or null. */
  document: JobPartyDocument | null;
}

export interface PartyStanding {
  partyId: string;
  partyName: string;
  /** The live jobs the party has an issued or closed order on. */
  projects: Array<{ id: string; number: string; name: string }>;
  required: RequiredStanding[];
  /** Everything else on file, received. */
  others: JobPartyDocument[];
  /** Every required kind is on file and not expired. Expiring still stands. */
  good: boolean;
}

/** Whole days from `from` to `to`, both ISO dates; negative when `to` is earlier. */
function daysUntil(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/**
 * THE STANDING RULE, pure: for each required kind, the received document
 * that runs longest — one with no expiry beats any date — and its state
 * against today. Missing, expired, expiring within `EXPIRING_SOON_DAYS`, or
 * ok. Void and requested documents are not on file.
 */
export function standingFor(
  documents: readonly JobPartyDocument[],
  required: readonly string[],
  asOf: string,
): Pick<PartyStanding, "required" | "others" | "good"> {
  const received = documents.filter((d) => d.status === "received");
  const requiredRows: RequiredStanding[] = required.map((kind) => {
    const mine = received.filter((d) => d.kind === kind);
    if (mine.length === 0) return { kind, state: "missing", document: null };
    const best = mine.reduce((a, b) =>
      a.expiresOn === null ? a : b.expiresOn === null ? b : b.expiresOn > a.expiresOn ? b : a,
    );
    const state: StandingState =
      best.expiresOn === null
        ? "ok"
        : best.expiresOn < asOf
          ? "expired"
          : daysUntil(asOf, best.expiresOn) <= EXPIRING_SOON_DAYS
            ? "expiring"
            : "ok";
    return { kind, state, document: best };
  });
  return {
    required: requiredRows,
    others: received.filter((d) => !required.includes(d.kind)),
    good: requiredRows.every((r) => r.state === "ok" || r.state === "expiring"),
  };
}

/**
 * EVERY PARTY WITH AN ORDER ON A LIVE JOB, and where each stands: the
 * insurance audit's own view. Issued or closed orders on jobs that are not
 * complete or cancelled; a draft order names nobody the business owes.
 */
export async function subcontractorStanding(
  tx: Tx,
  tenantId: string,
  required: readonly string[],
  asOf: string,
): Promise<PartyStanding[]> {
  const orders = await tx
    .select({
      partyId: schema.jobCommitments.partyId,
      partyName: schema.parties.displayName,
      projectId: schema.jobProjects.id,
      projectNumber: schema.jobProjects.number,
      projectName: schema.jobProjects.name,
    })
    .from(schema.jobCommitments)
    .innerJoin(
      schema.jobProjects,
      and(
        eq(schema.jobProjects.tenantId, schema.jobCommitments.tenantId),
        eq(schema.jobProjects.id, schema.jobCommitments.projectId),
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
        eq(schema.jobCommitments.tenantId, tenantId),
        inArray(schema.jobCommitments.status, [...COMMITTED_STATUSES]),
        inArray(schema.jobProjects.status, ["planned", "active", "on_hold"]),
      ),
    )
    .orderBy(asc(schema.parties.displayName), asc(schema.jobProjects.number));
  if (orders.length === 0) return [];
  const byParty = new Map<string, PartyStanding>();
  for (const o of orders) {
    const row = byParty.get(o.partyId) ?? {
      partyId: o.partyId,
      partyName: o.partyName ?? "—",
      projects: [],
      required: [],
      others: [],
      good: true,
    };
    if (!row.projects.some((p) => p.id === o.projectId)) {
      row.projects.push({ id: o.projectId, number: o.projectNumber, name: o.projectName });
    }
    byParty.set(o.partyId, row);
  }
  const documents = await listPartyDocuments(tx, tenantId, [...byParty.keys()]);
  for (const row of byParty.values()) {
    const mine = documents.filter((d) => d.document.partyId === row.partyId).map((d) => d.document);
    Object.assign(row, standingFor(mine, required, asOf));
  }
  return [...byParty.values()];
}

/** One party's standing, whatever it has on order — the commitment page's line. */
export async function partyStanding(
  tx: Tx,
  tenantId: string,
  partyId: string,
  required: readonly string[],
  asOf: string,
): Promise<Pick<PartyStanding, "required" | "others" | "good">> {
  const documents = await listPartyDocuments(tx, tenantId, [partyId]);
  return standingFor(
    documents.map((d) => d.document),
    required,
    asOf,
  );
}

/**
 * The chase, as a Work item linked to the PARTY — "Certificate of insurance
 * from Pleasant Valley Feed Mill" — not to any one job, because the document
 * is not any one job's.
 */
export async function askForPartyDocument(
  tx: Tx,
  ctx: JobsCtx,
  input: { partyId: string; kind: string; dueOn?: string | null },
): Promise<string> {
  requireWrite(ctx, "member");
  if (!isPartyDocumentKind(input.kind)) {
    throw new JobsError("INVALID_KIND", `invalid document kind: ${input.kind}`);
  }
  const party = await tx
    .select({ name: schema.parties.displayName })
    .from(schema.parties)
    .where(and(eq(schema.parties.tenantId, ctx.tenantId), eq(schema.parties.id, input.partyId)))
    .limit(1);
  if (party.length === 0) throw new JobsError("NOT_FOUND", `party ${input.partyId} not found`);
  return createWorkForEntity(
    tx,
    { tenantId: ctx.tenantId, userId: ctx.userId },
    { extensionSlug: PACK, entityType: PARTY_ENTITY, entityId: input.partyId },
    {
      title: `${partyDocumentKindLabel(input.kind)} from ${party[0].name}`,
      notes: "",
      dueOn: input.dueOn ?? null,
    },
  );
}

/**
 * THE CERTIFICATES THIS JOB SHOULD WORRY ABOUT: expired, or expiring inside
 * `EXPIRING_SOON_DAYS`, held by a party the job has actually ORDERED from.
 *
 * A party in the address book with a lapsed certificate is not this job's
 * problem — the scope is the commitments, which is what `boardExtras` applies
 * for the card board. `selectDistinct` on the document, because one
 * subcontractor can hold several orders on the same job and a lapsed
 * certificate is one problem, not one per order.
 */
export async function lapsedCertificatesForProject(
  tx: Tx,
  tenantId: string,
  projectId: string,
  asOf: string,
): Promise<{ partyName: string; kind: string; expiresOn: string | null }[]> {
  const rows = await tx
    .selectDistinct({
      partyName: schema.parties.displayName,
      kind: schema.jobPartyDocuments.kind,
      expiresOn: schema.jobPartyDocuments.expiresOn,
    })
    .from(schema.jobCommitments)
    .innerJoin(
      schema.jobPartyDocuments,
      and(
        eq(schema.jobPartyDocuments.tenantId, schema.jobCommitments.tenantId),
        eq(schema.jobPartyDocuments.partyId, schema.jobCommitments.partyId),
      ),
    )
    .innerJoin(schema.parties, eq(schema.parties.id, schema.jobCommitments.partyId))
    .where(
      and(
        eq(schema.jobCommitments.tenantId, tenantId),
        eq(schema.jobCommitments.projectId, projectId),
        inArray(schema.jobCommitments.status, [...COMMITTED_STATUSES]),
        lte(schema.jobPartyDocuments.expiresOn, addDays(asOf, EXPIRING_SOON_DAYS)),
      ),
    );
  // Soonest to expire first: the one to chase is the one furthest gone.
  return rows.sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));
}
