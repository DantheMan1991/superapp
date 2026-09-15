import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobPhase } from "@/db/schema";
import { ensureExtensionCalendar, findExtensionCalendarId } from "@/lib/schedule/managed-calendars";
import { addDays, dateInTimezone, isDateString, startOfDayInTimezone } from "@/lib/timezone";
import { cancelItem, createItem, updateItem } from "@/modules/scheduling/item-ops";
import { attachLink } from "@/modules/scheduling/link-ops";
import { JobsError, getProject, requireWrite, type JobsCtx } from "./ops";
import {
  cascade,
  durationDays,
  earliestStart,
  summarise,
  wouldCycle,
  type PhaseDates,
  type PhaseMove,
  type ScheduleSummary,
} from "./schedule-math";
import { JOB_CALENDAR, PACK, PHASE_ITEM_KIND, PROJECT_ENTITY, isPhaseKind, isPhaseStatus } from "./vocabulary";

/**
 * A JOB'S SCHEDULE (slice 12 of the construction plan as it turned out to be
 * needed, ADR 0071): its phases and milestones, each an all-day item on the
 * business's *Job schedule* calendar — so the company calendar, the week
 * view and the phone feed show every job's phases with no work of their own
 * — and a row of the pack's beside it holding what a calendar does not
 * know: the order, the predecessor and its lag, the trade doing it, the cost
 * code, and whether it is planned, underway or done.
 *
 * **CORE OWNS THE DATES.** A phase's first and last day live on its calendar
 * item and nowhere else; the pack reads them back through the tenant's time
 * zone and writes them through the scheduling module's own verbs, which
 * check the calendar is writable the way they check it for anybody.
 *
 * **A MOVE PUSHES WHAT FOLLOWS.** Finish-to-start with a lag in days; moving
 * a phase later pushes its successors until each starts no earlier than its
 * predecessor allows, every phase keeping its length. Nothing is pulled
 * earlier. A phase may not be placed before its predecessor allows, and a
 * predecessor may not be its own descendant.
 */

export interface PhaseInput {
  projectId: string;
  name: string;
  /** "phase" (a span) or "milestone" (a single day). */
  kind?: string;
  /** YYYY-MM-DD, the first day. */
  startOn: string;
  /** YYYY-MM-DD, the last day, inclusive; blank or null means the first. A milestone's is always its first. */
  endOn?: string | null;
  predecessorId?: string | null;
  lagDays?: number;
  /** The trade or crew doing it, a party. */
  partyId?: string | null;
  costCodeId?: string | null;
  status?: string;
  notes?: string;
  sortOrder?: number;
}

const LAG_LIMIT_DAYS = 365;

function schedulingCtx(ctx: JobsCtx): { tenantId: string; userId: string; role: "owner" | "staff" | "expert" } {
  return { tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role === "owner" || ctx.role === "expert" ? ctx.role : "staff" };
}

function itemTitle(projectNumber: string, name: string): string {
  return `${projectNumber} · ${name}`;
}

function validateShape(input: Partial<PhaseInput>): void {
  if (input.name !== undefined && input.name.trim() === "") {
    throw new JobsError("INVALID_VALUE", "a phase needs a name");
  }
  if (input.kind !== undefined && !isPhaseKind(input.kind)) {
    throw new JobsError("INVALID_VALUE", "a phase is a phase or a milestone");
  }
  if (input.status !== undefined && !isPhaseStatus(input.status)) {
    throw new JobsError("INVALID_STATUS", `invalid status: ${input.status}`);
  }
  if (input.startOn !== undefined && !isDateString(input.startOn)) {
    throw new JobsError("INVALID_VALUE", "a phase needs the day it starts");
  }
  if (input.endOn !== undefined && input.endOn !== null && !isDateString(input.endOn)) {
    throw new JobsError("INVALID_VALUE", "a phase's last day is a date");
  }
  if (input.lagDays !== undefined && (!Number.isInteger(input.lagDays) || Math.abs(input.lagDays) > LAG_LIMIT_DAYS)) {
    throw new JobsError("INVALID_VALUE", "a lag is a whole number of days within a year");
  }
}

/**
 * The *Job schedule* calendar, made once per business and shared with
 * everyone at write. A business-owned calendar is something the scheduling
 * module lets only an OWNER make (its write policy), so the first phase — or
 * the first owner to open a schedule — makes it, and a staff member before
 * that is told to ask, rather than shown a policy refusal.
 */
