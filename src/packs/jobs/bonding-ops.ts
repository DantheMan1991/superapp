import "server-only";
import { and, asc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobBond, JobBondingLine } from "@/db/schema";
import { JobsError, billedByProject, projectValues, requireWrite, type JobsCtx } from "./ops";
import { backlogOf, bondStanding, bondingCapacity, tiesUpCapacity, type BondedJob, type BondingCapacity } from "./bonding-math";
import { isBondKind, isBondStatus, slugLabel, type BondStanding, type BondStatus } from "./vocabulary";

/**
 * Surety bonds and the line behind them (ADR 0078).
 *
 * Owner-only throughout: a bond is a term of the agreement, the way a
 * contract's value is, and the line is what the surety will back. Nothing
 * here posts anything — the surety's invoice is an ordinary bill in
 * Accounting, and the bond records what it cost and which code it belongs
 * on so the job cost report shows it beside everything else.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateOrNull(value: string | null | undefined, what: string): string | null {
  const v = (value ?? "").trim();
  if (v === "") return null;
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

function positive(cents: number, what: string): number {
  if (!Number.isInteger(cents) || cents <= 0) throw new JobsError("INVALID_VALUE", `${what} is an amount of more than nothing`);
  return cents;
}

export interface BondInput {
  kind: string;
  number?: string;
  suretyPartyId?: string | null;
  penalSumCents: number;
  premiumCents?: number | null;
  costCodeId?: string | null;
  contractId?: string | null;
  effectiveOn?: string | null;
  expiresOn?: string | null;
  notes?: string;
}

async function partyOrThrow(tx: Tx, tenantId: string, partyId: string | null | undefined): Promise<string | null> {
  if (!partyId) return null;
  const rows = await tx
    .select({ id: schema.parties.id })
    .from(schema.parties)
    .where(and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, partyId)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("INVALID_VALUE", "that surety is not in the books");
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

/** A contract of THIS job, or none: a bond cannot name somebody else's agreement. */
async function contractOrThrow(tx: Tx, tenantId: string, projectId: string, contractId: string | null | undefined): Promise<string | null> {
  if (!contractId) return null;
  const rows = await tx
    .select({ id: schema.jobContracts.id })
    .from(schema.jobContracts)
    .where(
      and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, contractId), eq(schema.jobContracts.projectId, projectId)),
    )
    .limit(1);
  if (rows.length === 0) throw new JobsError("INVALID_VALUE", "that contract is not on this job");
  return contractId;
}

function checkedFields(input: BondInput) {
  const kind = input.kind.trim().toLowerCase();
  if (!isBondKind(kind)) {
    throw new JobsError("INVALID_KIND", "a kind of bond must be lowercase letters, numbers and underscores");
  }
  const premium = input.premiumCents ?? null;
  if (premium !== null && (!Number.isInteger(premium) || premium < 0)) {
    throw new JobsError("INVALID_VALUE", "a premium is an amount, or nothing at all");
  }
  const effectiveOn = dateOrNull(input.effectiveOn, "a bond");
  const expiresOn = dateOrNull(input.expiresOn, "an expiry");
  if (effectiveOn && expiresOn && expiresOn < effectiveOn) {
    throw new JobsError("INVALID_VALUE", "a bond cannot run out before it takes effect");
  }
  return {
    kind,
    number: bounded(input.number, 100, "a bond number"),
    penalSumCents: positive(input.penalSumCents, "what a bond covers"),
    premiumCents: premium,
    effectiveOn,
    expiresOn,
    notes: bounded(input.notes, 4000, "the notes"),
  };
}

