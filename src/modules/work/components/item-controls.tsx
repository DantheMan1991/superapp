"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WORK_STATES, type WorkState } from "@/lib/work/vocabulary";
import { describeWorkState, isClosedState } from "../core/state";
import type { MemberOption, WorkRowView } from "../core/row";
import { setAssigneeAction, setItemStateAction } from "../actions";

/**
 * The controls a row carries, shared by BOTH drawings.
 *
 * The list and the board are two ways of arranging the same rows, so the things
 * you can do TO a row have to behave identically in each. Writing them once is
 * what makes that true rather than aspirational — two copies would drift the
 * first time one of them learned about a new state.
 */

/** The sentinel a Select uses for "nobody" — Radix cannot hold an empty value. */
export const NOBODY = "__nobody__";

type ActionResult = { ok: true } | { error: string };

/**
 * Run a server action, report a failure, refresh on success.
 *
 * `router.refresh()` rather than local state: the row's new position depends on
 * filters the server applied, so a component that patched itself would show a
 * row in a view it no longer belongs to until something else re-rendered.
 */
export function useWorkAction(): {
  pending: boolean;
  run: (action: () => Promise<ActionResult>) => void;
} {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return {
    pending,
    run: (action) =>
      startTransition(async () => {
        const result = await action();
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        router.refresh();
      }),
  };
}

/** One tap: done, or back to open. The big target, for a phone. */
export function CloseToggle({
  row,
  pending,
  run,
}: {
  row: WorkRowView;
  pending: boolean;
  run: (action: () => Promise<ActionResult>) => void;
}) {
  const closed = isClosedState(row.state);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 shrink-0"
      disabled={pending}
      aria-label={closed ? `Reopen ${row.title}` : `Mark ${row.title} done`}
      onClick={() =>
        run(() =>
          setItemStateAction({
            itemId: row.id,
            state: closed ? "todo" : "done",
          }),
        )
      }
    >
      {closed ? (
        <RotateCcw className="h-4 w-4" />
      ) : (
        <Check className="h-4 w-4" />
      )}
    </Button>
  );
}

/**
 * The state control, which is also how work moves between board columns.
 *
 * A MENU, NOT DRAG AND DROP. conventions §8: a real share of usage is
 * one-handed, in the field, on a phone, and dragging a card between columns
 * that do not fit the screen is the one board interaction with no good touch
 * story. CRM's deal board made the same call. A menu also names every
 * destination, which a drag target never does.
 */
export function StateControl({
  row,
  pending,
  run,
  className,
  canWrite = true,
}: {
  row: WorkRowView;
  pending: boolean;
  run: (action: () => Promise<ActionResult>) => void;
  className?: string;
  /**
   * False renders the value as text rather than a disabled select. A greyed
   * dropdown reads as "not right now"; this state is "not you, ever", and the
   * page says so once at the top instead.
   */
  canWrite?: boolean;
}) {
  if (!canWrite) {
    return (
      <span className="text-sm text-muted-foreground">
        {describeWorkState(row.state, row.status)}
      </span>
    );
  }
  return (
    <Select
      value={row.state}
      disabled={pending}
      onValueChange={(value) =>
        run(() =>
          setItemStateAction({ itemId: row.id, state: value as WorkState }),
        )
      }
    >
      <SelectTrigger className={className ?? "h-8 w-[140px]"}>
        <SelectValue>{describeWorkState(row.state, row.status)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {WORK_STATES.map((state) => (
          <SelectItem key={state} value={state}>
            {describeWorkState(state, "")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AssigneeControl({
  row,
  members,
  pending,
  run,
  className,
  canWrite = true,
}: {
  row: WorkRowView;
  members: MemberOption[];
  pending: boolean;
  run: (action: () => Promise<ActionResult>) => void;
  className?: string;
  /** See `StateControl`. Text, not a greyed dropdown. */
  canWrite?: boolean;
}) {
  if (!canWrite) {
    return (
      <span className="text-sm text-muted-foreground">
        {row.assigneeLabel ?? "Nobody"}
      </span>
    );
  }
  return (
    <Select
      value={row.assignee ?? NOBODY}
      disabled={pending}
      onValueChange={(value) =>
        run(() =>
          setAssigneeAction({
            itemId: row.id,
            assignee: value === NOBODY ? null : value,
          }),
        )
      }
    >
      <SelectTrigger className={className ?? "h-8 w-[160px]"}>
        <SelectValue>{row.assigneeLabel ?? "Nobody"}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>
          <span className="flex items-center gap-2">
            <X className="h-3 w-3" />
            Nobody
          </span>
        </SelectItem>
        {members.map((member) => (
          <SelectItem key={member.clerkUserId} value={member.clerkUserId}>
            {member.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