export async function ensureJobCalendar(tx: Tx, ctx: JobsCtx): Promise<string> {
  const existing = await findExtensionCalendarId(tx, ctx.tenantId, JOB_CALENDAR.extensionSlug, JOB_CALENDAR.extensionKey);
  if (existing) return existing;
  if (ctx.role !== "owner") {
    throw new JobsError("SCHEDULE_NOT_MADE", "the Job schedule calendar is made by an owner");
  }
  return ensureExtensionCalendar(tx, ctx.tenantId, JOB_CALENDAR);
}

async function loadPhase(tx: Tx, tenantId: string, id: string): Promise<JobPhase> {
  const rows = await tx
    .select()
    .from(schema.jobPhases)
    .where(and(eq(schema.jobPhases.tenantId, tenantId), eq(schema.jobPhases.id, id)))
    .limit(1);
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `phase ${id} not found`);
  return rows[0];
}

/** Every phase of a job with its dates, the shape the arithmetic reads. */
async function phaseDatesOf(tx: Tx, tenantId: string, projectId: string, timeZone: string): Promise<Array<PhaseDates & { name: string }>> {
  const rows = await tx
    .select({
      id: schema.jobPhases.id,
      name: schema.jobPhases.name,
      predecessorId: schema.jobPhases.predecessorId,
      lagDays: schema.jobPhases.lagDays,
      startsAt: schema.scheduleItems.startsAt,
      endsAt: schema.scheduleItems.endsAt,
    })
    .from(schema.jobPhases)
    .innerJoin(schema.scheduleItems, eq(schema.scheduleItems.id, schema.jobPhases.itemId))
    .where(and(eq(schema.jobPhases.tenantId, tenantId), eq(schema.jobPhases.projectId, projectId)));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    predecessorId: r.predecessorId,
    lagDays: r.lagDays,
    startOn: dateInTimezone(r.startsAt, timeZone),
    endOn: addDays(dateInTimezone(r.endsAt, timeZone), -1),
  }));
}

function assertAfterPredecessor(
  name: string,
  startOn: string,
  predecessor: { name: string; endOn: string } | null,
  lagDays: number,
): void {
  if (!predecessor) return;
  const earliest = earliestStart(predecessor.endOn, lagDays);
  if (startOn < earliest) {
    throw new JobsError(
      "INVALID_VALUE",
      `${name} cannot start before ${earliest}: ${predecessor.name} runs to ${predecessor.endOn}${lagDays !== 0 ? ` and the lag is ${lagDays} days` : ""}`,
    );
  }
}

async function writeItemDates(
  tx: Tx,
  ctx: JobsCtx,
  itemId: string,
  startOn: string,
  endOn: string,
  timeZone: string,
  extra: { title?: string; description?: string } = {},
): Promise<void> {
  await updateItem(tx, schedulingCtx(ctx), itemId, {
    ...extra,
    startsAt: startOfDayInTimezone(startOn, timeZone),
    endsAt: startOfDayInTimezone(addDays(endOn, 1), timeZone),
    allDay: true,
    timeZone,
  });
}

