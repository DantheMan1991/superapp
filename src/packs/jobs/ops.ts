import "server-only";
import { and, asc, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
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
  JobPayApplicationCost,
  JobPayApplicationLabor,
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
  customerForParty,
  dueDateFromCustomerTerms,
  ensureCustomerForParty,
} from "@/modules/accounting/invoicing/customers";
import { listRates } from "@/modules/time/rate-ops";
import { LABOR_EXPENSE_SUBTYPE } from "@/lib/labor-posting";
import {
  costPlusTotals,
  laborLineCents,
  minutesToHoursString,
  payApplicationTotals,
  thousandthsToQuantityString,
  unitLineCents,
  ppmToPercentString,
  type CostLineFigures,
  type CostPlusTerms,
  type CostPlusTotals,
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
  FEE_PPM_MAX,
  COST_PLUS_METHODS,
  TIME_AND_MATERIALS_METHODS,
  billsTheLedger,
  isTimeAndMaterialsMethod,
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
      | "NOT_LATEST_PERIOD"
      /** A job's cost can be billed by one cost-plus contract; a second would bill it twice. */
      | "ONE_COST_PLUS"
      /** A subcontractor's application is against a SUBCONTRACT; a purchase order is billed with an ordinary bill. */
      | "NOT_SUBCONTRACT"
      /** Hours this period on a line with no bill rate; the message names the person (on WIP, the jobs). */
      | "NO_BILL_RATE"
      /** A contract's flat labour rate is fixed once an application has issued. */
      | "RATE_LOCKED",
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
  /** Cost-plus terms (slice 5b): a fee rate in ppm, a fixed fee, a guaranteed maximum. Null for none. */
  feePpm?: number | null;
  feeCents?: number | null;
  gmaxCents?: number | null;
  /** Time and materials (slice 5d): one rate for every hour, cents per hour; null = each person's rate from Time. */
  laborRateCents?: number | null;
  status?: string;
  signedOn?: string | null;
  notes?: string;
}

/** The cost-plus terms as the arithmetic wants them. */
export function costPlusTerms(contract: Pick<JobContract, "feePpm" | "feeCents" | "gmaxCents">): CostPlusTerms {
  return { feePpm: contract.feePpm, feeCents: contract.feeCents, gmaxCents: contract.gmaxCents };
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
      feePpm: input.feePpm ?? null,
      feeCents: input.feeCents ?? null,
      gmaxCents: input.gmaxCents ?? null,
      laborRateCents: input.laborRateCents ?? null,
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
  feePpm?: number | null;
  feeCents?: number | null;
  gmaxCents?: number | null;
  laborRateCents?: number | null;
}): void {
  if (
    input.feePpm != null &&
    (!Number.isInteger(input.feePpm) || input.feePpm < 0 || input.feePpm > FEE_PPM_MAX)
  ) {
    throw new JobsError("INVALID_VALUE", "a fee must be between 0% and 100% of cost");
  }
  if (input.feeCents != null && (!Number.isInteger(input.feeCents) || input.feeCents < 0)) {
    throw new JobsError("INVALID_VALUE", "a fixed fee cannot be negative");
  }
  if (input.gmaxCents != null && (!Number.isInteger(input.gmaxCents) || input.gmaxCents < 0)) {
    throw new JobsError("INVALID_VALUE", "a guaranteed maximum cannot be negative");
  }
  if (
    input.laborRateCents != null &&
    (!Number.isInteger(input.laborRateCents) || input.laborRateCents < 0)
  ) {
    throw new JobsError("INVALID_VALUE", "a labour rate cannot be negative");
  }
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
  /**
   * A FLAT LABOUR RATE IS LOCKED ONCE BILLED (ADR 0062). It carries no date,
   * so changing it would re-rate every hour an issued certificate already
   * carries; a rate that changes over time is Time's dated rate card.
   */
  if (
    input.laborRateCents !== undefined &&
    input.laborRateCents !== existing[0].laborRateCents &&
    (await hasIssuedApplication(tx, ctx.tenantId, id))
  ) {
    throw new JobsError(
      "RATE_LOCKED",
      "the contract's labour rate is fixed once an application has issued",
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
  if (input.feePpm !== undefined) patch.feePpm = input.feePpm;
  if (input.feeCents !== undefined) patch.feeCents = input.feeCents;
  if (input.gmaxCents !== undefined) patch.gmaxCents = input.gmaxCents;
  if (input.laborRateCents !== undefined) patch.laborRateCents = input.laborRateCents;
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
async function accountIdsOfType(
  tx: Tx,
  tenantId: string,
  accountType: "expense" | "income",
  /** Time and materials: the wages accounts left out, because hours are billed by rate (ADR 0062). */
  opts: { withoutLabor?: boolean } = {},
): Promise<string[]> {
  const accounts = await tx
    .select({ id: schema.accounts.id, subtype: schema.accounts.subtype })
    .from(schema.accounts)
    .where(
      and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.accountType, accountType)),
    );
  return accounts
    .filter((a) => !opts.withoutLabor || a.subtype !== LABOR_EXPENSE_SUBTYPE)
    .map((a) => a.id);
}

/** The wages accounts: expense accounts of the subtype the labour accrual posts to. */
async function laborAccountIds(tx: Tx, tenantId: string): Promise<string[]> {
  const accounts = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.tenantId, tenantId),
        eq(schema.accounts.accountType, "expense"),
        eq(schema.accounts.subtype, LABOR_EXPENSE_SUBTYPE),
      ),
    );
  return accounts.map((a) => a.id);
}

async function netByProject(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
  accountType: "expense" | "income",
  asOf?: string,
): Promise<Map<string, number>> {
  return netByProjectForAccounts(
    tx,
    tenantId,
    scope,
    await accountIdsOfType(tx, tenantId, accountType),
    asOf,
  );
}

/**
 * What each project carries on the WAGES accounts: the labour cost a
 * time-and-materials job bills by rate instead of marking up (ADR 0062).
 */
export async function laborCostByProject(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
  asOf?: string,
): Promise<Map<string, number>> {
  return netByProjectForAccounts(tx, tenantId, scope, await laborAccountIds(tx, tenantId), asOf);
}

