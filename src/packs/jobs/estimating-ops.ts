import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobEstimate, JobEstimateGroup, JobEstimateLine } from "@/db/schema";
import type { RememberedPrice } from "./price-memory";
import {
  estimateByCode,
  estimateTotals,
  groupCostCents,
  groupPriceCents,
  isFixedPrice,
  lineCostCents,
  linePriceCents,
  scheduleRows,
  type EstimateTotals,
} from "./estimate-math";
import {
  JobsError,
  getProject,
  requireWrite,
  saveSovLines,
  setBudgetLines,
  updateContract,
  type JobsCtx,
} from "./ops";
import { customerForParty } from "@/modules/accounting/invoicing/customers";
import { isProposalFormat } from "./proposal-sections";
import { createSelection } from "./selections-ops";
import {
  RATE_PPM_MAX,
  isEstimateStatus,
  isGroupPriceMode,
  isProposalPresentation,
  isScheduleShape,
  type ScheduleShape,
} from "./vocabulary";

/**
 * Estimates — slice 10 of the construction plan, ADR 0069: the front end of
 * every job. An estimate is lines of cost and price on a job; accepted, it
 * names the contract it priced, and from there the pack's other verbs take
 * over — the budget by code, the schedule of values by line, the value on
 * the contract. Nothing here bills, and nothing here is stored that the
 * lines already say.
 *
 * **WRITING ONE IS A CHORE; MAKING IT MONEY IS NOT.** Drafting, pricing and
 * sending are `member` — the estimator is rarely the owner. Accepting one
 * onto a contract, making it the budget or the schedule of values touch
 * signed money and are `owner`, held by the verbs they call.
 */

export interface EstimateLineInput {
  /** Present when editing a line that exists; absent for a new one. */
  id?: string;
  /**
   * The client-facing item this line sits in (ADR 0079): an existing group's
   * id, or the `key` of a group being created in the same save. Null or absent
   * leaves the line loose. Only the server mints a group's id, which is why a
   * new group is referenced by a key and never by an id the client chose.
   */
  groupRef?: string | null;
  costCodeId?: string | null;
  description: string;
  /** What the client reads instead (ADR 0080); blank uses the description. */
  clientDescription?: string;
  /** Whether the line is a row on the proposal; false is only allowed inside an item. */
  clientVisible?: boolean;
  unit?: string;
  /** In thousandths; 1,000 — one — for a lump sum. */
  quantityThousandths?: number;
  unitCostCents?: number;
  markupPpm?: number | null;
  unitPriceCents?: number | null;
  notes?: string;
  /**
   * WHERE THIS LINE'S NUMBER CAME FROM (X2b, ADR 0098). A walk sets it; the
   * editor never does, and every line somebody typed carries a blank.
   *
   * **OMITTING IT LEAVES WHAT IS THERE**, rather than clearing it, which is
   * the whole reason it is optional in two senses: the editor's autosave
   * posts every line on every keystroke and does not know about a basis, so
   * a save that blanked an absent field would wipe the provenance off a
   * walked estimate the first time somebody fixed a typo.
   */
  basis?: string;
  basisDetail?: string;
}

/** A client-facing item on the estimate (ADR 0079). */
export interface EstimateGroupInput {
  /** Present when editing a group that exists. */
  id?: string;
  /** For a new group: what its lines name in `groupRef`. Ignored when `id` is given. */
  key?: string;
  name: string;
  clientNote?: string;
  /** The heading it is printed under. A label, never a code. */
  section?: string;
  /** Whether the client sees what is in it. Absent means yes. */
  showLines?: boolean;
  /** "rollup" — its lines sum — or "fixed" — the price is typed. */
  priceMode?: string;
  /** Required by `fixed`, refused by `rollup`. */
  fixedPriceCents?: number | null;
  /**
   * **THIS ITEM IS AN ALLOWANCE** (X12): a figure the client agrees to now
   * and chooses against later. Absent means no, so every caller that does
   * not know about allowances leaves one off rather than setting one.
   */
  isAllowance?: boolean;
}

export interface EstimateInput {
  projectId: string;
  number: string;
  title?: string;
  status?: string;
  sentOn?: string | null;
  decidedOn?: string | null;
  validUntil?: string | null;
  markupPpm?: number;
  overheadPpm?: number;
  profitPpm?: number;
  notes?: string;
  /** The proposal (ADR 0070): how the price is shown, and the client's three texts. */
  presentation?: string;
  /** Whether the `codes` presentation prints a code's number beside its name (ADR 0080). */
  showCodeNumbers?: boolean;
  /** What the paper is (E5a, ADR 0083): `letter` or `brochure`. A printing choice. */
  format?: string;
  /** The letter the brochure opens with. One of the proposal's WORDS, so fixed with the money. */
  letter?: string;
  scope?: string;
  exclusions?: string;
  terms?: string;
  /** The client-facing items, in the order given (ADR 0079). */
  groups?: EstimateGroupInput[];
  lines?: EstimateLineInput[];
}

function validateRate(value: number | null | undefined, what: string): void {
  if (value === undefined || value === null) return;
  if (!Number.isInteger(value) || value < 0 || value > RATE_PPM_MAX) {
    throw new JobsError("INVALID_VALUE", `${what} must be between 0% and 1,000%`);
  }
}

