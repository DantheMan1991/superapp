"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, CornerDownRight, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import {
  urgencyLabel,
  urgencyOf,
  type UrgencyGroup,
} from "../core/grouping";
import { WORK_COLOR_CLASSES } from "../core/colors";
import { describeWorkState, isClosedState } from "../core/state";
import { createItemAction, setAssigneeAction, setItemStateAction } from "../actions";

/**
 * "My work" — the surface a person opens daily, and the one designed for a
 * phone first.
 *
 * conventions §8: a real share of usage is one-handed, in the field. So the
 * primary gesture is a single tap on a big target that closes an item, the
 * add-work row is one field with everything else optional, and nothing here
 * needs a second hand or a hover.
 */

export type WorkViewMode = "mine" | "unassigned" | "list";

export interface WorkRowView {
  id: string;
  title: string;
  state: WorkState;
  status: string;
  dueOn: string | null;
  startsOn: string | null;
  listId: string;
  listName: string;
  listColor: string;
  assignee: string | null;
  assigneeLabel: string | null;
  hasParent: boolean;
}

interface ListOption {
  id: string;
  name: string;
  color: string;
}

interface MemberOption {
  clerkUserId: string;
  label: string;
}

/** The sentinel a Select uses for "nobody" — Radix cannot hold an empty value. */
const NOBODY = "__nobody__";

export function MyWork({
  mode,
  today,
  groups,
  lists,
  members,
  selectedListId,
  defaultListId,
  showDone,
  isOwner,
  currentUserId,
}: {
  mode: WorkViewMode;
  today: string;
  groups: UrgencyGroup<WorkRowView>[];
  lists: ListOption[];
  members: MemberOption[];
  selectedListId: string | null;
  defaultListId: string | null;
  showDone: boolean;
  isOwner: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [addListId, setAddListId] = useState(defaultListId ?? "");

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  function go(next: Record<string, string | null>) {
    const params = new URLSearchParams();
    if (mode === "list" && selectedListId) params.set("list", selectedListId);
    if (mode !== "mine") params.set("view", mode);
    if (showDone) params.set("done", "1");
    for (const [key, value] of Object.entries(next)) {
      if (value === null) params.delete(key);
      else params.set(key, value);
    }
    router.push(`/dashboard/m/work?${params.toString()}`);
  }

  function run(action: () => Promise<{ ok: true } | { error: string }>) {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function add() {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (!addListId) {
      toast.error("Make a list first.");
      return;
    }
    run(async () => {
      const result = await createItemAction({
        listId: addListId,
        title: trimmed,
        dueOn: dueOn || null,
        // Adding work from "my work" assigns it to you; adding it from a list
        // leaves it unassigned, because that is the pile somebody picks from.
        assignee: mode === "mine" ? currentUserId : null,
      });
      if ("ok" in result) {
        setTitle("");
        setDueOn("");
      }
      return result;
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={mode === "mine" ? "default" : "outline"}
          size="sm"
          onClick={() => router.push("/dashboard/m/work")}
        >
          My work
        </Button>
        {isOwner && (
          <Button
            variant={mode === "unassigned" ? "default" : "outline"}
            size="sm"
            onClick={() => router.push("/dashboard/m/work?view=unassigned")}
          >
            Unassigned
          </Button>
        )}
        <Select
          value={mode === "list" ? (selectedListId ?? "") : ""}
          onValueChange={(value) =>
            router.push(`/dashboard/m/work?view=list&list=${value}`)
          }
        >
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue placeholder="A list…" />
          </SelectTrigger>
          <SelectContent>
            {lists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => go({ done: showDone ? null : "1" })}
          >
            {showDone ? "Hide finished" : "Show finished"}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/m/work/lists">Lists</Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add();
          }}
          placeholder="What needs doing?"
          className="h-9 min-w-[12rem] flex-1"
          aria-label="What needs doing?"
        />
        <Input
          type="date"
          value={dueOn}
          onChange={(event) => setDueOn(event.target.value)}
          className="h-9 w-[10rem]"
          aria-label="Due date"
        />
        <Select value={addListId} onValueChange={setAddListId}>
          <SelectTrigger className="h-9 w-[150px]">
            <SelectValue placeholder="List" />
          </SelectTrigger>
          <SelectContent>
            {lists.map((list) => (
              <SelectItem key={list.id} value={list.id}>
                {list.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={add} disabled={pending || !title.trim()}>
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </div>

      {total === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {mode === "mine"
            ? "Nothing is on you right now."
            : mode === "unassigned"
              ? "Everything has somebody on it."
              : "Nothing on this list yet."}
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.urgency} className="space-y-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              {urgencyLabel(group.urgency)}
              <span className="ml-2 tabular-nums">{group.items.length}</span>
            </h2>
            <ul className="divide-y rounded-lg border">
              {group.items.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    disabled={pending}
                    aria-label={
                      isClosedState(row.state) ? "Reopen" : "Mark done"
                    }
                    onClick={() =>
                      run(() =>
                        setItemStateAction({
                          itemId: row.id,
                          state: isClosedState(row.state) ? "todo" : "done",
                        }),
                      )
                    }
                  >
                    {isClosedState(row.state) ? (
                      <RotateCcw className="h-4 w-4" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                  </Button>

                  <span className="flex min-w-[10rem] flex-1 items-center gap-2">
                    {row.hasParent && (
                      <CornerDownRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <span
                      className={
                        isClosedState(row.state)
                          ? "text-muted-foreground line-through"
                          : ""
                      }
                    >
                      {row.title}
                    </span>
                  </span>

                  <DueBadge dueOn={row.dueOn} today={today} />

                  {row.listName && mode !== "list" && (
                    <Badge variant="outline" className="gap-1">
                      <span
                        className={`h-2 w-2 rounded-full ${
                          WORK_COLOR_CLASSES[
                            row.listColor as keyof typeof WORK_COLOR_CLASSES
                          ] ?? "bg-slate-400"
                        }`}
                      />
                      {row.listName}
                    </Badge>
                  )}

                  <Select
                    value={row.state}
                    onValueChange={(value) =>
                      run(() =>
                        setItemStateAction({
                          itemId: row.id,
                          state: value as WorkState,
                        }),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-[140px]">
                      <SelectValue>
                        {describeWorkState(row.state, row.status)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {WORK_STATES.map((state) => (
                        <SelectItem key={state} value={state}>
                          {describeWorkState(state, "")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={row.assignee ?? NOBODY}
                    onValueChange={(value) =>
                      run(() =>
                        setAssigneeAction({
                          itemId: row.id,
                          assignee: value === NOBODY ? null : value,
                        }),
                      )
                    }
                  >
                    <SelectTrigger className="h-8 w-[160px]">
                      <SelectValue>
                        {row.assigneeLabel ?? "Nobody"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NOBODY}>
                        <span className="flex items-center gap-2">
                          <X className="h-3 w-3" />
                          Nobody
                        </span>
                      </SelectItem>
                      {members.map((member) => (
                        <SelectItem
                          key={member.clerkUserId}
                          value={member.clerkUserId}
                        >
                          {member.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
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
function DueBadge({ dueOn, today }: { dueOn: string | null; today: string }) {
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
