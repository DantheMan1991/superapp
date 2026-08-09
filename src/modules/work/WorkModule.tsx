import type { TenantContext } from "@/lib/auth";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { todayInTimezone } from "@/lib/timezone";
import { withWork } from "@/lib/work/with-work";
import type { WorkState } from "@/lib/work/vocabulary";
import { listWorkItems, listWorkLists } from "./read";
import { groupByUrgency, isDeferred } from "./core/grouping";
import { MyWork, type WorkRowView, type WorkViewMode } from "./components/my-work";

/**
 * The module's home: what is on YOU.
 *
 * The per-person surface leads rather than a board, because it is the one that
 * gets opened daily and the one that proves the shape. Google Tasks' single
 * good idea, with the thing that makes it useless to a business fixed: the rows
 * are the workspace's work, assigned to a person, not a private per-account
 * list.
 *
 * URL-DRIVEN, the house pattern — `?view=mine|unassigned|list&list=<id>`. A
 * particular view is linkable, survives a refresh, and the server fetches
 * exactly what is being looked at.
 *
 * ANCHORED ON THE TENANT'S TODAY, never the server's and never the browser's,
 * so two people in one workspace agree about what is overdue.
 */
export async function WorkModule({
  ctx,
  searchParams,
}: {
  ctx: TenantContext;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const workCtx = {
    tenantId: ctx.tenant.id,
    userId: ctx.userId,
    role: ctx.role,
  };
  const today = todayInTimezone(ctx.tenant.timezone);

  const single = (key: string): string | undefined => {
    const value = searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const requested = single("view");
  // `unassigned` is an OWNER's question. Offering it to staff would show them a
  // pile they were never asked to pick up, which is the digest's reasoning
  // applied to a page.
  const mode: WorkViewMode =
    requested === "list"
      ? "list"
      : requested === "unassigned" && ctx.role === "owner"
        ? "unassigned"
        : "mine";
  const listId = single("list");
  const showDone = single("done") === "1";

  const { lists, items, members } = await withWork(workCtx, async (tx) => {
    const lists = await listWorkLists(tx, ctx.tenant.id);
    const filter =
      mode === "mine"
        ? { assignee: ctx.userId }
        : mode === "unassigned"
          ? { assignee: null }
          : { listId: listId && listId.length > 0 ? listId : undefined };
    return {
      lists,
      items: await listWorkItems(tx, ctx.tenant.id, {
        ...filter,
        openOnly: !showDone,
      }),
      members: await listAssignableMembers(tx, ctx.tenant.id),
    };
  });

  const listById = new Map(lists.map((l) => [l.id, l]));
  const labelByUser = new Map(
    members.map((m) => [m.clerkUserId, memberLabel(m)]),
  );

  const rows: WorkRowView[] = items
    // Deferred work is held back on the two per-person views only. A list is a
    // place you go to look at everything on it, so hiding rows there would be
    // the page disagreeing with its own heading.
    .filter((item) =>
      mode === "list" ? true : !isDeferred(item.startsOn, today),
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      state: item.state as WorkState,
      status: item.status,
      dueOn: item.dueOn,
      startsOn: item.startsOn,
      listId: item.listId,
      listName: listById.get(item.listId)?.name ?? "",
      listColor: listById.get(item.listId)?.color ?? "",
      assignee: item.assigneeClerkUserId,
      assigneeLabel: item.assigneeClerkUserId
        ? (labelByUser.get(item.assigneeClerkUserId) ?? "Someone who has left")
        : null,
      hasParent: item.parentId !== null,
    }));

  const groups = groupByUrgency(rows, today);
  const defaultListId =
    lists.find((l) => l.isDefault)?.id ?? lists[0]?.id ?? null;

  return (
    <MyWork
      mode={mode}
      today={today}
      groups={groups}
      lists={lists.map((l) => ({ id: l.id, name: l.name, color: l.color }))}
      members={members.map((m) => ({
        clerkUserId: m.clerkUserId,
        label: memberLabel(m),
      }))}
      selectedListId={listId ?? null}
      defaultListId={defaultListId}
      showDone={showDone}
      isOwner={ctx.role === "owner"}
      currentUserId={ctx.userId}
    />
  );
}