function validateEstimateShape(input: Partial<EstimateInput>): void {
  if (input.number !== undefined && input.number.trim() === "") {
    throw new JobsError("INVALID_VALUE", "an estimate needs a number");
  }
  if (input.status !== undefined && !isEstimateStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  if (input.format !== undefined && !isProposalFormat(input.format)) {
    throw new JobsError("INVALID_VALUE", "a proposal prints as a letter or as a brochure");
  }
  if (input.presentation !== undefined && !isProposalPresentation(input.presentation)) {
    throw new JobsError(
      "INVALID_VALUE",
      "a proposal shows its price line by line, by cost code, by item or as one sum",
    );
  }
  validateRate(input.markupPpm, "a markup");
  validateRate(input.overheadPpm, "overhead");
  validateRate(input.profitPpm, "profit");
  for (const group of input.groups ?? []) {
    if (group.name.trim() === "") {
      throw new JobsError("INVALID_VALUE", "an item needs a name the client will read");
    }
    const mode = group.priceMode ?? "rollup";
    if (!isGroupPriceMode(mode)) {
      throw new JobsError("INVALID_VALUE", `an item's price either adds up its lines or is typed: ${mode}`);
    }
    const fixed = group.fixedPriceCents ?? null;
    if (mode === "fixed" && fixed === null) {
      throw new JobsError("INVALID_VALUE", `give ${group.name.trim()} the price the client pays, or let its lines add up`);
    }
    if (mode === "rollup" && fixed !== null) {
      throw new JobsError("INVALID_VALUE", `${group.name.trim()} adds up its lines, so it cannot also carry a price`);
    }
    if (fixed !== null && (!Number.isInteger(fixed) || fixed < 0)) {
      throw new JobsError("INVALID_VALUE", "a price cannot be negative");
    }
  }
  for (const line of input.lines ?? []) {
    if (line.description.trim() === "") {
      throw new JobsError("INVALID_VALUE", "an estimate line needs a description");
    }
    const qty = line.quantityThousandths ?? 1000;
    if (!Number.isInteger(qty) || qty < 0) {
      throw new JobsError("INVALID_VALUE", "a quantity cannot be negative");
    }
    const cost = line.unitCostCents ?? 0;
    if (!Number.isInteger(cost) || cost < 0) {
      throw new JobsError("INVALID_VALUE", "a unit cost cannot be negative");
    }
    validateRate(line.markupPpm, "a line's markup");
    const price = line.unitPriceCents ?? null;
    if (price !== null && (!Number.isInteger(price) || price < 0)) {
      throw new JobsError("INVALID_VALUE", "a unit price cannot be negative");
    }
    // Hidden money must have somewhere to hide, and an item is that somewhere:
    // a hidden loose line is money with no row and a page that stops adding up.
    if (line.clientVisible === false && !line.groupRef) {
      throw new JobsError(
        "INVALID_VALUE",
        `put ${line.description.trim()} in an item before keeping it off the proposal`,
      );
    }
  }
}

async function loadEstimate(tx: Tx, tenantId: string, id: string): Promise<JobEstimate> {
  const rows = await tx
    .select()
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), eq(schema.jobEstimates.id, id)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `estimate ${id} not found`);
  return rows[0];
}

async function linesOf(tx: Tx, tenantId: string, estimateId: string): Promise<JobEstimateLine[]> {
  return tx
    .select()
    .from(schema.jobEstimateLines)
    .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), eq(schema.jobEstimateLines.estimateId, estimateId)))
    .orderBy(asc(schema.jobEstimateLines.sortOrder), asc(schema.jobEstimateLines.createdAt));
}

/**
 * Whether a row already holds every value we are about to write (E3b, ADR 0082).
 *
 * **Derived from the keys of `values`, never a hand-written field list**, so a
 * column added to the write is compared without anybody remembering to add it
 * here — the alternative is a list that silently stops noticing a field, which
 * is how a save quietly starts dropping one. A non-primitive in `values` would
 * never compare equal and the row would simply be written, which is the safe
 * direction to fail in.
 */
function rowHolds(existing: Record<string, unknown>, values: Record<string, unknown>): boolean {
  return Object.entries(values).every(([key, value]) => existing[key] === value);
}

/** What a save actually touched, so autosave can say "Saved" without lying about it. */
export interface SaveCounts {
  inserted: number;
  updated: number;
  removed: number;
  unchanged: number;
}

const noCounts = (): SaveCounts => ({ inserted: 0, updated: 0, removed: 0, unchanged: 0 });

async function groupsOf(tx: Tx, tenantId: string, estimateId: string): Promise<JobEstimateGroup[]> {
  return tx
    .select()
    .from(schema.jobEstimateGroups)
    .where(and(eq(schema.jobEstimateGroups.tenantId, tenantId), eq(schema.jobEstimateGroups.estimateId, estimateId)))
    .orderBy(asc(schema.jobEstimateGroups.sortOrder), asc(schema.jobEstimateGroups.createdAt));
}

/**
 * Write an estimate's groups (ADR 0079): the ones given, in the order given —
 * updated by id, inserted when new. Returns what each was referred to by,
 * mapped to the id it now has, so the lines saved next can point at a group
 * created in the same breath. **Deleting is left to the caller**, after the
 * lines are written: a group removed while its lines still name it would take
 * their pricing with it, and the order below makes that impossible.
 */
