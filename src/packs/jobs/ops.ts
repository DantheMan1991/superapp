import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
  JobBudgetLine,
  JobChangeOrder,
  JobChangeOrderLine,
  JobCommitment,
  JobCommitmentLine,
  JobContract,
  JobCostCode,
  JobCostCodeSet,
  JobPayApplication,
  JobPayApplicationLine,
  JobProject,
  JobSovLine,
} from "@/db/schema";
import {
  createInvoiceDraft,
  issueInvoice,
  loadInvoice,
  voidInvoice,
} from "@/modules/accounting/invoicing/invoices";
import {
  dueDateFromCustomerTerms,
  ensureCustomerForParty,
} from "@/modules/accounting/invoicing/customers";
import {
  payApplicationTotals,
  ppmToPercentString,
  type PayApplicationTotals,
  type PayLineFigures,
} from "./billing-math";
import {
  archiveDimensionMember,
  getBalances,
  listDimensionMembers,
  upsertDimensionMember,
  type EntityScope,
} from "@/modules/accounting/core";
import {
  APPROVED_CHANGE_STATUSES,
  COMMITTED_STATUSES,
  COST_CODE_DIMENSION,
  DELIVERY_METHOD_FORMAT,
  PROJECT_DIMENSION,
  RETAINAGE_PPM_MAX,
  RETAINAGE_RECEIVABLE_CODE,
  REVENUE_ACCOUNT_CODES,
  VALUED_CONTRACT_STATUSES,
  isBillingMethod,
  isChangeOrderStatus,
  isCommitmentKind,
  isCommitmentStatus,
  isContractRole,
  isContractStatus,
  isProjectStatus,
} from "./vocabulary";

/**
 * The `jobs` pack's write surface: projects, and the cost codes they are
 * budgeted against.
 *
 * **THE DIMENSION SYNC IS NOT OPTIONAL AND NOT DEFERRABLE.** Every create and
 * every rename writes `dimension_members` in the SAME transaction, because a
 * project that exists without its cost object is an entity no report can group
 * by — which is worse than a refusal, and is the failure
 * `docs/modules/packs-and-profiles.md` names when it says a pack that tracks
 * activity without syncing a dimension member "has built a to-do list".
 */

export class JobsError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "INVALID_STATUS"
      | "INVALID_KIND"
      | "INVALID_ROLE"
      | "INVALID_BILLING_METHOD"
      | "INVALID_VALUE"
      | "NO_LINES"
      | "INVALID_DELIVERY_METHOD"
      | "NUMBER_TAKEN"
      | "NAME_TAKEN"
      | "SET_IN_USE"
      | "STALE_VERSION"
      /** A signed contract's value moves by change order, not by edit. */
      | "VALUE_LOCKED"
      /** An approved change order carries the date it was approved. */
      | "APPROVAL_DATE_REQUIRED"
      /** A schedule line an application has billed against cannot be removed. */
      | "SOV_LINE_BILLED"
      /** One draft application per contract at a time. */
      | "ONE_DRAFT"
      /** The certificate comes to nothing or less; there is no invoice to issue. */
      | "NOTHING_DUE"
      /** A contract with nobody on the other side cannot be billed. */
      | "COUNTERPARTY_REQUIRED"
      /** The chart lacks an account billing needs; the message names it. */
      | "ACCOUNT_MISSING"
      /** Only the latest issued application on a contract can be voided. */
      | "NOT_LAST"
      /** A job on the schedule has no budget and no estimate; the message names the jobs. */
      | "ESTIMATE_REQUIRED"
      /** A job with billings but no fixed contract value cannot be measured; the message names it. */
      | "BILLED_NO_VALUE"
      /** A WIP period must come after the company's latest posted one; the message says which. */
      | "NOT_FORWARD"
      /** Billings equal earned revenue on every job: there is no entry to post. */
      | "NOTHING_TO_POST"
      /** Only the latest posted WIP period of a company can be unposted. */
      | "NOT_LATEST_PERIOD",
    message: string,
  ) {
    super(message);
    this.name = "JobsError";
  }
}

export interface JobsCtx {
  tenantId: string;
  userId: string;
  role: "owner" | "staff" | "expert";
}

/**
 * Jobs is owner territory to write, member-wide to read.
 *
 * Same division as `assets` and `land`, and forced from below in the same way:
 * `upsertDimensionMember` calls `requireOwnerRole`, so a staff-created project
 * could not sync its cost object. Reading the job list stays ordinary work for
 * anybody who has to go and stand on the site.
 */
export function requireWrite(ctx: JobsCtx, level: WriteLevel): void {
  if (!allowsWrite(ctx.role, level)) {
    throw new JobsError("FORBIDDEN", `role ${ctx.role} may not perform this write`);
  }
}

// ---------------------------------------------------------------- cost codes

export interface CostCodeSetInput {
  name: string;
  isDefault?: boolean;
  notes?: string;
}

export async function listCostCodeSets(
  tx: Tx,
  tenantId: string,
): Promise<JobCostCodeSet[]> {
  return tx
    .select()
    .from(schema.jobCostCodeSets)
    .where(eq(schema.jobCostCodeSets.tenantId, tenantId))
    .orderBy(desc(schema.jobCostCodeSets.isDefault), asc(schema.jobCostCodeSets.name));
}

