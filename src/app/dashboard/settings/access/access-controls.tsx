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
import { ToolAreaField, type ToolChoice } from "@/components/app/tool-area-field";
import {
  createAccessLevelAction,
  deleteAccessLevelAction,
  updateAccessLevelAction,
} from "./actions";

/**
 * THE SCREEN TICKS WHAT SOMEBODY **CAN** REACH. THE DATABASE STORES WHAT THEY
 * CANNOT (ADR 0093, extended to areas by ADR 0095).
 *
 * The inversion is deliberate and it happens in exactly one place, here.
 *
 * - **Ticked is allowed**, because that is the sentence an owner is thinking:
 *   *"Field crew gets Jobs, Time and Documents."* A screen that asked them to
 *   tick the things somebody may NOT do reads backwards and is mis-set on the
 *   first try.
 * - **Stored is denied**, because a tool or a part built next year must be
 *   reachable by everybody rather than silently missing for every level in
 *   every workspace. The reasoning is in `src/lib/access/can.ts`.
 *
 * So `denied = every key on offer today, minus what is ticked`, where a key is
 * a tool slug or `tool:area`. A tool this business has switched OFF is in
 * neither list and stays reachable if it comes back — the same permissive
 * direction, and the safe one for a menu.
 */
function allKeys(tools: ToolChoice[]): string[] {
  return tools.flatMap((t) => [t.slug, ...t.areas.map((a) => `${t.slug}:${a.key}`)]);
}

function deniedFromTicked(tools: ToolChoice[], ticked: string[]): string[] {
  return allKeys(tools).filter((key) => !ticked.includes(key));
}

function tickedFromDenied(tools: ToolChoice[], denied: readonly string[]): string[] {
  // A part is allowed only while its tool is: `reaches` says so, and the screen
  // has to agree or a level reads as half-on.
  return allKeys(tools).filter((key) => {
    const tool = key.split(":")[0];
    return !denied.includes(key) && !denied.includes(tool);
  });
}

export interface AccessLevelRow {
  id: string;
  name: string;
  notes: string;
  denied: string[];
  members: number;
}

/** Make a level. */
export function AccessLevelForm({ tools }: { tools: ToolChoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Everything ticked to start: a new level takes nothing away until its
  // author says so, which matches what the stored empty list means.
  const [ticked, setTicked] = useState<string[]>(allKeys(tools));
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
      setTicked(allKeys(tools));
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
      <DialogContent className="sm:max-w-lg">
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
            <ToolAreaField id="access-tools" tools={tools} picked={ticked} onPicked={setTicked} />
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
  tools: ToolChoice[];
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
          <DialogContent className="sm:max-w-lg">
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
                <ToolAreaField
                  id={`tools-${level.id}`}
                  tools={tools}
                  picked={ticked}
                  onPicked={setTicked}
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
