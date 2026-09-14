import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { JobDailyLog, JobDailyLogCrew } from "@/db/schema";
import { attachmentCounts, detachAllForEntity } from "@/modules/documents/attachments";
import {
  createWorkForEntity,
  listWorkForEntity,
  setWorkComplete,
  type EntityWorkRow,
} from "@/lib/work/entity-work";
import { JobsError, getProject, requireWrite, type JobsCtx } from "./ops";
import { DAILY_LOG_ENTITY, PACK, PROJECT_ENTITY } from "./vocabulary";

/**
 * The field: daily logs, who was on site, and the punch list.
 *
 * **EVERYTHING HERE IS A CHORE — `member`, not `owner`.** The person with the
 * phone on the site is rarely the owner, and a daily log that only an owner
 * could write would be written by nobody. Same split the livestock pack drew
 * for a photo of an animal: doing the work is member-level, deciding what
 * the business has agreed to is owner-level.
 *
 * **TWO OF THE THREE THINGS HERE ARE NOT THIS PACK'S ROWS.** Photos are
 * Documents' (`document_attachments`, hung on the day) and punch items are
 * Work's (`work_item_links`, hung on the project), reached through the Layer 0
 * seams every pack uses. This file names the entity types — that is the one
 * thing only the owning pack may do — and nothing else about either.
 */

const punchRef = (projectId: string) => ({
  extensionSlug: PACK,
  entityType: PROJECT_ENTITY,
  entityId: projectId,
});

export interface CrewInput {
  partyId?: string | null;
  trade?: string;
  workers: number;
  hoursTenths: number;
  notes?: string;
}

export interface DailyLogInput {
  projectId: string;
  logDate: string;
  weather?: string;
  notes?: string;
  /**
   * Add these words to the day's notes rather than replace them — what a
   * sentence from the field does, because "poured the slab" at nine and
   * "framers started" at two are two lines of one day.
   */
  appendNotes?: string;
  /** When given, REPLACES the day's crew lines, the way a document's lines are. */
  crews?: CrewInput[];
}

function validateCrews(crews: CrewInput[]): void {
  for (const c of crews) {
    if (!Number.isInteger(c.workers) || c.workers < 0) {
      throw new JobsError("INVALID_VALUE", "workers cannot be negative");
    }
    if (!Number.isInteger(c.hoursTenths) || c.hoursTenths < 0) {
      throw new JobsError("INVALID_VALUE", "hours cannot be negative");
    }
    if ((c.trade ?? "").trim() === "" && !c.partyId) {
      throw new JobsError("INVALID_VALUE", "a crew line names a trade or a subcontractor");
    }
  }
}