async function saveGroups(
  tx: Tx,
  tenantId: string,
  estimateId: string,
  groups: EstimateGroupInput[],
): Promise<{ refs: Map<string, string>; keptIds: Set<string>; counts: SaveCounts }> {
  const existing = await groupsOf(tx, tenantId, estimateId);
  const byId = new Map(existing.map((e) => [e.id, e]));
  const refs = new Map<string, string>();
  const keptIds = new Set<string>();
  const counts = noCounts();
  for (const [i, g] of groups.entries()) {
    const mode = g.priceMode ?? "rollup";
    const values = {
      name: g.name.trim(),
      clientNote: g.clientNote?.trim() ?? "",
      section: g.section?.trim() ?? "",
      showLines: g.showLines ?? true,
      priceMode: mode,
      fixedPriceCents: mode === "fixed" ? (g.fixedPriceCents ?? null) : null,
      isAllowance: g.isAllowance === true,
      sortOrder: (i + 1) * 10,
    };
    if (g.id) {
      const row = byId.get(g.id);
      if (!row) {
        throw new JobsError("NOT_FOUND", `item ${g.id} is not on this estimate`);
      }
      if (rowHolds(row as unknown as Record<string, unknown>, values)) {
        counts.unchanged += 1;
      } else {
        await tx
          .update(schema.jobEstimateGroups)
          .set({ ...values, updatedAt: new Date() })
          .where(and(eq(schema.jobEstimateGroups.tenantId, tenantId), eq(schema.jobEstimateGroups.id, g.id)));
        counts.updated += 1;
      }
      refs.set(g.id, g.id);
      keptIds.add(g.id);
    } else {
      const rows = await tx
        .insert(schema.jobEstimateGroups)
        .values({ tenantId, estimateId, ...values })
        .returning({ id: schema.jobEstimateGroups.id });
      if (g.key) refs.set(g.key, rows[0].id);
      keptIds.add(rows[0].id);
      counts.inserted += 1;
    }
  }
  return { refs, keptIds, counts };
}

/** The groups no longer on the estimate. Their lines, if any survived, go loose (the FK's SET NULL). */
async function deleteGroupsGone(
  tx: Tx,
  tenantId: string,
  estimateId: string,
  kept: Set<string>,
): Promise<number> {
  const existing = await groupsOf(tx, tenantId, estimateId);
  const gone = existing.filter((e) => !kept.has(e.id)).map((e) => e.id);
  if (gone.length > 0) {
    await tx
      .delete(schema.jobEstimateGroups)
      .where(and(eq(schema.jobEstimateGroups.tenantId, tenantId), inArray(schema.jobEstimateGroups.id, gone)));
  }
  return gone.length;
}

/**
 * Write an estimate's lines: the ones given, in the order given — updated by
 * id, inserted when new, removed when left out. The schedule of values' rule,
 * so a line keeps its identity across an edit. Nothing points at an estimate
 * line, so nothing holds one.
 *
 * `groupRef` names the client-facing item the line sits in, by a group's id or
 * by the key a group created in this same save was given; a reference to
 * neither is refused rather than quietly dropped, because a line that lost its
 * item is a line the client would see at the wrong price.
 */
async function saveLines(
  tx: Tx,
  tenantId: string,
  estimateId: string,
  lines: EstimateLineInput[],
  groupRefs: Map<string, string> = new Map(),
): Promise<SaveCounts> {
  const existing = await linesOf(tx, tenantId, estimateId);
  const keep = new Set(lines.map((l) => l.id).filter((id): id is string => !!id));
  for (const id of keep) {
    if (!existing.some((e) => e.id === id)) {
      throw new JobsError("NOT_FOUND", `estimate line ${id} is not on this estimate`);
    }
  }
  const counts = noCounts();
  const removed = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (removed.length > 0) {
    await tx
      .delete(schema.jobEstimateLines)
      .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), inArray(schema.jobEstimateLines.id, removed)));
    counts.removed = removed.length;
  }
  const byId = new Map(existing.map((e) => [e.id, e]));
  for (const [i, l] of lines.entries()) {
    let groupId: string | null = null;
    if (l.groupRef) {
      groupId = groupRefs.get(l.groupRef) ?? null;
      if (groupId === null) {
        throw new JobsError("NOT_FOUND", `${l.description.trim()} names an item that is not on this estimate`);
      }
    }
    const values = {
      groupId,
      costCodeId: l.costCodeId ?? null,
      description: l.description.trim(),
      clientDescription: l.clientDescription?.trim() ?? "",
      clientVisible: l.clientVisible ?? true,
      unit: l.unit?.trim() ?? "",
      quantityThousandths: l.quantityThousandths ?? 1000,
      unitCostCents: l.unitCostCents ?? 0,
      markupPpm: l.markupPpm ?? null,
      unitPriceCents: l.unitPriceCents ?? null,
      notes: l.notes?.trim() ?? "",
      sortOrder: (i + 1) * 10,
      /**
       * Only when the caller SAID so. The editor posts no basis, and an
       * absent one must leave the row's alone — see `EstimateLineInput`.
       */
      ...(l.basis !== undefined ? { basis: l.basis } : {}),
      ...(l.basisDetail !== undefined ? { basisDetail: l.basisDetail.trim() } : {}),
    };
    if (l.id) {
      // A row that already holds all of this is left alone — autosave on a
      // two-hundred-line estimate must not rewrite two hundred rows a second.
      const row = byId.get(l.id);
      if (row && rowHolds(row as unknown as Record<string, unknown>, values)) {
        counts.unchanged += 1;
        continue;
      }
      await tx
        .update(schema.jobEstimateLines)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), eq(schema.jobEstimateLines.id, l.id)));
      counts.updated += 1;
    } else {
      await tx.insert(schema.jobEstimateLines).values({ tenantId, estimateId, ...values });
      counts.inserted += 1;
    }
  }
  return counts;
}

/**
 * Every unit this business has typed on an estimate line, so the entry bar's
 * grammar knows `bdl` is a unit the first time somebody uses it and nothing
 * has to be configured (E3, ADR 0081). Distinct, non-blank, and it is a HINT
 * to a parser rather than a validation of anything — the unit column stays
 * free text.
 */
export async function unitsInUse(tx: Tx, tenantId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ unit: schema.jobEstimateLines.unit })
    .from(schema.jobEstimateLines)
    .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), sql`btrim(${schema.jobEstimateLines.unit}) <> ''`));
  return rows.map((r) => r.unit.trim()).filter((u) => u !== "");
}

/** How many remembered prices travel to the editor with the page. */
export const PRICE_BOOK_LIMIT = 600;

