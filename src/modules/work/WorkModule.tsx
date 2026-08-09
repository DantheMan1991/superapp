import type { TenantContext } from "@/lib/auth";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { todayInTimezone } from "@/lib/timezone";
import { withWork } from "@/lib/work/with-work";
import type { WorkState } from "@/lib/work/vocabulary";
import { listWorkItems, listWorkLists } from "./read";
import { groupByUrgency, isDeferred } from "./core/grouping";
import type { WorkRowView } from "./core/row";
import { parseWorkView, resolveAssignee } from "./core/view-params";
import { AddWork } from "./components/add-work";
import { FilterBar } from "./components/filter-bar";
import { WorkBoard } from "./components/work-board";
import { WorkList } from "./components/work-list";

/**
 * The module's home: one query, drawn two ways.
 *
 * THE VIEW IS THE URL. `parseWorkView` turns the query string into a filter set
 * and a choice of drawing; `listWorkItems` answers it; the list and the board
 * render the same rows. There is deliberately no second query builder and no
 * per-view fetch — if a future view needs one, `core/view-params.ts` was the
 * wrong shape and that is the thing to fix.
 *
 * With no parameters at all this is "what is on me, still open, as a list",
 * because the most common view should not need a query string to reach.
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
  const view = parseWorkView(searchParams);

  const { lists, items, members } = await withWork(workCtx, async (tx) => ({
    lists: await listWorkLists(tx, ctx.tenant.id),
    items: await listWorkItems(tx, ctx.tenant.id, {
      listId: view.listId ?? undefined,
      assignee: resolveAssignee(view.assignee, ctx.userId),
      openOnly: view.openOnly,
      states: view.states,
      q: view.q || undefined,
    }),
    members: await listAssignableMembers(tx, ctx.tenant.id),
  }));

  const listById = new Map(lists.map((list) => [list.id, list]));
  const labelByUser = new Map(
    members.map((member) => [member.clerkUserId, memberLabel(member)]),
  );

  const rows: WorkRowView[] = items
    // Deferred work is held back only on a per-person view. A list or a board
    // is a place you go to see everything, so hiding rows there would be the
    // page disagreeing with its own heading.
    .filter((item) =>
      view.assignee === "me" ? !isDeferred(item.startsOn, today) : true,
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
        ? (labelByUser.get(item.assigneeClerkUserId) ??
          "Someone who has left")
        : null,
      hasParent: item.parentId !== null,
    }));

  const listOptions = lists.map((list) => ({
    id: list.id,
    name: list.name,
    color: list.color,
  }));
  const memberOptions = members.map((member) => ({
    clerkUserId: member.clerkUserId,
    label: memberLabel(member),
  }));
  const showListName = view.listId === null;

  return (
    <div className="space-y-4">
      <FilterBar
        view={view}
        lists={listOptions}
        members={memberOptions}
        currentUserId={ctx.userId}
      />
      <AddWork
        lists={listOptions}
        defaultListId={
          view.listId ??
          lists.find((list) => list.isDefault)?.id ??
          lists[0]?.id ??
          null
        }
        assignToSelf={view.assignee === "me"}
        currentUserId={ctx.userId}
      />
      {view.display === "board" ? (
        <WorkBoard
          rows={rows}
          today={today}
          members={memberOptions}
          showListName={showListName}
        />
      ) : (
        <WorkList
          groups={groupByUrgency(rows, today)}
          today={today}
          members={memberOptions}
          showListName={showListName}
          emptyMessage={
            view.assignee === "me"
              ? "Nothing is on you right now."
              : view.assignee === "nobody"
                ? "Everything has somebody on it."
                : "No work matches this view."
          }
        />
      )}
    </div>
  );
}
