import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { allowsWrite, type WriteLevel } from "@/lib/packs/authorize";
import type {
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
  COMMITTED_STATUSES,
  COST_CODE_DIMENSION,
  DELIVERY_METHOD_FORMAT,
  PROJECT_DIMENSION,
  isBillingMethod,
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
      | "STALE_VERSION",
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
 * ONE STATEMENT FOR THE WHOLE LIST, grouped in the database rather than a query
 * per project — the reason `listProjectRows` reads the way it does.
 */
export interface ProjectValue {
  projectId: string;
  valueCents: number;
  signedCount: number;
}

export async function projectValues(
  tx: Tx,
  tenantId: string,
): Promise<Map<string, ProjectValue>> {
  const rows = await tx
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
    .groupBy(schema.jobContracts.projectId);

  return new Map(rows.map((r) => [r.projectId, r]));
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
