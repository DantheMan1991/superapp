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
  JobProject,
} from "@/db/schema";
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
      | "APPROVAL_DATE_REQUIRED",
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
function requireWrite(ctx: JobsCtx, level: WriteLevel): void {
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
export async function actualByProject(
  tx: Tx,
  tenantId: string,
  scope: EntityScope,
): Promise<Map<string, number>> {
  const expenseAccounts = await tx
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.accountType, "expense")),
    );
  if (expenseAccounts.length === 0) return new Map();

  const rows = await getBalances(tx, tenantId, {
    scope,
    accountIds: expenseAccounts.map((a) => a.id),
    groupByDimensionType: PROJECT_DIMENSION,
  });

  /**
   * `memberId` is the dimension member, not the project. The pack owns the
   * mapping back to its own row, because `dimension_members.pack_entity_id` is
   * the only place the two are tied together.
   */
  const members = await listDimensionMembers(tx, tenantId, PROJECT_DIMENSION);
  const projectOf = new Map(members.map((m) => [m.id, m.packEntityId]));

  const out = new Map<string, number>();
  for (const row of rows) {
    if (!row.memberId) continue; // untagged cost belongs to no job
    const projectId = projectOf.get(row.memberId);
    if (!projectId) continue;
    out.set(projectId, (out.get(projectId) ?? 0) + row.netCents);
  }
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
