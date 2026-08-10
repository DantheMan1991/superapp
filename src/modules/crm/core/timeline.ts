import type { CrmActivity, CrmActivityKind } from "@/db/schema";

/**
 * The timeline: merging heterogeneous things that happened into one ordered
 * stream, and deciding what is overdue. PURE — no database, no `server-only`,
 * no React.
 *
 * BUILT FOR SOURCES THAT DO NOT EXIST YET. Slice 5 adds mail threads once CRM
 * registers its entity types with Mail, and slice 3's stage events are already
 * a candidate. `TimelineItem` is therefore a shape any source can produce
 * rather than a union of the two tables that happen to exist today — the merge
 * takes items, not tables, so adding a source is a mapping function and nothing
 * else.
 */

export type TimelineItemKind = CrmActivityKind | "task" | "task_done";

export interface TimelineItem {
  /** Unique across sources — prefix by source, never a bare row id. */
  id: string;
  kind: TimelineItemKind;
  /** When the thing HAPPENED. Not when the row was written. */
  at: Date;
  title: string;
  /** Optional second line. Already formatted by whoever produced it. */
  detail?: string;
  /** Where clicking goes, when the item has a page of its own. */
  href?: string;
  /** Which deal this belongs to, when it belongs to one. */
  dealId?: string | null;
}

/**
 * Merge and order, newest first.
 *
 * Ties broken by `id` so the order is TOTAL and therefore stable: two things
 * logged in the same second would otherwise swap places between renders, which
 * looks like the page is lying about history.
 */
export function mergeTimeline(...sources: TimelineItem[][]): TimelineItem[] {
  return sources
    .flat()
    .sort((a, b) => {
      const d = b.at.getTime() - a.at.getTime();
      return d !== 0 ? d : a.id.localeCompare(b.id);
    });
}

/** An activity as a timeline item. */
export function activityToTimeline(
  activity: Pick<
    CrmActivity,
    "id" | "kind" | "subject" | "body" | "occurredAt" | "dealId"
  >,
): TimelineItem {
  return {
    id: `activity:${activity.id}`,
    kind: activity.kind,
    at: activity.occurredAt,
    // Falls back to the body's first line rather than showing a blank row: a
    // note is usually all body and no subject, and "(no subject)" would be the
    // most common thing on the page.
    title: activity.subject || firstLine(activity.body) || defaultTitle(activity.kind),
    detail: activity.subject ? firstLine(activity.body) : undefined,
    dealId: activity.dealId,
  };
}

/**
 * A task as a timeline item.
 *
 * A COMPLETED task appears at the time it was COMPLETED, an open one at the
 * time it is due. That is what makes the stream read as history: "we agreed a
 * price / I chased them / they signed" rather than every follow-up bunching at
 * the moment somebody typed it.
 *
 * An open task with no due date has no place on a timeline at all — it has not
 * happened and is not scheduled — so this returns null and the caller drops it.
 * It still appears in the task list, which is where undated work belongs.
 */
export function taskToTimeline(
  task: {
    id: string;
    title: string;
    dueOn: string | null;
    completedAt: Date | null;
    dealId: string | null;
    notes: string;
  },
): TimelineItem | null {
  if (task.completedAt) {
    return {
      id: `task:${task.id}`,
      kind: "task_done",
      at: task.completedAt,
      title: task.title,
      detail: firstLine(task.notes),
      dealId: task.dealId,
    };
  }
  if (!task.dueOn) return null;
  return {
    id: `task:${task.id}`,
    kind: "task",
    // Midday UTC rather than midnight, so a due date does not jump a day for
    // anybody west of Greenwich when it is rendered in local time.
    at: new Date(`${task.dueOn}T12:00:00Z`),
    title: task.title,
    detail: firstLine(task.notes),
    dealId: task.dealId,
  };
}

function firstLine(text: string): string | undefined {
  const line = text.split("\n").find((l) => l.trim().length > 0);
  if (!line) return undefined;
  const trimmed = line.trim();
  return trimmed.length > 140 ? `${trimmed.slice(0, 139)}…` : trimmed;
}

function defaultTitle(kind: CrmActivityKind): string {
  switch (kind) {
    case "call":
      return "Call";
    case "meeting":
      return "Meeting";
    case "note":
      return "Note";
  }
}

/* -- Follow-up urgency ---------------------------------------------------- */

export type DueBucket = "overdue" | "today" | "soon" | "later" | "someday";

/**
 * How urgent an open task is.
 *
 * `today` is passed in as a yyyy-mm-dd STRING rather than a Date, and that is
 * the whole trick: "is this overdue" is a question about calendar days in the
 * user's timezone, and comparing a `date` column to a server `Date` gets it
 * wrong by up to a day for anybody not on UTC. Strings in the same format
 * compare correctly with `<`.
 *
 * A task with no due date is `someday` — not overdue. Nobody agreed a date, so
 * nothing has been missed.
 */
export function dueBucket(
  dueOn: string | null,
  today: string,
  opts: { soonWithinDays?: number } = {},
): DueBucket {
  if (!dueOn) return "someday";
  if (dueOn < today) return "overdue";
  if (dueOn === today) return "today";

  const within = opts.soonWithinDays ?? 7;
  const limit = addDays(today, within);
  return dueOn <= limit ? "soon" : "later";
}

/** Calendar-day arithmetic on a yyyy-mm-dd string, via UTC so DST cannot shift it. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The fields a grouped follow-up is read by.
 *
 * Structural rather than `CrmTask`: since work.md slice 5b these rows come out
 * of `work_items`, and naming the table here would have made every consumer
 * care where they are stored.
 */
export interface GroupableTask {
  id: string;
  title: string;
  notes: string;
  dueOn: string | null;
  completedAt: Date | null;
  partyId: string | null;
  dealId: string | null;
  version: number;
  assigneeClerkUserId: string | null;
}

export interface TaskGroups {
  overdue: GroupableTask[];
  today: GroupableTask[];
  soon: GroupableTask[];
  later: GroupableTask[];
  someday: GroupableTask[];
}

/**
 * Group open tasks by urgency, each group in due order.
 *
 * COMPLETED TASKS ARE DROPPED rather than given a group. A list whose job is
 * "what is outstanding" that also carries what is finished is a list nobody
 * trusts the top of.
 */
export function groupTasks(
  tasks: GroupableTask[],
  today: string,
): TaskGroups {
  const groups: TaskGroups = {
    overdue: [],
    today: [],
    soon: [],
    later: [],
    someday: [],
  };

  for (const task of tasks) {
    if (task.completedAt) continue;
    groups[dueBucket(task.dueOn, today)].push(task);
  }

  for (const key of Object.keys(groups) as (keyof TaskGroups)[]) {
    groups[key].sort((a, b) => {
      // Undated last within a group, then by date, then by title so the order
      // is total and does not shuffle between renders.
      if (a.dueOn !== b.dueOn) {
        if (!a.dueOn) return 1;
        if (!b.dueOn) return -1;
        return a.dueOn < b.dueOn ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    });
  }

  return groups;
}

export const ACTIVITY_SUBJECT_MAX = 200;
export const ACTIVITY_BODY_MAX = 10_000;
export const TASK_TITLE_MAX = 200;
export const TASK_NOTES_MAX = 4000;