/**
 * WHAT THIS BUSINESS CHARGED FOR EACH LINE LAST TIME (E4a) — every priced
 * estimate line across the tenant, newest first, one per description.
 *
 * Loaded with the page like `unitsInUse`, and for the same reason: the entry
 * bar and the paste preview have to answer as somebody types, and a server
 * round trip per keystroke is not an answer. `priceBookFrom` keeps the first
 * row for each key, so the ORDER here is what makes it "the last time".
 *
 * Bounded at `PRICE_BOOK_LIMIT` distinct descriptions. A business with more
 * than six hundred different lines in its history gets the six hundred most
 * recently priced, which are the ones it is still using; the alternative is
 * shipping a payload that grows forever to answer a question about the line
 * somebody is typing now.
 *
 * **Zero-cost lines are not memories.** A line priced at nothing is an
 * allowance carry, a by-others note or a line somebody had not got to yet —
 * offering it back as "what you charged last time" would be the feature
 * teaching itself a blank.
 */
export async function priceBookRows(
  tx: Tx,
  tenantId: string,
  limit: number = PRICE_BOOK_LIMIT,
): Promise<RememberedPrice[]> {
  const key = sql<string>`btrim(regexp_replace(lower(${schema.jobEstimateLines.description}), '[^a-z0-9]+', ' ', 'g'))`;
  const rows = await tx
    .selectDistinctOn([key], {
      key,
      description: schema.jobEstimateLines.description,
      unitCostCents: schema.jobEstimateLines.unitCostCents,
      unit: schema.jobEstimateLines.unit,
      projectNumber: schema.jobProjects.number,
      pricedOn: sql<string>`to_char(${schema.jobEstimateLines.createdAt}, 'YYYY-MM-DD')`,
      createdAt: schema.jobEstimateLines.createdAt,
    })
    .from(schema.jobEstimateLines)
    .innerJoin(
      schema.jobEstimates,
      and(
        eq(schema.jobEstimates.tenantId, schema.jobEstimateLines.tenantId),
        eq(schema.jobEstimates.id, schema.jobEstimateLines.estimateId),
      ),
    )
    .innerJoin(
      schema.jobProjects,
      and(
        eq(schema.jobProjects.tenantId, schema.jobEstimates.tenantId),
        eq(schema.jobProjects.id, schema.jobEstimates.projectId),
      ),
    )
    .where(
      and(
        eq(schema.jobEstimateLines.tenantId, tenantId),
        sql`${schema.jobEstimateLines.unitCostCents} > 0`,
        sql`${key} <> ''`,
      ),
    )
    // DISTINCT ON needs its own expression first; the newest of each follows.
    .orderBy(key, desc(schema.jobEstimateLines.createdAt))
    .limit(limit);

  // Newest first overall, so the editor's book and any "recent" reading agree.
  // `createdAt` is ordered on and then dropped: the book carries `pricedOn`,
  // which is the same instant as the tenant will read it.
  return rows
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((r) => ({
      key: r.key,
      description: r.description,
      unitCostCents: r.unitCostCents,
      unit: r.unit,
      projectNumber: r.projectNumber,
      pricedOn: r.pricedOn,
    }));
}

/** The terms of the newest estimate that has any: a business's terms are mostly boilerplate, so a new estimate starts with them. */
async function lastTerms(tx: Tx, tenantId: string): Promise<string> {
  const rows = await tx
    .select({ terms: schema.jobEstimates.terms })
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), sql`${schema.jobEstimates.terms} <> ''`))
    .orderBy(desc(schema.jobEstimates.createdAt))
    .limit(1);
  return rows[0]?.terms ?? "";
}

