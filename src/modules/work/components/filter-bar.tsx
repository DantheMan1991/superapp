"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Columns3, List, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WORK_STATES, type WorkState } from "@/lib/work/vocabulary";
import { coreStateLabel } from "../core/state";
import type { ListOption, MemberOption } from "../core/row";
import {
  DEFAULT_VIEW,
  isFiltered,
  workViewHref,
  workViewToQuery,
  type WorkView,
} from "../core/view-params";
import { SavedViews, type SavedViewOption } from "./saved-views";

/**
 * The filters, and the choice of how to draw the results.
 *
 * EVERY CONTROL HERE WRITES THE URL AND NOTHING ELSE. There is no filter state
 * in this component beyond the search box's in-progress text — a view is a
 * parameter set, so the URL is the only place it can live if a view is going to
 * be linkable, refreshable and (slice 3) saveable. A `useState` for "current
 * filters" would be a second copy of the truth.
 */

const ANY_LIST = "__any__";
const ANY_STATE = "__any__";

export function FilterBar({
  view,
  lists,
  members,
  currentUserId,
  savedViews,
}: {
  view: WorkView;
  lists: ListOption[];
  members: MemberOption[];
  currentUserId: string;
  savedViews: SavedViewOption[];
}) {
  const router = useRouter();
  const [q, setQ] = useState(view.q);

  function apply(patch: Partial<WorkView>) {
    router.push(workViewHref({ ...view, ...patch }));
  }

  const assigneeValue =
    view.assignee === "anyone" || view.assignee === "nobody"
      ? view.assignee
      : view.assignee === "me"
        ? currentUserId
        : view.assignee.userId;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button
            variant={view.display === "list" ? "secondary" : "ghost"}
            size="sm"
            className="h-7"
            onClick={() => apply({ display: "list" })}
            aria-pressed={view.display === "list"}
          >
            <List className="mr-1 h-4 w-4" />
            List
          </Button>
          <Button
            variant={view.display === "board" ? "secondary" : "ghost"}
            size="sm"
            className="h-7"
            onClick={() => apply({ display: "board" })}
            aria-pressed={view.display === "board"}
          >
            <Columns3 className="mr-1 h-4 w-4" />
            Board
          </Button>
        </div>

        <Select
          value={assigneeValue}
          onValueChange={(value) =>
            apply({
              assignee:
                value === "anyone" || value === "nobody"
                  ? value
                  : value === currentUserId
                    ? "me"
                    : { userId: value },
            })
          }
        >
          <SelectTrigger className="h-8 w-[170px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={currentUserId}>My work</SelectItem>
            <SelectItem value="anyone">Anyone</SelectItem>
            {/*
              Offered to everybody, not just owners — which reverses slice 1.
              The digest PUSHES unassigned work to owners because nobody asked
              for it; a filter PULLS, and a staff member who picks "Nobody" is
              asking to see what is going spare. Different direction, different
              answer.
            */}
            <SelectItem value="nobody">Nobody</SelectItem>
            {members
              .filter((member) => member.clerkUserId !== currentUserId)
              .map((member) => (
                <SelectItem key={member.clerkUserId} value={member.clerkUserId}>
                  {member.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        <Select
          value={view.listId ?? ANY_LIST}
          onValueChange={(value) =>
            apply({ listId: value === ANY_LIST ? null : value })
          }
        >
          <SelectTrigger className="h-8 w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_LIST}>Every list</SelectItem>
            {lists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/*
          A single state, not a multi-select. The URL holds an array because a
          saved view may want one (slice 3), but a five-way multi-select is a
          lot of chrome for a question the board already answers by drawing
          every column.
        */}
        {view.display === "list" && (
          <Select
            value={view.states[0] ?? ANY_STATE}
            onValueChange={(value) =>
              apply({
                states: value === ANY_STATE ? [] : [value as WorkState],
              })
            }
          >
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_STATE}>Any state</SelectItem>
              {WORK_STATES.map((state) => (
                <SelectItem key={state} value={state}>
                  {coreStateLabel(state)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            apply({ q: q.trim() });
          }}
        >
          <Input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="Search work…"
            className="h-8 w-[10rem]"
            aria-label="Search work"
          />
          <Button type="submit" variant="ghost" size="icon" className="h-8 w-8">
            <Search className="h-4 w-4" />
            <span className="sr-only">Search</span>
          </Button>
        </form>

        <div className="ml-auto flex items-center gap-2">
          <SavedViews views={savedViews} currentParams={workViewToQuery(view)} />
          {view.display === "list" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => apply({ openOnly: !view.openOnly })}
            >
              {view.openOnly ? "Show finished" : "Hide finished"}
            </Button>
          )}
          {isFiltered(view) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                router.push(
                  workViewHref({ ...DEFAULT_VIEW, display: view.display }),
                );
              }}
            >
              <X className="mr-1 h-4 w-4" />
              Clear
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/m/work/lists">Lists</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