async function findLog(
  tx: Tx,
  tenantId: string,
  projectId: string,
  logDate: string,
): Promise<JobDailyLog | null> {
  const rows = await tx
    .select()
    .from(schema.jobDailyLogs)
    .where(
      and(
        eq(schema.jobDailyLogs.tenantId, tenantId),
        eq(schema.jobDailyLogs.projectId, projectId),
        eq(schema.jobDailyLogs.logDate, logDate),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Write a day's log — the day's if it exists, a new one if not.
 *
 * UPSERT BY (PROJECT, DAY), which is what makes the field usable: nobody in a
 * mud room at five knows whether somebody else already started today's
 * report, and two reports for one day is the thing a claims lawyer asks about.
 * `notes` replaces; `appendNotes` adds a line; `crews` replaces the lines;
 * anything omitted is left alone.
 */
export async function saveDailyLog(
  tx: Tx,
  ctx: JobsCtx,
  input: DailyLogInput,
): Promise<JobDailyLog> {
  requireWrite(ctx, "member");
  const project = await getProject(tx, ctx.tenantId, input.projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${input.projectId} not found`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.logDate)) {
    throw new JobsError("INVALID_VALUE", "a log needs a day");
  }
  if (input.crews) validateCrews(input.crews);

  const existing = await findLog(tx, ctx.tenantId, input.projectId, input.logDate);
  let log: JobDailyLog;
  if (existing) {
    const patch: Record<string, unknown> = {
      updatedAt: new Date(),
      version: existing.version + 1,
    };
    if (input.weather !== undefined) patch.weather = input.weather.trim();
    if (input.notes !== undefined) patch.notes = input.notes.trim();
    if (input.appendNotes !== undefined && input.appendNotes.trim() !== "") {
      const base = (input.notes !== undefined ? input.notes : existing.notes).trim();
      patch.notes = base === "" ? input.appendNotes.trim() : `${base}\n${input.appendNotes.trim()}`;
    }
    const rows = await tx
      .update(schema.jobDailyLogs)
      .set(patch)
      .where(eq(schema.jobDailyLogs.id, existing.id))
      .returning();
    log = rows[0];
  } else {
    const notes = [input.notes?.trim() ?? "", input.appendNotes?.trim() ?? ""]
      .filter((s) => s !== "")
      .join("\n");
    const rows = await tx
      .insert(schema.jobDailyLogs)
      .values({
        tenantId: ctx.tenantId,
        projectId: input.projectId,
        logDate: input.logDate,
        weather: input.weather?.trim() ?? "",
        notes,
        createdByClerkUserId: ctx.userId,
      })
      .returning();
    log = rows[0];
  }

  if (input.crews) {
    await tx
      .delete(schema.jobDailyLogCrews)
      .where(
        and(eq(schema.jobDailyLogCrews.tenantId, ctx.tenantId), eq(schema.jobDailyLogCrews.logId, log.id)),
      );
    if (input.crews.length > 0) {
      await tx.insert(schema.jobDailyLogCrews).values(
        input.crews.map((c, i) => ({
          tenantId: ctx.tenantId,
          logId: log.id,
          partyId: c.partyId ?? null,
          trade: c.trade?.trim() ?? "",
          workers: c.workers,
          hoursTenths: c.hoursTenths,
          notes: c.notes?.trim() ?? "",
          sortOrder: (i + 1) * 10,
        })),
      );
    }
  }
  return log;
}

/** Add one crew line to a day, leaving the others alone — what a sentence does. */
export async function addCrew(
  tx: Tx,
  ctx: JobsCtx,
  logId: string,
  crew: CrewInput,
): Promise<JobDailyLogCrew> {
  requireWrite(ctx, "member");
  validateCrews([crew]);
  const log = await tx
    .select({ id: schema.jobDailyLogs.id })
    .from(schema.jobDailyLogs)
    .where(and(eq(schema.jobDailyLogs.tenantId, ctx.tenantId), eq(schema.jobDailyLogs.id, logId)))
    .limit(1);
  if (log.length === 0) throw new JobsError("NOT_FOUND", `log ${logId} not found`);
  const order = (
    await tx
      .select({ max: sql<number>`coalesce(max(${schema.jobDailyLogCrews.sortOrder}), 0)`.mapWith(Number) })
      .from(schema.jobDailyLogCrews)
      .where(and(eq(schema.jobDailyLogCrews.tenantId, ctx.tenantId), eq(schema.jobDailyLogCrews.logId, logId)))
  )[0].max;
  const rows = await tx
    .insert(schema.jobDailyLogCrews)
    .values({
      tenantId: ctx.tenantId,
      logId,
      partyId: crew.partyId ?? null,
      trade: crew.trade?.trim() ?? "",
      workers: crew.workers,
      hoursTenths: crew.hoursTenths,
      notes: crew.notes?.trim() ?? "",
      sortOrder: order + 10,
    })
    .returning();
  return rows[0];
}

/**
 * Remove a day's log. Its crew lines go by cascade; its PHOTOS are detached
 * rather than deleted — the file stays in the cabinet, because removing a
 * day's report and destroying its pictures are different acts, and the
 * pictures may be the evidence.
 */
export async function deleteDailyLog(tx: Tx, ctx: JobsCtx, logId: string): Promise<void> {
  requireWrite(ctx, "member");
  const rows = await tx
    .delete(schema.jobDailyLogs)
    .where(and(eq(schema.jobDailyLogs.tenantId, ctx.tenantId), eq(schema.jobDailyLogs.id, logId)))
    .returning({ id: schema.jobDailyLogs.id });
  if (rows.length === 0) throw new JobsError("NOT_FOUND", `log ${logId} not found`);
  await detachAllForEntity(tx, ctx.tenantId, {
    extensionSlug: PACK,
    entityType: DAILY_LOG_ENTITY,
    entityId: logId,
  });
}

export interface DailyLogRow {
  log: JobDailyLog;
  crews: Array<JobDailyLogCrew & { partyName: string | null }>;
  photoCount: number;
  /** Σ workers × hours across the day's lines, in tenths of an hour. */
  manHoursTenths: number;
}

/**
 * A project's days, newest first, each with its crews and how many photos are
 * on it. The photo count comes through Documents' own export — this pack
 * never reads `document_attachments` itself.
 */
export async function listDailyLogs(
  tx: Tx,
  tenantId: string,
  projectId: string,
  options: { limit?: number } = {},
): Promise<DailyLogRow[]> {
  const query = tx
    .select()
    .from(schema.jobDailyLogs)
    .where(and(eq(schema.jobDailyLogs.tenantId, tenantId), eq(schema.jobDailyLogs.projectId, projectId)))
    .orderBy(desc(schema.jobDailyLogs.logDate));
  const logs = options.limit ? await query.limit(options.limit) : await query;
  if (logs.length === 0) return [];
  const ids = logs.map((l) => l.id);
  const [crews, photos] = await Promise.all([
    tx
      .select({ crew: schema.jobDailyLogCrews, partyName: schema.parties.displayName })
      .from(schema.jobDailyLogCrews)
      .leftJoin(
        schema.parties,
        and(
          eq(schema.parties.tenantId, schema.jobDailyLogCrews.tenantId),
          eq(schema.parties.id, schema.jobDailyLogCrews.partyId),
        ),
      )
      .where(and(eq(schema.jobDailyLogCrews.tenantId, tenantId), inArray(schema.jobDailyLogCrews.logId, ids)))
      .orderBy(asc(schema.jobDailyLogCrews.sortOrder), asc(schema.jobDailyLogCrews.createdAt)),
    attachmentCounts(tx, tenantId, DAILY_LOG_ENTITY, ids),
  ]);
  const crewsByLog = new Map<string, DailyLogRow["crews"]>();
  for (const r of crews) {
    const list = crewsByLog.get(r.crew.logId) ?? [];
    list.push({ ...r.crew, partyName: r.partyName ?? null });
    crewsByLog.set(r.crew.logId, list);
  }
  return logs.map((log) => {
    const own = crewsByLog.get(log.id) ?? [];
    return {
      log,
      crews: own,
      photoCount: photos.get(log.id) ?? 0,
      manHoursTenths: own.reduce((sum, c) => sum + c.workers * c.hoursTenths, 0),
    };
  });
}

/** One day by id, for the photo actions' compensating control. */
export async function getDailyLog(tx: Tx, tenantId: string, logId: string): Promise<JobDailyLog | null> {
  const rows = await tx
    .select()
    .from(schema.jobDailyLogs)
    .where(and(eq(schema.jobDailyLogs.tenantId, tenantId), eq(schema.jobDailyLogs.id, logId)))
    .limit(1);
  return rows[0] ?? null;
}

// ------------------------------------------------------------------- punch list

/**
 * A punch item is a WORK ITEM linked to the project — raised where it lives,
 * worked in the Work module beside everything else that needs doing, and
 * shown on the project page because the link says whose it is. Nothing here
 * is a task engine.
 */
export async function addPunchItem(
  tx: Tx,
  ctx: JobsCtx,
  projectId: string,
  input: { title: string; notes?: string; dueOn?: string | null },
): Promise<string> {
  requireWrite(ctx, "member");
  const project = await getProject(tx, ctx.tenantId, projectId);
  if (!project) throw new JobsError("NOT_FOUND", `project ${projectId} not found`);
  if (input.title.trim() === "") throw new JobsError("INVALID_VALUE", "a punch item needs saying what it is");
  return createWorkForEntity(
    tx,
    { tenantId: ctx.tenantId, userId: ctx.userId },
    punchRef(projectId),
    { title: input.title.trim(), notes: input.notes?.trim() ?? "", dueOn: input.dueOn ?? null },
  );
}

export async function listPunchItems(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<EntityWorkRow[]> {
  return listWorkForEntity(tx, { tenantId }, { entityType: PROJECT_ENTITY, entityId: projectId });
}

export async function setPunchDone(
  tx: Tx,
  ctx: JobsCtx,
  itemId: string,
  done: boolean,
): Promise<void> {
  requireWrite(ctx, "member");
  await setWorkComplete(tx, { tenantId: ctx.tenantId, userId: ctx.userId }, itemId, done);
}
