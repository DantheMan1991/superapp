"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, RotateCcw, CalendarDays, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  setEntityWorkAssigneeAction,
  setEntityWorkDoneAction,
  setEntityWorkDueAction,
} from "@/lib/work/actions";


export interface WorkRowView {
  id: string;
  title: string;
  dueOn: string | null;
  assigneeClerkUserId: string | null;
  completedAt: Date | string | null;
  /**
   * Optimistic concurrency. Pass what was rendered and a concurrent edit is
   * refused rather than silently overwritten — the property follow-ups have
   * carried since CRM slice 1, kept here so a shared verb does not quietly
   * lose it.
   */
  version?: number;
}

/**
 * One piece of work, with the verbs that stop it being a stub.
 *
 * THE ATOM, NOT A CONTAINER. CRM renders these inside its own timeline, which
 * interleaves notes and follow-ups and is better for CRM than a generic panel
 * would be; the assets pack renders them in a plain list. What is shared is the
 * VERBS — done, reopen, reassign, re-due — so the same work behaves the same
 * way wherever somebody meets it.
 *
 * Sharing the verbs rather than the layout is the whole point. Before this,
 * every consumer wrapped its own subset of actions: CRM wrapped two, and a
 * follow-up on a record read as something you had to leave CRM to work on. A
 * shared container would have fixed that by making every surface look the same,
 * which is a different and worse trade.
 *
 * Every action refreshes the route the caller names. This component does not
 * know where it is.
 */
export function WorkItemRow({
  item,
  members = [],
  revalidate,
  className,
}: {
  item: WorkRowView;
  /** Who can be given work. From the server, in the caller's own tenant. */
  members?: Array<{ clerkUserId: string; label: string }>;
  revalidate?: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingDue, setEditingDue] = useState(false);
  const done = item.completedAt !== null;

  function run(fn: () => Promise<{ error?: string } | { ok: boolean }>, ok: string) {
    startTransition(async () => {
      const result = await fn();
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(ok);
      setEditingDue(false);
      router.refresh();
    });
  }

  const assigneeLabel =
    members.find((m) => m.clerkUserId === item.assigneeClerkUserId)?.label ??
    (item.assigneeClerkUserId ? "Someone" : "Nobody yet");

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              setEntityWorkDoneAction({
                itemId: item.id,
                done: !done,
                expectedVersion: item.version,
                revalidate,
              }),
            done ? "Reopened" : "Done",
          )
        }
        aria-label={done ? `Reopen ${item.title}` : `Mark ${item.title} done`}
      >
        {done ? (
          <RotateCcw className="mr-1.5 size-3.5" />
        ) : (
          <Check className="mr-1.5 size-3.5" />
        )}
        {done ? "Reopen" : "Done"}
      </Button>

      {!done && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={pending}>
                <UserRound className="mr-1.5 size-3.5" />
                {assigneeLabel}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() =>
                  run(
                    () =>
                      setEntityWorkAssigneeAction({
                        itemId: item.id,
                        assignee: null,
                        revalidate,
                      }),
                    "Unassigned",
                  )
                }
              >
                Nobody yet
              </DropdownMenuItem>
              {members.map((m) => (
                <DropdownMenuItem
                  key={m.clerkUserId}
                  onSelect={() =>
                    run(
                      () =>
                        setEntityWorkAssigneeAction({
                          itemId: item.id,
                          assignee: m.clerkUserId,
                          revalidate,
                        }),
                      `Given to ${m.label}`,
                    )
                  }
                >
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {editingDue ? (
            <Input
              type="date"
              className="h-8 w-40"
              defaultValue={item.dueOn ?? ""}
              autoFocus
              disabled={pending}
              onBlur={() => setEditingDue(false)}
              onChange={(e) =>
                run(
                  () =>
                    setEntityWorkDueAction({
                      itemId: item.id,
                      expectedVersion: item.version,
                      // Clearing the field is meaningful: it moves the item to
                      // "someday" rather than leaving it overdue forever.
                      dueOn: e.target.value || null,
                      revalidate,
                    }),
                  e.target.value ? "Date set" : "Date cleared",
                )
              }
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setEditingDue(true)}
            >
              <CalendarDays className="mr-1.5 size-3.5" />
              {item.dueOn ?? "No date"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
