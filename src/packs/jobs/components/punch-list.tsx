"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { addPunchItemAction, setPunchDoneAction } from "../actions";

export interface PunchRow {
  id: string;
  title: string;
  notes: string;
  dueOn: string | null;
  done: boolean;
}

/**
 * The punch list: what still needs fixing on this job.
 *
 * **THESE ARE WORK ITEMS**, linked to the project — the same rows the Work
 * module lists, assigns and chases in its digest. This panel is a view of
 * them from the job's side, with the one thing a superintendent does on a
 * walk-through: add an item, tick an item. Everything else — who it is on,
 * a note, a due date changed — is the Work module's screen.
 */
export function PunchList({
  projectId,
  items,
  canEdit,
}: {
  projectId: string;
  items: PunchRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [dueOn, setDueOn] = useState("");
  const open = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  function add() {
    if (title.trim() === "") return;
    startTransition(async () => {
      const result = await addPunchItemAction({ projectId, title: title.trim(), dueOn });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setTitle("");
      setDueOn("");
      router.refresh();
    });
  }

  function toggle(item: PunchRow, next: boolean) {
    startTransition(async () => {
      const result = await setPunchDoneAction({ projectId, itemId: item.id, done: next });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {open.length === 0 && done.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing on the list. Items added here are work items linked to this
          job — they show up in Work beside everything else that needs doing.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {[...open, ...done].map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-2">
              <Checkbox
                id={`punch-${item.id}`}
                checked={item.done}
                disabled={!canEdit || pending}
                onCheckedChange={(v) => toggle(item, v === true)}
                className="mt-0.5"
              />
              <label htmlFor={`punch-${item.id}`} className="flex-1 text-sm">
                <span className={item.done ? "text-muted-foreground line-through" : ""}>
                  {item.title}
                </span>
                {(item.dueOn || item.notes) && (
                  <span className="block text-xs text-muted-foreground">
                    {[item.dueOn ? `due ${item.dueOn}` : null, item.notes || null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </label>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[14rem] flex-1">
            <Input
              aria-label="New punch item"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") add();
              }}
              placeholder="Touch up paint in the master bath"
              maxLength={300}
            />
          </div>
          <Input
            aria-label="Due"
            type="date"
            value={dueOn}
            onChange={(e) => setDueOn(e.target.value)}
            className="w-40"
          />
          <Button size="sm" onClick={add} disabled={pending || title.trim() === ""}>
            <Plus className="mr-1.5 size-4" /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
