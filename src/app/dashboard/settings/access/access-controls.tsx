"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/app/use-confirm";
import { PackField, type PackChoice } from "@/components/app/pack-field";
import {
  createAccessLevelAction,
  deleteAccessLevelAction,
  updateAccessLevelAction,
} from "./actions";

/**
 * THE SCREEN TICKS WHAT SOMEBODY **CAN** REACH. THE DATABASE STORES WHAT THEY
 * CANNOT (ADR 0093).
 *
 * The inversion is deliberate and it happens in exactly one place, here.
 *
 * - **Ticked is allowed**, because that is the sentence an owner is thinking:
 *   *"Field crew gets Jobs, Time and Documents."* A screen that asked them to
 *   tick the things somebody may NOT do reads backwards and is mis-set on the
 *   first try.
 * - **Stored is denied**, because a tool built next year must be reachable by
 *   everybody rather than silently missing for every level in every workspace.
 *   The reasoning is in `src/lib/access/can.ts`.
 *
 * So `denied = every tool switched on today, minus what is ticked`. A tool this
 * business has switched OFF is in neither list and stays reachable if it comes
 * back — which is the same permissive direction, and the safe one for a menu.
 */
function deniedFromTicked(tools: PackChoice[], ticked: string[]): string[] {
  return tools.map((t) => t.slug).filter((slug) => !ticked.includes(slug));
}

function tickedFromDenied(tools: PackChoice[], denied: readonly string[]): string[] {
  return tools.map((t) => t.slug).filter((slug) => !denied.includes(slug));
}

const HINT =
  "Tick what this level can open. Everything else is gone from their menu, and the page says it does not exist if they type the address. Overview, their own hours and their own phone are always there.";

export interface AccessLevelRow {
  id: string;
  name: string;
  notes: string;
  denied: string[];
  members: number;
}

/** Make a level. */
export function AccessLevelForm({ tools }: { tools: PackChoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Everything ticked to start: a new level takes nothing away until its
  // author says so, which matches what the stored empty list means.
  const [ticked, setTicked] = useState<string[]>(tools.map((t) => t.slug));
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createAccessLevelAction({
        name: String(formData.get("name") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        denied: deniedFromTicked(tools, ticked),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Added");
      setOpen(false);
      setTicked(tools.map((t) => t.slug));
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add a level
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add a level</DialogTitle>
            <DialogDescription>
              A job, with the tools that job does not need switched off. You give
              it to people on the Team page.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="access-name">Name</Label>
              <Input
                id="access-name"
                name="name"
                required
                maxLength={60}
                autoFocus
                placeholder="Field crew"
              />
            </div>
            <PackField
              id="access-tools"
              label="What they can open"
              choices={tools}
              picked={ticked}
              onPicked={setTicked}
              hint={HINT}
            />
            <div className="grid gap-2">
              <Label htmlFor="access-notes">Notes</Label>
              <Textarea id="access-notes" name="notes" rows={2} maxLength={2000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit one, and delete it.
 *
 * **DELETING IS OUTSIDE THE DIALOG**, the arrangement the division controls use
 * and for the same reason: a confirm opened from inside an open dialog is two
 * Radix modals deep, and `useConfirm` has to be awaited before any transition
 * starts.
 */
export function AccessLevelControls({
  level,
  tools,
}: {
  level: AccessLevelRow;
  tools: PackChoice[];
}) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<string[]>(tickedFromDenied(tools, level.denied));
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await updateAccessLevelAction({
        id: level.id,
        name: String(formData.get("name") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        denied: deniedFromTicked(tools, ticked),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Saved");
      setOpen(false);
      router.refresh();
    });
  }

  async function remove() {
    // Asked BEFORE the transition starts — see `useConfirm`.
    const asked = await confirm({
      title: `Delete ${level.name}?`,
      description:
        level.members > 0
          ? `${level.members} ${level.members === 1 ? "person is" : "people are"} on this level. Move them to another one first — this will be refused.`
          : "Nobody is on this level, so nothing changes for anyone.",
      confirmLabel: "Delete it",
    });
    if (!asked) return;
    startTransition(async () => {
      const result = await deleteAccessLevelAction({ id: level.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted");
      router.refresh();
    });
  }

  return (
    <>
      {confirmDialog}
      <div className="flex items-center justify-end gap-1">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <Pencil className="mr-1 h-3.5 w-3.5" />
              Edit
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <form action={submit}>
              <DialogHeader>
                <DialogTitle>Edit {level.name}</DialogTitle>
                <DialogDescription>
                  {level.members === 0
                    ? "Nobody is on this level yet."
                    : `${level.members} ${level.members === 1 ? "person is" : "people are"} on this level. Changes reach them on their next page load.`}
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor={`name-${level.id}`}>Name</Label>
                  <Input
                    id={`name-${level.id}`}
                    name="name"
                    required
                    maxLength={60}
                    defaultValue={level.name}
                  />
                </div>
                <PackField
                  id={`tools-${level.id}`}
                  label="What they can open"
                  choices={tools}
                  picked={ticked}
                  onPicked={setTicked}
                  hint={HINT}
                />
                <div className="grid gap-2">
                  <Label htmlFor={`notes-${level.id}`}>Notes</Label>
                  <Textarea
                    id={`notes-${level.id}`}
                    name="notes"
                    rows={2}
                    maxLength={2000}
                    defaultValue={level.notes}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Button variant="ghost" size="sm" onClick={remove} disabled={pending}>
          Delete
        </Button>
      </div>
    </>
  );
}