export async function getDefaultCostCodeSet(
  tx: Tx,
  tenantId: string,
): Promise<JobCostCodeSet | null> {
  const rows = await tx
    .select()
    .from(schema.jobCostCodeSets)
    .where(
      and(
        eq(schema.jobCostCodeSets.tenantId, tenantId),
        eq(schema.jobCostCodeSets.isDefault, true),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * **CLEARING THE OLD DEFAULT IS PART OF SETTING THE NEW ONE.**
 *
 * `job_cost_code_sets_one_default_idx` is a partial unique index, so two
 * defaults fail at the database. That is the backstop, not the mechanism: this
 * clears the incumbent first, in the same transaction, so the ordinary act of
 * promoting a set succeeds rather than colliding.
 */
async function clearOtherDefaults(
  tx: Tx,
  tenantId: string,
  exceptId: string | null,
): Promise<void> {
  const where = exceptId
    ? and(
        eq(schema.jobCostCodeSets.tenantId, tenantId),
        eq(schema.jobCostCodeSets.isDefault, true),
        ne(schema.jobCostCodeSets.id, exceptId),
      )
    : and(
        eq(schema.jobCostCodeSets.tenantId, tenantId),
        eq(schema.jobCostCodeSets.isDefault, true),
      );
  await tx
    .update(schema.jobCostCodeSets)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(where);
}

export async function createCostCodeSet(
  tx: Tx,
  ctx: JobsCtx,
  input: CostCodeSetInput,
): Promise<JobCostCodeSet> {
  requireWrite(ctx, "owner");
  const name = input.name.trim();
  /**
   * THE FIRST SET IS THE DEFAULT, whether or not anybody asked. A business with
   * one list must never be asked which list a project uses, and a first set that
   * was not the default would make every project carry an explicit choice
   * forever.
   */
  const existing = await listCostCodeSets(tx, ctx.tenantId);
  const isDefault = input.isDefault ?? existing.length === 0;
  if (isDefault) await clearOtherDefaults(tx, ctx.tenantId, null);

  const rows = await tx
    .insert(schema.jobCostCodeSets)
    .values({
      tenantId: ctx.tenantId,
      name,
      isDefault,
      notes: input.notes?.trim() ?? "",
    })
    .returning();
  return rows[0];
}

export async function setDefaultCostCodeSet(
  tx: Tx,
  ctx: JobsCtx,
  setId: string,
): Promise<JobCostCodeSet> {
  requireWrite(ctx, "owner");
  await clearOtherDefaults(tx, ctx.tenantId, setId);
  const rows = await tx
    .update(schema.jobCostCodeSets)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(
      and(
        eq(schema.jobCostCodeSets.tenantId, ctx.tenantId),
        eq(schema.jobCostCodeSets.id, setId),
      ),
    )
    .returning();
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `set ${setId} not found`);
  return rows[0];
}

export interface CostCodeInput {
  setId: string;
  code: string;
  name: string;
  sortOrder?: number;
  notes?: string;
}

export async function listCostCodes(
  tx: Tx,
  tenantId: string,
  setId: string,
): Promise<JobCostCode[]> {
  return tx
    .select()
    .from(schema.jobCostCodes)
    .where(
      and(
        eq(schema.jobCostCodes.tenantId, tenantId),
        eq(schema.jobCostCodes.setId, setId),
      ),
    )
    .orderBy(asc(schema.jobCostCodes.sortOrder), asc(schema.jobCostCodes.code));
}

export async function createCostCode(
  tx: Tx,
  ctx: JobsCtx,
  input: CostCodeInput,
): Promise<JobCostCode> {
  requireWrite(ctx, "owner");
  /**
   * A new code lands at the END of the list by default, not at position zero:
   * a chart is read in the order the business wrote it, and silently putting
   * every addition first would reorder a list somebody deliberately arranged.
   */
  const order =
    input.sortOrder ??
    (
      await tx
        .select({ max: sql<number>`coalesce(max(${schema.jobCostCodes.sortOrder}), 0)` })
        .from(schema.jobCostCodes)
        .where(
          and(
            eq(schema.jobCostCodes.tenantId, ctx.tenantId),
            eq(schema.jobCostCodes.setId, input.setId),
          ),
        )
    )[0].max + 10;

  const rows = await tx
    .insert(schema.jobCostCodes)
    .values({
      tenantId: ctx.tenantId,
      setId: input.setId,
      code: input.code.trim(),
      name: input.name.trim(),
      sortOrder: order,
      notes: input.notes?.trim() ?? "",
    })
    .returning();

  // Same transaction, always — see the file header. A code that is not a cost
  // object is one nobody can charge a bill to.
  await upsertDimensionMember(tx, ctx, {
    dimensionType: COST_CODE_DIMENSION,
    packEntityId: rows[0].id,
    displayName: codeLabel(rows[0]),
  });
  return rows[0];
}

/** What a cost code is called in a report's dimension column. */
export function codeLabel(code: Pick<JobCostCode, "code" | "name">): string {
  return `${code.code} · ${code.name}`;
}

// ------------------------------------------------------------------ projects

export interface ProjectInput {
  entityId: string;
  name: string;
  number: string;
  status?: string;
  deliveryMethod?: string | null;
  enterpriseId?: string | null;
  partyId?: string | null;
  costCodeSetId?: string | null;
  address?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  notes?: string;
}

export async function listProjects(
  tx: Tx,
  tenantId: string,
): Promise<JobProject[]> {
  return tx
    .select()
    .from(schema.jobProjects)
    .where(eq(schema.jobProjects.tenantId, tenantId))
    .orderBy(desc(schema.jobProjects.createdAt));
}

export async function getProject(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<JobProject | null> {
  const rows = await tx
    .select()
    .from(schema.jobProjects)
    .where(and(eq(schema.jobProjects.tenantId, tenantId), eq(schema.jobProjects.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

function validateProjectShape(input: {
  status?: string;
  deliveryMethod?: string | null;
}): void {
  if (input.status !== undefined && !isProjectStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  /**
   * FORMAT ONLY, never a value list. The check mirrors
   * `job_projects_delivery_method_format`; what the words MEAN is the industry
   * profile's business, and a list here would make this pack know its industry.
   */
  if (
    input.deliveryMethod !== undefined &&
    input.deliveryMethod !== null &&
    input.deliveryMethod !== "" &&
    !DELIVERY_METHOD_FORMAT.test(input.deliveryMethod)
  ) {
    throw new JobsError(
      "INVALID_DELIVERY_METHOD",
      `invalid delivery method: ${input.deliveryMethod}`,
    );
  }
}

export async function createProject(
  tx: Tx,
  ctx: JobsCtx,
  input: ProjectInput,
): Promise<JobProject> {
  requireWrite(ctx, "owner");
  validateProjectShape(input);

  /**
   * The set a project is budgeted against, resolved ONCE at creation rather
   * than read through. A tenant that later changes its default must not silently
   * re-chart a job already underway — same reasoning as the profile seed being
   * copied rather than resolved live (ADR 0009).
   */
  const costCodeSetId =
    input.costCodeSetId ?? (await getDefaultCostCodeSet(tx, ctx.tenantId))?.id ?? null;

  const rows = await tx
    .insert(schema.jobProjects)
    .values({
      tenantId: ctx.tenantId,
      entityId: input.entityId,
      enterpriseId: input.enterpriseId ?? null,
      partyId: input.partyId ?? null,
      number: input.number.trim(),
      name: input.name.trim(),
      status: input.status ?? "planned",
      deliveryMethod: input.deliveryMethod?.trim() || null,
      costCodeSetId,
      address: input.address?.trim() ?? "",
      startsOn: input.startsOn ?? null,
      endsOn: input.endsOn ?? null,
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  const project = rows[0];

  // Same transaction, always. See the file header.
  await upsertDimensionMember(tx, ctx, {
    dimensionType: PROJECT_DIMENSION,
    packEntityId: project.id,
    displayName: dimensionLabel(project),
  });

  return project;
}

/**
 * What a project is called in a report's dimension column.
 *
 * **THE NUMBER LEADS**, because a cost report is read against a job list and
 * the number is what people say out loud. A name alone would make two houses on
 * the same street indistinguishable in a column narrow enough to matter.
 */
export function dimensionLabel(project: Pick<JobProject, "number" | "name">): string {
  return `${project.number} · ${project.name}`;
}

export async function updateProject(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<ProjectInput> & { version?: number },
): Promise<JobProject> {
  requireWrite(ctx, "owner");
  validateProjectShape(input);
  const existing = await getProject(tx, ctx.tenantId, id);
  if (!existing) throw new JobsError("NOT_FOUND", `project ${id} not found`);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "project changed since loaded");
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing.version + 1,
  };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.number !== undefined) patch.number = input.number.trim();
  if (input.status !== undefined) patch.status = input.status;
  if (input.deliveryMethod !== undefined) {
    patch.deliveryMethod = input.deliveryMethod?.trim() || null;
  }
  if (input.enterpriseId !== undefined) patch.enterpriseId = input.enterpriseId;
  if (input.partyId !== undefined) patch.partyId = input.partyId;
  if (input.costCodeSetId !== undefined) patch.costCodeSetId = input.costCodeSetId;
  if (input.address !== undefined) patch.address = input.address.trim();
  if (input.startsOn !== undefined) patch.startsOn = input.startsOn;
  if (input.endsOn !== undefined) patch.endsOn = input.endsOn;
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.jobProjects)
    .set(patch)
    .where(
      and(eq(schema.jobProjects.tenantId, ctx.tenantId), eq(schema.jobProjects.id, id)),
    )
    .returning();
  const project = rows[0];

  /**
   * THE COST OBJECT FOLLOWS THE RENAME, in the same transaction. A report
   * grouping by a name the job list no longer uses is the quiet kind of wrong:
   * nothing errors, and two people reading two screens disagree.
   */
  if (input.name !== undefined || input.number !== undefined) {
    await upsertDimensionMember(tx, ctx, {
      dimensionType: PROJECT_DIMENSION,
      packEntityId: project.id,
      displayName: dimensionLabel(project),
    });
  }

  /**
   * A CANCELLED PROJECT STOPS BEING TAGGABLE, and a complete one does not.
   * Closing a job does not stop bills arriving against it — retainage and the
   * last subcontractor invoice turn up months later — whereas a job that never
   * happened should not be offered on a bill line at all. Archiving keeps every
   * tag already made reporting, which is what `archiveDimensionMember` is for.
   */
  if (input.status === "cancelled" && existing.status !== "cancelled") {
    const members = await listDimensionMembers(tx, ctx.tenantId, PROJECT_DIMENSION);
    const mine = members.find((m) => m.packEntityId === project.id);
    if (mine) await archiveDimensionMember(tx, ctx, { memberId: mine.id });
  }
  if (input.status !== undefined && input.status !== "cancelled" && existing.status === "cancelled") {
    await upsertDimensionMember(tx, ctx, {
      dimensionType: PROJECT_DIMENSION,
      packEntityId: project.id,
      displayName: dimensionLabel(project),
    });
  }

  return project;
}

// ----------------------------------------------------------- reads for a page

export interface ProjectRow {
  project: JobProject;
  entityName: string;
  clientName: string | null;
  enterpriseName: string | null;
  costCodeSetName: string | null;
}

/**
 * The job list, with the names its three coordinates resolve to.
 *
 * **ONE STATEMENT, NOT ONE PER ROW.** Four left joins rather than a lookup per
 * project, because a contractor with eighty live jobs would otherwise pay three
 * hundred round trips to draw a table — the reason `listEngagements` reads the
 * same way.
 *
 * LEFT joins throughout, including the entity, which is NOT NULL: a row that
 * failed to resolve its company should still appear in the list rather than
 * vanish from it, because a job missing from the screen is the one nobody
 * notices.
 */
export async function listProjectRows(
  tx: Tx,
  tenantId: string,
): Promise<ProjectRow[]> {
  const rows = await tx
    .select({
      project: schema.jobProjects,
      entityName: schema.entities.name,
      clientName: schema.parties.displayName,
      enterpriseName: schema.enterprises.name,
      costCodeSetName: schema.jobCostCodeSets.name,
    })
    .from(schema.jobProjects)
    .leftJoin(
      schema.entities,
      and(
        eq(schema.entities.tenantId, schema.jobProjects.tenantId),
        eq(schema.entities.id, schema.jobProjects.entityId),
      ),
    )
    .leftJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.jobProjects.tenantId),
        eq(schema.parties.id, schema.jobProjects.partyId),
      ),
    )
    .leftJoin(
      schema.enterprises,
      and(
        eq(schema.enterprises.tenantId, schema.jobProjects.tenantId),
        eq(schema.enterprises.id, schema.jobProjects.enterpriseId),
      ),
    )
    .leftJoin(
      schema.jobCostCodeSets,
      and(
        eq(schema.jobCostCodeSets.tenantId, schema.jobProjects.tenantId),
        eq(schema.jobCostCodeSets.id, schema.jobProjects.costCodeSetId),
      ),
    )
    .where(eq(schema.jobProjects.tenantId, tenantId))
    .orderBy(desc(schema.jobProjects.createdAt));

  return rows.map((r) => ({
    project: r.project,
    entityName: r.entityName ?? "—",
    clientName: r.clientName,
    enterpriseName: r.enterpriseName,
    costCodeSetName: r.costCodeSetName,
  }));
}

// ----------------------------------------------------------------- contracts

export interface ContractInput {
  projectId: string;
  kind: string;
  name?: string;
  counterpartyPartyId?: string | null;
  role?: string;
  billingMethod?: string;
  valueCents?: number | null;
  status?: string;
  signedOn?: string | null;
  notes?: string;
}

export async function listContracts(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<JobContract[]> {
  return tx
    .select()
    .from(schema.jobContracts)
    .where(
      and(
        eq(schema.jobContracts.tenantId, tenantId),
        eq(schema.jobContracts.projectId, projectId),
      ),
    )
    .orderBy(asc(schema.jobContracts.sequence), asc(schema.jobContracts.createdAt));
}

/**
 * What each project is worth, and how many agreements it took.
 *
 * **ONLY SIGNED AND COMPLETE CONTRACTS COUNT.** A concept the client has not
 * signed is not money; adding it in would report a business as bigger than it
 * is, which is the number an owner takes to a bank. `proposed`, `declined` and
 * `cancelled` are simply not summed.
 *
 * **A COUNT OF OUTSTANDING PROPOSALS IS DELIBERATELY NOT HERE.** It was, briefly,
 * and nothing read it: the job list shows a value, and the project page counts
 * its own contracts in memory. A field nothing reads is worse than an honest
 * absence — the standard this pack set one slice ago by refusing to add
 * `PackDefinition.dimensionTypes`. Add it the day a screen wants it.
 *
 * TWO STATEMENTS FOR THE WHOLE LIST, grouped in the database rather than a query
 * per project — the reason `listProjectRows` reads the way it does.
 *
 * **REVISED, NOT ORIGINAL, since slice 4.** `valueCents` is what the signed
 * agreements are worth NOW: their original values plus every APPROVED change
 * order against them. A list that showed the original would report a job that
 * grew by $60k of approved changes at the number it was signed for, which is the
 * number nobody bills. `changesCents` is the approved total on its own, so a
 * screen can say how much of the value is growth. When a change counts is one
 * rule, `countedChange`, shared with the job cost report.
 */
export interface ProjectValue {
  projectId: string;
  /** Original + approved changes, over signed and complete contracts. */
  valueCents: number;
  /** The approved changes alone. Negative when deductions outweigh additions. */
  changesCents: number;
  signedCount: number;
}

export async function projectValues(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, ProjectValue>> {
  const [contracts, changes] = await Promise.all([
    tx
      .select({
        projectId: schema.jobContracts.projectId,
        valueCents: sql<number>`coalesce(sum(${schema.jobContracts.valueCents}) filter (
          where ${schema.jobContracts.status} in ('signed', 'complete')
        ), 0)`.mapWith(Number),
        signedCount: sql<number>`count(*) filter (
          where ${schema.jobContracts.status} in ('signed', 'complete')
        )`.mapWith(Number),
      })
      .from(schema.jobContracts)
      .where(eq(schema.jobContracts.tenantId, tenantId))
      .groupBy(schema.jobContracts.projectId),
    tx
      .select({
        projectId: schema.jobContracts.projectId,
        changesCents: sql<number>`coalesce(sum(${schema.jobChangeOrders.valueCents}), 0)`.mapWith(
          Number,
        ),
      })
      .from(schema.jobChangeOrders)
      .innerJoin(
        schema.jobContracts,
        and(
          eq(schema.jobContracts.tenantId, schema.jobChangeOrders.tenantId),
          eq(schema.jobContracts.id, schema.jobChangeOrders.contractId),
        ),
      )
      .where(and(eq(schema.jobChangeOrders.tenantId, tenantId), countedChange()))
      .groupBy(schema.jobContracts.projectId),
  ]);

  const changesByProject = new Map(changes.map((r) => [r.projectId, r.changesCents]));
  return new Map(
    contracts.map((r) => {
      const changesCents = changesByProject.get(r.projectId) ?? 0;
      return [
        r.projectId,
        {
          projectId: r.projectId,
          valueCents: r.valueCents + changesCents,
          changesCents,
          signedCount: r.signedCount,
        },
      ];
    }),
  );
}

export async function createContract(
  tx: Tx,
  ctx: JobsCtx,
  input: ContractInput,
): Promise<JobContract> {
  requireWrite(ctx, "owner");
  validateContractShape(input);

  /**
   * NEXT IN THE LADDER. A new agreement goes after the ones already on the
   * project, because Concept Design → Drawings → New Home is the order they were
   * agreed and the order somebody reads them in. Dates cannot do this job: a
   * drawings contract signed late is still the second step.
   */
  const sequence =
    (
      await tx
        .select({
          max: sql<number>`coalesce(max(${schema.jobContracts.sequence}), -1)`.mapWith(
            Number,
          ),
        })
        .from(schema.jobContracts)
        .where(
          and(
            eq(schema.jobContracts.tenantId, ctx.tenantId),
            eq(schema.jobContracts.projectId, input.projectId),
          ),
        )
    )[0].max + 1;

  const rows = await tx
    .insert(schema.jobContracts)
    .values({
      tenantId: ctx.tenantId,
      projectId: input.projectId,
      kind: input.kind.trim(),
      name: input.name?.trim() ?? "",
      counterpartyPartyId: input.counterpartyPartyId ?? null,
      role: input.role ?? "prime",
      billingMethod: input.billingMethod ?? "fixed_price",
      valueCents: input.valueCents ?? null,
      status: input.status ?? "proposed",
      sequence,
      signedOn: input.signedOn ?? null,
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

function validateContractShape(input: {
  kind?: string;
  role?: string;
  status?: string;
  billingMethod?: string;
  valueCents?: number | null;
}): void {
  if (input.kind !== undefined && !DELIVERY_METHOD_FORMAT.test(input.kind.trim())) {
    throw new JobsError("INVALID_KIND", `invalid contract kind: ${input.kind}`);
  }
  if (input.role !== undefined && !isContractRole(input.role)) {
    throw new JobsError("INVALID_ROLE", `invalid role: ${input.role}`);
  }
  if (input.status !== undefined && !isContractStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  if (input.billingMethod !== undefined && !isBillingMethod(input.billingMethod)) {
    throw new JobsError(
      "INVALID_BILLING_METHOD",
      `invalid billing method: ${input.billingMethod}`,
    );
  }
  if (
    input.valueCents !== undefined &&
    input.valueCents !== null &&
    input.valueCents < 0
  ) {
    throw new JobsError("INVALID_VALUE", "a contract value cannot be negative");
  }
}

export async function updateContract(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<ContractInput> & { version?: number },
): Promise<JobContract> {
  requireWrite(ctx, "owner");
  validateContractShape(input);
  const existing = await tx
    .select()
    .from(schema.jobContracts)
    .where(
      and(eq(schema.jobContracts.tenantId, ctx.tenantId), eq(schema.jobContracts.id, id)),
    )
    .limit(1);
  if (existing.length === 0) {
    throw new JobsError("NOT_FOUND", `contract ${id} not found`);
  }
  if (input.version !== undefined && input.version !== existing[0].version) {
    throw new JobsError("STALE_VERSION", "contract changed since loaded");
  }
  /**
   * **A SIGNED VALUE IS LOCKED.** Once the agreement counts — signed or
   * complete — its value is the ORIGINAL half of *original + approved changes =
   * revised*, and a value that can still be edited in place makes that line
   * meaningless. The way it moves is a change order, which is what the business
   * does on paper too; a typo in a signed value is a change order that says so.
   * The one exception is a signed contract with NO value recorded yet: filling
   * that in the first time is entry, not revision. Slice 4.
   */
  if (
    input.valueCents !== undefined &&
    existing[0].valueCents !== null &&
    input.valueCents !== existing[0].valueCents &&
    (VALUED_CONTRACT_STATUSES as readonly string[]).includes(existing[0].status)
  ) {
    throw new JobsError(
      "VALUE_LOCKED",
      "a signed contract's value is changed by change order, not by edit",
    );
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing[0].version + 1,
  };
  if (input.kind !== undefined) patch.kind = input.kind.trim();
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.counterpartyPartyId !== undefined) {
    patch.counterpartyPartyId = input.counterpartyPartyId;
  }
  if (input.role !== undefined) patch.role = input.role;
  if (input.billingMethod !== undefined) patch.billingMethod = input.billingMethod;
  if (input.valueCents !== undefined) patch.valueCents = input.valueCents;
  if (input.status !== undefined) patch.status = input.status;
  if (input.signedOn !== undefined) patch.signedOn = input.signedOn;
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.jobContracts)
    .set(patch)
    .where(
      and(eq(schema.jobContracts.tenantId, ctx.tenantId), eq(schema.jobContracts.id, id)),
    )
    .returning();
  return rows[0];
}

/**
 * Rename a cost code list.
 *
 * Only the name and the notes. **Which list a project is budgeted against is not
 * editable here and must not become so**: a project resolves its set once at
 * creation precisely so a later change cannot silently re-chart a job already
 * underway, and re-pointing a whole list would do that to every project at once.
 */
export async function updateCostCodeSet(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: { name?: string; notes?: string; version?: number },
): Promise<JobCostCodeSet> {
  requireWrite(ctx, "owner");
  const existing = await tx
    .select()
    .from(schema.jobCostCodeSets)
    .where(
      and(
        eq(schema.jobCostCodeSets.tenantId, ctx.tenantId),
        eq(schema.jobCostCodeSets.id, id),
      ),
    )
    .limit(1);
  if (existing.length === 0) throw new JobsError("NOT_FOUND", `set ${id} not found`);
  if (input.version !== undefined && input.version !== existing[0].version) {
    throw new JobsError("STALE_VERSION", "list changed since loaded");
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing[0].version + 1,
  };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.jobCostCodeSets)
    .set(patch)
    .where(
      and(
        eq(schema.jobCostCodeSets.tenantId, ctx.tenantId),
        eq(schema.jobCostCodeSets.id, id),
      ),
    )
    .returning();
  return rows[0];
}

/**
 * Change one line of the chart of cost: its code, its name, its place in the
 * order, or whether it is still offered.
 *
 * **RETIRED, NEVER DELETED.** `is_active = false` takes a code off the list a
 * person picks from and leaves every cost already charged to it exactly where it
 * is — the same rule `archiveDimensionMember` applies to a cost object, and for
 * the same reason: a code that vanished would take a year of job history with
 * it. The row has no delete verb at all, which is deliberate.
 *
 * **A code may be RENUMBERED**, and that is not the same as retiring it: a
 * business that moves from its own scheme to CSI renumbers in place and keeps
 * its history. The unique index on `(tenant_id, set_id, code)` is what stops two
 * lines colliding, and the action translates that collision into a sentence.
 */
export async function updateCostCode(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: {
    code?: string;
    name?: string;
    sortOrder?: number;
    isActive?: boolean;
    notes?: string;
  },
): Promise<JobCostCode> {
  requireWrite(ctx, "owner");
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.code !== undefined) patch.code = input.code.trim();
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.jobCostCodes)
    .set(patch)
    .where(
      and(
        eq(schema.jobCostCodes.tenantId, ctx.tenantId),
        eq(schema.jobCostCodes.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `code ${id} not found`);

  /**
   * THE COST OBJECT FOLLOWS THE CODE, including its retirement.
   *
   * A renumbered code must not leave reports grouping by the old number, and a
   * RETIRED one must stop being offered on a new bill while everything already
   * charged to it keeps reporting — which is exactly what `is_active` on a
   * dimension member means. `upsertDimensionMember` sets `isActive: true`, so a
   * retire needs the archive verb instead.
   */
  const code = rows[0];
  if (code.isActive) {
    await upsertDimensionMember(tx, ctx, {
      dimensionType: COST_CODE_DIMENSION,
      packEntityId: code.id,
      displayName: codeLabel(code),
    });
  } else {
    const members = await listDimensionMembers(tx, ctx.tenantId, COST_CODE_DIMENSION);
    const mine = members.find((m) => m.packEntityId === code.id);
    if (mine && mine.isActive) {
      await archiveDimensionMember(tx, ctx, { memberId: mine.id });
    }
  }
  return code;
}

// --------------------------------------------------------------- commitments

export interface CommitmentLineInput {
  costCodeId?: string | null;
  description?: string;
  amountCents: number;
}

export interface CommitmentInput {
  projectId: string;
  partyId: string;
  kind?: string;
  number: string;
  description?: string;
  status?: string;
  issuedOn?: string | null;
  notes?: string;
  lines: CommitmentLineInput[];
}

function validateCommitmentShape(input: {
  kind?: string;
  status?: string;
  lines?: CommitmentLineInput[];
}): void {
  if (input.kind !== undefined && !isCommitmentKind(input.kind)) {
    throw new JobsError("INVALID_KIND", `invalid commitment kind: ${input.kind}`);
  }
  if (input.status !== undefined && !isCommitmentStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  if (input.lines !== undefined) {
    /**
     * **A COMMITMENT WITH NO LINES COMMITS NOTHING**, and would sit on a project
     * looking like an order while adding zero to what the job owes. Refused here
     * rather than allowed and then filtered out of every sum afterwards.
     */
    if (input.lines.length === 0) {
      throw new JobsError("NO_LINES", "a commitment needs at least one line");
    }
    for (const line of input.lines) {
      if (!Number.isInteger(line.amountCents) || line.amountCents < 0) {
        throw new JobsError("INVALID_VALUE", "a committed amount cannot be negative");
      }
    }
  }
}

export async function createCommitment(
  tx: Tx,
  ctx: JobsCtx,
  input: CommitmentInput,
): Promise<JobCommitment> {
  requireWrite(ctx, "owner");
  validateCommitmentShape(input);

  const rows = await tx
    .insert(schema.jobCommitments)
    .values({
      tenantId: ctx.tenantId,
      projectId: input.projectId,
      partyId: input.partyId,
      kind: input.kind ?? "purchase_order",
      number: input.number.trim(),
      description: input.description?.trim() ?? "",
      status: input.status ?? "draft",
      issuedOn: input.issuedOn ?? null,
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  const commitment = rows[0];

  await tx.insert(schema.jobCommitmentLines).values(
    input.lines.map((line, i) => ({
      tenantId: ctx.tenantId,
      commitmentId: commitment.id,
      costCodeId: line.costCodeId ?? null,
      description: line.description?.trim() ?? "",
      amountCents: line.amountCents,
      sortOrder: i * 10,
    })),
  );

  return commitment;
}

/**
 * Change a commitment's header, and REPLACE its lines when any are given.
 *
 * **REPLACE, NOT MERGE**, and the choice is worth stating. A line-by-line patch
 * needs stable ids round-tripping through a form and a rule for what a missing
 * id means; replacing is one delete and one insert inside the transaction the
 * caller already holds, and it cannot leave behind a line nobody meant to keep.
 * The cost is that an edit rewrites rows that did not change, which matters to
 * nothing here: no other table points at a commitment line.
 *
 * Omitting `lines` entirely leaves them alone, so a status change does not
 * disturb the money.
 */
export async function updateCommitment(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<CommitmentInput> & { version?: number },
): Promise<JobCommitment> {
  requireWrite(ctx, "owner");
  validateCommitmentShape(input);
  const existing = await tx
    .select()
    .from(schema.jobCommitments)
    .where(
      and(
        eq(schema.jobCommitments.tenantId, ctx.tenantId),
        eq(schema.jobCommitments.id, id),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    throw new JobsError("NOT_FOUND", `commitment ${id} not found`);
  }
  if (input.version !== undefined && input.version !== existing[0].version) {
    throw new JobsError("STALE_VERSION", "commitment changed since loaded");
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing[0].version + 1,
  };
  if (input.partyId !== undefined) patch.partyId = input.partyId;
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.number !== undefined) patch.number = input.number.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.status !== undefined) patch.status = input.status;
  if (input.issuedOn !== undefined) patch.issuedOn = input.issuedOn;
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.jobCommitments)
    .set(patch)
    .where(
      and(
        eq(schema.jobCommitments.tenantId, ctx.tenantId),
        eq(schema.jobCommitments.id, id),
      ),
    )
    .returning();

  if (input.lines !== undefined) {
    await tx
      .delete(schema.jobCommitmentLines)
      .where(
        and(
          eq(schema.jobCommitmentLines.tenantId, ctx.tenantId),
          eq(schema.jobCommitmentLines.commitmentId, id),
        ),
      );
    await tx.insert(schema.jobCommitmentLines).values(
      input.lines.map((line, i) => ({
        tenantId: ctx.tenantId,
        commitmentId: id,
        costCodeId: line.costCodeId ?? null,
        description: line.description?.trim() ?? "",
        amountCents: line.amountCents,
        sortOrder: i * 10,
      })),
    );
  }

  return rows[0];
}

export interface CommitmentRow {
  commitment: JobCommitment;
  vendorName: string;
  lines: JobCommitmentLine[];
  totalCents: number;
}

export async function listCommitments(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<CommitmentRow[]> {
  const headers = await tx
    .select({
      commitment: schema.jobCommitments,
      vendorName: schema.parties.displayName,
    })
    .from(schema.jobCommitments)
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
        eq(schema.jobCommitments.projectId, projectId),
      ),
    )
    .orderBy(asc(schema.jobCommitments.number));
  if (headers.length === 0) return [];

  // One statement for every line on the page, not one per commitment.
  const lines = await tx
    .select()
    .from(schema.jobCommitmentLines)
    .where(
      and(
        eq(schema.jobCommitmentLines.tenantId, tenantId),
        inArray(
          schema.jobCommitmentLines.commitmentId,
          headers.map((h) => h.commitment.id),
        ),
      ),
    )
    .orderBy(asc(schema.jobCommitmentLines.sortOrder));

  return headers.map((h) => {
    const mine = lines.filter((l) => l.commitmentId === h.commitment.id);
    return {
      commitment: h.commitment,
      vendorName: h.vendorName ?? "—",
      lines: mine,
      totalCents: mine.reduce((sum, l) => sum + l.amountCents, 0),
    };
  });
}

/**
 * WHAT EACH PROJECT HAS COMMITTED, by project and by cost code.
 *
 * **Only `issued` and `closed` count.** A draft is written but not sent, so
 * nobody is owed anything — the same rule, and the same reason, as a proposed
 * contract not being revenue. The constant is shared so the two cannot drift.
 */
export interface CommittedTotals {
  byProject: Map<string, number>;
  byCostCode: Map<string, number>;
}

export async function committedTotals(
  tx: Tx,
  tenantId: string,
): Promise<CommittedTotals> {
  const rows = await tx
    .select({
      projectId: schema.jobCommitments.projectId,
      costCodeId: schema.jobCommitmentLines.costCodeId,
      amountCents: sql<number>`sum(${schema.jobCommitmentLines.amountCents})`.mapWith(
        Number,
      ),
    })
    .from(schema.jobCommitmentLines)
    .innerJoin(
      schema.jobCommitments,
      and(
        eq(schema.jobCommitments.tenantId, schema.jobCommitmentLines.tenantId),
        eq(schema.jobCommitments.id, schema.jobCommitmentLines.commitmentId),
      ),
    )
    .where(
      and(
        eq(schema.jobCommitmentLines.tenantId, tenantId),
        inArray(schema.jobCommitments.status, [...COMMITTED_STATUSES]),
      ),
    )
    .groupBy(schema.jobCommitments.projectId, schema.jobCommitmentLines.costCodeId);

  const byProject = new Map<string, number>();
  const byCostCode = new Map<string, number>();
  for (const r of rows) {
    byProject.set(r.projectId, (byProject.get(r.projectId) ?? 0) + r.amountCents);
    if (r.costCodeId) {
      byCostCode.set(r.costCodeId, (byCostCode.get(r.costCodeId) ?? 0) + r.amountCents);
    }
  }
  return { byProject, byCostCode };
}

/**
 * WHAT EACH PROJECT HAS ACTUALLY COST, from the ledger.
 *
 * **THIS IS A CORE EXPORT DOING THE WORK, NOT A QUERY OF ITS TABLES.**
 * `getBalances` already groups by a dimension type and already applies the basis
 * lens, so a pack asks it for expense balances grouped by `project` and gets an
 * answer that agrees with every other report in the product. Accounting learns
 * nothing about this pack; the direction stays core → lib → pack, and a job cost
 * figure that disagreed with the P&L would be worse than no figure at all.
 *
 * Expense accounts only: a project's costs, not its billings. `netCents` is
 * debit-positive for an expense, which is the sign a builder expects.
 */
/**
 * NET LEDGER MOVEMENT PER PROJECT on one kind of account, as of a date: the
 * one query `actualByProject` and `billedByProject` share.
 *
 * `memberId` is the dimension member, not the project. The pack owns the
 * mapping back to its own row, because `dimension_members.pack_entity_id` is
 * the only place the two are tied together.
 */
async function netByProject(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
  accountType: "expense" | "income",
  asOf?: string,
): Promise<Map<string, number>> {
  const accounts = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.accountType, accountType)),
    );
  if (accounts.length === 0) return new Map();

  const rows = await getBalances(tx, tenantId, {
    scope,
    asOf,
    accountIds: accounts.map((a) => a.id),
    groupByDimensionType: PROJECT_DIMENSION,
  });

  const members = await listDimensionMembers(tx, tenantId, PROJECT_DIMENSION);
  const projectOf = new Map(members.map((m) => [m.id, m.packEntityId]));

  const out = new Map<string, number>();
  for (const row of rows) {
    if (!row.memberId) continue; // untagged money belongs to no job
    const projectId = projectOf.get(row.memberId);
    if (!projectId) continue;
    out.set(projectId, (out.get(projectId) ?? 0) + row.netCents);
  }
  return out;
}

/** What each project has COST: every expense line tagged with it, as of a date when one is given. */
export async function actualByProject(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
  asOf?: string,
): Promise<Map<string, number>> {
  return netByProject(tx, tenantId, scope, "expense", asOf);
}

/**
 * GROSS BILLINGS PER PROJECT: every income line tagged with the job — a pay
 * application's revenue line, a plain invoice somebody wrote against the job,
 * a credit memo — as of a date. Read from the ledger rather than from this
 * pack's own applications so a job billed any other way still counts, and as
 * of the period end so an invoice dated after it stays out.
 *
 * THE WIP ADJUSTMENT'S OWN ENTRIES STAY OUT BY DATE, NOT BY FILTER (ADR 0059):
 * each period's adjustment is dated its period end and reversed the next
 * day, so a read as of any LATER period end sees both and nets to nothing —
 * and a posted period's own figures are frozen on its lines rather than
 * re-read. Income is a credit, so the net is negated into a positive figure.
 */
export async function billedByProject(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
  asOf?: string,
): Promise<Map<string, number>> {
  const net = await netByProject(tx, tenantId, scope, "income", asOf);
  return new Map([...net].map(([projectId, cents]) => [projectId, -cents]));
}

/**
 * THE REVISED BUDGET PER PROJECT: original lines plus approved change-order
 * lines, the same two sums `jobCostRows` makes per code, added up per job.
 * What a WIP schedule uses as the estimated total cost until somebody
 * re-estimates.
 */
export async function budgetByProject(tx: Tx, tenantId: string): Promise<Map<string, number>> {
  const [original, changes] = await Promise.all([
    tx
      .select({
        projectId: schema.jobBudgetLines.projectId,
        cents: sql<number>`coalesce(sum(${schema.jobBudgetLines.originalCents}), 0)`.mapWith(Number),
      })
      .from(schema.jobBudgetLines)
      .where(eq(schema.jobBudgetLines.tenantId, tenantId))
      .groupBy(schema.jobBudgetLines.projectId),
    tx
      .select({
        projectId: schema.jobContracts.projectId,
        cents: sql<number>`coalesce(sum(${schema.jobChangeOrderLines.amountCents}), 0)`.mapWith(Number),
      })
      .from(schema.jobChangeOrderLines)
      .innerJoin(
        schema.jobChangeOrders,
        and(
          eq(schema.jobChangeOrders.tenantId, schema.jobChangeOrderLines.tenantId),
          eq(schema.jobChangeOrders.id, schema.jobChangeOrderLines.changeOrderId),
        ),
      )
      .innerJoin(
        schema.jobContracts,
        and(
          eq(schema.jobContracts.tenantId, schema.jobChangeOrders.tenantId),
          eq(schema.jobContracts.id, schema.jobChangeOrders.contractId),
        ),
      )
      .where(and(eq(schema.jobChangeOrderLines.tenantId, tenantId), countedChange()))
      .groupBy(schema.jobContracts.projectId),
  ]);
  const out = new Map<string, number>();
  for (const r of original) out.set(r.projectId, r.cents);
  for (const r of changes) out.set(r.projectId, (out.get(r.projectId) ?? 0) + r.cents);
  return out;
}

// -------------------------------------------------------------------- budget

export interface BudgetLineInput {
  costCodeId: string;
  originalCents: number;
  notes?: string;
}

/**
 * Write a project's budget: one amount per cost code.
 *
 * **UPSERT PER CODE, and a code omitted from the input is LEFT ALONE.** The
 * alternative — replace the whole budget, the way a commitment's lines are
 * replaced — is wrong here for a reason worth stating: a commitment's lines are
 * one document somebody is editing in front of them, while a budget is built up
 * over weeks by different people. Replacing it would make "I added the concrete
 * number" quietly delete everything typed since the form was opened.
 *
 * Removing a code from a budget is `removeBudgetLine`, said out loud.
 */
export async function setBudgetLines(
  tx: Tx,
  ctx: JobsCtx,
  projectId: string,
  lines: BudgetLineInput[],
): Promise<JobBudgetLine[]> {
  requireWrite(ctx, "owner");
  for (const line of lines) {
    if (!Number.isInteger(line.originalCents) || line.originalCents < 0) {
      throw new JobsError("INVALID_VALUE", "a budget cannot be negative");
    }
  }
  if (lines.length === 0) return [];

  const rows = await tx
    .insert(schema.jobBudgetLines)
    .values(
      lines.map((line) => ({
        tenantId: ctx.tenantId,
        projectId,
        costCodeId: line.costCodeId,
        originalCents: line.originalCents,
        notes: line.notes?.trim() ?? "",
      })),
    )
    /**
     * The unique index is the mechanism here, not just the backstop: one line
     * per code per project means a second write to the same code is an EDIT, and
     * saying so in SQL is what stops two rows making every variance ambiguous.
     */
    .onConflictDoUpdate({
      target: [
        schema.jobBudgetLines.tenantId,
        schema.jobBudgetLines.projectId,
        schema.jobBudgetLines.costCodeId,
      ],
      set: {
        originalCents: sql`excluded.original_cents`,
        notes: sql`excluded.notes`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows;
}

export async function removeBudgetLine(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
): Promise<void> {
  requireWrite(ctx, "owner");
  const rows = await tx
    .delete(schema.jobBudgetLines)
    .where(
      and(
        eq(schema.jobBudgetLines.tenantId, ctx.tenantId),
        eq(schema.jobBudgetLines.id, id),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new JobsError("NOT_FOUND", `budget line ${id} not found`);
  }
}

/**
 * THE JOB COST REPORT, one row per cost code.
 *
 * Budget against committed, per code, which is the question a builder actually
 * asks: *is the framing going to come in?* A job-level total answers nothing —
 * "$40k over" is a fact, "the framing is $40k over" is a decision.
 *
 * **EVERY CODE THAT HAS EITHER A BUDGET OR A COMMITMENT APPEARS**, not just the
 * budgeted ones. A code somebody ordered against and never budgeted is the most
 * interesting row on the page and would be the easiest to leave out.
 *
 * **THERE IS NO ACTUAL COLUMN HERE, AND THAT IS DELIBERATE.** Actual cost comes
 * from `getBalances`, which groups by ONE dimension type — so it can answer "what
 * has this project cost" or "what has this code cost across every project", and
 * not "what has this code cost on THIS project". Showing a per-code actual
 * without that would mean either reading accounting's tables directly, which
 * this pack must not do, or quietly reporting another job's spend in this job's
 * column. The project-level actual is on the page as its own figure; per-code
 * waits for `getBalances` to take a second group-by, which is accounting's call
 * and not this pack's to force.
 */
export interface JobCostRow {
  costCodeId: string;
  code: string;
  name: string;
  sortOrder: number;
  /** What the code was budgeted at before any change order; null when no budget line exists. */
  originalCents: number | null;
  /** Approved change-order lines against the code. Can be negative. */
  changesCents: number;
  /**
   * The REVISED budget — original plus approved changes — and the figure every
   * variance is measured against. Named `budgetCents` rather than
   * `revisedCents` because it is what "budget" means once a job has moved: the
   * screen shows this and mentions the original only when they differ.
   */
  budgetCents: number;
  committedCents: number;
  /** Budget minus committed. Negative means over. */
  varianceCents: number;
  /** A budget line exists, or an approved change put money on the code. */
  hasBudget: boolean;
}

export async function jobCostRows(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<JobCostRow[]> {
  const [budget, committed, changes, codes] = await Promise.all([
    tx
      .select()
      .from(schema.jobBudgetLines)
      .where(
        and(
          eq(schema.jobBudgetLines.tenantId, tenantId),
          eq(schema.jobBudgetLines.projectId, projectId),
        ),
      ),
    // Committed on THIS project only, by code. `committedTotals` answers for the
    // whole tenant; a job cost report must not borrow another job's orders.
    tx
      .select({
        costCodeId: schema.jobCommitmentLines.costCodeId,
        amountCents: sql<number>`sum(${schema.jobCommitmentLines.amountCents})`.mapWith(
          Number,
        ),
      })
      .from(schema.jobCommitmentLines)
      .innerJoin(
        schema.jobCommitments,
        and(
          eq(schema.jobCommitments.tenantId, schema.jobCommitmentLines.tenantId),
          eq(schema.jobCommitments.id, schema.jobCommitmentLines.commitmentId),
        ),
      )
      .where(
        and(
          eq(schema.jobCommitmentLines.tenantId, tenantId),
          eq(schema.jobCommitments.projectId, projectId),
          inArray(schema.jobCommitments.status, [...COMMITTED_STATUSES]),
        ),
      )
      .groupBy(schema.jobCommitmentLines.costCodeId),
    /*
     * THE OTHER HALF OF THE BUDGET: approved change-order lines on THIS project,
     * by code. Through the contract, because a change order belongs to one and
     * that is the only way it knows which project it is on — and because the
     * contract's own status is part of whether the change counts.
     */
    tx
      .select({
        costCodeId: schema.jobChangeOrderLines.costCodeId,
        amountCents: sql<number>`sum(${schema.jobChangeOrderLines.amountCents})`.mapWith(
          Number,
        ),
      })
      .from(schema.jobChangeOrderLines)
      .innerJoin(
        schema.jobChangeOrders,
        and(
          eq(schema.jobChangeOrders.tenantId, schema.jobChangeOrderLines.tenantId),
          eq(schema.jobChangeOrders.id, schema.jobChangeOrderLines.changeOrderId),
        ),
      )
      .innerJoin(
        schema.jobContracts,
        and(
          eq(schema.jobContracts.tenantId, schema.jobChangeOrders.tenantId),
          eq(schema.jobContracts.id, schema.jobChangeOrders.contractId),
        ),
      )
      .where(
        and(
          eq(schema.jobChangeOrderLines.tenantId, tenantId),
          eq(schema.jobContracts.projectId, projectId),
          countedChange(),
        ),
      )
      .groupBy(schema.jobChangeOrderLines.costCodeId),
    tx
      .select()
      .from(schema.jobCostCodes)
      .where(eq(schema.jobCostCodes.tenantId, tenantId)),
  ]);

  const codeById = new Map(codes.map((c) => [c.id, c]));
  const budgetByCode = new Map(budget.map((b) => [b.costCodeId, b]));
  const committedByCode = new Map(
    committed.filter((c) => c.costCodeId).map((c) => [c.costCodeId!, c.amountCents]),
  );
  const changesByCode = new Map(changes.map((c) => [c.costCodeId, c.amountCents]));

  /*
   * A code with an approved change and no budget line IS budgeted — at the
   * change — so it joins the report as a budgeted row rather than a `Not
   * budgeted` one. The badge is for money ordered against a code nobody planned
   * for; a code the owner approved money onto has been planned for, late.
   */
  const ids = new Set([
    ...budgetByCode.keys(),
    ...committedByCode.keys(),
    ...changesByCode.keys(),
  ]);
  const rows: JobCostRow[] = [];
  for (const id of ids) {
    const code = codeById.get(id);
    if (!code) continue;
    const originalCents = budgetByCode.get(id)?.originalCents ?? null;
    const changesCents = changesByCode.get(id) ?? 0;
    const budgetCents = (originalCents ?? 0) + changesCents;
    const committedCents = committedByCode.get(id) ?? 0;
    rows.push({
      costCodeId: id,
      code: code.code,
      name: code.name,
      sortOrder: code.sortOrder,
      originalCents,
      changesCents,
      budgetCents,
      committedCents,
      varianceCents: budgetCents - committedCents,
      hasBudget: originalCents !== null || changesByCode.has(id),
    });
  }
  // The order the business arranged its chart in, not the order ids came back.
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  return rows;
}

// ------------------------------------------------------------- change orders

/**
 * THE ONE RULE FOR WHEN A CHANGE ORDER'S MONEY COUNTS, as a SQL condition every
 * roll-up in this file shares: the change order is APPROVED, and the contract
 * it changes is one whose value counts. An approved change on a declined or
 * cancelled contract is a change to nothing, and summing it would grow a job
 * the business never got. Needs `job_contracts` joined by the caller.
 *
 * Two exported constants, one predicate — so `projectValues`, `jobCostRows` and
 * a page adding change orders up in memory cannot drift into three opinions
 * about what "approved" means.
 */
function countedChange() {
  return and(
    inArray(schema.jobChangeOrders.status, [...APPROVED_CHANGE_STATUSES]),
    inArray(schema.jobContracts.status, [...VALUED_CONTRACT_STATUSES]),
  );
}

export interface ChangeOrderLineInput {
  costCodeId: string;
  description?: string;
  /** May be negative: a deduction is a negative line, not a separate concept. */
  amountCents: number;
}

export interface ChangeOrderInput {
  contractId: string;
  number: string;
  title: string;
  description?: string;
  status?: string;
  /** The change to the contract's value. May be negative. */
  valueCents?: number;
  requestedOn?: string | null;
  approvedOn?: string | null;
  notes?: string;
  /** Zero lines is legitimate: a pure price change with no scope to cost. */
  lines?: ChangeOrderLineInput[];
}

function validateChangeOrderShape(input: {
  status?: string;
  valueCents?: number;
  lines?: ChangeOrderLineInput[];
}): void {
  if (input.status !== undefined && !isChangeOrderStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  /*
   * NO SIGN CHECK, on purpose, and it is the only money in this pack without
   * one. A deductive change order — the owner drops the pool — is ordinary, and
   * the schema header says why it is a negative number rather than a credit.
   */
  if (input.valueCents !== undefined && !Number.isInteger(input.valueCents)) {
    throw new JobsError("INVALID_VALUE", "a change order value must be whole cents");
  }
  for (const line of input.lines ?? []) {
    if (!line.costCodeId) {
      throw new JobsError(
        "INVALID_VALUE",
        "a change order line needs a cost code: its only job is to move that code's budget",
      );
    }
    if (!Number.isInteger(line.amountCents)) {
      throw new JobsError("INVALID_VALUE", "a change order line must be whole cents");
    }
  }
}

/**
 * The approval date follows the status, both ways.
 *
 * Approved with no date is refused — the date is the evidence, and a status
 * anybody can flip without one is a status nobody has to justify. Anything
 * other than approved CLEARS the date, because a change order taken back to
 * proposed or declined was not approved on that day after all, and a form
 * should not have to know to blank the box. `job_change_orders_approved_has_date`
 * is the backstop for any path that skips this.
 */
function approvalDateFor(status: string, approvedOn: string | null): string | null {
  if (status === "approved") {
    if (!approvedOn) {
      throw new JobsError(
        "APPROVAL_DATE_REQUIRED",
        "an approved change order needs the date it was approved",
      );
    }
    return approvedOn;
  }
  return null;
}

export async function createChangeOrder(
  tx: Tx,
  ctx: JobsCtx,
  input: ChangeOrderInput,
): Promise<JobChangeOrder> {
  requireWrite(ctx, "owner");
  validateChangeOrderShape(input);

  // The contract is the parent, and it has to be this tenant's. The composite
  // FK would refuse a cross-tenant one anyway; this turns that into NOT_FOUND
  // rather than a constraint name.
  const contract = await tx
    .select({ id: schema.jobContracts.id })
    .from(schema.jobContracts)
    .where(
      and(
        eq(schema.jobContracts.tenantId, ctx.tenantId),
        eq(schema.jobContracts.id, input.contractId),
      ),
    )
    .limit(1);
  if (contract.length === 0) {
    throw new JobsError("NOT_FOUND", `contract ${input.contractId} not found`);
  }

  const status = input.status ?? "proposed";
  const rows = await tx
    .insert(schema.jobChangeOrders)
    .values({
      tenantId: ctx.tenantId,
      contractId: input.contractId,
      number: input.number.trim(),
      title: input.title.trim(),
      description: input.description?.trim() ?? "",
      status,
      valueCents: input.valueCents ?? 0,
      requestedOn: input.requestedOn ?? null,
      approvedOn: approvalDateFor(status, input.approvedOn ?? null),
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  const changeOrder = rows[0];

  if (input.lines && input.lines.length > 0) {
    await tx.insert(schema.jobChangeOrderLines).values(
      input.lines.map((line, i) => ({
        tenantId: ctx.tenantId,
        changeOrderId: changeOrder.id,
        costCodeId: line.costCodeId,
        description: line.description?.trim() ?? "",
        amountCents: line.amountCents,
        sortOrder: i * 10,
      })),
    );
  }

  return changeOrder;
}

/**
 * Change a change order's header, and REPLACE its lines when any are given —
 * the same rule as a commitment's, for the same reason: the lines are one
 * document somebody is editing in front of them. An empty array is a real
 * instruction here, unlike on a commitment, because a change order with no
 * lines is a legitimate thing to be.
 *
 * **THE CONTRACT IS NOT EDITABLE.** A change order changes the agreement it was
 * raised against; moving it would renumber it under another contract's pay
 * applications and silently move money between two agreements. Raise it again
 * on the right one.
 */
export async function updateChangeOrder(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<Omit<ChangeOrderInput, "contractId">> & { version?: number },
): Promise<JobChangeOrder> {
  requireWrite(ctx, "owner");
  validateChangeOrderShape(input);
  const existing = await tx
    .select()
    .from(schema.jobChangeOrders)
    .where(
      and(
        eq(schema.jobChangeOrders.tenantId, ctx.tenantId),
        eq(schema.jobChangeOrders.id, id),
      ),
    )
    .limit(1);
  if (existing.length === 0) {
    throw new JobsError("NOT_FOUND", `change order ${id} not found`);
  }
  if (input.version !== undefined && input.version !== existing[0].version) {
    throw new JobsError("STALE_VERSION", "change order changed since loaded");
  }

  const status = input.status ?? existing[0].status;
  const approvedOn =
    input.approvedOn !== undefined ? input.approvedOn : existing[0].approvedOn;

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: existing[0].version + 1,
    status,
    approvedOn: approvalDateFor(status, approvedOn),
  };
  if (input.number !== undefined) patch.number = input.number.trim();
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) patch.description = input.description.trim();
  if (input.valueCents !== undefined) patch.valueCents = input.valueCents;
  if (input.requestedOn !== undefined) patch.requestedOn = input.requestedOn;
  if (input.notes !== undefined) patch.notes = input.notes.trim();

  const rows = await tx
    .update(schema.jobChangeOrders)
    .set(patch)
    .where(
      and(
        eq(schema.jobChangeOrders.tenantId, ctx.tenantId),
        eq(schema.jobChangeOrders.id, id),
      ),
    )
    .returning();

  if (input.lines !== undefined) {
    await tx
      .delete(schema.jobChangeOrderLines)
      .where(
        and(
          eq(schema.jobChangeOrderLines.tenantId, ctx.tenantId),
          eq(schema.jobChangeOrderLines.changeOrderId, id),
        ),
      );
    if (input.lines.length > 0) {
      await tx.insert(schema.jobChangeOrderLines).values(
        input.lines.map((line, i) => ({
          tenantId: ctx.tenantId,
          changeOrderId: id,
          costCodeId: line.costCodeId,
          description: line.description?.trim() ?? "",
          amountCents: line.amountCents,
          sortOrder: i * 10,
        })),
      );
    }
  }

  return rows[0];
}

export interface ChangeOrderRow {
  changeOrder: JobChangeOrder;
  contract: Pick<JobContract, "id" | "kind" | "name" | "status" | "sequence">;
  lines: JobChangeOrderLine[];
  /** The lines summed: what the change is estimated to COST, beside its price. */
  costCents: number;
}

/**
 * Every change order on a project, in the order its contracts sit, with the
 * contract each one changes and the lines that say what it costs.
 *
 * Reached through the contract — a change order does not carry `project_id`,
 * and the join is the proof that it does not need to.
 */
export async function listChangeOrders(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<ChangeOrderRow[]> {
  const heads = await tx
    .select({
      changeOrder: schema.jobChangeOrders,
      contract: {
        id: schema.jobContracts.id,
        kind: schema.jobContracts.kind,
        name: schema.jobContracts.name,
        status: schema.jobContracts.status,
        sequence: schema.jobContracts.sequence,
      },
    })
    .from(schema.jobChangeOrders)
    .innerJoin(
      schema.jobContracts,
      and(
        eq(schema.jobContracts.tenantId, schema.jobChangeOrders.tenantId),
        eq(schema.jobContracts.id, schema.jobChangeOrders.contractId),
      ),
    )
    .where(
      and(
        eq(schema.jobChangeOrders.tenantId, tenantId),
        eq(schema.jobContracts.projectId, projectId),
      ),
    )
    .orderBy(
      asc(schema.jobContracts.sequence),
      asc(schema.jobChangeOrders.createdAt),
      asc(schema.jobChangeOrders.number),
    );
  if (heads.length === 0) return [];

  const lines = await tx
    .select()
    .from(schema.jobChangeOrderLines)
    .where(
      and(
        eq(schema.jobChangeOrderLines.tenantId, tenantId),
        inArray(
          schema.jobChangeOrderLines.changeOrderId,
          heads.map((h) => h.changeOrder.id),
        ),
      ),
    )
    .orderBy(asc(schema.jobChangeOrderLines.sortOrder));

  const linesByCo = new Map<string, JobChangeOrderLine[]>();
  for (const line of lines) {
    const list = linesByCo.get(line.changeOrderId) ?? [];
    list.push(line);
    linesByCo.set(line.changeOrderId, list);
  }

  return heads.map((h) => {
    const own = linesByCo.get(h.changeOrder.id) ?? [];
    return {
      changeOrder: h.changeOrder,
      contract: h.contract,
      lines: own,
      costCents: own.reduce((sum, l) => sum + l.amountCents, 0),
    };
  });
}
// ------------------------------------------------------------------- billing

export interface SovLineInput {
  /** Present when editing a line that exists; absent for a new one. */
  id?: string;
  description: string;
  scheduledCents: number;
  costCodeId?: string | null;
  changeOrderId?: string | null;
}

export async function listSovLines(
  tx: Tx,
  tenantId: string,
  contractId: string,
): Promise<JobSovLine[]> {
  return tx
    .select()
    .from(schema.jobSovLines)
    .where(
      and(
        eq(schema.jobSovLines.tenantId, tenantId),
        eq(schema.jobSovLines.contractId, contractId),
      ),
    )
    .orderBy(asc(schema.jobSovLines.sortOrder), asc(schema.jobSovLines.createdAt));
}

async function loadContract(tx: Tx, tenantId: string, contractId: string): Promise<JobContract> {
  const rows = await tx
    .select()
    .from(schema.jobContracts)
    .where(
      and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, contractId)),
    )
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `contract ${contractId} not found`);
  return rows[0];
}

/**
 * Write a contract's schedule of values: the lines given, in the order given.
 *
 * **REPLACE, WITH ONE THING IT WILL NOT REPLACE.** A schedule is one document
 * somebody edits in front of them, so lines omitted are removed and the rest
 * are re-sequenced — the commitment rule, not the budget's. Except a line an
 * application has already billed against: removing it would make an issued
 * certificate refer to a line that is not there, and the pre-check refuses with
 * `SOV_LINE_BILLED` (the RESTRICT foreign key is the backstop). Its value can
 * still change, because every issued application froze the value it saw.
 */
export async function saveSovLines(
  tx: Tx,
  ctx: JobsCtx,
  contractId: string,
  lines: SovLineInput[],
): Promise<JobSovLine[]> {
  requireWrite(ctx, "owner");
  await loadContract(tx, ctx.tenantId, contractId);
  for (const line of lines) {
    if (line.description.trim() === "") {
      throw new JobsError("INVALID_VALUE", "a schedule line needs a description");
    }
    if (!Number.isInteger(line.scheduledCents) || line.scheduledCents < 0) {
      throw new JobsError("INVALID_VALUE", "a scheduled value cannot be negative");
    }
  }

  const existing = await listSovLines(tx, ctx.tenantId, contractId);
  const keep = new Set(lines.map((l) => l.id).filter((id): id is string => !!id));
  for (const id of keep) {
    if (!existing.some((e) => e.id === id)) {
      throw new JobsError("NOT_FOUND", `schedule line ${id} is not on this contract`);
    }
  }
  const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (removed.length > 0) {
    const billed = await tx
      .select({ sovLineId: schema.jobPayApplicationLines.sovLineId })
      .from(schema.jobPayApplicationLines)
      .where(
        and(
          eq(schema.jobPayApplicationLines.tenantId, ctx.tenantId),
          inArray(schema.jobPayApplicationLines.sovLineId, removed),
        ),
      )
      .limit(1);
    if (billed.length > 0) {
      throw new JobsError(
        "SOV_LINE_BILLED",
        "a schedule line an application has billed against cannot be removed",
      );
    }
    await tx
      .delete(schema.jobSovLines)
      .where(
        and(
          eq(schema.jobSovLines.tenantId, ctx.tenantId),
          inArray(schema.jobSovLines.id, removed),
        ),
      );
  }

  for (const [i, line] of lines.entries()) {
    const values = {
      description: line.description.trim(),
      scheduledCents: line.scheduledCents,
      costCodeId: line.costCodeId ?? null,
      changeOrderId: line.changeOrderId ?? null,
      sortOrder: (i + 1) * 10,
    };
    if (line.id) {
      await tx
        .update(schema.jobSovLines)
        .set({ ...values, updatedAt: new Date(), version: sql`${schema.jobSovLines.version} + 1` })
        .where(
          and(eq(schema.jobSovLines.tenantId, ctx.tenantId), eq(schema.jobSovLines.id, line.id)),
        );
    } else {
      await tx.insert(schema.jobSovLines).values({
        tenantId: ctx.tenantId,
        contractId,
        ...values,
      });
    }
  }
  return listSovLines(tx, ctx.tenantId, contractId);
}

export interface PayApplicationLineRow extends JobPayApplicationLine {
  description: string;
  /** The schedule line's value NOW; equals `scheduledCents` on an issued application. */
  sovScheduledCents: number;
}

export interface PayApplicationRow {
  app: JobPayApplication;
  lines: PayApplicationLineRow[];
  totals: PayApplicationTotals;
  /** The invoice an issued application became, in Accounting's own words. */
  invoice: { id: string; invoiceNumber: string; status: string; totalCents: number } | null;
}

/**
 * The latest ISSUED application on a contract before a given number — the one
 * whose figures the next application carries forward. A void application is
 * skipped: its invoice was voided, so nothing it certified stands.
 */
async function lastIssuedBefore(
  tx: Tx,
  tenantId: string,
  contractId: string,
  beforeNumber: number | null,
): Promise<JobPayApplication | null> {
  const rows = await tx
    .select()
    .from(schema.jobPayApplications)
    .where(
      and(
        eq(schema.jobPayApplications.tenantId, tenantId),
        eq(schema.jobPayApplications.contractId, contractId),
        eq(schema.jobPayApplications.status, "issued"),
        ...(beforeNumber === null ? [] : [sql`${schema.jobPayApplications.number} < ${beforeNumber}`]),
      ),
    )
    .orderBy(desc(schema.jobPayApplications.number))
    .limit(1);
  return rows[0] ?? null;
}

/** What an issued application certified: earned less retainage, from its frozen totals. */
function certifiedCents(app: JobPayApplication | null): number {
  return app ? app.completedToDateCents - app.retainageCents : 0;
}

function figuresOf(lines: PayApplicationLineRow[], live: boolean): PayLineFigures[] {
  return lines.map((l) => ({
    sovLineId: l.sovLineId,
    scheduledCents: live ? l.sovScheduledCents : l.scheduledCents,
    previousCents: l.previousCents,
    thisPeriodCents: l.thisPeriodCents,
    storedCents: l.storedCents,
  }));
}

async function loadAppLines(
  tx: Tx,
  tenantId: string,
  appIds: string[],
): Promise<Map<string, PayApplicationLineRow[]>> {
  const out = new Map<string, PayApplicationLineRow[]>();
  if (appIds.length === 0) return out;
  const rows = await tx
    .select({
      line: schema.jobPayApplicationLines,
      description: schema.jobSovLines.description,
      sovScheduledCents: schema.jobSovLines.scheduledCents,
      sovSortOrder: schema.jobSovLines.sortOrder,
    })
    .from(schema.jobPayApplicationLines)
    .innerJoin(
      schema.jobSovLines,
      and(
        eq(schema.jobSovLines.tenantId, schema.jobPayApplicationLines.tenantId),
        eq(schema.jobSovLines.id, schema.jobPayApplicationLines.sovLineId),
      ),
    )
    .where(
      and(
        eq(schema.jobPayApplicationLines.tenantId, tenantId),
        inArray(schema.jobPayApplicationLines.payApplicationId, appIds),
      ),
    )
    .orderBy(asc(schema.jobSovLines.sortOrder), asc(schema.jobSovLines.createdAt));
  for (const r of rows) {
    const list = out.get(r.line.payApplicationId) ?? [];
    list.push({ ...r.line, description: r.description, sovScheduledCents: r.sovScheduledCents });
    out.set(r.line.payApplicationId, list);
  }
  return out;
}

/**
 * Every application on a contract, oldest first, each with its lines and its
 * certificate. A DRAFT's figures are computed live from its lines and the
 * schedule as it is now; an ISSUED one's come from the totals frozen at issue,
 * so the certificate a client signed reads the same whatever the schedule has
 * become. The invoice is read through Accounting's own verb, never its table.
 */
export async function listPayApplications(
  tx: Tx,
  tenantId: string,
  contractId: string,
): Promise<PayApplicationRow[]> {
  const apps = await tx
    .select()
    .from(schema.jobPayApplications)
    .where(
      and(
        eq(schema.jobPayApplications.tenantId, tenantId),
        eq(schema.jobPayApplications.contractId, contractId),
      ),
    )
    .orderBy(asc(schema.jobPayApplications.number));
  const linesByApp = await loadAppLines(
    tx,
    tenantId,
    apps.map((a) => a.id),
  );

  const out: PayApplicationRow[] = [];
  for (const app of apps) {
    const lines = linesByApp.get(app.id) ?? [];
    let totals: PayApplicationTotals;
    if (app.status === "draft") {
      const previous = await lastIssuedBefore(tx, tenantId, contractId, app.number);
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
    let invoice: PayApplicationRow["invoice"] = null;
    if (app.invoiceId) {
      const inv = await loadInvoice(tx, tenantId, app.invoiceId);
      invoice = {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        status: inv.status,
        totalCents: inv.totalCents,
      };
    }
    out.push({ app, lines, totals, invoice });
  }
  return out;
}

export interface PayApplicationInput {
  contractId: string;
  periodTo: string;
  retainagePpm?: number;
  notes?: string;
}

function validateRetainage(ppm: number): void {
  if (!Number.isInteger(ppm) || ppm < 0 || ppm > RETAINAGE_PPM_MAX) {
    throw new JobsError("INVALID_VALUE", "retainage must be between 0% and 100%");
  }
}

/**
 * Give a draft a line for every schedule line it lacks, carrying forward what
 * the last issued application completed on each — WORK only, never stored
 * materials, which are entered fresh each period because they are what is on
 * site now. Called when a draft is made and again whenever it is edited, so a
 * schedule that grew after the draft did (an approved change order's lines)
 * reaches it without the draft being remade.
 */
async function syncDraftLines(
  tx: Tx,
  tenantId: string,
  app: JobPayApplication,
): Promise<void> {
  const [sov, have, previous] = await Promise.all([
    listSovLines(tx, tenantId, app.contractId),
    tx
      .select({ sovLineId: schema.jobPayApplicationLines.sovLineId })
      .from(schema.jobPayApplicationLines)
      .where(
        and(
          eq(schema.jobPayApplicationLines.tenantId, tenantId),
          eq(schema.jobPayApplicationLines.payApplicationId, app.id),
        ),
      ),
    lastIssuedBefore(tx, tenantId, app.contractId, app.number),
  ]);
  const has = new Set(have.map((h) => h.sovLineId));
  const missing = sov.filter((s) => !has.has(s.id));
  if (missing.length === 0) return;

  const carried = new Map<string, number>();
  if (previous) {
    const prior = await tx
      .select()
      .from(schema.jobPayApplicationLines)
      .where(
        and(
          eq(schema.jobPayApplicationLines.tenantId, tenantId),
          eq(schema.jobPayApplicationLines.payApplicationId, previous.id),
        ),
      );
    for (const p of prior) carried.set(p.sovLineId, p.previousCents + p.thisPeriodCents);
  }
  await tx.insert(schema.jobPayApplicationLines).values(
    missing.map((s) => ({
      tenantId,
      payApplicationId: app.id,
      sovLineId: s.id,
      scheduledCents: s.scheduledCents,
      previousCents: carried.get(s.id) ?? 0,
      thisPeriodCents: 0,
      storedCents: 0,
    })),
  );
}

/**
 * Start a draw. ONE DRAFT AT A TIME per contract: an application carries the
 * previous one's figures forward, and two open at once would each claim to be
 * next. Numbered after the last, void ones included — a certificate number is
 * never reused.
 */
export async function createPayApplication(
  tx: Tx,
  ctx: JobsCtx,
  input: PayApplicationInput,
): Promise<JobPayApplication> {
  requireWrite(ctx, "owner");
  await loadContract(tx, ctx.tenantId, input.contractId);
  const sov = await listSovLines(tx, ctx.tenantId, input.contractId);
  if (sov.length === 0) {
    throw new JobsError("NO_LINES", "the contract needs a schedule of values first");
  }
  const existing = await tx
    .select({
      max: sql<number>`coalesce(max(${schema.jobPayApplications.number}), 0)`.mapWith(Number),
      drafts: sql<number>`count(*) filter (where ${schema.jobPayApplications.status} = 'draft')`.mapWith(
        Number,
      ),
    })
    .from(schema.jobPayApplications)
    .where(
      and(
        eq(schema.jobPayApplications.tenantId, ctx.tenantId),
        eq(schema.jobPayApplications.contractId, input.contractId),
      ),
    );
  if (existing[0].drafts > 0) {
    throw new JobsError("ONE_DRAFT", "this contract already has a draft application open");
  }
  // The rate carries forward from the last application unless told otherwise:
  // retainage is agreed once, in the contract, not chosen each month.
  const last = await lastIssuedBefore(tx, ctx.tenantId, input.contractId, null);
  const retainagePpm = input.retainagePpm ?? last?.retainagePpm ?? 0;
  validateRetainage(retainagePpm);

  const rows = await tx
    .insert(schema.jobPayApplications)
    .values({
      tenantId: ctx.tenantId,
      contractId: input.contractId,
      number: existing[0].max + 1,
      periodTo: input.periodTo,
      retainagePpm,
      notes: input.notes?.trim() ?? "",
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  await syncDraftLines(tx, ctx.tenantId, rows[0]);
  return rows[0];
}

async function loadPayApplication(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<JobPayApplication> {
  const rows = await tx
    .select()
    .from(schema.jobPayApplications)
    .where(
      and(eq(schema.jobPayApplications.tenantId, tenantId), eq(schema.jobPayApplications.id, id)),
    )
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `pay application ${id} not found`);
  return rows[0];
}

export interface PayApplicationLineInput {
  sovLineId: string;
  thisPeriodCents: number;
  storedCents: number;
}

/**
 * Change a draft: the period, the rate, the notes, and what each line
 * completed this period and has stored. `this period` may be NEGATIVE — an
 * earlier over-billing is corrected on the next application, which is how the
 * G703 has always worked — but a line's total to date may not go below zero.
 * Lines not mentioned are left alone. Only a draft; an issued application is
 * a certificate somebody has, and it is voided, never edited.
 */
export async function updatePayApplication(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: {
    periodTo?: string;
    retainagePpm?: number;
    notes?: string;
    lines?: PayApplicationLineInput[];
    version?: number;
  },
): Promise<JobPayApplication> {
  requireWrite(ctx, "owner");
  const app = await loadPayApplication(tx, ctx.tenantId, id);
  if (app.status !== "draft") {
    throw new JobsError("INVALID_STATUS", "only a draft application can be changed");
  }
  if (input.version !== undefined && input.version !== app.version) {
    throw new JobsError("STALE_VERSION", "application changed since loaded");
  }
  if (input.retainagePpm !== undefined) validateRetainage(input.retainagePpm);
  await syncDraftLines(tx, ctx.tenantId, app);

  if (input.lines) {
    const current = await tx
      .select()
      .from(schema.jobPayApplicationLines)
      .where(
        and(
          eq(schema.jobPayApplicationLines.tenantId, ctx.tenantId),
          eq(schema.jobPayApplicationLines.payApplicationId, id),
        ),
      );
    const bySov = new Map(current.map((l) => [l.sovLineId, l]));
    for (const line of input.lines) {
      const row = bySov.get(line.sovLineId);
      if (!row) throw new JobsError("NOT_FOUND", `schedule line ${line.sovLineId} is not on this application`);
      if (!Number.isInteger(line.thisPeriodCents) || !Number.isInteger(line.storedCents)) {
        throw new JobsError("INVALID_VALUE", "amounts must be whole cents");
      }
      if (line.storedCents < 0) {
        throw new JobsError("INVALID_VALUE", "stored materials cannot be negative");
      }
      if (row.previousCents + line.thisPeriodCents + line.storedCents < 0) {
        throw new JobsError(
          "INVALID_VALUE",
          "a line cannot be completed to less than nothing",
        );
      }
      await tx
        .update(schema.jobPayApplicationLines)
        .set({
          thisPeriodCents: line.thisPeriodCents,
          storedCents: line.storedCents,
          updatedAt: new Date(),
        })
        .where(eq(schema.jobPayApplicationLines.id, row.id));
    }
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
    version: app.version + 1,
  };
  if (input.periodTo !== undefined) patch.periodTo = input.periodTo;
  if (input.retainagePpm !== undefined) patch.retainagePpm = input.retainagePpm;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  const rows = await tx
    .update(schema.jobPayApplications)
    .set(patch)
    .where(
      and(eq(schema.jobPayApplications.tenantId, ctx.tenantId), eq(schema.jobPayApplications.id, id)),
    )
    .returning();
  return rows[0];
}

export async function deletePayApplication(tx: Tx, ctx: JobsCtx, id: string): Promise<void> {
  requireWrite(ctx, "owner");
  const app = await loadPayApplication(tx, ctx.tenantId, id);
  if (app.status !== "draft") {
    throw new JobsError("INVALID_STATUS", "only a draft application can be deleted; an issued one is voided");
  }
  await tx
    .delete(schema.jobPayApplications)
    .where(
      and(eq(schema.jobPayApplications.tenantId, ctx.tenantId), eq(schema.jobPayApplications.id, id)),
    );
}

/** An active account by code, or null. The pack reads the chart; it never writes it. */
export async function accountByCode(tx: Tx, tenantId: string, codes: readonly string[]): Promise<string | null> {
  for (const code of codes) {
    const row = await tx.query.accounts.findFirst({
      where: and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.code, code),
        eq(schema.accounts.isActive, true),
      ),
      columns: { id: true },
    });
    if (row) return row.id;
  }
  return null;
}

/**
 * ISSUE A PAY APPLICATION: freeze its certificate and post it as an ordinary
 * invoice (ADR 0058).
 *
 * The invoice is for the CURRENT PAYMENT DUE, made of two lines the ledger
 * can read: the work earned this period, to contract revenue, tagged with the
 * project so every report that groups by job sees it; and the retainage
 * withheld this period as a NEGATIVE line to the retainage receivable —
 * Dr AR (net), Dr Retainage Receivable (held), Cr Revenue (gross), which is
 * the entry every contractor's accountant expects. When the rate is lowered
 * or set to zero on a later application the same line runs the other way and
 * RELEASES retainage: the final application releasing everything held is not
 * a second feature, it is this one with the rate at zero.
 *
 * Nothing here is a second ledger. AR, aging, reminders, payments and the
 * cash-basis lens all see the invoice, and the application remembers which
 * one it became.
 */
export async function issuePayApplication(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: { issueDate: string; version?: number },
): Promise<{ app: JobPayApplication; invoiceId: string }> {
  requireWrite(ctx, "owner");
  const app = await loadPayApplication(tx, ctx.tenantId, id);
  if (app.status !== "draft") {
    throw new JobsError("INVALID_STATUS", "only a draft application can be issued");
  }
  if (input.version !== undefined && input.version !== app.version) {
    throw new JobsError("STALE_VERSION", "application changed since loaded");
  }
  await syncDraftLines(tx, ctx.tenantId, app);
  const lines = (await loadAppLines(tx, ctx.tenantId, [app.id])).get(app.id) ?? [];
  if (lines.length === 0) {
    throw new JobsError("NO_LINES", "the contract needs a schedule of values first");
  }
  const previous = await lastIssuedBefore(tx, ctx.tenantId, app.contractId, app.number);
  const totals = payApplicationTotals(figuresOf(lines, true), app.retainagePpm, certifiedCents(previous));
  if (totals.dueCents <= 0) {
    throw new JobsError("NOTHING_DUE", "nothing is due on this application");
  }
  const grossThisPeriod = totals.completedToDateCents - (previous?.completedToDateCents ?? 0);
  const retainageThisPeriod = totals.retainageCents - (previous?.retainageCents ?? 0);

  const contract = await loadContract(tx, ctx.tenantId, app.contractId);
  if (!contract.counterpartyPartyId) {
    throw new JobsError("COUNTERPARTY_REQUIRED", "the contract needs somebody to bill");
  }
  const project = await getProject(tx, ctx.tenantId, contract.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${contract.projectId} not found`);

  const revenueAccountId = await accountByCode(tx, ctx.tenantId, REVENUE_ACCOUNT_CODES);
  if (!revenueAccountId) {
    throw new JobsError(
      "ACCOUNT_MISSING",
      `the chart has no ${REVENUE_ACCOUNT_CODES.join(" or ")} account to bill to`,
    );
  }
  let retainageAccountId: string | null = null;
  if (retainageThisPeriod !== 0) {
    retainageAccountId = await accountByCode(tx, ctx.tenantId, [RETAINAGE_RECEIVABLE_CODE]);
    if (!retainageAccountId) {
      throw new JobsError(
        "ACCOUNT_MISSING",
        `the chart has no ${RETAINAGE_RECEIVABLE_CODE} Retainage Receivable account`,
      );
    }
  }
  // The project's cost object, so the revenue lands on the job in every
  // report. An archived member (a cancelled project) is simply not tagged —
  // billing must not fail on a tag.
  const member = (await listDimensionMembers(tx, ctx.tenantId, PROJECT_DIMENSION)).find(
    (m) => m.packEntityId === project.id && m.isActive,
  );
  const dims = member ? [member.id] : undefined;

  const customer = await ensureCustomerForParty(tx, ctx, contract.counterpartyPartyId);
  const dueDate = await dueDateFromCustomerTerms(tx, ctx.tenantId, customer, input.issueDate);
  const kind = contract.name ? `${contract.kind} · ${contract.name}` : contract.kind;
  const ratePct = ppmToPercentString(app.retainagePpm);

  const draft = await createInvoiceDraft(tx, ctx, {
    entityId: project.entityId,
    customerId: customer.id,
    issueDate: input.issueDate,
    dueDate,
    memo: `Pay application ${app.number} · ${project.number} · ${kind}`,
    lines: [
      ...(grossThisPeriod !== 0
        ? [
            {
              description: `Application ${app.number} — work completed and stored through ${app.periodTo}`,
              quantity: "1",
              unitPriceCents: grossThisPeriod,
              incomeAccountId: revenueAccountId,
              dimensionMemberIds: dims,
            },
          ]
        : []),
      ...(retainageThisPeriod !== 0 && retainageAccountId
        ? [
            {
              description:
                retainageThisPeriod > 0
                  ? `Retainage withheld (${ratePct}%)`
                  : "Retainage released",
              quantity: "1",
              unitPriceCents: -retainageThisPeriod,
              incomeAccountId: retainageAccountId,
              dimensionMemberIds: dims,
            },
          ]
        : []),
    ],
  });
  const issued = await issueInvoice(tx, ctx, { invoiceId: draft.id, expectedVersion: draft.version });

  // Freeze what the certificate said, line by line and in total.
  for (const line of lines) {
    await tx
      .update(schema.jobPayApplicationLines)
      .set({ scheduledCents: line.sovScheduledCents, updatedAt: new Date() })
      .where(eq(schema.jobPayApplicationLines.id, line.id));
  }
  const rows = await tx
    .update(schema.jobPayApplications)
    .set({
      status: "issued",
      invoiceId: issued.id,
      issuedOn: input.issueDate,
      scheduledCents: totals.scheduledCents,
      completedToDateCents: totals.completedToDateCents,
      retainageCents: totals.retainageCents,
      previousCertificatesCents: totals.previousCertificatesCents,
      dueCents: totals.dueCents,
      version: app.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.jobPayApplications.tenantId, ctx.tenantId), eq(schema.jobPayApplications.id, id)),
    )
    .returning();
  return { app: rows[0], invoiceId: issued.id };
}

/**
 * Void an issued application: its invoice is voided through Accounting (which
 * refuses one that has payments) and the application stops counting. ONLY THE
 * LATEST issued one on a contract can go, because every later certificate was
 * computed from it — voiding an earlier one would leave the later ones
 * certifying against a number that no longer stands.
 */
export async function voidPayApplication(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: { version?: number } = {},
): Promise<JobPayApplication> {
  requireWrite(ctx, "owner");
  const app = await loadPayApplication(tx, ctx.tenantId, id);
  if (app.status !== "issued") {
    throw new JobsError("INVALID_STATUS", "only an issued application can be voided");
  }
  if (input.version !== undefined && input.version !== app.version) {
    throw new JobsError("STALE_VERSION", "application changed since loaded");
  }
  const latest = await lastIssuedBefore(tx, ctx.tenantId, app.contractId, null);
  if (!latest || latest.id !== app.id) {
    throw new JobsError("NOT_LAST", "only the latest issued application can be voided");
  }
  if (app.invoiceId) {
    const invoice = await loadInvoice(tx, ctx.tenantId, app.invoiceId);
    if (invoice.status !== "void") {
      await voidInvoice(tx, ctx, { invoiceId: invoice.id, expectedVersion: invoice.version });
    }
  }
  const rows = await tx
    .update(schema.jobPayApplications)
    .set({ status: "void", version: app.version + 1, updatedAt: new Date() })
    .where(
      and(eq(schema.jobPayApplications.tenantId, ctx.tenantId), eq(schema.jobPayApplications.id, id)),
    )
    .returning();
  return rows[0];
}

export interface ContractBilling {
  contractId: string;
  scheduledCents: number;
  /** Σ current payment due over issued applications: what has been billed. */
  billedCents: number;
  /** What the latest issued application holds back. */
  retainageHeldCents: number;
  issuedCount: number;
  hasDraft: boolean;
}

/** Per contract on a project: what the schedule says and what has been billed. */
export async function contractBilling(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<Map<string, ContractBilling>> {
  const contracts = await listContracts(tx, tenantId, projectId);
  const ids = contracts.map((c) => c.id);
  const out = new Map<string, ContractBilling>();
  if (ids.length === 0) return out;
  const [sov, apps] = await Promise.all([
    tx
      .select({
        contractId: schema.jobSovLines.contractId,
        scheduledCents: sql<number>`coalesce(sum(${schema.jobSovLines.scheduledCents}), 0)`.mapWith(
          Number,
        ),
      })
      .from(schema.jobSovLines)
      .where(
        and(eq(schema.jobSovLines.tenantId, tenantId), inArray(schema.jobSovLines.contractId, ids)),
      )
      .groupBy(schema.jobSovLines.contractId),
    tx
      .select()
      .from(schema.jobPayApplications)
      .where(
        and(
          eq(schema.jobPayApplications.tenantId, tenantId),
          inArray(schema.jobPayApplications.contractId, ids),
        ),
      )
      .orderBy(asc(schema.jobPayApplications.number)),
  ]);
  for (const c of contracts) {
    out.set(c.id, {
      contractId: c.id,
      scheduledCents: sov.find((s) => s.contractId === c.id)?.scheduledCents ?? 0,
      billedCents: 0,
      retainageHeldCents: 0,
      issuedCount: 0,
      hasDraft: false,
    });
  }
  for (const app of apps) {
    const row = out.get(app.contractId)!;
    if (app.status === "issued") {
      row.billedCents += app.dueCents;
      row.retainageHeldCents = app.retainageCents; // ascending by number: the latest wins
      row.issuedCount += 1;
    } else if (app.status === "draft") {
      row.hasDraft = true;
    }
  }
  return out;
}

/** One contract, or null. The page's loader; `loadContract` above throws for the verbs. */
export async function getContract(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<JobContract | null> {
  const rows = await tx
    .select()
    .from(schema.jobContracts)
    .where(and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, id)))
    .limit(1);
  return rows[0] ?? null;
}