async function netByProjectForAccounts(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
  accountIds: string[],
  asOf?: string,
): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();

  const rows = await getBalances(tx, tenantId, {
    scope,
    asOf,
    accountIds,
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
  /** What the ledger says has been SPENT on this code, on this job only. */
  actualCents: number;
  /**
   * What the code will cost at least: the greater of committed and actual.
   * Ordered but not yet billed is still owed; billed beyond what was ordered
   * has already happened. Neither alone is the number to hold against a
   * budget, and their sum would count the same dollar twice.
   */
  projectedCents: number;
  /** Budget minus projected. Negative means over. */
  varianceCents: number;
  /** A budget line exists, or an approved change put money on the code. */
  hasBudget: boolean;
}

export interface JobCostReport {
  rows: JobCostRow[];
  /** Spent on the job with no cost code on the line — coded in Accounting, not here. */
  uncodedActualCents: number;
  /** Every code plus the uncoded remainder: what the ledger says the job has cost. */
  actualCents: number;
}

/**
 * ACTUAL PER CODE, ON THIS JOB ONLY — the column that was deliberately absent
 * from slice 3 through slice 6. `getBalances` grouped by ONE dimension type,
 * so it could say what a job cost or what a code cost across every job and
 * never both; a per-code figure here would have meant reading Accounting's
 * tables or borrowing another job's spend. `withinMemberId` (Accounting,
 * 2026-09-14) slices the ledger to the lines tagged with THIS job's cost
 * object and groups those by cost code, so another job's spend on the same
 * code cannot reach this column by construction. The null-member row is
 * money on the job with no code on the line.
 */
export async function actualByCode(
  tx: Tx,
  tenantId: string,
  project: JobProject | null,
  asOf?: string,
  /** Time and materials: the wages accounts left out — hours are billed by rate, never as marked-up cost. */
  opts: { withoutLabor?: boolean } = {},
): Promise<{ byCode: Map<string, number>; uncodedCents: number }> {
  const empty = { byCode: new Map<string, number>(), uncodedCents: 0 };
  if (!project) return empty;
  const member = (await listDimensionMembers(tx, tenantId, PROJECT_DIMENSION)).find(
    (m) => m.packEntityId === project.id,
  );
  if (!member) return empty;
  const accountIds = await accountIdsOfType(tx, tenantId, "expense", opts);
  if (accountIds.length === 0) return empty;
  const rows = await getBalances(tx, tenantId, {
    scope: { kind: "one", entityId: project.entityId },
    asOf,
    accountIds,
    withinMemberId: member.id,
    groupByDimensionType: COST_CODE_DIMENSION,
  });
  const codeOf = new Map(
    (await listDimensionMembers(tx, tenantId, COST_CODE_DIMENSION)).map((m) => [m.id, m.packEntityId]),
  );
  const byCode = new Map<string, number>();
  let uncodedCents = 0;
  for (const row of rows) {
    const codeId = row.memberId ? codeOf.get(row.memberId) : undefined;
    if (!codeId) {
      uncodedCents += row.netCents;
      continue;
    }
    byCode.set(codeId, (byCode.get(codeId) ?? 0) + row.netCents);
  }
  return { byCode, uncodedCents };
}

/** The rows alone. `jobCostReport` for the uncoded remainder as well. */
export async function jobCostRows(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<JobCostRow[]> {
  return (await jobCostReport(tx, tenantId, projectId)).rows;
}

export async function jobCostReport(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<JobCostReport> {
  const project = await getProject(tx, tenantId, projectId);
  const [budget, committed, changes, codes, actual] = await Promise.all([
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
    actualByCode(tx, tenantId, project),
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
    // Spent against a code nobody budgeted or ordered: as interesting as the
    // ordered-but-unbudgeted row, and just as easy to leave out.
    ...actual.byCode.keys(),
  ]);
  const rows: JobCostRow[] = [];
  for (const id of ids) {
    const code = codeById.get(id);
    if (!code) continue;
    const originalCents = budgetByCode.get(id)?.originalCents ?? null;
    const changesCents = changesByCode.get(id) ?? 0;
    const budgetCents = (originalCents ?? 0) + changesCents;
    const committedCents = committedByCode.get(id) ?? 0;
    const actualCents = actual.byCode.get(id) ?? 0;
    const projectedCents = Math.max(committedCents, actualCents);
    rows.push({
      costCodeId: id,
      code: code.code,
      name: code.name,
      sortOrder: code.sortOrder,
      originalCents,
      changesCents,
      budgetCents,
      committedCents,
      actualCents,
      projectedCents,
      varianceCents: budgetCents - projectedCents,
      hasBudget: originalCents !== null || changesByCode.has(id),
    });
  }
  // The order the business arranged its chart in, not the order ids came back.
  rows.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  let coded = 0;
  for (const cents of actual.byCode.values()) coded += cents;
  return {
    rows,
    uncodedActualCents: actual.uncodedCents,
    actualCents: coded + actual.uncodedCents,
  };
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
  /** Ignored on a unit-priced line, whose value is quantity × price. */
  scheduledCents: number;
  costCodeId?: string | null;
  changeOrderId?: string | null;
  /** Unit price (ADR 0064): the unit, the estimated quantity in thousandths and the price per unit — both or neither. */
  unit?: string;
  quantityThousandths?: number | null;
  unitPriceCents?: number | null;
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
    const qty = line.quantityThousandths ?? null;
    const price = line.unitPriceCents ?? null;
    if ((qty === null) !== (price === null)) {
      throw new JobsError("INVALID_VALUE", "a unit-priced line needs both a quantity and a price per unit");
    }
    if (qty !== null && (!Number.isInteger(qty) || qty < 0)) {
      throw new JobsError("INVALID_VALUE", "a quantity cannot be negative");
    }
    if (price !== null && (!Number.isInteger(price) || price < 0)) {
      throw new JobsError("INVALID_VALUE", "a unit price cannot be negative");
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
    const qty = line.quantityThousandths ?? null;
    const price = line.unitPriceCents ?? null;
    const values = {
      description: line.description.trim(),
      // A unit line is worth its estimate at its price; nothing typed overrides that.
      scheduledCents: qty !== null && price !== null ? unitLineCents(qty, price) : line.scheduledCents,
      unit: line.unit?.trim() ?? "",
      quantityThousandths: qty,
      unitPriceCents: price,
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
  /** Unit price: the line's unit, price per unit and estimated quantity; nulls on a lump-sum line. */
  unit: string;
  unitPriceCents: number | null;
  sovQuantityThousandths: number | null;
}

/** A cost line with its code's label, or null labels for the no-code line. */
export interface CostLineRow extends JobPayApplicationCost {
  code: string | null;
  name: string | null;
}

export interface LaborLineRow extends JobPayApplicationLabor {
  /** The person, by the name Time gives them. */
  name: string;
}

export interface PayApplicationRow {
  app: JobPayApplication;
  /** The schedule lines of a fixed-price application; empty on a cost-plus one. */
  lines: PayApplicationLineRow[];
  /** The cost lines of a cost-plus application; empty on a fixed-price one. */
  costs: CostLineRow[];
  /** The labour lines of a time-and-materials application, as last synced; empty otherwise. */
  labor: LaborLineRow[];
  /** Time and materials, on a draft: worked minutes on the job not yet on an approved sheet. */
  laborAwaitingMinutes: number;
  totals: PayApplicationTotals;
  /** The cost-plus certificate's extra figures; null on a fixed-price application. */
  costPlus: CostPlusTotals | null;
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
      unit: schema.jobSovLines.unit,
      unitPriceCents: schema.jobSovLines.unitPriceCents,
      sovQuantityThousandths: schema.jobSovLines.quantityThousandths,
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
    list.push({
      ...r.line,
      description: r.description,
      sovScheduledCents: r.sovScheduledCents,
      unit: r.unit,
      unitPriceCents: r.unitPriceCents,
      sovQuantityThousandths: r.sovQuantityThousandths,
    });
    out.set(r.line.payApplicationId, list);
  }
  return out;
}

async function loadCostLines(
  tx: Tx,
  tenantId: string,
  appIds: string[],
): Promise<Map<string, CostLineRow[]>> {
  const out = new Map<string, CostLineRow[]>();
  if (appIds.length === 0) return out;
  const rows = await tx
    .select({
      line: schema.jobPayApplicationCosts,
      code: schema.jobCostCodes.code,
      name: schema.jobCostCodes.name,
      sortOrder: schema.jobCostCodes.sortOrder,
    })
    .from(schema.jobPayApplicationCosts)
    .leftJoin(
      schema.jobCostCodes,
      and(
        eq(schema.jobCostCodes.tenantId, schema.jobPayApplicationCosts.tenantId),
        eq(schema.jobCostCodes.id, schema.jobPayApplicationCosts.costCodeId),
      ),
    )
    .where(
      and(
        eq(schema.jobPayApplicationCosts.tenantId, tenantId),
        inArray(schema.jobPayApplicationCosts.payApplicationId, appIds),
      ),
    );
  // The chart's order, the no-code line last.
  rows.sort(
    (a, b) =>
      (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
      (a.code ?? "\uffff").localeCompare(b.code ?? "\uffff"),
  );
  for (const r of rows) {
    const list = out.get(r.line.payApplicationId) ?? [];
    list.push({ ...r.line, code: r.code, name: r.name });
    out.set(r.line.payApplicationId, list);
  }
  return out;
}

function costFigures(lines: ReadonlyArray<JobPayApplicationCost>): CostLineFigures[] {
  return lines.map((l) => ({
    costCodeId: l.costCodeId,
    ledgerToDateCents: l.ledgerToDateCents,
    previousCents: l.previousCents,
    thisPeriodCents: l.thisPeriodCents,
  }));
}

/**
 * Give a cost-plus draft a line for every cost code the ledger has charged to
 * the job as of the period end (and one for money with no code), carrying
 * what earlier issued applications billed on each. The ledger figure is
 * refreshed every sync; a line's `this period` is refreshed too UNLESS the
 * person typed something other than the default — a disputed bill left out
 * stays left out when the draft is saved again.
 *
 * TO DATE, NEVER BY WINDOW (ADR 0060): a bill dated inside an earlier period
 * and posted late shows up as ledger-to-date greater than previous, and is
 * billed by the next application rather than lost between two windows.
 */
async function syncCostLines(
  tx: Tx,
  tenantId: string,
  app: JobPayApplication,
  contract: JobContract,
): Promise<void> {
  const project = await getProject(tx, tenantId, contract.projectId);
  const [ledger, previousApp, have] = await Promise.all([
    actualByCode(tx, tenantId, project, app.periodTo, {
      withoutLabor: isTimeAndMaterialsMethod(contract.billingMethod),
    }),
    lastIssuedBefore(tx, tenantId, app.contractId, app.number),
    loadCostLines(tx, tenantId, [app.id]),
  ]);
  const previous = new Map<string | null, number>();
  if (previousApp) {
    for (const l of (await loadCostLines(tx, tenantId, [previousApp.id])).get(previousApp.id) ?? []) {
      previous.set(l.costCodeId, l.previousCents + l.thisPeriodCents);
    }
  }
  const existing = new Map((have.get(app.id) ?? []).map((l) => [l.costCodeId, l]));
  const codes = new Set<string | null>([
    ...ledger.byCode.keys(),
    ...(ledger.uncodedCents !== 0 ? [null] : []),
    ...previous.keys(),
    ...existing.keys(),
  ]);
  for (const codeId of codes) {
    const ledgerCents = codeId === null ? ledger.uncodedCents : (ledger.byCode.get(codeId) ?? 0);
    const previousCents = previous.get(codeId) ?? 0;
    const line = existing.get(codeId);
    if (line) {
      const untouched = line.thisPeriodCents === line.ledgerToDateCents - line.previousCents;
      await tx
        .update(schema.jobPayApplicationCosts)
        .set({
          ledgerToDateCents: ledgerCents,
          previousCents,
          thisPeriodCents: untouched ? ledgerCents - previousCents : line.thisPeriodCents,
          updatedAt: new Date(),
        })
        .where(eq(schema.jobPayApplicationCosts.id, line.id));
    } else {
      await tx.insert(schema.jobPayApplicationCosts).values({
        tenantId,
        payApplicationId: app.id,
        costCodeId: codeId,
        ledgerToDateCents: ledgerCents,
        previousCents,
        thisPeriodCents: ledgerCents - previousCents,
      });
    }
  }
}

// ------------------------------------------------------- time and materials

/**
 * TIME AND MATERIALS (slice 5d, ADR 0062): cost plus a fee with a rate card
 * in place of labour cost. The hours are Time's — approved worked minutes
 * tagged with the job's cost object, the same tag a bill line carries —
 * billed at each person's rate in force on the day, or at one flat rate on
 * the contract; the books' other cost is billed marked up, with the wages
 * accounts left out because the hours already cover them. Everything else —
 * the certificate, the invoice, retainage, the void path, one draft at a
 * time, one biller per job — is the cost-plus slice's, unchanged.
 */

/** What a time-and-materials draft bills of one person's hours this period. */
export interface LaborLineInput {
  workerId: string;
  rateCents: number;
  thisPeriodMinutes: number;
}

export interface LaborOnJob {
  /** Approved worked minutes by person, then by the rate in force on the hour's day (0 = no rate found). */
  byWorker: Map<string, Map<number, number>>;
  /** Worked minutes on the job not yet on an approved sheet: said on the draft, never billed. */
  awaitingMinutes: number;
  /** Approved minutes with no rate to bill them at. */
  unratedMinutes: number;
}

const laborKey = (l: { workerId: string; rateCents: number }) => `${l.workerId}|${l.rateCents}`;

/** Whether Time is switched on here — the hours a T&M application bills come from nowhere else. */
export async function timeEnabled(tx: Tx, tenantId: string): Promise<boolean> {
  const rows = await tx
    .select({ moduleId: schema.tenantModules.moduleId })
    .from(schema.tenantModules)
    .where(
      and(
        eq(schema.tenantModules.tenantId, tenantId),
        eq(schema.tenantModules.moduleId, "time"),
        eq(schema.tenantModules.enabled, true),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * THE HOURS ON A JOB, from Time. An entry counts when it is WORKED (leave is
 * a cost, never a charge), tagged with the job's cost object, dated on or
 * before `asOf`, and on an APPROVED sheet — the gate the labour accrual
 * uses, so what is billed and what the books carry agree. The rate is the
 * contract's flat rate when it has one, else the person's bill rate in force
 * on the day from Time's rate card — which is owners-only, as every verb
 * that prices hours is; a reader who cannot see rates sees every hour as
 * unrated, never as free.
 */
export async function laborOnJob(
  tx: Tx,
  tenantId: string,
  project: JobProject | null,
  asOf: string,
  flatRateCents: number | null,
): Promise<LaborOnJob> {
  const out: LaborOnJob = { byWorker: new Map(), awaitingMinutes: 0, unratedMinutes: 0 };
  if (!project) return out;
  const member = (await listDimensionMembers(tx, tenantId, PROJECT_DIMENSION)).find(
    (m) => m.packEntityId === project.id,
  );
  if (!member) return out;
  const e = schema.timeEntries;
  const d = schema.timeEntryDimensions;
  const sh = schema.timeSheets;
  const rows = await tx
    .select({
      workerId: e.workerId,
      workDate: e.workDate,
      minutes: e.minutes,
      approved: sql<boolean>`exists (select 1 from ${sh} where ${sh.tenantId} = ${e.tenantId} and ${sh.workerId} = ${e.workerId} and ${sh.approvedAt} is not null and ${e.workDate} between ${sh.periodStartsOn} and ${sh.periodEndsOn})`,
    })
    .from(e)
    .innerJoin(
      d,
      and(
        eq(d.tenantId, e.tenantId),
        eq(d.entryId, e.id),
        eq(d.dimensionType, PROJECT_DIMENSION),
        eq(d.memberId, member.id),
      ),
    )
    .where(and(eq(e.tenantId, tenantId), eq(e.payType, "worked"), lte(e.workDate, asOf)));
  if (rows.length === 0) return out;
  const rates = flatRateCents === null ? await listRates(tx, tenantId) : [];
  const rateFor = (workerId: string, day: string): number => {
    if (flatRateCents !== null) return flatRateCents;
    // Newest first, so the first rate that had started by the day is the one in force.
    const inForce = rates.find((r) => r.workerId === workerId && r.effectiveOn <= day);
    return inForce?.billRateCents ?? 0;
  };
  for (const r of rows) {
    if (!r.approved) {
      out.awaitingMinutes += r.minutes;
      continue;
    }
    const rate = rateFor(r.workerId, r.workDate);
    if (rate === 0) out.unratedMinutes += r.minutes;
    const byRate = out.byWorker.get(r.workerId) ?? new Map<number, number>();
    byRate.set(rate, (byRate.get(rate) ?? 0) + r.minutes);
    out.byWorker.set(r.workerId, byRate);
  }
  return out;
}

/** The labour lines of applications with the person's name, in name order then by rate. */
async function loadLaborLines(
  tx: Tx,
  tenantId: string,
  appIds: string[],
): Promise<Map<string, LaborLineRow[]>> {
  const out = new Map<string, LaborLineRow[]>();
  if (appIds.length === 0) return out;
  const rows = await tx
    .select({ line: schema.jobPayApplicationLabor, name: schema.parties.displayName })
    .from(schema.jobPayApplicationLabor)
    .leftJoin(
      schema.timeWorkers,
      and(
        eq(schema.timeWorkers.tenantId, schema.jobPayApplicationLabor.tenantId),
        eq(schema.timeWorkers.id, schema.jobPayApplicationLabor.workerId),
      ),
    )
    .leftJoin(
      schema.parties,
      and(
        eq(schema.parties.tenantId, schema.timeWorkers.tenantId),
        eq(schema.parties.id, schema.timeWorkers.partyId),
      ),
    )
    .where(
      and(
        eq(schema.jobPayApplicationLabor.tenantId, tenantId),
        inArray(schema.jobPayApplicationLabor.payApplicationId, appIds),
      ),
    );
  rows.sort(
    (a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.line.rateCents - b.line.rateCents,
  );
  for (const r of rows) {
    const list = out.get(r.line.payApplicationId) ?? [];
    list.push({ ...r.line, name: r.name ?? "Somebody no longer in Time" });
    out.set(r.line.payApplicationId, list);
  }
  return out;
}

/** What the labour lines have billed to date: earlier applications' share plus this one's. */
function laborToDateCents(
  lines: ReadonlyArray<Pick<JobPayApplicationLabor, "previousCents" | "thisPeriodCents">>,
): number {
  return lines.reduce((sum, l) => sum + l.previousCents + l.thisPeriodCents, 0);
}

/**
 * Give a time-and-materials draft a line for every person and rate Time has
 * approved hours for on the job as of the period end, carrying what earlier
 * issued applications billed on each; `this period` defaults to the
 * difference and is kept once typed, exactly as `syncCostLines` keeps cost.
 * TO DATE, NEVER BY WINDOW: a sheet approved late shows up as more to date
 * than billed and goes on the next application. A line with nothing to date
 * and nothing before it is dropped — a person whose hours found a rate moves
 * from the no-rate line to a priced one. A rate dated back in Time after an
 * application issued moves hours between lines too, which shows as a credit
 * on the old line and the hours again on the new: re-rated in the open, not
 * quietly.
 */
async function syncLaborLines(
  tx: Tx,
  tenantId: string,
  app: JobPayApplication,
  contract: JobContract,
): Promise<void> {
  const project = await getProject(tx, tenantId, contract.projectId);
  const [labor, previousApp, have] = await Promise.all([
    laborOnJob(tx, tenantId, project, app.periodTo, contract.laborRateCents),
    lastIssuedBefore(tx, tenantId, app.contractId, app.number),
    loadLaborLines(tx, tenantId, [app.id]),
  ]);
  const previous = new Map<
    string,
    { workerId: string; rateCents: number; minutes: number; cents: number }
  >();
  if (previousApp) {
    for (const l of (await loadLaborLines(tx, tenantId, [previousApp.id])).get(previousApp.id) ?? []) {
      previous.set(laborKey(l), {
        workerId: l.workerId,
        rateCents: l.rateCents,
        minutes: l.previousMinutes + l.thisPeriodMinutes,
        cents: l.previousCents + l.thisPeriodCents,
      });
    }
  }
  const toDate = new Map<string, { workerId: string; rateCents: number; minutes: number }>();
  for (const [workerId, byRate] of labor.byWorker) {
    for (const [rateCents, minutes] of byRate) {
      toDate.set(laborKey({ workerId, rateCents }), { workerId, rateCents, minutes });
    }
  }
  const existing = new Map((have.get(app.id) ?? []).map((l) => [laborKey(l), l]));
  const keys = new Set<string>([...toDate.keys(), ...previous.keys(), ...existing.keys()]);
  for (const key of keys) {
    const now = toDate.get(key);
    const before = previous.get(key);
    const line = existing.get(key);
    const workerId = now?.workerId ?? before?.workerId ?? line!.workerId;
    const rateCents = now?.rateCents ?? before?.rateCents ?? line!.rateCents;
    const minutesToDate = now?.minutes ?? 0;
    const previousMinutes = before?.minutes ?? 0;
    const previousCents = before?.cents ?? 0;
    if (minutesToDate === 0 && previousMinutes === 0 && previousCents === 0) {
      if (line) {
        await tx
          .delete(schema.jobPayApplicationLabor)
          .where(eq(schema.jobPayApplicationLabor.id, line.id));
      }
      continue;
    }
    if (line) {
      const untouched = line.thisPeriodMinutes === line.minutesToDate - line.previousMinutes;
      const thisPeriodMinutes = untouched ? minutesToDate - previousMinutes : line.thisPeriodMinutes;
      await tx
        .update(schema.jobPayApplicationLabor)
        .set({
          minutesToDate,
          previousMinutes,
          previousCents,
          thisPeriodMinutes,
          thisPeriodCents: laborLineCents(thisPeriodMinutes, rateCents),
          updatedAt: new Date(),
        })
        .where(eq(schema.jobPayApplicationLabor.id, line.id));
    } else {
      const thisPeriodMinutes = minutesToDate - previousMinutes;
      await tx.insert(schema.jobPayApplicationLabor).values({
        tenantId,
        payApplicationId: app.id,
        workerId,
        rateCents,
        minutesToDate,
        previousMinutes,
        previousCents,
        thisPeriodMinutes,
        thisPeriodCents: laborLineCents(thisPeriodMinutes, rateCents),
      });
    }
  }
}

/** Whether an issued application stands on a contract — what locks its flat labour rate. */
async function hasIssuedApplication(tx: Tx, tenantId: string, contractId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: schema.jobPayApplications.id })
    .from(schema.jobPayApplications)
    .where(
      and(
        eq(schema.jobPayApplications.tenantId, tenantId),
        eq(schema.jobPayApplications.contractId, contractId),
        eq(schema.jobPayApplications.status, "issued"),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * A JOB'S COST IS BILLED BY ONE COST-PLUS CONTRACT. Cost belongs to the
 * project, so two cost-plus contracts on it would each bill the same dollar;
 * refused the moment the second one starts an application.
 */
async function assertOnlyCostPlusBiller(tx: Tx, tenantId: string, contract: JobContract): Promise<void> {
  const rivals = await tx
    .select({ id: schema.jobContracts.id })
    .from(schema.jobContracts)
    .innerJoin(
      schema.jobPayApplications,
      and(
        eq(schema.jobPayApplications.tenantId, schema.jobContracts.tenantId),
        eq(schema.jobPayApplications.contractId, schema.jobContracts.id),
      ),
    )
    .where(
      and(
        eq(schema.jobContracts.tenantId, tenantId),
        eq(schema.jobContracts.projectId, contract.projectId),
        ne(schema.jobContracts.id, contract.id),
        inArray(schema.jobContracts.billingMethod, [
          ...COST_PLUS_METHODS,
          ...TIME_AND_MATERIALS_METHODS,
        ]),
        ne(schema.jobPayApplications.status, "void"),
      ),
    )
    .limit(1);
  if (rivals.length > 0) {
    throw new JobsError("ONE_COST_PLUS", "another cost-plus or time-and-materials contract on this job is already billing its cost");
  }
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
  const contract = await loadContract(tx, tenantId, contractId);
  const costPlus = billsTheLedger(contract.billingMethod);
  const tm = isTimeAndMaterialsMethod(contract.billingMethod);
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
  const ids = apps.map((a) => a.id);
  const [linesByApp, costsByApp, laborByApp] = await Promise.all([
    loadAppLines(tx, tenantId, ids),
    loadCostLines(tx, tenantId, ids),
    loadLaborLines(tx, tenantId, ids),
  ]);
  // A cost-plus DRAFT shows the books as they are NOW, the way a fixed-price
  // draft shows the schedule as it is now; what it bills is what was saved.
  const project = costPlus ? await getProject(tx, tenantId, contract.projectId) : null;

  const out: PayApplicationRow[] = [];
  for (const app of apps) {
    const lines = linesByApp.get(app.id) ?? [];
    let costs = costsByApp.get(app.id) ?? [];
    const labor = laborByApp.get(app.id) ?? [];
    let laborAwaitingMinutes = 0;
    let totals: PayApplicationTotals;
    let cp: CostPlusTotals | null = null;
    if (app.status === "draft") {
      const previous = await lastIssuedBefore(tx, tenantId, contractId, app.number);
      if (costPlus) {
        const ledger = await actualByCode(tx, tenantId, project, app.periodTo, { withoutLabor: tm });
        costs = costs.map((c) => ({
          ...c,
          ledgerToDateCents:
            c.costCodeId === null ? ledger.uncodedCents : (ledger.byCode.get(c.costCodeId) ?? 0),
        }));
        if (tm) {
          // The hours themselves are read at save; what is said live is only what is still waiting.
          laborAwaitingMinutes = (
            await laborOnJob(tx, tenantId, project, app.periodTo, contract.laborRateCents)
          ).awaitingMinutes;
        }
        cp = costPlusTotals(
          costFigures(costs),
          costPlusTerms(contract),
          app.feeToDateCents,
          app.retainagePpm,
          certifiedCents(previous),
          laborToDateCents(labor),
        );
        totals = cp;
      } else {
        totals = payApplicationTotals(figuresOf(lines, true), app.retainagePpm, certifiedCents(previous));
      }
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
      if (costPlus) {
        cp = {
          ...totals,
          laborToDateCents: app.laborToDateCents,
          costToDateCents: app.costToDateCents,
          feeToDateCents: app.feeToDateCents,
          capped:
            app.completedToDateCents <
            app.laborToDateCents + app.costToDateCents + app.feeToDateCents,
        };
      }
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
    out.push({ app, lines, costs, labor, laborAwaitingMinutes, totals, costPlus: cp, invoice });
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
  const carriedQuantity = new Map<string, number>();
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
    for (const p of prior) {
      carried.set(p.sovLineId, p.previousCents + p.thisPeriodCents);
      carriedQuantity.set(p.sovLineId, p.quantityPreviousThousandths + p.quantityThisPeriodThousandths);
    }
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
      quantityPreviousThousandths: carriedQuantity.get(s.id) ?? 0,
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
  const contract = await loadContract(tx, ctx.tenantId, input.contractId);
  const costPlus = billsTheLedger(contract.billingMethod);
  const tm = isTimeAndMaterialsMethod(contract.billingMethod);
  if (costPlus) {
    await assertOnlyCostPlusBiller(tx, ctx.tenantId, contract);
  } else {
    const sov = await listSovLines(tx, ctx.tenantId, input.contractId);
    if (sov.length === 0) {
      throw new JobsError("NO_LINES", "the contract needs a schedule of values first");
    }
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
  if (costPlus) {
    await syncCostLines(tx, ctx.tenantId, rows[0], contract);
    if (tm) await syncLaborLines(tx, ctx.tenantId, rows[0], contract);
  } else await syncDraftLines(tx, ctx.tenantId, rows[0]);
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
  /** Ignored on a unit-priced line when a quantity is given: the money is the quantity at the line's price. */
  thisPeriodCents: number;
  storedCents: number;
  /** Unit price: the quantity completed this period, thousandths; may be negative. */
  quantityThisPeriodThousandths?: number;
}

/** What a cost-plus draft bills on one code this period. Null code = the no-code line. */
export interface CostLineInput {
  costCodeId: string | null;
  thisPeriodCents: number;
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
    /** Cost-plus only: what each code bills this period. */
    costLines?: CostLineInput[];
    /** Cost-plus only, on a contract with a fixed fee: the fee billed to date. */
    feeToDateCents?: number;
    /** Time and materials only: what each person's line bills this period, in minutes. */
    laborLines?: LaborLineInput[];
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
  const contract = await loadContract(tx, ctx.tenantId, app.contractId);
  const costPlus = billsTheLedger(contract.billingMethod);
  const tm = isTimeAndMaterialsMethod(contract.billingMethod);
  // The period may move; the ledger is read as of the NEW period end.
  const synced = input.periodTo !== undefined ? { ...app, periodTo: input.periodTo } : app;
  if (costPlus) {
    await syncCostLines(tx, ctx.tenantId, synced, contract);
    if (tm) await syncLaborLines(tx, ctx.tenantId, synced, contract);
  } else await syncDraftLines(tx, ctx.tenantId, app);

  if (tm && input.laborLines) {
    const current = (await loadLaborLines(tx, ctx.tenantId, [app.id])).get(app.id) ?? [];
    const byKey = new Map(current.map((l) => [laborKey(l), l]));
    for (const line of input.laborLines) {
      // A rate set in Time between opening the draft and saving it re-keys
      // the person's line at the new rate — the very thing the no-rate note
      // tells the person to do. What was typed follows them to their one
      // line; a person with two lines now keeps the refreshed defaults.
      const theirs = current.filter((l) => l.workerId === line.workerId);
      const row = byKey.get(laborKey(line)) ?? (theirs.length === 1 ? theirs[0] : undefined);
      if (!row) continue;
      if (!Number.isInteger(line.thisPeriodMinutes)) {
        throw new JobsError("INVALID_VALUE", "hours must be whole minutes");
      }
      await tx
        .update(schema.jobPayApplicationLabor)
        .set({
          thisPeriodMinutes: line.thisPeriodMinutes,
          thisPeriodCents: laborLineCents(line.thisPeriodMinutes, row.rateCents),
          updatedAt: new Date(),
        })
        .where(eq(schema.jobPayApplicationLabor.id, row.id));
    }
  }
  if (costPlus && input.costLines) {
    const current = (await loadCostLines(tx, ctx.tenantId, [app.id])).get(app.id) ?? [];
    const byCode = new Map(current.map((l) => [l.costCodeId, l]));
    for (const line of input.costLines) {
      const row = byCode.get(line.costCodeId);
      if (!row) {
        throw new JobsError("NOT_FOUND", `cost code ${line.costCodeId ?? "(none)"} is not on this application`);
      }
      if (!Number.isInteger(line.thisPeriodCents)) {
        throw new JobsError("INVALID_VALUE", "amounts must be whole cents");
      }
      await tx
        .update(schema.jobPayApplicationCosts)
        .set({ thisPeriodCents: line.thisPeriodCents, updatedAt: new Date() })
        .where(eq(schema.jobPayApplicationCosts.id, row.id));
    }
  }
  if (input.feeToDateCents !== undefined) {
    if (!Number.isInteger(input.feeToDateCents) || input.feeToDateCents < 0) {
      throw new JobsError("INVALID_VALUE", "the fee billed to date cannot be negative");
    }
    if (contract.feeCents !== null && input.feeToDateCents > contract.feeCents) {
      throw new JobsError("INVALID_VALUE", "the fee billed to date cannot exceed the fixed fee");
    }
  }

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
    const priced = new Map(
      (await listSovLines(tx, ctx.tenantId, app.contractId)).map((sov) => [sov.id, sov.unitPriceCents]),
    );
    for (const line of input.lines) {
      const row = bySov.get(line.sovLineId);
      if (!row) throw new JobsError("NOT_FOUND", `schedule line ${line.sovLineId} is not on this application`);
      if (!Number.isInteger(line.thisPeriodCents) || !Number.isInteger(line.storedCents)) {
        throw new JobsError("INVALID_VALUE", "amounts must be whole cents");
      }
      if (line.storedCents < 0) {
        throw new JobsError("INVALID_VALUE", "stored materials cannot be negative");
      }
      // A unit-priced line is billed by QUANTITY: what was typed is the
      // quantity, and the money is that quantity at the line's price (ADR 0064).
      let thisPeriodCents = line.thisPeriodCents;
      let quantityThisPeriodThousandths = row.quantityThisPeriodThousandths;
      const unitPriceCents = priced.get(line.sovLineId) ?? null;
      if (unitPriceCents !== null && line.quantityThisPeriodThousandths !== undefined) {
        if (!Number.isInteger(line.quantityThisPeriodThousandths)) {
          throw new JobsError("INVALID_VALUE", "a quantity must be whole thousandths");
        }
        if (row.quantityPreviousThousandths + line.quantityThisPeriodThousandths < 0) {
          throw new JobsError("INVALID_VALUE", "a line's quantity to date cannot go below nothing");
        }
        quantityThisPeriodThousandths = line.quantityThisPeriodThousandths;
        thisPeriodCents = unitLineCents(quantityThisPeriodThousandths, unitPriceCents);
      }
      if (row.previousCents + thisPeriodCents + line.storedCents < 0) {
        throw new JobsError(
          "INVALID_VALUE",
          "a line cannot be completed to less than nothing",
        );
      }
      await tx
        .update(schema.jobPayApplicationLines)
        .set({
          thisPeriodCents,
          quantityThisPeriodThousandths,
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
  if (costPlus && input.feeToDateCents !== undefined) patch.feeToDateCents = input.feeToDateCents;
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
  const contract = await loadContract(tx, ctx.tenantId, app.contractId);
  const costPlus = billsTheLedger(contract.billingMethod);
  const tm = isTimeAndMaterialsMethod(contract.billingMethod);
  const previous = await lastIssuedBefore(tx, ctx.tenantId, app.contractId, app.number);

  /**
   * THE CERTIFICATE, either way: five totals and the gross lines the invoice
   * carries before retainage. A fixed-price application earns a share of its
   * schedule; a cost-plus one earns what the job cost plus the fee (ADR 0060).
   */
  let totals: PayApplicationTotals;
  let cp: CostPlusTotals | null = null;
  let lines: PayApplicationLineRow[] = [];
  const gross: Array<{ description: string; cents: number }> = [];
  if (costPlus) {
    await syncCostLines(tx, ctx.tenantId, app, contract);
    if (tm) await syncLaborLines(tx, ctx.tenantId, app, contract);
    const costs = (await loadCostLines(tx, ctx.tenantId, [app.id])).get(app.id) ?? [];
    const labor = tm ? ((await loadLaborLines(tx, ctx.tenantId, [app.id])).get(app.id) ?? []) : [];
    if (costs.length === 0 && labor.length === 0) {
      throw new JobsError(
        "NO_LINES",
        tm
          ? "the books carry no cost and Time no approved hours on this job yet"
          : "the books carry no cost on this job yet",
      );
    }
    // Hours with no rate are hours nobody has priced: they wait, they are not given away.
    const unpriced = labor.find((l) => l.rateCents === 0 && l.thisPeriodMinutes !== 0);
    if (unpriced) throw new JobsError("NO_BILL_RATE", unpriced.name);
    cp = costPlusTotals(
      costFigures(costs),
      costPlusTerms(contract),
      app.feeToDateCents,
      app.retainagePpm,
      certifiedCents(previous),
      laborToDateCents(labor),
    );
    totals = cp;
    const laborThisPeriod = cp.laborToDateCents - (previous?.laborToDateCents ?? 0);
    const costThisPeriod = cp.costToDateCents - (previous?.costToDateCents ?? 0);
    const feeThisPeriod = cp.feeToDateCents - (previous?.feeToDateCents ?? 0);
    const grossThisPeriod = cp.completedToDateCents - (previous?.completedToDateCents ?? 0);
    if (grossThisPeriod !== laborThisPeriod + costThisPeriod + feeThisPeriod) {
      // The maximum held the figure down; one line says so rather than lines
      // that do not add up to it.
      gross.push({
        description: tm
          ? `Application ${app.number} — labour, cost and markup through ${app.periodTo}, at the not-to-exceed`
          : `Application ${app.number} — cost plus fee through ${app.periodTo}, at the guaranteed maximum`,
        cents: grossThisPeriod,
      });
    } else {
      // Each person's hours this period is a line the client can read against the timesheet.
      for (const l of labor) {
        if (l.thisPeriodCents === 0) continue;
        gross.push({
          description: `Application ${app.number} — ${l.name}, ${minutesToHoursString(l.thisPeriodMinutes)} h at ${(l.rateCents / 100).toFixed(2)}/h through ${app.periodTo}`,
          cents: l.thisPeriodCents,
        });
      }
      if (costThisPeriod !== 0) {
        gross.push({
          description: `Application ${app.number} — cost incurred through ${app.periodTo}`,
          cents: costThisPeriod,
        });
      }
      if (feeThisPeriod !== 0) {
        gross.push({
          description: contract.feePpm
            ? `${tm ? "Markup" : "Fee"} (${ppmToPercentString(contract.feePpm)}% of cost)${contract.feeCents ? " and fixed fee" : ""}`
            : tm
              ? "Markup"
              : "Fee",
          cents: feeThisPeriod,
        });
      }
    }
  } else {
    await syncDraftLines(tx, ctx.tenantId, app);
    lines = (await loadAppLines(tx, ctx.tenantId, [app.id])).get(app.id) ?? [];
    if (lines.length === 0) {
      throw new JobsError("NO_LINES", "the contract needs a schedule of values first");
    }
    totals = payApplicationTotals(figuresOf(lines, true), app.retainagePpm, certifiedCents(previous));
    const grossThisPeriod = totals.completedToDateCents - (previous?.completedToDateCents ?? 0);
    if (lines.some((l) => l.unitPriceCents !== null)) {
      // A unit-price invoice reads like a unit-price invoice: a line per item
      // with the quantity this period at its price, and whatever the
      // certificate carries beyond the items (stored materials coming and
      // going) as one line of its own.
      let itemised = 0;
      for (const l of lines) {
        if (l.unitPriceCents === null || l.quantityThisPeriodThousandths === 0) continue;
        gross.push({
          description: `Application ${app.number} — ${l.description}, ${thousandthsToQuantityString(l.quantityThisPeriodThousandths)} ${l.unit || "units"} at ${(l.unitPriceCents / 100).toFixed(2)}${l.unit ? `/${l.unit}` : ""} through ${app.periodTo}`,
          cents: l.thisPeriodCents,
        });
        itemised += l.thisPeriodCents;
      }
      if (grossThisPeriod - itemised !== 0) {
        gross.push({
          description: `Application ${app.number} — stored materials and other work through ${app.periodTo}`,
          cents: grossThisPeriod - itemised,
        });
      }
    } else if (grossThisPeriod !== 0) {
      gross.push({
        description: `Application ${app.number} — work completed and stored through ${app.periodTo}`,
        cents: grossThisPeriod,
      });
    }
  }
  if (totals.dueCents <= 0) {
    throw new JobsError("NOTHING_DUE", "nothing is due on this application");
  }
  const retainageThisPeriod = totals.retainageCents - (previous?.retainageCents ?? 0);

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
      ...gross.map((g) => ({
        description: g.description,
        quantity: "1",
        unitPriceCents: g.cents,
        incomeAccountId: revenueAccountId,
        dimensionMemberIds: dims,
      })),
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
      costToDateCents: cp?.costToDateCents ?? 0,
      feeToDateCents: cp?.feeToDateCents ?? 0,
      laborToDateCents: cp?.laborToDateCents ?? 0,
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

// ------------------------------------------------------------ the printout

/** Everything the certificate PDF prints, read once (slice 5e, ADR 0063). */
export interface CertificateData {
  app: JobPayApplication;
  contract: JobContract;
  project: JobProject;
  row: PayApplicationRow;
  /** The last issued application before this one; its period end splits the change orders. */
  previous: JobPayApplication | null;
  /** The APPROVED change orders on this contract. */
  changeOrders: ChangeOrderRow[];
  ownerName: string;
  ownerAddress: string;
}

/**
 * A pay application with the facts its printout needs: the contract and the
 * project it belongs to, the row the contract page shows (live for a draft,
 * frozen once issued), the approved change orders, the party the application
 * is made to. Null when there is no such application in this tenant — the
 * route answers 404, never the pack.
 */
export async function payApplicationCertificate(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<CertificateData | null> {
  const apps = await tx
    .select()
    .from(schema.jobPayApplications)
    .where(and(eq(schema.jobPayApplications.tenantId, tenantId), eq(schema.jobPayApplications.id, id)))
    .limit(1);
  const app = apps[0];
  if (!app) return null;
  const contract = await getContract(tx, tenantId, app.contractId);
  if (!contract) return null;
  const project = await getProject(tx, tenantId, contract.projectId);
  if (!project) return null;
  const row = (await listPayApplications(tx, tenantId, contract.id)).find((r) => r.app.id === id);
  if (!row) return null;
  const previous = await lastIssuedBefore(tx, tenantId, contract.id, app.number);
  const changeOrders = (await listChangeOrders(tx, tenantId, project.id)).filter(
    (r) =>
      r.contract.id === contract.id &&
      (APPROVED_CHANGE_STATUSES as readonly string[]).includes(r.changeOrder.status),
  );
  let ownerName = "";
  let ownerAddress = "";
  if (contract.counterpartyPartyId) {
    const party = await tx
      .select({ name: schema.parties.displayName })
      .from(schema.parties)
      .where(and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, contract.counterpartyPartyId)))
      .limit(1);
    ownerName = party[0]?.name ?? "";
    // The only postal address the product keeps is the customer's, in
    // Accounting; a party that has never been billed prints its name alone.
    ownerAddress = (await customerForParty(tx, tenantId, contract.counterpartyPartyId))?.address ?? "";
  }
  return { app, contract, project, row, previous, changeOrders, ownerName, ownerAddress };
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
