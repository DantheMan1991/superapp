import "server-only";
import { and, desc, eq, or } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { CrmActivity, CrmActivityKind } from "@/db/schema";
import { WorkError } from "@/lib/work/errors";
import {
  attachEntity,
  createUnlinkedWork,
  createWorkForEntity,
  detachEntityType,
  listOpenWork,
  listRecentlyClosedWork,
  listWorkByIds,
  listWorkForEntity,
  setWorkAssignee,
  setWorkComplete,
  updateEntityWork,
  type EntityWorkRow,
} from "@/lib/work/entity-work";
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

/**
 * The `extension_slug` CRM's links carry.
 *
 * Must match `crmMailExtension.slug`, which is what `entity-links/registry`
 * resolves a stored link back through. A mismatch is silent: the link row
 * survives, resolves to nothing, and renders as a deleted record.
 */
const CRM_SLUG = "crm";

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

/* -- Follow-ups ----------------------------------------------------------- */

/**
 * A follow-up IS a work item linked to this record. There is no `crm_tasks`
 * behind these any more (work.md slice 5b) — the storage moved, the vocabulary
 * did not.
 *
 * `FollowUp` keeps the field names CRM's pages and components already use, so
 * the swap touched no component: `notes` rather than `description`,
 * `completedAt` rather than `closedAt`, and `partyId`/`dealId` lifted out of
 * the link rows they now live in. A translation at the boundary, not a second
 * model — one row underneath, one write path onto it.
 */
export interface FollowUp {
  id: string;
  title: string;
  notes: string;
  dueOn: string | null;
  assigneeClerkUserId: string | null;
  completedAt: Date | null;
  version: number;
  partyId: string | null;
  dealId: string | null;
}

/** The two types a party can be linked as, decided by `parties.kind`. */
const PARTY_TYPES = ["contact", "company"] as const;

function toFollowUp(row: EntityWorkRow): FollowUp {
  const party = row.links.find(
    (l) => l.entityType === "contact" || l.entityType === "company",
  );
  const deal = row.links.find((l) => l.entityType === "deal");
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    dueOn: row.dueOn,
    assigneeClerkUserId: row.assigneeClerkUserId,
    completedAt: row.completedAt,
    version: row.version,
    partyId: party?.entityId ?? null,
    dealId: deal?.entityId ?? null,
  };
}

/**
 * Which linkable type this party is.
 *
 * WRITING a link needs the exact type, because a link row stores one — reading
 * can match on the id across both. Getting this wrong is silent: the chip
 * resolves to nothing and renders as a deleted record.
 */