export async function createEstimate(tx: Tx, ctx: JobsCtx, input: EstimateInput): Promise<JobEstimate> {
  requireWrite(ctx, "member");
  validateEstimateShape(input);
  const project = await getProject(tx, ctx.tenantId, input.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${input.projectId} not found`);
  const terms = input.terms === undefined ? await lastTerms(tx, ctx.tenantId) : input.terms.trim();
  const rows = await tx
    .insert(schema.jobEstimates)
    .values({
      tenantId: ctx.tenantId,
      projectId: project.id,
      number: input.number.trim(),
      title: input.title?.trim() ?? "",
      status: input.status ?? "draft",
      sentOn: input.sentOn ?? null,
      decidedOn: input.decidedOn ?? null,
      validUntil: input.validUntil ?? null,
      markupPpm: input.markupPpm ?? 0,
      overheadPpm: input.overheadPpm ?? 0,
      profitPpm: input.profitPpm ?? 0,
      notes: input.notes?.trim() ?? "",
      presentation: input.presentation ?? "lines",
      showCodeNumbers: input.showCodeNumbers ?? false,
      format: input.format ?? "letter",
      letter: input.letter?.trim() ?? "",
      scope: input.scope?.trim() ?? "",
      exclusions: input.exclusions?.trim() ?? "",
      terms,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  if ((input.groups && input.groups.length > 0) || (input.lines && input.lines.length > 0)) {
    const { refs } = await saveGroups(tx, ctx.tenantId, rows[0].id, input.groups ?? []);
    await saveLines(tx, ctx.tenantId, rows[0].id, input.lines ?? [], refs);
  }
  return rows[0];
}

/**
 * Change an estimate: the header, the rates, and the lines when given. **An
 * accepted estimate is fixed** — its lines became a contract's value, a
 * budget or a schedule — so it refuses everything but the notes; revise by
 * making a new one and marking this one superseded.
 */
export interface UpdatedEstimate {
  row: JobEstimate;
  /**
   * THE IDS THE EDITOR IS OWED (ADR 0109). The editor posts a new line with no
   * id, and until it learns the one the server minted every autosave sends
   * the line again with none — `saveLines` deletes the row it made last time,
   * inserts another, and anything hanging off the old id (a measurement
   * standing behind the line) is cut loose by its SET NULL. In the payload's
   * order, which is the sort order, so the editor can adopt them by position.
   */
  lineIds: string[];
  /** A new item's key → the id it was given, for the same reason. */
  groupRefs: Record<string, string>;
}

export async function updateEstimate(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<Omit<EstimateInput, "projectId">> & { version?: number },
): Promise<JobEstimate> {
  return (await updateEstimateReturning(tx, ctx, id, input)).row;
}

/** `updateEstimate`, handing back the ids the save minted as well as the row. */
export async function updateEstimateReturning(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: Partial<Omit<EstimateInput, "projectId">> & { version?: number },
): Promise<UpdatedEstimate> {
  requireWrite(ctx, "member");
  validateEstimateShape(input);
  const existing = await loadEstimate(tx, ctx.tenantId, id);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "estimate changed since loaded");
  }
  const status = input.status ?? existing.status;
  /** Whether a child row was inserted, changed or removed, so an untouched save writes nothing. */
  let wrote = false;
  if (existing.status === "accepted") {
    // The money, and the proposal's words — they are the agreement. The presentation is a printing choice and stays free.
    const moneyMoves =
      input.lines !== undefined ||
      input.groups !== undefined ||
      (input.markupPpm !== undefined && input.markupPpm !== existing.markupPpm) ||
      (input.overheadPpm !== undefined && input.overheadPpm !== existing.overheadPpm) ||
      (input.profitPpm !== undefined && input.profitPpm !== existing.profitPpm) ||
      (input.letter !== undefined && input.letter.trim() !== existing.letter) ||
      (input.scope !== undefined && input.scope.trim() !== existing.scope) ||
      (input.exclusions !== undefined && input.exclusions.trim() !== existing.exclusions) ||
      (input.terms !== undefined && input.terms.trim() !== existing.terms);
    if (moneyMoves || (status !== "accepted" && status !== "superseded")) {
      throw new JobsError("ESTIMATE_ACCEPTED", `estimate ${existing.number} was accepted; revise it as a new one`);
    }
  }
  let lineIds: string[] = [];
  let groupRefs: Record<string, string> = {};
  if (input.groups !== undefined || input.lines !== undefined) {
    // Groups first so a line can name one made in the same save; the groups that
    // went last, so no line is ever orphaned mid-write.
    const saved =
      input.groups === undefined
        ? null
        : await saveGroups(tx, ctx.tenantId, id, input.groups);
    if (saved) groupRefs = Object.fromEntries(saved.refs);
    const refs =
      saved?.refs ?? new Map((await groupsOf(tx, ctx.tenantId, id)).map((g) => [g.id, g.id]));
    if (input.lines !== undefined) {
      const lineCounts = await saveLines(tx, ctx.tenantId, id, input.lines, refs);
      wrote = wrote || lineCounts.inserted + lineCounts.updated + lineCounts.removed > 0;
      // In sort order, which `saveLines` set from the payload's order.
      lineIds = (await linesOf(tx, ctx.tenantId, id)).map((l) => l.id);
    }
    if (saved) {
      wrote = wrote || saved.counts.inserted + saved.counts.updated > 0;
      wrote = (await deleteGroupsGone(tx, ctx.tenantId, id, saved.keptIds)) > 0 || wrote;
    }
  }
  const patch: Record<string, unknown> = { status };
  if (input.number !== undefined) patch.number = input.number.trim();
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.sentOn !== undefined) patch.sentOn = input.sentOn;
  if (input.decidedOn !== undefined) patch.decidedOn = input.decidedOn;
  if (input.validUntil !== undefined) patch.validUntil = input.validUntil;
  if (input.markupPpm !== undefined) patch.markupPpm = input.markupPpm;
  if (input.overheadPpm !== undefined) patch.overheadPpm = input.overheadPpm;
  if (input.profitPpm !== undefined) patch.profitPpm = input.profitPpm;
  if (input.notes !== undefined) patch.notes = input.notes.trim();
  if (input.presentation !== undefined) patch.presentation = input.presentation;
  // A printing choice, like the presentation: free even on an accepted estimate.
  if (input.showCodeNumbers !== undefined) patch.showCodeNumbers = input.showCodeNumbers;
  if (input.format !== undefined) patch.format = input.format;
  // The letter is the agreement's words, so it is fixed with the money above.
  if (input.letter !== undefined) patch.letter = input.letter.trim();
  if (input.scope !== undefined) patch.scope = input.scope.trim();
  if (input.exclusions !== undefined) patch.exclusions = input.exclusions.trim();
  if (input.terms !== undefined) patch.terms = input.terms.trim();
  /**
   * NOTHING CHANGED, NOTHING WRITTEN, AND THE VERSION DOES NOT MOVE (E3b, ADR
   * 0082). Autosave fires on a timer, so a save that would rewrite the row with
   * the values it already holds must be a SELECT and no more — otherwise the
   * version churns under an editor that has not been touched, and the next real
   * edit is refused as stale.
   */
  if (!wrote && rowHolds(existing as unknown as Record<string, unknown>, patch)) {
    return { row: existing, lineIds, groupRefs };
  }
  const rows = await tx
    .update(schema.jobEstimates)
    .set({ ...patch, updatedAt: new Date(), version: existing.version + 1 })
    .where(and(eq(schema.jobEstimates.tenantId, ctx.tenantId), eq(schema.jobEstimates.id, id)))
    .returning();
  return { row: rows[0], lineIds, groupRefs };
}

export interface EstimateLineRow extends JobEstimateLine {
  codeLabel: string | null;
  /** The same code without its number, for a proposal that does not print one (ADR 0080). */
  codeName: string | null;
  /** Quantity at the unit cost, rounded once. */
  costCents: number;
  /** Quantity at the explicit unit price, or the cost marked up by the line's rate or the estimate's. */
  priceCents: number;
}

/**
 * A client-facing item with its arithmetic (ADR 0079). The COST is always its
 * lines'; the PRICE is what the client is asked for it before overhead and
 * profit — the typed one on a fixed group, its lines' otherwise — so the
 * margin is the number that says whether a round price was a safe one.
 */
export interface EstimateGroupRow extends JobEstimateGroup {
  costCents: number;
  priceCents: number;
  marginCents: number;
  marginPpm: number | null;
  lineCount: number;
  /** Whether the price was typed, and so sits outside the overhead-and-profit spread. */
  fixed: boolean;
}

export interface EstimateCodeRow {
  costCodeId: string | null;
  codeLabel: string | null;
  costCents: number;
  priceCents: number;
}

export interface EstimateRow {
  estimate: JobEstimate;
  /** The client-facing items, in their order; empty on an estimate of loose lines. */
  groups: EstimateGroupRow[];
  lines: EstimateLineRow[];
  totals: EstimateTotals;
  /** Cost and price by cost code, the no-code line last. */
  byCode: EstimateCodeRow[];
  contract: { id: string; kind: string; name: string; status: string } | null;
}

/** Every estimate on a job, newest first, each with its lines and its arithmetic. */
export async function listEstimates(tx: Tx, tenantId: string, projectId: string): Promise<EstimateRow[]> {
  const estimates = await tx
    .select()
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), eq(schema.jobEstimates.projectId, projectId)))
    .orderBy(desc(schema.jobEstimates.createdAt));
  if (estimates.length === 0) return [];
  const ids = estimates.map((e) => e.id);
  const contractIds = [...new Set(estimates.map((e) => e.contractId).filter((x): x is string => !!x))];
  const [lines, groups, codes, contracts] = await Promise.all([
    tx
      .select()
      .from(schema.jobEstimateLines)
      .where(and(eq(schema.jobEstimateLines.tenantId, tenantId), inArray(schema.jobEstimateLines.estimateId, ids)))
      .orderBy(asc(schema.jobEstimateLines.sortOrder), asc(schema.jobEstimateLines.createdAt)),
    tx
      .select()
      .from(schema.jobEstimateGroups)
      .where(and(eq(schema.jobEstimateGroups.tenantId, tenantId), inArray(schema.jobEstimateGroups.estimateId, ids)))
      .orderBy(asc(schema.jobEstimateGroups.sortOrder), asc(schema.jobEstimateGroups.createdAt)),
    tx
      .select({ id: schema.jobCostCodes.id, code: schema.jobCostCodes.code, name: schema.jobCostCodes.name })
      .from(schema.jobCostCodes)
      .where(eq(schema.jobCostCodes.tenantId, tenantId)),
    contractIds.length === 0
      ? Promise.resolve([])
      : tx
          .select({
            id: schema.jobContracts.id,
            kind: schema.jobContracts.kind,
            name: schema.jobContracts.name,
            status: schema.jobContracts.status,
          })
          .from(schema.jobContracts)
          .where(and(eq(schema.jobContracts.tenantId, tenantId), inArray(schema.jobContracts.id, contractIds))),
  ]);
  const codeLabel = new Map(codes.map((c) => [c.id, `${c.code} · ${c.name}`]));
  const codeName = new Map(codes.map((c) => [c.id, c.name]));
  const contractById = new Map(contracts.map((c) => [c.id, c]));
  return estimates.map((estimate) => {
    const own = lines.filter((l) => l.estimateId === estimate.id);
    const ownGroups = groups.filter((g) => g.estimateId === estimate.id);
    const groupRows: EstimateGroupRow[] = ownGroups.map((g) => {
      const children = own.filter((l) => l.groupId === g.id);
      const costCents = groupCostCents(children);
      const priceCents = groupPriceCents(g, children, estimate.markupPpm);
      const marginCents = priceCents - costCents;
      return {
        ...g,
        costCents,
        priceCents,
        marginCents,
        marginPpm: priceCents > 0 ? Math.round((marginCents / priceCents) * 1_000_000) : null,
        lineCount: children.length,
        fixed: isFixedPrice(g),
      };
    });
    const rows: EstimateLineRow[] = own.map((l) => ({
      ...l,
      codeLabel: l.costCodeId ? (codeLabel.get(l.costCodeId) ?? null) : null,
      codeName: l.costCodeId ? (codeName.get(l.costCodeId) ?? null) : null,
      costCents: lineCostCents(l),
      priceCents: linePriceCents(l, estimate.markupPpm),
    }));
    const byCode: EstimateCodeRow[] = [...estimateByCode(own, estimate.markupPpm, ownGroups).entries()]
      .map(([costCodeId, figures]) => ({
        costCodeId,
        codeLabel: costCodeId ? (codeLabel.get(costCodeId) ?? null) : null,
        ...figures,
      }))
      .sort((a, b) => (a.costCodeId === null ? 1 : b.costCodeId === null ? -1 : (a.codeLabel ?? "").localeCompare(b.codeLabel ?? "")));
    return {
      estimate,
      groups: groupRows,
      lines: rows,
      totals: estimateTotals(own, estimate, ownGroups),
      byCode,
      contract: estimate.contractId ? (contractById.get(estimate.contractId) ?? null) : null,
    };
  });
}

/** One estimate with its arithmetic, or null. */
export async function getEstimate(tx: Tx, tenantId: string, id: string): Promise<EstimateRow | null> {
  const rows = await tx
    .select({ projectId: schema.jobEstimates.projectId })
    .from(schema.jobEstimates)
    .where(and(eq(schema.jobEstimates.tenantId, tenantId), eq(schema.jobEstimates.id, id)))
    .limit(1);
  if (rows.length === 0) return null;
  return (await listEstimates(tx, tenantId, rows[0].projectId)).find((r) => r.estimate.id === id) ?? null;
}

export interface ProposalData {
  row: EstimateRow;
  project: NonNullable<Awaited<ReturnType<typeof getProject>>>;
  /** The client the proposal is made to, and the only postal address the product keeps for them, Accounting's. */
  toName: string;
  toAddress: string;
}

/**
 * What the proposal prints (ADR 0070): the estimate with its arithmetic,
 * the job, and the client — the contract's counterparty when the estimate
 * names a contract, else the job's client party; a party never billed
 * prints as a name alone, the certificate's rule.
 */
export async function proposalData(tx: Tx, tenantId: string, id: string): Promise<ProposalData | null> {
  const row = await getEstimate(tx, tenantId, id);
  if (!row) return null;
  const project = await getProject(tx, tenantId, row.estimate.projectId);
  if (!project) return null;
  let partyId: string | null = project.partyId ?? null;
  if (row.estimate.contractId) {
    const contract = await tx
      .select({ counterpartyPartyId: schema.jobContracts.counterpartyPartyId })
      .from(schema.jobContracts)
      .where(and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, row.estimate.contractId)))
      .limit(1);
    partyId = contract[0]?.counterpartyPartyId ?? partyId;
  }
  let toName = "";
  let toAddress = "";
  if (partyId) {
    const party = await tx
      .select({ name: schema.parties.displayName })
      .from(schema.parties)
      .where(and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, partyId)))
      .limit(1);
    toName = party[0]?.name ?? "";
    toAddress = (await customerForParty(tx, tenantId, partyId))?.address ?? "";
  }
  return { row, project, toName, toAddress };
}

/** The contract an estimate is applied to has to be this job's. */
async function assertContractOnProject(tx: Tx, tenantId: string, contractId: string, projectId: string) {
  const rows = await tx
    .select({ projectId: schema.jobContracts.projectId })
    .from(schema.jobContracts)
    .where(and(eq(schema.jobContracts.tenantId, tenantId), eq(schema.jobContracts.id, contractId)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `contract ${contractId} not found`);
  if (rows[0].projectId !== projectId) throw new JobsError("WRONG_PROJECT", "the contract named is on another job");
}

/**
 * ACCEPT an estimate onto a contract: the status, the date, the link, and
 * the contract's value set to the estimate's total — through `updateContract`,
 * which refuses a signed value (`VALUE_LOCKED`) as it refuses it from a form.
 * Any other estimate on the job still `sent` is left as it is: two bids may
 * both be out, and only the business knows which the other one was for.
 */

/* ------------------------------------------------------------------------
 * AN ALLOWANCE ITEM BECOMES A SELECTION (X12).
 *
 * The founder: *"we ususaly have some items listed as an allowance. things
 * like plumbing fixtures etc."*
 *
 * The machinery for an allowance has been in the pack since slice 8 —
 * `job_selections` holds what the contract set aside, what the client chose,
 * and raises the difference as a change order ([ADR 0067](../../../docs/decisions/0067-a-selection-is-a-decision-the-client-owes-and-an-allowance-is-the-money-the-contract-holds-for-it.md)).
 * What was missing was the sentence at the FRONT of it: an estimate could not
 * say an item was an allowance, so every one had to be typed into Selections
 * again by hand after the client signed.
 *
 * ── THE FIGURE IS THE PRICE, BECAUSE HE SAID SO ─────────────────────────────
 *
 * *"the allowance is a cost we mark up like everything else."* So what the
 * client is held to is the item's own scheduled figure — its lines marked up
 * with their share of overhead and profit, the same number printed on the
 * proposal they signed. Taking the COST instead would understate every
 * allowance by the margin and make the change order compare a price against
 * a cost, which is a comparison that means nothing on a signed contract.
 *
 * ── AND IT HAPPENS ONCE ─────────────────────────────────────────────────────
 *
 * `acceptEstimate` already refuses a second acceptance, and this skips any
 * item that already has a selection pointing AT IT — by id, never by name,
 * because a builder renames an allowance and two jobs both have *Plumbing
 * fixtures*.
 * ---------------------------------------------------------------------- */

async function allowancesBecomeSelections(
  tx: Tx,
  ctx: JobsCtx,
  estimate: JobEstimate,
  lines: readonly JobEstimateLine[],
  groups: readonly JobEstimateGroup[],
  contractId: string,
): Promise<number> {
  const allowances = groups.filter((g) => g.isAllowance);
  if (allowances.length === 0) return 0;

  /** What the client reads against each item — the figure on the proposal. */
  const rows = scheduleRows(
    lines.map((l) => ({
      ...l,
      description: l.description,
      clientDescription: l.clientDescription,
      unit: l.unit,
      costCodeId: l.costCodeId,
    })),
    estimate,
    groups,
    "group",
  );
  const byGroup = new Map(rows.filter((r) => r.groupId).map((r) => [r.groupId as string, r]));

  const already = await tx
    .select({ estimateGroupId: schema.jobSelections.estimateGroupId })
    .from(schema.jobSelections)
    .where(
      and(
        eq(schema.jobSelections.tenantId, ctx.tenantId),
        inArray(
          schema.jobSelections.estimateGroupId,
          allowances.map((g) => g.id),
        ),
      ),
    );
  const done = new Set(already.map((r) => r.estimateGroupId));

  let made = 0;
  for (const group of allowances) {
    if (done.has(group.id)) continue;
    const row = byGroup.get(group.id);
    await createSelection(tx, ctx, {
      projectId: estimate.projectId,
      contractId,
      estimateGroupId: group.id,
      /** The item's own code when its lines agree on one; none when they do not. */
      costCodeId: row?.costCodeId ?? null,
      name: group.name,
      description: group.clientNote,
      allowanceCents: row?.scheduledCents ?? 0,
      notes: `From ${estimate.number}.`,
    });
    made += 1;
  }
  return made;
}

export async function acceptEstimate(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: { contractId: string; decidedOn: string; version?: number },
): Promise<JobEstimate> {
  requireWrite(ctx, "owner");
  const existing = await loadEstimate(tx, ctx.tenantId, id);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "estimate changed since loaded");
  }
  if (existing.status === "accepted") {
    throw new JobsError("ESTIMATE_ACCEPTED", `estimate ${existing.number} was already accepted`);
  }
  await assertContractOnProject(tx, ctx.tenantId, input.contractId, existing.projectId);
  const lines = await linesOf(tx, ctx.tenantId, id);
  const groups = await groupsOf(tx, ctx.tenantId, id);
  const totals = estimateTotals(lines, existing, groups);
  const contract = await tx
    .select({ valueCents: schema.jobContracts.valueCents })
    .from(schema.jobContracts)
    .where(and(eq(schema.jobContracts.tenantId, ctx.tenantId), eq(schema.jobContracts.id, input.contractId)))
    .limit(1);
  if (contract[0].valueCents !== totals.totalCents) {
    await updateContract(tx, ctx, input.contractId, { valueCents: totals.totalCents });
  }
  const rows = await tx
    .update(schema.jobEstimates)
    .set({
      status: "accepted",
      contractId: input.contractId,
      decidedOn: input.decidedOn,
      updatedAt: new Date(),
      version: existing.version + 1,
    })
    .where(and(eq(schema.jobEstimates.tenantId, ctx.tenantId), eq(schema.jobEstimates.id, id)))
    .returning();
  /**
   * **EVERY ALLOWANCE THE CLIENT JUST AGREED TO IS NOW A DECISION THEY OWE.**
   * Last, so a failure here cannot leave an estimate half accepted — it is one
   * transaction either way, and this is the order that reads correctly.
   */
  await allowancesBecomeSelections(tx, ctx, rows[0], lines, groups, input.contractId);
  return rows[0];
}

/**
 * MAKE THE ESTIMATE THE BUDGET: its cost by code, written as each code's
 * original through `setBudgetLines` (slice 3's rule: one line per code, the
 * original kept). Cost on lines with no code has nowhere to land and is
 * returned so the page can say so; nothing is written for it.
 */
export async function applyEstimateToBudget(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
): Promise<{ codes: number; budgetCents: number; uncodedCents: number }> {
  requireWrite(ctx, "owner");
  const estimate = await loadEstimate(tx, ctx.tenantId, id);
  const byCode = estimateByCode(
    await linesOf(tx, ctx.tenantId, id),
    estimate.markupPpm,
    await groupsOf(tx, ctx.tenantId, id),
  );
  const lines = [...byCode.entries()]
    .filter((entry): entry is [string, { costCents: number; priceCents: number }] => entry[0] !== null)
    .map(([costCodeId, figures]) => ({ costCodeId, originalCents: figures.costCents }));
  if (lines.length > 0) await setBudgetLines(tx, ctx, estimate.projectId, lines);
  return {
    codes: lines.length,
    budgetCents: lines.reduce((sum, l) => sum + l.originalCents, 0),
    uncodedCents: byCode.get(null)?.costCents ?? 0,
  };
}

/**
 * MAKE THE ESTIMATE THE SCHEDULE OF VALUES on a contract, at its PRICE with
 * overhead and profit spread in proportion (`scheduleRows`), so the schedule
 * totals the estimate's total — the contract sum an accepted estimate set,
 * which is what a G703 requires and what every application is measured
 * against. The schedule is replaced, through `saveSovLines`, which refuses to
 * remove a line an application has billed against.
 *
 * **BY GROUP when the estimate has any** (ADR 0079), which is the shape a
 * client can read: one line per client-facing item and per loose line, so the
 * schedule an owner certifies against matches the proposal they signed rather
 * than the takeoff behind it. BY LINE is the other shape and the only one an
 * ungrouped estimate has; asked for by name, it stays available, and a line
 * sold at an explicit unit price keeps its unit and quantity with the unit
 * price raised by the same share, so a unit-price contract bills by the
 * quantity (ADR 0064).
 */
export async function applyEstimateToSchedule(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  contractId: string,
  shape?: string,
): Promise<{ lines: number; scheduledCents: number; shape: ScheduleShape }> {
  requireWrite(ctx, "owner");
  const estimate = await loadEstimate(tx, ctx.tenantId, id);
  await assertContractOnProject(tx, ctx.tenantId, contractId, estimate.projectId);
  if (shape !== undefined && !isScheduleShape(shape)) {
    throw new JobsError("INVALID_VALUE", "a schedule is written by item or line by line");
  }
  const lines = await linesOf(tx, ctx.tenantId, id);
  const groups = await groupsOf(tx, ctx.tenantId, id);
  // No groups, no choice: by line is the only shape an ungrouped estimate has.
  const chosen: ScheduleShape = groups.length === 0 ? "line" : ((shape as ScheduleShape) ?? "group");
  const rows = scheduleRows(lines, estimate, groups, chosen);
  const saved = await saveSovLines(
    tx,
    ctx,
    contractId,
    rows.map((r) => ({
      description: r.description,
      scheduledCents: r.scheduledCents,
      costCodeId: r.costCodeId,
      unit: r.unit,
      quantityThousandths: r.quantityThousandths,
      unitPriceCents: r.unitPriceCents,
    })),
  );
  return {
    lines: saved.length,
    scheduledCents: saved.reduce((sum, l) => sum + l.scheduledCents, 0),
    shape: chosen,
  };
}
