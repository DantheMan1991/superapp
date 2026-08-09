import "server-only";
import { and, asc, eq, isNull, lte, sql, type SQL } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import type { WorkState, WorkVisibility } from "@/lib/work/vocabulary";

/**
 * The read path. Everything that answers "what work is there" goes through
 * here, and nothing here decides who may see what.
 *
 * THAT IS THE WHOLE POINT, AND IT IS WHY THIS FILE IS SHORT. Scheduling needed
 * `app_schedule_range()` because two of its four access levels are partial
 * redactions and RLS cannot return half a row. Work has no such level: a list is
 * visible or it is not, so a policy says everything and application code says
 * nothing. If a future slice adds a "can see titles only" level, this is where
 * the projection lands and drizzle/0097 is the worked example — but do not
 * invent one before a surface needs it.
 *
 * Every function takes the CALLER'S `tx`. None opens its own transaction and
 * none calls `withSystem`: the caller has already established the RLS context
 * through `withWork`, so what these can find is exactly what that person may
 * see. Invariant S12 as a function signature.
 *
 * `tenant_id` is also filtered explicitly, even though RLS already did it.
 * Defense in depth, the way `findPrimaryCalendarId` does it — neither layer is
 * trusted alone.
 */

export interface WorkListRow {
  id: string;
  name: string;
  color: string;
  visibility: WorkVisibility;
  isDefault: boolean;
  archivedAt: Date | null;
}

export interface WorkItemRow {
  id: string;
  listId: string;
  title: string;
  description: string;
  state: WorkState;
  status: string;
  dueOn: string | null;
  startsOn: string | null;
  assigneeClerkUserId: string | null;
  parentId: string | null;
  kind: string;
  closedAt: Date | null;
}

/**
 * The lists this person can see, default first and then by name.
 *
 * Archived lists are excluded unless asked for: archiving is what this module
 * has instead of deleting, so an archived list still holds its items and still
 * resolves a link — it just stops appearing in pickers.
 */
export async function listWorkLists(
  tx: Tx,
  tenantId: string,
  opts?: { includeArchived?: boolean },
): Promise<WorkListRow[]> {
  const where: SQL[] = [eq(schema.workLists.tenantId, tenantId)];
  if (!opts?.includeArchived) {
    where.push(isNull(schema.workLists.archivedAt));
  }
  const rows = await tx
    .select({
      id: schema.workLists.id,
      name: schema.workLists.name,
      color: schema.workLists.color,
      visibility: schema.workLists.visibility,
      isDefault: schema.workLists.isDefault,
      archivedAt: schema.workLists.archivedAt,
    })
    .from(schema.workLists)
    .where(and(...where))
    .orderBy(sql`${schema.workLists.isDefault} desc`, asc(schema.workLists.name));
  return rows as WorkListRow[];
}

export interface WorkItemFilter {
  listId?: string;
  /**
   * Whose work. Pass `null` for the unassigned pile — which is a real question
   * the digest asks on an owner's behalf, and not the same as "no filter".
   */
  assignee?: string | null;
  /** Only work that is not finished with — `closed_at IS NULL`. */
  openOnly?: boolean;
  /** `yyyy-mm-dd`. Due on or before this day. Compare STRINGS, never Dates. */
  dueOnOrBefore?: string;
}

/**
 * Work items, soonest due first.
 *
 * Undated work sorts LAST rather than first, which is Postgres' default for
 * ASC and also the behaviour you want: a list that opens with forty items
 * nobody put a date on has buried the three that are due today.
 */
export async function listWorkItems(
  tx: Tx,
  tenantId: string,
  filter: WorkItemFilter = {},
): Promise<WorkItemRow[]> {
  const where: SQL[] = [eq(schema.workItems.tenantId, tenantId)];
  if (filter.listId) {
    where.push(eq(schema.workItems.listId, filter.listId));
  }
  if (filter.assignee === null) {
    where.push(isNull(schema.workItems.assigneeClerkUserId));
  } else if (filter.assignee !== undefined) {
    where.push(eq(schema.workItems.assigneeClerkUserId, filter.assignee));
  }
  if (filter.openOnly) {
    where.push(isNull(schema.workItems.closedAt));
  }
  if (filter.dueOnOrBefore) {
    where.push(lte(schema.workItems.dueOn, filter.dueOnOrBefore));
  }
  const rows = await tx
    .select({
      id: schema.workItems.id,
      listId: schema.workItems.listId,
      title: schema.workItems.title,
      description: schema.workItems.description,
      state: schema.workItems.state,
      status: schema.workItems.status,
      dueOn: schema.workItems.dueOn,
      startsOn: schema.workItems.startsOn,
      assigneeClerkUserId: schema.workItems.assigneeClerkUserId,
      parentId: schema.workItems.parentId,
      kind: schema.workItems.kind,
      closedAt: schema.workItems.closedAt,
    })
    .from(schema.workItems)
    .where(and(...where))
    .orderBy(asc(schema.workItems.dueOn), asc(schema.workItems.createdAt));
  return rows as WorkItemRow[];
}