export async function getBond(tx: Tx, tenantId: string, id: string): Promise<JobBond | null> {
  const rows = await tx
    .select()
    .from(schema.jobBonds)
    .where(and(eq(schema.jobBonds.tenantId, tenantId), eq(schema.jobBonds.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

async function bondOrThrow(tx: Tx, tenantId: string, id: string): Promise<JobBond> {
  const row = await getBond(tx, tenantId, id);
  if (!row) throw new JobsError("NOT_FOUND", `bond ${id} not found`);
  return row;
}

/**
 * Record one. A bond starts `requested` — asked for and not yet in hand —
 * unless a date it took effect is given, which is what recording one that
 * already exists looks like.
 */
export async function recordBond(tx: Tx, ctx: JobsCtx, projectId: string, input: BondInput): Promise<JobBond> {
  requireWrite(ctx, "owner");
  const project = await tx
    .select({ id: schema.jobProjects.id })
    .from(schema.jobProjects)
    .where(and(eq(schema.jobProjects.tenantId, ctx.tenantId), eq(schema.jobProjects.id, projectId)))
    .limit(1);
  if (project.length === 0) throw new JobsError("NOT_FOUND", `project ${projectId} not found`);
  const checked = checkedFields(input);
  const rows = await tx
    .insert(schema.jobBonds)
    .values({
      tenantId: ctx.tenantId,
      projectId,
      ...checked,
      status: checked.effectiveOn ? "issued" : "requested",
      contractId: await contractOrThrow(tx, ctx.tenantId, projectId, input.contractId),
      suretyPartyId: await partyOrThrow(tx, ctx.tenantId, input.suretyPartyId),
      costCodeId: await codeOrThrow(tx, ctx.tenantId, input.costCodeId),
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

export async function updateBond(tx: Tx, ctx: JobsCtx, id: string, input: BondInput, expectedVersion: number): Promise<JobBond> {
  requireWrite(ctx, "owner");
  const bond = await bondOrThrow(tx, ctx.tenantId, id);
  if (bond.version !== expectedVersion) throw new JobsError("STALE_VERSION", "bond changed");
  const checked = checkedFields(input);
  // A bond in force has to keep the day it took effect; the CHECK says so too.
  if (!checked.effectiveOn && bond.status !== "requested" && bond.status !== "void") {
    throw new JobsError("INVALID_VALUE", "a bond that is in force carries the day it took effect");
  }
  const rows = await tx
    .update(schema.jobBonds)
    .set({
      ...checked,
      contractId: await contractOrThrow(tx, ctx.tenantId, bond.projectId, input.contractId),
      suretyPartyId: await partyOrThrow(tx, ctx.tenantId, input.suretyPartyId),
      costCodeId: await codeOrThrow(tx, ctx.tenantId, input.costCodeId),
      version: bond.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobBonds.tenantId, ctx.tenantId), eq(schema.jobBonds.id, id)))
    .returning();
  return rows[0];
}

export interface BondStatusInput {
  status: string;
  /** Required to put a bond in force, and kept when it is released. */
  effectiveOn?: string | null;
  /** Required to release one. */
  releasedOn?: string | null;
}

/**
 * Move a bond along: issued when it arrives, released when the obligee lets
 * it go, dropped when it was never written. Releasing is what frees the
 * capacity it was tying up, which is the whole reason the status exists.
 */
export async function setBondStatus(tx: Tx, ctx: JobsCtx, id: string, input: BondStatusInput): Promise<JobBond> {
  requireWrite(ctx, "owner");
  const bond = await bondOrThrow(tx, ctx.tenantId, id);
  if (!isBondStatus(input.status)) throw new JobsError("INVALID_STATUS", "a bond is asked for, issued, released or dropped");
  const status: BondStatus = input.status;
  const effectiveOn = dateOrNull(input.effectiveOn, "a bond") ?? bond.effectiveOn;
  if ((status === "issued" || status === "released") && !effectiveOn) {
    throw new JobsError("INVALID_VALUE", "say the day the bond took effect");
  }
  const releasedOn = status === "released" ? dateOrNull(input.releasedOn, "a release") : null;
  if (status === "released" && !releasedOn) throw new JobsError("INVALID_VALUE", "say the day the bond was released");
  if (releasedOn && effectiveOn && releasedOn < effectiveOn) {
    throw new JobsError("INVALID_VALUE", "a bond cannot be released before it took effect");
  }
  const rows = await tx
    .update(schema.jobBonds)
    .set({
      status,
      effectiveOn: status === "requested" || status === "void" ? bond.effectiveOn : effectiveOn,
      releasedOn,
      version: bond.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobBonds.tenantId, ctx.tenantId), eq(schema.jobBonds.id, id)))
    .returning();
  return rows[0];
}

// ------------------------------------------------------------------- the line

export interface BondingLineInput {
  singleJobLimitCents: number | null;
  aggregateLimitCents: number | null;
  suretyPartyId?: string | null;
  notes?: string;
}

export async function getBondingLine(tx: Tx, tenantId: string, entityId: string): Promise<JobBondingLine | null> {
  const rows = await tx
    .select()
    .from(schema.jobBondingLines)
    .where(and(eq(schema.jobBondingLines.tenantId, tenantId), eq(schema.jobBondingLines.entityId, entityId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Set what the surety will back for one company. One row per company, so
 * this is an upsert: a business types the letter's two numbers once and
 * changes them when the letter changes.
 */
export async function setBondingLine(tx: Tx, ctx: JobsCtx, entityId: string, input: BondingLineInput): Promise<JobBondingLine> {
  requireWrite(ctx, "owner");
  const single = input.singleJobLimitCents;
  const aggregate = input.aggregateLimitCents;
  for (const [value, what] of [
    [single, "a single-job limit"],
    [aggregate, "an aggregate limit"],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      throw new JobsError("INVALID_VALUE", `${what} is an amount of more than nothing, or nothing at all`);
    }
  }
  if (single !== null && aggregate !== null && single > aggregate) {
    throw new JobsError("INVALID_VALUE", "a single-job limit cannot be more than the aggregate");
  }
  const values = {
    singleJobLimitCents: single,
    aggregateLimitCents: aggregate,
    suretyPartyId: await partyOrThrow(tx, ctx.tenantId, input.suretyPartyId),
    notes: bounded(input.notes, 4000, "the notes"),
  };
  const existing = await getBondingLine(tx, ctx.tenantId, entityId);
  if (existing) {
    const rows = await tx
      .update(schema.jobBondingLines)
      .set({ ...values, version: existing.version + 1, updatedAt: new Date() })
      .where(and(eq(schema.jobBondingLines.tenantId, ctx.tenantId), eq(schema.jobBondingLines.id, existing.id)))
      .returning();
    return rows[0];
  }
  const rows = await tx
    .insert(schema.jobBondingLines)
    .values({ tenantId: ctx.tenantId, entityId, ...values, createdByClerkUserId: ctx.userId })
    .returning();
  return rows[0];
}

// ------------------------------------------------------------------- reading

export interface BondRow {
  bond: JobBond;
  standing: BondStanding;
  suretyName: string | null;
  codeLabel: string | null;
  /** The contract it names, in the words the contracts tab uses. */
  contractLabel: string | null;
}

const columns = {
  bond: schema.jobBonds,
  suretyName: schema.parties.displayName,
  code: schema.jobCostCodes.code,
  codeName: schema.jobCostCodes.name,
  contractKind: schema.jobContracts.kind,
  contractName: schema.jobContracts.name,
};

type Selected = {
  bond: JobBond;
  suretyName: string | null;
  code: string | null;
  codeName: string | null;
  contractKind: string | null;
  contractName: string | null;
};

function query(tx: Tx, tenantId: string, where: SQL | undefined) {
  return tx
    .select(columns)
    .from(schema.jobBonds)
    .leftJoin(schema.parties, and(eq(schema.parties.tenantId, schema.jobBonds.tenantId), eq(schema.parties.id, schema.jobBonds.suretyPartyId)))
    .leftJoin(
      schema.jobCostCodes,
      and(eq(schema.jobCostCodes.tenantId, schema.jobBonds.tenantId), eq(schema.jobCostCodes.id, schema.jobBonds.costCodeId)),
    )
    .leftJoin(
      schema.jobContracts,
      and(eq(schema.jobContracts.tenantId, schema.jobBonds.tenantId), eq(schema.jobContracts.id, schema.jobBonds.contractId)),
    )
    .where(and(eq(schema.jobBonds.tenantId, tenantId), where))
    .orderBy(asc(schema.jobBonds.createdAt));
}

function toRow(r: Selected, today: string): BondRow {
  // The kind through `slugLabel`, so this reads the way the contracts table above it does.
  const label = [r.contractKind ? slugLabel(r.contractKind) : null, r.contractName]
    .filter((x): x is string => !!x && x !== "")
    .join(" · ");
  return {
    bond: r.bond,
    standing: bondStanding(r.bond.status, r.bond.expiresOn, today),
    suretyName: r.suretyName,
    codeLabel: r.code ? `${r.code} · ${r.codeName ?? ""}`.trim() : null,
    contractLabel: label === "" ? null : label,
  };
}

/** One job's bonds, oldest first. */
export async function listBonds(tx: Tx, tenantId: string, projectId: string, today: string): Promise<BondRow[]> {
  return (await query(tx, tenantId, eq(schema.jobBonds.projectId, projectId))).map((r) => toRow(r, today));
}

export interface BondedJobRow extends BondedJob {
  number: string;
  name: string;
  status: string;
  /** Every bond on the job that is still tying up the line. */
  bonds: BondRow[];
}

export interface BondingView {
  entityId: string;
  line: JobBondingLine | null;
  capacity: BondingCapacity;
  /** One entry per job, however many bonds it carries — see `bonding-math.ts`. */
  jobs: BondedJobRow[];
  /** Bonds worth a sentence: ending soon, expired, or still only asked for. */
  attention: { projectId: string; number: string; row: BondRow }[];
}

/**
 * The capacity screen for one company: the surety's line, what is tying it
 * up, and the jobs doing the tying. A job counts ONCE however many bonds it
 * carries, which is why the bonds are folded per job before the arithmetic.
 */
export async function bondingView(tx: Tx, tenantId: string, entityId: string, today: string): Promise<BondingView> {
  const [line, rows] = await Promise.all([
    getBondingLine(tx, tenantId, entityId),
    query(
      tx,
      tenantId,
      and(
        inArray(schema.jobBonds.projectId, sql`(select id from job_projects where tenant_id = ${tenantId} and entity_id = ${entityId})`),
        ne(schema.jobBonds.status, "void"),
      ),
    ),
  ]);
  const bondRows = rows.map((r) => toRow(r, today));

  /*
   * TWO LISTS OVER THE SAME ROWS, AND THEY DO NOT OVERLAP.
   *
   * `holding` is what ties up the line; `worth a look` is mostly what does
   * NOT — an expired bond nobody renewed has quietly given the job back,
   * which is the thing most worth saying out loud. Building the second
   * inside the first's branch hid every expired bond on a job with nothing
   * else on it, which is exactly the job you want to hear about.
   */
  const holding = new Map<string, BondRow[]>();
  const flagged: BondRow[] = [];
  for (const row of bondRows) {
    if (tiesUpCapacity(row.standing)) {
      const list = holding.get(row.bond.projectId) ?? [];
      list.push(row);
      holding.set(row.bond.projectId, list);
    }
    if (row.standing === "expiring" || row.standing === "expired" || row.standing === "requested") flagged.push(row);
  }

  const needed = [...new Set([...holding.keys(), ...flagged.map((r) => r.bond.projectId)])];
  const jobs: BondedJobRow[] = [];
  const attention: BondingView["attention"] = [];
  if (needed.length > 0) {
    const [values, billed, projects] = await Promise.all([
      projectValues(tx, tenantId),
      billedByProject(tx, tenantId, { kind: "one", entityId }),
      tx
        .select({
          id: schema.jobProjects.id,
          number: schema.jobProjects.number,
          name: schema.jobProjects.name,
          status: schema.jobProjects.status,
        })
        .from(schema.jobProjects)
        .where(and(eq(schema.jobProjects.tenantId, tenantId), inArray(schema.jobProjects.id, needed))),
    ]);
    // A cancelled job ties up nothing and is worth no look: the exposure went with it.
    const live = new Map(projects.filter((p) => p.status !== "cancelled").map((p) => [p.id, p]));
    for (const [projectId, bonds] of holding) {
      const p = live.get(projectId);
      if (!p) continue;
      const job = backlogOf({
        projectId,
        contractCents: values.get(projectId)?.valueCents ?? 0,
        billedCents: billed.get(projectId) ?? 0,
      });
      jobs.push({ ...job, number: p.number, name: p.name, status: p.status, bonds });
    }
    jobs.sort((a, b) => b.backlogCents - a.backlogCents || a.number.localeCompare(b.number));
    for (const row of flagged) {
      const p = live.get(row.bond.projectId);
      if (!p) continue;
      attention.push({ projectId: row.bond.projectId, number: p.number, row });
    }
  }
  return {
    entityId,
    line,
    capacity: bondingCapacity(
      { singleJobLimitCents: line?.singleJobLimitCents ?? null, aggregateLimitCents: line?.aggregateLimitCents ?? null },
      jobs,
    ),
    jobs,
    attention,
  };
}
