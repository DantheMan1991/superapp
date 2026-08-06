import "server-only";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CrmActivity, CrmActivityKind, CrmTask } from "@/db/schema";
import { CrmError } from "./core/errors";
import { runTrigger } from "./automation-ops";
import {
  activityToTimeline,
  mergeTimeline,
  taskToTimeline,
  type TimelineItem,
} from "./core/timeline";
import { adoptRecord } from "./party-ops";
import type { CrmCtx } from "./core/types";

/**
 * Activity and follow-ups — what was said, and what has to happen next.
 *
 * The timeline read lives here rather than in the page so that slice 5 can add
 * mail threads in ONE place. `loadTimeline` composes sources through
 * `mergeTimeline`; a new source is a query and a mapping function, and no
 * caller changes.
 */

const TIMELINE_LIMIT = 200;

/* -- Activity ------------------------------------------------------------- */

export async function listActivitiesForParty(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<CrmActivity[]> {
  return tx.query.crmActivities.findMany({
    where: and(
      eq(schema.crmActivities.tenantId, tenantId),
      eq(schema.crmActivities.partyId, partyId),
    ),
    orderBy: [desc(schema.crmActivities.occurredAt)],
    limit: TIMELINE_LIMIT,
  });
}

export async function listActivitiesForDeal(
  tx: Tx,
  tenantId: string,
  dealId: string,
): Promise<CrmActivity[]> {
  return tx.query.crmActivities.findMany({
    where: and(
      eq(schema.crmActivities.tenantId, tenantId),
      eq(schema.crmActivities.dealId, dealId),
    ),
    orderBy: [desc(schema.crmActivities.occurredAt)],
    limit: TIMELINE_LIMIT,
  });
}

export interface ActivityInput {
  partyId: string;
  dealId?: string | null;
  kind: CrmActivityKind;
  subject?: string;
  body?: string;
  /** When it HAPPENED. Defaults to now for something logged as it happens. */
  occurredAt?: Date;
}

export async function logActivity(
  tx: Tx,
  ctx: CrmCtx,
  input: ActivityInput,
): Promise<CrmActivity> {
  if ((input.subject ?? "").trim().length === 0 && (input.body ?? "").trim().length === 0) {
    throw new CrmError("ACTIVITY_EMPTY", "an activity needs a subject or a note");
  }

  // The policy resolves through `crm_party_details`, so a party CRM has never
  // been asked about would make the row invisible the instant it was written.
  await adoptRecord(tx, ctx, input.partyId);

  const [row] = await tx
    .insert(schema.crmActivities)
    .values({
      tenantId: ctx.tenantId,
      partyId: input.partyId,
      dealId: input.dealId ?? null,
      kind: input.kind,
      subject: (input.subject ?? "").trim(),
      body: input.body ?? "",
      occurredAt: input.occurredAt ?? new Date(),
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return row;
}

export async function updateActivity(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    activityId: string;
    expectedVersion: number;
    patch: { subject?: string; body?: string; occurredAt?: Date };
  },
): Promise<CrmActivity> {
  const rows = await tx
    .update(schema.crmActivities)
    .set({
      ...(args.patch.subject !== undefined
        ? { subject: args.patch.subject.trim() }
        : {}),
      ...(args.patch.body !== undefined ? { body: args.patch.body } : {}),
      ...(args.patch.occurredAt !== undefined
        ? { occurredAt: args.patch.occurredAt }
        : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmActivities.tenantId, ctx.tenantId),
        eq(schema.crmActivities.id, args.activityId),
        eq(schema.crmActivities.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "activity changed since loaded");
  }
  return rows[0];
}

/**
 * Activity IS deletable, unlike almost everything else in this module.
 *
 * The reason is that it is the one table holding somebody's unstructured prose
 * about another person. "Rude on the phone, would not budge" is a note whose
 * author may reasonably want it gone, and archiving it — leaving it readable
 * while pretending otherwise — would be the worse answer. Nothing references an
 * activity, so removing one dangles nothing.
 */
export async function deleteActivity(
  tx: Tx,
  ctx: CrmCtx,
  activityId: string,
): Promise<void> {
  const rows = await tx
    .delete(schema.crmActivities)
    .where(
      and(
        eq(schema.crmActivities.tenantId, ctx.tenantId),
        eq(schema.crmActivities.id, activityId),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("ACTIVITY_NOT_FOUND", "activity missing");
  }
}

/* -- Tasks ---------------------------------------------------------------- */

export async function listTasksForParty(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<CrmTask[]> {
  return tx.query.crmTasks.findMany({
    where: and(
      eq(schema.crmTasks.tenantId, tenantId),
      eq(schema.crmTasks.partyId, partyId),
    ),
    orderBy: [asc(schema.crmTasks.dueOn)],
    limit: TIMELINE_LIMIT,
  });
}

export async function listTasksForDeal(
  tx: Tx,
  tenantId: string,
  dealId: string,
): Promise<CrmTask[]> {
  return tx.query.crmTasks.findMany({
    where: and(
      eq(schema.crmTasks.tenantId, tenantId),
      eq(schema.crmTasks.dealId, dealId),
    ),
    orderBy: [asc(schema.crmTasks.dueOn)],
    limit: TIMELINE_LIMIT,
  });
}

/**
 * Every open follow-up in the tenant — the module-level list.
 *
 * Open only: `groupTasks` drops completed ones anyway, and fetching them to
 * throw them away is a bigger query for no reason. Undated tasks are included,
 * because "someday" is a real bucket and a list that hid them would quietly
 * lose work.
 */
export async function listOpenTasks(
  tx: Tx,
  tenantId: string,
  opts: { assigneeClerkUserId?: string } = {},
): Promise<CrmTask[]> {
  return tx.query.crmTasks.findMany({
    where: and(
      eq(schema.crmTasks.tenantId, tenantId),
      isNull(schema.crmTasks.completedAt),
      ...(opts.assigneeClerkUserId
        ? [eq(schema.crmTasks.assigneeClerkUserId, opts.assigneeClerkUserId)]
        : []),
    ),
    // Nulls last so undated work does not sit above what is overdue.
    orderBy: [sql`${schema.crmTasks.dueOn} asc nulls last`],
    limit: 500,
  });
}

/** Recently completed, for the "and here is what got done" panel. */
export async function listRecentlyCompletedTasks(
  tx: Tx,
  tenantId: string,
  limit = 20,
): Promise<CrmTask[]> {
  return tx.query.crmTasks.findMany({
    where: and(
      eq(schema.crmTasks.tenantId, tenantId),
      sql`${schema.crmTasks.completedAt} is not null`,
    ),
    orderBy: [desc(schema.crmTasks.completedAt)],
    limit,
  });
}

export interface TaskInput {
  partyId?: string | null;
  dealId?: string | null;
  title: string;
  notes?: string;
  dueOn?: string | null;
  assigneeClerkUserId?: string | null;
}

export async function createTask(
  tx: Tx,
  ctx: CrmCtx,
  input: TaskInput,
): Promise<CrmTask> {
  if (input.title.trim().length === 0) {
    throw new CrmError("TASK_TITLE_REQUIRED", "a task needs a title");
  }
  // Only when attached: an unattached task has no record to adopt, which is the
  // whole point of allowing one.
  if (input.partyId) await adoptRecord(tx, ctx, input.partyId);

  const [row] = await tx
    .insert(schema.crmTasks)
    .values({
      tenantId: ctx.tenantId,
      partyId: input.partyId ?? null,
      dealId: input.dealId ?? null,
      title: input.title.trim(),
      notes: input.notes ?? "",
      dueOn: input.dueOn ?? null,
      assigneeClerkUserId: input.assigneeClerkUserId ?? null,
      createdByClerkUserId: ctx.userId,
    })
    .returning();
  return row;
}

export async function updateTask(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    taskId: string;
    expectedVersion: number;
    patch: Omit<Partial<TaskInput>, "partyId">;
  },
): Promise<CrmTask> {
  const { patch } = args;
  if (patch.title !== undefined && patch.title.trim().length === 0) {
    throw new CrmError("TASK_TITLE_REQUIRED", "a task needs a title");
  }

  const rows = await tx
    .update(schema.crmTasks)
    .set({
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.dueOn !== undefined ? { dueOn: patch.dueOn } : {}),
      ...(patch.assigneeClerkUserId !== undefined
        ? { assigneeClerkUserId: patch.assigneeClerkUserId }
        : {}),
      ...(patch.dealId !== undefined ? { dealId: patch.dealId } : {}),
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmTasks.tenantId, ctx.tenantId),
        eq(schema.crmTasks.id, args.taskId),
        eq(schema.crmTasks.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "task changed since loaded");
  }
  return rows[0];
}

/**
 * Tick or untick.
 *
 * BOTH completion columns move together, because the CHECK constraint requires
 * it — `completed_at` and `completed_by` are one fact stored in two places and
 * the database refuses a row carrying only half of it. Reopening clears both.
 */
export async function setTaskComplete(
  tx: Tx,
  ctx: CrmCtx,
  args: { taskId: string; expectedVersion: number; complete: boolean },
): Promise<CrmTask> {
  const rows = await tx
    .update(schema.crmTasks)
    .set({
      completedAt: args.complete ? new Date() : null,
      completedByClerkUserId: args.complete ? ctx.userId : null,
      version: args.expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.crmTasks.tenantId, ctx.tenantId),
        eq(schema.crmTasks.id, args.taskId),
        eq(schema.crmTasks.version, args.expectedVersion),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new CrmError("STALE_VERSION", "task changed since loaded");
  }

  // TRIGGER, on completion only — reopening a follow-up is a correction, and
  // firing rules on it would punish somebody for fixing a mistake. An
  // unattached task has no record for a rule to act on, so it fires nothing.
  if (args.complete && rows[0].partyId) {
    await runTrigger(
      tx,
      { tenantId: ctx.tenantId, userId: ctx.userId, partyId: rows[0].partyId },
      "task_completed",
    );
  }

  return rows[0];
}

export async function deleteTask(
  tx: Tx,
  ctx: CrmCtx,
  taskId: string,
): Promise<void> {
  const rows = await tx
    .delete(schema.crmTasks)
    .where(
      and(eq(schema.crmTasks.tenantId, ctx.tenantId), eq(schema.crmTasks.id, taskId)),
    )
    .returning();
  if (rows.length === 0) throw new CrmError("TASK_NOT_FOUND", "task missing");
}

/* -- The timeline --------------------------------------------------------- */

export interface Timeline {
  items: TimelineItem[];
  openTasks: CrmTask[];
}

/**
 * One record's timeline: what happened, and what is still outstanding.
 *
 * THE COMPOSITION POINT. Slice 5 adds mail threads by fetching them here and
 * passing another array to `mergeTimeline` — no caller and no shape changes.
 * Open tasks come back separately as well as in the stream, because "due next
 * Tuesday" belongs in a to-do list and on the timeline for different reasons.
 */
export async function loadTimeline(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<Timeline> {
  const [activities, tasks] = await Promise.all([
    listActivitiesForParty(tx, tenantId, partyId),
    listTasksForParty(tx, tenantId, partyId),
  ]);

  return {
    items: mergeTimeline(
      activities.map(activityToTimeline),
      // Open undated tasks map to null and are dropped — they have not happened
      // and are not scheduled, so they belong in the list rather than the stream.
      tasks.map(taskToTimeline).filter((i): i is TimelineItem => i !== null),
    ),
    openTasks: tasks.filter((t) => !t.completedAt),
  };
}

/** The same, for one deal. */
export async function loadDealTimeline(
  tx: Tx,
  tenantId: string,
  dealId: string,
): Promise<Timeline> {
  const [activities, tasks] = await Promise.all([
    listActivitiesForDeal(tx, tenantId, dealId),
    listTasksForDeal(tx, tenantId, dealId),
  ]);

  return {
    items: mergeTimeline(
      activities.map(activityToTimeline),
      tasks.map(taskToTimeline).filter((i): i is TimelineItem => i !== null),
    ),
    openTasks: tasks.filter((t) => !t.completedAt),
  };
}

/** Parties named by a set of tasks, for the module-level list's labels. */
export async function resolveTaskParties(
  tx: Tx,
  tenantId: string,
  tasks: CrmTask[],
): Promise<Map<string, string>> {
  const ids = [...new Set(tasks.map((t) => t.partyId).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.parties.id, displayName: schema.parties.displayName })
    .from(schema.parties)
    .where(
      and(
        eq(schema.parties.tenantId, tenantId),
        or(...ids.map((id) => eq(schema.parties.id, id))),
      ),
    );
  return new Map(rows.map((r) => [r.id, r.displayName]));
}
