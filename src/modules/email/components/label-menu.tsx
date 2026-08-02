"use client";

import { useState } from "react";
import { Check, Minus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JmapMailbox } from "@/lib/email/jmap/types";
import { labelableFolders, labelStateAcross } from "../organise/labels";

/**
 * Apply and remove labels across a selection.
 *
 * THREE STATES PER LABEL, not two: every selected message has it, some do, or
 * none do. Collapsing "some" into either of the others is how a bulk action
 * quietly strips a label from the messages that already had it — so a partial
 * label shows a dash, and clicking it ADDS to everything rather than toggling.
 * Adding is the reading people expect and the one that never destroys anything.
 *
 * The menu closes only on Done or an outside click, not on each pick: labelling
 * is usually several at once, and a menu that shuts after every choice makes
 * five labels five round trips.
 */
export function LabelMenu({
  folders,
  selection,
  disabled,
  onApply,
}: {
  folders: JmapMailbox[];
  /** The `mailboxIds` of every selected message. */
  selection: Readonly<Record<string, boolean>>[];
  disabled?: boolean;
  onApply: (add: string[], remove: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  /** Pending changes, applied together when the menu closes. */
  const [add, setAdd] = useState<Set<string>>(new Set());
  const [remove, setRemove] = useState<Set<string>>(new Set());

  const labels = labelableFolders(folders);
  const current = labelStateAcross(selection, folders);

  function stateOf(id: string): "all" | "some" | "none" {
    if (add.has(id)) return "all";
    if (remove.has(id)) return "none";
    return current.get(id) ?? "none";
  }

  function toggle(id: string) {
    const now = stateOf(id);
    const nextAdd = new Set(add);
    const nextRemove = new Set(remove);
    nextAdd.delete(id);
    nextRemove.delete(id);
    // "some" and "none" both go to applied — see the header. Only a label every
    // message already carries can be taken away in one click.
    if (now === "all") nextRemove.add(id);
    else nextAdd.add(id);
    setAdd(nextAdd);
    setRemove(nextRemove);
  }

  function close(apply: boolean) {
    if (apply && (add.size > 0 || remove.size > 0)) {
      onApply([...add], [...remove]);
    }
    setAdd(new Set());
    setRemove(new Set());
    setOpen(false);
  }

  if (labels.length === 0) {
    // No labelable folders yet. Saying nothing is better than a button that
    // opens an empty menu — the folder rail is where one gets created.
    return null;
  }

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Tag className="size-3.5" />
        Label
      </Button>

      {open && (
        <>
          {/* Catches the outside click without stealing focus from the list. */}
          <div className="fixed inset-0 z-20" onClick={() => close(true)} />
          <div className="absolute bottom-full left-0 z-30 mb-1 max-h-72 w-60 overflow-y-auto rounded-md border bg-background p-1 shadow-md">
            {labels.map((label) => {
              const state = stateOf(label.id);
              return (
                <button
                  key={label.id}
                  type="button"
                  onClick={() => toggle(label.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-secondary"
                >
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center rounded-[3px] border"
                  >
                    {state === "all" && <Check className="size-3" />}
                    {state === "some" && <Minus className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
                </button>
              );
            })}
            <div className="mt-1 border-t pt-1">
              <button
                type="button"
                onClick={() => close(true)}
                className="w-full rounded-sm px-2 py-1 text-xs font-medium hover:bg-secondary"
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The labels on one row.
 *
 * Derived from the message's own `mailboxIds` — a label IS a mailbox, so there
 * is nothing to fetch and nothing to keep in step.
 */
export function LabelChips({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <>
      {names.map((name) => (
        <span
          key={name}
          className="max-w-[8rem] shrink-0 truncate rounded-sm bg-secondary px-1.5 py-px text-[0.65rem] text-muted-foreground"
        >
          {name}
        </span>
      ))}
    </>
  );
}