export async function createPhase(tx: Tx, ctx: JobsCtx, input: PhaseInput, timeZone: string): Promise<JobPhase> {
  requireWrite(ctx, "member");
  validateShape(input);
  const project = await getProject(tx, ctx.tenantId, input.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${input.projectId} not found`);
  const kind = input.kind ?? "phase";
  const name = input.name.trim();
  const startOn = input.startOn;
  const endOn = kind === "milestone" ? startOn : (input.endOn ?? startOn);
  if (endOn < startOn) throw new JobsError("INVALID_VALUE", "a phase cannot end before it starts");
  const lagDays = input.lagDays ?? 0;
  const siblings = await phaseDatesOf(tx, ctx.tenantId, project.id, timeZone);
  const predecessor = input.predecessorId ? (siblings.find((p) => p.id === input.predecessorId) ?? null) : null;
  if (input.predecessorId && !predecessor) {
    throw new JobsError("WRONG_PROJECT", "the phase named as predecessor is on another job");
  }
  assertAfterPredecessor(name, startOn, predecessor, lagDays);

  const calendarId = await ensureJobCalendar(tx, ctx);
  const sctx = schedulingCtx(ctx);
  const itemId = await createItem(tx, sctx, {
    calendarId,
    title: itemTitle(project.number, name),
    description: input.notes?.trim() ?? "",
    startsAt: startOfDayInTimezone(startOn, timeZone),
    endsAt: startOfDayInTimezone(addDays(endOn, 1), timeZone),
    allDay: true,
    timeZone,
    showAs: "free",
    kind: PHASE_ITEM_KIND,
  });
  await attachLink(tx, sctx, { itemId, extensionSlug: PACK, entityType: PROJECT_ENTITY, entityId: project.id });
  const rows = await tx
    .insert(schema.jobPhases)
    .values({
      tenantId: ctx.tenantId,
      projectId: project.id,
      itemId,
      name,
      kind,
      status: input.status ?? "planned",
      predecessorId: input.predecessorId ?? null,
      lagDays,
      partyId: input.partyId ?? null,
      costCodeId: input.costCodeId ?? null,
      notes: input.notes?.trim() ?? "",
      sortOrder: input.sortOrder ?? (siblings.length + 1) * 10,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return rows[0];
}

export interface PhaseUpdate extends Partial<Omit<PhaseInput, "projectId">> {
  version?: number;
}

/**
 * Change a phase, then push whatever follows it. Returns the phase and the
 * successors that moved, so the page can say so.
 */
export async function updatePhase(
  tx: Tx,
  ctx: JobsCtx,
  id: string,
  input: PhaseUpdate,
  timeZone: string,
): Promise<{ phase: JobPhase; moved: PhaseMove[] }> {
  requireWrite(ctx, "member");
  validateShape(input);
  const existing = await loadPhase(tx, ctx.tenantId, id);
  if (input.version !== undefined && input.version !== existing.version) {
    throw new JobsError("STALE_VERSION", "phase changed since loaded");
  }
  const project = await getProject(tx, ctx.tenantId, existing.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${existing.projectId} not found`);
  const siblings = await phaseDatesOf(tx, ctx.tenantId, project.id, timeZone);
  const mine = siblings.find((p) => p.id === id);
  if (!mine) throw new JobsError("NOT_FOUND", `phase ${id} has no calendar item`);

  const name = input.name?.trim() ?? existing.name;
  const kind = input.kind ?? existing.kind;
  const startOn = input.startOn ?? mine.startOn;
  const endGiven = input.endOn ?? undefined;
  // A new start with no new end keeps the phase's length; a milestone is its start.
  const endOn =
    kind === "milestone"
      ? startOn
      : (endGiven ?? (input.startOn ? addDays(startOn, durationDays(mine.startOn, mine.endOn) - 1) : mine.endOn));
  if (endOn < startOn) throw new JobsError("INVALID_VALUE", "a phase cannot end before it starts");
  const predecessorId = input.predecessorId === undefined ? existing.predecessorId : input.predecessorId;
  const lagDays = input.lagDays ?? existing.lagDays;
  if (predecessorId === id) throw new JobsError("PHASE_CYCLE", `${name} cannot follow itself`);
  if (predecessorId !== null && !siblings.some((p) => p.id === predecessorId)) {
    throw new JobsError("WRONG_PROJECT", "the phase named as predecessor is on another job");
  }
  if (predecessorId !== null && wouldCycle(siblings, id, predecessorId)) {
    throw new JobsError("PHASE_CYCLE", `${name} already comes before that phase; the schedule would loop`);
  }
  const predecessor = predecessorId ? (siblings.find((p) => p.id === predecessorId) ?? null) : null;
  assertAfterPredecessor(name, startOn, predecessor, lagDays);

  const datesMoved = startOn !== mine.startOn || endOn !== mine.endOn;
  const notes = input.notes?.trim() ?? existing.notes;
  if (datesMoved || name !== existing.name || notes !== existing.notes) {
    await writeItemDates(tx, ctx, existing.itemId, startOn, endOn, timeZone, {
      title: itemTitle(project.number, name),
      description: notes,
    });
  }
  const rows = await tx
    .update(schema.jobPhases)
    .set({
      name,
      kind,
      status: input.status ?? existing.status,
      predecessorId,
      lagDays,
      partyId: input.partyId === undefined ? existing.partyId : input.partyId,
      costCodeId: input.costCodeId === undefined ? existing.costCodeId : input.costCodeId,
      notes,
      sortOrder: input.sortOrder ?? existing.sortOrder,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.jobPhases.tenantId, ctx.tenantId), eq(schema.jobPhases.id, id)))
    .returning();

  // The push: every successor keeps its length and starts no earlier than it may.
  const after: PhaseDates[] = siblings.map((p) => (p.id === id ? { ...p, startOn, endOn, predecessorId, lagDays } : p));
  const moved = datesMoved || predecessorId !== existing.predecessorId || lagDays !== existing.lagDays ? cascade(after, [id]) : [];
  if (moved.length > 0) {
    const items = await tx
      .select({ id: schema.jobPhases.id, itemId: schema.jobPhases.itemId })
      .from(schema.jobPhases)
      .where(and(eq(schema.jobPhases.tenantId, ctx.tenantId), inArray(schema.jobPhases.id, moved.map((m) => m.id))));
    for (const m of moved) {
      const row = items.find((i) => i.id === m.id);
      if (row) await writeItemDates(tx, ctx, row.itemId, m.startOn, m.endOn, timeZone);
    }
  }
  return { phase: rows[0], moved };
}

