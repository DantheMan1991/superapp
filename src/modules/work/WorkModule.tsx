import type { TenantContext } from "@/lib/auth";
import { listAssignableMembers, memberLabel } from "@/lib/team";
import { todayInTimezone } from "@/lib/timezone";
import { withWork } from "@/lib/work/with-work";
import type { WorkState } from "@/lib/work/vocabulary";
import { getWorkItem, listWorkItems, listWorkLists } from "./read";
import { resolveLinks } from "./link-ops";
import { listSavedViews } from "./saved-view-ops";
import { groupByUrgency, isDeferred } from "./core/grouping";
import type { WorkRowView } from "./core/row";
import {
  parseWorkView,
  resolveAssignee,
  workViewHref,
  workViewToQuery,
} from "./core/view-params";
import { AddWork } from "./components/add-work";
import { FilterBar } from "./components/filter-bar";
import { ItemSheet, type SheetItem, type SheetLink } from "./components/item-sheet";
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

  /*
   * `?item=` is NOT part of the view, deliberately. It says which sheet is
   * open, which is not a filter and must not end up inside a saved view — a
   * view called "Overdue on site" that also reopens one particular item every
   * time it is used would be carrying somebody's accident forever.
   */
  const rawItem = searchParams["item"];
  const openItemId = (Array.isArray(rawItem) ? rawItem[0] : rawItem) ?? null;

  const { lists, items, members, savedViews, openItem, openLinks } =
    await withWork(workCtx, async (tx) => {
      const openItem = openItemId
        ? await getWorkItem(tx, ctx.tenant.id, openItemId)
        : null;
      return {
        lists: await listWorkLists(tx, ctx.tenant.id),
        items: await listWorkItems(tx, ctx.tenant.id, {
          listId: view.listId ?? undefined,
          assignee: resolveAssignee(view.assignee, ctx.userId),
          openOnly: view.openOnly,
          states: view.states,
          q: view.q || undefined,
        }),
        members: await listAssignableMembers(tx, ctx.tenant.id),
        savedViews: await listSavedViews(tx, workCtx),
        openItem,
        openLinks: openItem
          ? await resolveLinks(tx, workCtx, [openItem.id])
          : [],
      };
    });

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
  const viewQuery = workViewToQuery(view);

  const sheetItem: SheetItem | null = openItem
    ? {
        id: openItem.id,
        title: openItem.title,
        description: openItem.description,
        state: openItem.state as WorkState,
        status: openItem.status,
        dueOn: openItem.dueOn,
        startsOn: openItem.startsOn,
        listId: openItem.listId,
        listName: listById.get(openItem.listId)?.name ?? "",
        listColor: listById.get(openItem.listId)?.color ?? "",
        assignee: openItem.assigneeClerkUserId,
        assigneeLabel: openItem.assigneeClerkUserId
          ? (labelByUser.get(openItem.assigneeClerkUserId) ??
            "Someone who has left")
          : null,
        hasParent: openItem.parentId !== null,
      }
    : null;

  const sheetLinks: SheetLink[] = openLinks.map((link) => ({
    linkId: link.linkId,
    entityType: link.entityType,
    label: link.entity?.label ?? null,
    sublabel: link.entity?.sublabel,
    href: link.entity?.href,
  }));

  return (
    <div className="space-y-4">
      <FilterBar
        view={view}
        lists={listOptions}
        members={memberOptions}
        currentUserId={ctx.userId}
        savedViews={savedViews.map((saved) => ({
          id: saved.id,
          name: saved.name,
          params: saved.params,
          scope: saved.scope,
          mine: saved.mine,
        }))}
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
          viewQuery={viewQuery}
        />
      ) : (
        <WorkList
          groups={groupByUrgency(rows, today)}
          today={today}
          members={memberOptions}
          showListName={showListName}
          viewQuery={viewQuery}
          emptyMessage={
            view.assignee === "me"
              ? "Nothing is on you right now."
              : view.assignee === "nobody"
                ? "Everything has somebody on it."
                : "No work matches this view."
          }
        />
      )}
      <ItemSheet
        item={sheetItem}
        links={sheetLinks}
        members={memberOptions}
        backHref={workViewHref(view)}
      />
    </div>
  );
}
