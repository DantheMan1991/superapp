"use client";

import Link from "next/link";
import { CornerDownRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { urgencyLabel, urgencyOf, type UrgencyGroup } from "../core/grouping";
import { WORK_COLOR_CLASSES, type WorkColor } from "../core/colors";
import { isClosedState } from "../core/state";
import type { MemberOption, WorkRowView } from "../core/row";
import {
  AssigneeControl,
  CloseToggle,
  StateControl,
  useWorkAction,
} from "./item-controls";

/**
 * The list drawing: work in sections by how soon it is due.
 *
 * The default because it answers "what should I do next" — a board answers
 * "where is everything", which is a different question and a less frequent one.
 */
export function WorkList({
  groups,
  today,
  members,
  showListName,
  viewQuery,
  emptyMessage,
}: {
  groups: UrgencyGroup<WorkRowView>[];
  today: string;
  members: MemberOption[];
  showListName: boolean;
  /** The current view's query string, so opening a row keeps the view. */
  viewQuery: string;
  emptyMessage: string;
}) {
  const { pending, run } = useWorkAction();
  const total = groups.reduce((n, group) => n + group.items.length, 0);

  if (total === 0) {
    return (
      <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.urgency} className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">
            {urgencyLabel(group.urgency)}
            <span className="ml-2 tabular-nums">{group.items.length}</span>
          </h2>
          <ul className="divide-y divide-divider rounded-lg border">
            {group.items.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3"
              >
                <CloseToggle row={row} pending={pending} run={run} />
                <span className="flex min-w-[10rem] flex-1 items-center gap-2">
                  {row.hasParent && (
                    <CornerDownRight
                      className="h-3 w-3 shrink-0 text-muted-foreground"
                      aria-label="Filed under other work"
                    />
                  )}
                  <Link
                    href={itemHref(row.id, viewQuery)}
                    className={`hover:underline ${
                      isClosedState(row.state)
                        ? "text-muted-foreground line-through"
                        : ""
                    }`}
                  >
                    {row.title}
                  </Link>
                </span>
                <DueBadge dueOn={row.dueOn} today={today} />
                {showListName && row.listName && (
                  <ListBadge name={row.listName} color={row.listColor} />
                )}
                <StateControl row={row} pending={pending} run={run} />
                <AssigneeControl
                  row={row}
                  members={members}
                  pending={pending}
                  run={run}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Where clicking a row goes: the sheet, with the current view kept.
 *
 * `?item=` rides ALONGSIDE the view params rather than replacing them, so
 * closing the sheet returns to the same filtered page — and so a link somebody
 * pastes carries both what they were looking at and which item they meant.
 */
export function itemHref(itemId: string, viewQuery: string): string {
  const params = new URLSearchParams(viewQuery);
  params.set("item", itemId);
  return `/dashboard/m/work?${params.toString()}`;
}

export function ListBadge({ name, color }: { name: string; color: string }) {
  return (
    <Badge variant="outline" className="gap-1">
      <span
        className={`h-2 w-2 rounded-full ${
          WORK_COLOR_CLASSES[color as WorkColor] ?? "bg-slate-400"
        }`}
      />
      {name}
    </Badge>
  );
}

/**
 * The per-row date badge, computed HERE rather than on the server.
 *
 * crm.md's open item, fixed by construction: a page rendered at 23:58 and read
 * at 00:02 would otherwise keep calling tomorrow's work "today" until something
 * unrelated re-rendered. `today` is still the TENANT's day, passed down — the
 * browser's clock is not consulted, only its render timing.
 */
export function DueBadge({
  dueOn,
  today,
}: {
  dueOn: string | null;
  today: string;
}) {
  if (!dueOn) return null;
  const urgency = urgencyOf(dueOn, today);
  return (
    <Badge
      variant={urgency === "overdue" ? "destructive" : "secondary"}
      className="tabular-nums"
    >
      {dueOn}
    </Badge>
  );
}