/** Remove a phase: its successors follow what it followed, and its calendar item is cancelled. */
export async function deletePhase(tx: Tx, ctx: JobsCtx, id: string): Promise<void> {
  requireWrite(ctx, "member");
  const existing = await loadPhase(tx, ctx.tenantId, id);
  await tx
    .update(schema.jobPhases)
    .set({ predecessorId: existing.predecessorId, updatedAt: new Date() })
    .where(and(eq(schema.jobPhases.tenantId, ctx.tenantId), eq(schema.jobPhases.predecessorId, id)));
  await tx.delete(schema.jobPhases).where(and(eq(schema.jobPhases.tenantId, ctx.tenantId), eq(schema.jobPhases.id, id)));
  await cancelItem(tx, schedulingCtx(ctx), existing.itemId);
}

export interface PhaseRow {
  phase: JobPhase;
  startOn: string;
  endOn: string;
  durationDays: number;
  predecessor: { id: string; name: string; endOn: string } | null;
  /** The first day this phase may start, given its predecessor and lag; null without one. */
  earliestStart: string | null;
  partyName: string | null;
  codeLabel: string | null;
  /** Planned or underway and past its last day. */
  overdue: boolean;
  /** Still planned though its first day has passed. */
  lateToStart: boolean;
}

/** A job's phases, soonest first, each with its dates, its people and its standing as of `today`. */
export async function listPhases(tx: Tx, tenantId: string, projectId: string, timeZone: string, today: string): Promise<PhaseRow[]> {
  const rows = await tx
    .select({
      phase: schema.jobPhases,
      startsAt: schema.scheduleItems.startsAt,
      endsAt: schema.scheduleItems.endsAt,
      cancelledAt: schema.scheduleItems.cancelledAt,
      partyName: schema.parties.displayName,
      code: schema.jobCostCodes.code,
      codeName: schema.jobCostCodes.name,
    })
    .from(schema.jobPhases)
    .innerJoin(schema.scheduleItems, eq(schema.scheduleItems.id, schema.jobPhases.itemId))
    .leftJoin(schema.parties, eq(schema.parties.id, schema.jobPhases.partyId))
    .leftJoin(schema.jobCostCodes, eq(schema.jobCostCodes.id, schema.jobPhases.costCodeId))
    .where(and(eq(schema.jobPhases.tenantId, tenantId), eq(schema.jobPhases.projectId, projectId), isNull(schema.scheduleItems.cancelledAt)))
    .orderBy(asc(schema.scheduleItems.startsAt), asc(schema.jobPhases.sortOrder), asc(schema.jobPhases.name));
  const dated = rows.map((r) => ({
    ...r,
    startOn: dateInTimezone(r.startsAt, timeZone),
    endOn: addDays(dateInTimezone(r.endsAt, timeZone), -1),
  }));
  const byId = new Map(dated.map((r) => [r.phase.id, r]));
  return dated.map((r) => {
    const pred = r.phase.predecessorId ? byId.get(r.phase.predecessorId) : undefined;
    return {
      phase: r.phase,
      startOn: r.startOn,
      endOn: r.endOn,
      durationDays: durationDays(r.startOn, r.endOn),
      predecessor: pred ? { id: pred.phase.id, name: pred.phase.name, endOn: pred.endOn } : null,
      earliestStart: pred ? earliestStart(pred.endOn, r.phase.lagDays) : null,
      partyName: r.partyName ?? null,
      codeLabel: r.code ? `${r.code} · ${r.codeName}` : null,
      overdue: r.phase.status !== "done" && r.endOn < today,
      lateToStart: r.phase.status === "planned" && r.startOn < today,
    };
  });
}

export function scheduleSummary(rows: readonly PhaseRow[], today: string): ScheduleSummary {
  return summarise(
    rows.map((r) => ({ startOn: r.startOn, endOn: r.endOn, status: r.phase.status, kind: r.phase.kind })),
    today,
  );
}

/** One phase with its dates, or null. */
export async function getPhase(tx: Tx, tenantId: string, id: string, timeZone: string, today: string): Promise<PhaseRow | null> {
  const rows = await tx
    .select({ projectId: schema.jobPhases.projectId })
    .from(schema.jobPhases)
    .where(and(eq(schema.jobPhases.tenantId, tenantId), eq(schema.jobPhases.id, id)))
    .limit(1);
  if (rows.length === 0) return null;
  return (await listPhases(tx, tenantId, rows[0].projectId, timeZone, today)).find((r) => r.phase.id === id) ?? null;
}