async function partyEntityType(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<"contact" | "company"> {
  const [row] = await tx
    .select({ kind: schema.parties.kind })
    .from(schema.parties)
    .where(
      and(eq(schema.parties.tenantId, tenantId), eq(schema.parties.id, partyId)),
    );
  if (!row) throw new CrmError("TASK_NOT_FOUND", "record missing");
  return row.kind === "person" ? "contact" : "company";
}

export async function listTasksForParty(
  tx: Tx,
  tenantId: string,
  partyId: string,
): Promise<FollowUp[]> {
  const rows = await listWorkForEntity(
    tx,
    { tenantId },
    { entityType: PARTY_TYPES, entityId: partyId },
  );
  return rows.map(toFollowUp);
}

export async function listTasksForDeal(
  tx: Tx,
  tenantId: string,
  dealId: string,
): Promise<FollowUp[]> {
  const rows = await listWorkForEntity(
    tx,
    { tenantId },
    { entityType: "deal", entityId: dealId },
  );
  return rows.map(toFollowUp);
}

/**
 * Everything outstanding, across every record.
 *
 * Now spans work that has nothing to do with CRM as well, which is the point of
 * the merge: one list of what somebody owes rather than one per module.
 */
export async function listOpenTasks(
  tx: Tx,
  tenantId: string,
  opts?: { assigneeClerkUserId?: string },
): Promise<FollowUp[]> {
  const rows = await listOpenWork(tx, { tenantId }, opts);
  return rows.map(toFollowUp);
}

/**
 * Follow-ups attached to a CRM record, across every record.
 *
 * THE CRM-SCOPED VIEW, and the distinction from `listOpenTasks` above is the
 * whole reason this exists. Slice 5b removed CRM's Follow-ups tab because a
 * CRM-filtered list would silently drop unattached work — "ring the accountant
 * back" had a home in `crm_tasks.party_id` being nullable, and a filtered page
 * would have hidden exactly those.
 *
 * That argument is sound for WORK being the complete list. It does not follow
 * that CRM may not have a view of its own work, and the two claims got thrown
 * out together. This one says what it excludes rather than pretending to be
 * everything: unattached follow-ups live in Work, and the page says so.
 *
 * Filtered in JS rather than SQL because `toFollowUp` already resolves the CRM
 * link out of `row.links`, and duplicating that resolution as a join would give
 * two definitions of "is this a CRM follow-up" to keep in step. Revisit if a
 * tenant's open-work count ever makes the round trip worth it.
 */
export async function listOpenTasksOnRecords(
  tx: Tx,
  tenantId: string,
  opts?: { assigneeClerkUserId?: string },
): Promise<FollowUp[]> {
  const rows = await listOpenWork(tx, { tenantId }, opts);
  return rows
    .map(toFollowUp)
    .filter((t) => t.partyId !== null || t.dealId !== null);
}

/** The same scoping, for what was recently finished. */
export async function listRecentlyCompletedTasksOnRecords(
  tx: Tx,
  tenantId: string,
  limit = 20,
): Promise<FollowUp[]> {
  const rows = await listRecentlyClosedWork(tx, { tenantId }, limit);
  return rows
    .map(toFollowUp)
    .filter((t) => t.partyId !== null || t.dealId !== null);
}

export async function listRecentlyCompletedTasks(
  tx: Tx,
  tenantId: string,
  limit = 20,
): Promise<FollowUp[]> {
  const rows = await listRecentlyClosedWork(tx, { tenantId }, limit);
  return rows.map(toFollowUp);
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
): Promise<FollowUp> {
  if (input.title.trim().length === 0) {
    throw new CrmError("TASK_TITLE_REQUIRED", "a task needs a title");
  }
  // Only when attached: an unattached follow-up has no record to adopt, which
  // is the whole point of allowing one.
  if (input.partyId) await adoptRecord(tx, ctx, input.partyId);

  const itemId = input.partyId
    ? await createWorkForEntity(
        tx,
        ctx,
        {
          extensionSlug: CRM_SLUG,
          entityType: await partyEntityType(tx, ctx.tenantId, input.partyId),
          entityId: input.partyId,
        },
        {
          title: input.title.trim(),
          notes: input.notes ?? "",
          dueOn: input.dueOn ?? null,
          assignee: input.assigneeClerkUserId ?? null,
        },
      )
    : await createUnlinkedWork(tx, ctx, {
        title: input.title.trim(),
        notes: input.notes ?? "",
        dueOn: input.dueOn ?? null,
        assignee: input.assigneeClerkUserId ?? null,
      });

  // A follow-up can be about both a record and one of its deals.
  if (input.dealId) {
    await attachEntity(tx, ctx, itemId, {
      extensionSlug: CRM_SLUG,
      entityType: "deal",
      entityId: input.dealId,
    });
  }

  return requireFollowUp(tx, ctx.tenantId, itemId);
}

export async function updateTask(
  tx: Tx,
  ctx: CrmCtx,
  args: {
    taskId: string;
    expectedVersion: number;
    patch: Omit<Partial<TaskInput>, "partyId">;
  },
): Promise<FollowUp> {
  const { patch } = args;
  if (patch.title !== undefined && patch.title.trim().length === 0) {
    throw new CrmError("TASK_TITLE_REQUIRED", "a task needs a title");
  }

  try {
    await updateEntityWork(tx, ctx, args.taskId, args.expectedVersion, {
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      ...(patch.dueOn !== undefined ? { dueOn: patch.dueOn } : {}),
    });
  } catch (error) {
    throw translateWorkError(error);
  }

  if (patch.assigneeClerkUserId !== undefined) {
    await setWorkAssignee(
      tx,
      ctx,
      args.taskId,
      patch.assigneeClerkUserId ?? null,
    );
  }
  // Moving a follow-up between deals is a link change, not a column write.
  if (patch.dealId !== undefined) {
    await detachEntityType(tx, { tenantId: ctx.tenantId }, args.taskId, "deal");
    if (patch.dealId) {
      await attachEntity(tx, ctx, args.taskId, {
        extensionSlug: CRM_SLUG,
        entityType: "deal",
        entityId: patch.dealId,
      });
    }
  }
  return requireFollowUp(tx, ctx.tenantId, args.taskId);
}

/**
 * Tick or untick.
 *
 * The optimistic version is checked FIRST, by an empty edit, so a stale tick is
 * refused for the same reason a stale rename is. `setWorkComplete` then moves
 * `state` and `closed_at` together, which the CHECK constraint requires.
 */
export async function setTaskComplete(
  tx: Tx,
  ctx: CrmCtx,
  args: { taskId: string; expectedVersion: number; complete: boolean },
): Promise<FollowUp> {
  try {
    await updateEntityWork(tx, ctx, args.taskId, args.expectedVersion, {});
  } catch (error) {
    throw translateWorkError(error);
  }
  await setWorkComplete(tx, ctx, args.taskId, args.complete);
  const row = await requireFollowUp(tx, ctx.tenantId, args.taskId);

  // TRIGGER, on completion only — reopening a follow-up is a correction, and
  // firing rules on it would punish somebody for fixing a mistake. An
  // unattached follow-up has no record for a rule to act on, so it fires
  // nothing.
  if (args.complete && row.partyId) {
    await runTrigger(
      tx,
      { tenantId: ctx.tenantId, userId: ctx.userId, partyId: row.partyId },
      "task_completed",
    );
  }
  return row;
}

export async function deleteTask(
  tx: Tx,
  ctx: CrmCtx,
  taskId: string,
): Promise<void> {
  // The link rows go with it: `work_item_links` cascades on the item.
  const rows = await tx
    .delete(schema.workItems)
    .where(
      and(
        eq(schema.workItems.tenantId, ctx.tenantId),
        eq(schema.workItems.id, taskId),
      ),
    )
    .returning({ id: schema.workItems.id });
  if (rows.length === 0) throw new CrmError("TASK_NOT_FOUND", "task missing");
}

/** One follow-up by id, or the CRM error the callers already handle. */
async function requireFollowUp(
  tx: Tx,
  tenantId: string,
  itemId: string,
): Promise<FollowUp> {
  const [row] = await listWorkByIds(tx, { tenantId }, [itemId]);
  if (!row) throw new CrmError("TASK_NOT_FOUND", "task missing");
  return toFollowUp(row);
}

/**
 * Work's errors, said in CRM's words.
 *
 * `STALE` is the one that matters: CRM's callers already catch `STALE_VERSION`
 * and re-render, and letting a `WorkError` through would break that without
 * any of them being touched.
 */
function translateWorkError(error: unknown): unknown {
  if (error instanceof WorkError) {
    if (error.code === "STALE") {
      return new CrmError("STALE_VERSION", "task changed since loaded");
    }
    if (error.code === "NOT_FOUND") {
      return new CrmError("TASK_NOT_FOUND", "task missing");
    }
  }
  return error;
}

/* -- The timeline --------------------------------------------------------- */

export interface Timeline {
  items: TimelineItem[];
  openTasks: FollowUp[];
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
  tasks: FollowUp[],
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
