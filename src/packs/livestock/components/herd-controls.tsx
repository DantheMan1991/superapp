"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addLotToGroupAction,
  createGroupAction,
  moveGroupToZoneAction,
  removeLotFromGroupAction,
  updateGroupAction,
} from "../actions";

const NONE = "__none__";

/** A lot as a picker needs it — code, what it is, and how many head. */
export interface HerdCandidate {
  id: string;
  code: string;
  species: string;
  head: number;
  /** The herd it is in now, so the picker can say what it would leave. */
  currentHerd: string | null;
}

/**
 * Start a herd. **The word is the tenant's** — a cattle operation says herd, a
 * flock keeper says flock — so every string here takes it as a prop rather than
 * saying "group" at somebody who has never called it that.
 */
export function HerdForm({ word }: { word: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const lower = word.toLowerCase();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await createGroupAction({
        name: String(formData.get("name") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${word} started`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Start a {lower}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Start a {lower}</DialogTitle>
            <DialogDescription>
              A set of animals you manage together. It can hold named animals and
              a pen counted by the head at the same time, and moving it moves all
              of them.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="herd-name">Name</Label>
              <Input
                id="herd-name"
                name="name"
                required
                maxLength={120}
                autoFocus
                placeholder="e.g. Cows, Replacements, Weaners"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="herd-notes">Notes</Label>
              <Textarea id="herd-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : `Start ${lower}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * **MOVE THE WHOLE HERD.** One act for every animal in it, which is the thing a
 * herd is for — ten cows used to be ten trips through the move dialog.
 */
export function MoveHerdForm({
  groupId,
  word,
  head,
  zones,
  structures,
  structureWord,
  today,
}: {
  groupId: string;
  word: string;
  head: number;
  zones: { id: string; name: string; parcelName: string }[];
  structures: { id: string; name: string }[];
  structureWord: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [zoneId, setZoneId] = useState("");
  const [structureId, setStructureId] = useState(NONE);
  const lower = word.toLowerCase();

  function submit(formData: FormData) {
    if (!zoneId) return;
    startTransition(async () => {
      const result = await moveGroupToZoneAction({
        groupId,
        zoneId,
        startedOn: String(formData.get("startedOn") ?? today),
        structureAssetId: structureId === NONE ? null : structureId,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // What could NOT be moved is said out loud. A herd where three of ten
      // refused must not report as a plain success.
      if (result.refused > 0) {
        toast.warning(
          `Moved ${result.moved} · ${result.refused} could not be moved`,
        );
      } else {
        toast.success(
          result.moved === 1 ? "1 moved" : `${result.moved} moved`,
        );
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Move the {lower}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Move the whole {lower}</DialogTitle>
            <DialogDescription>
              Every animal in it, in one go — {head} head. Whatever they were on
              stops the day before, so the paddock they leave starts resting.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="herd-zone">Onto</Label>
              <Select value={zoneId} onValueChange={setZoneId}>
                <SelectTrigger id="herd-zone">
                  <SelectValue placeholder="Pick where" />
                </SelectTrigger>
                <SelectContent>
                  {zones.map((z) => (
                    <SelectItem key={z.id} value={z.id}>
                      {z.name}
                      {z.parcelName ? ` · ${z.parcelName}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {structures.length > 0 && (
              <div className="grid gap-2">
                <Label htmlFor="herd-structure">{structureWord}</Label>
                <Select value={structureId} onValueChange={setStructureId}>
                  <SelectTrigger id="herd-structure">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Loose on the paddock</SelectItem>
                    {structures.map((sct) => (
                      <SelectItem key={sct.id} value={sct.id}>
                        {sct.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="herd-when">When</Label>
              <Input
                id="herd-when"
                name="startedOn"
                type="date"
                defaultValue={today}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !zoneId}>
              {pending ? "Moving…" : `Move ${head} head`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Put animals into a herd.
 *
 * **A candidate already in another herd is offered, and says which** — because
 * moving between herds is the ordinary case and hiding it would leave somebody
 * hunting for a cow the picker had quietly dropped. Choosing it closes the old
 * membership in the same transaction.
 */
export function AddToHerdForm({
  groupId,
  word,
  candidates,
  today,
}: {
  groupId: string;
  word: string;
  candidates: HerdCandidate[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string[]>([]);
  const lower = word.toLowerCase();

  function toggle(id: string) {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  }

  function submit(formData: FormData) {
    if (picked.length === 0) return;
    startTransition(async () => {
      const result = await addLotToGroupAction({
        groupId,
        livestockLotIds: picked,
        startedOn: String(formData.get("startedOn") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.count === 1 ? `Added to the ${lower}` : `${result.count} added`,
      );
      setPicked([]);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Add animals</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add animals to this {lower}</DialogTitle>
            <DialogDescription>
              Named animals and whole pens both. Anything already in another{" "}
              {lower} moves across.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="max-h-72 overflow-y-auto rounded-lg border">
              {candidates.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Nothing to add — every animal is already in this {lower}.
                </p>
              ) : (
                <ul className="divide-y">
                  {candidates.map((c) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-center gap-3 p-3 text-sm hover:bg-muted/50">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={picked.includes(c.id)}
                          onChange={() => toggle(c.id)}
                        />
                        <span className="flex-1 font-medium">{c.code}</span>
                        <span className="text-muted-foreground">
                          {c.head === 1 ? "1 head" : `${c.head} head`}
                          {c.currentHerd ? ` · in ${c.currentHerd}` : ""}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="add-when">From</Label>
              <Input
                id="add-when"
                name="startedOn"
                type="date"
                defaultValue={today}
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || picked.length === 0}>
              {pending
                ? "Adding…"
                : picked.length > 0
                  ? `Add ${picked.length}`
                  : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Take one animal out, leaving it in no herd. The animal is untouched. */
export function RemoveFromHerdButton({
  livestockLotId,
  code,
  word,
  today,
}: {
  livestockLotId: string;
  code: string;
  word: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const lower = word.toLowerCase();

  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      title={`Take ${code} out of this ${lower}`}
      onClick={() =>
        startTransition(async () => {
          const result = await removeLotFromGroupAction({
            livestockLotId,
            endedOn: today,
          });
          if ("error" in result) {
            toast.error(result.error);
            return;
          }
          toast.success(`${code} is in no ${lower} now`);
          router.refresh();
        })
      }
    >
      Take out
    </Button>
  );
}

/** Rename or close a herd. Closed keeps reporting; it stops being offered. */
export function EditHerdForm({
  groupId,
  word,
  name,
  notes,
  status,
}: {
  groupId: string;
  word: string;
  name: string;
  notes: string;
  status: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const lower = word.toLowerCase();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await updateGroupAction({
        id: groupId,
        name: String(formData.get("name") ?? ""),
        notes: String(formData.get("notes") ?? ""),
        status: String(formData.get("status") ?? status),
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Edit this {lower}</DialogTitle>
            <DialogDescription>
              Closing it keeps every record it holds and stops it being offered
              when animals are moved.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-herd-name">Name</Label>
              <Input
                id="edit-herd-name"
                name="name"
                required
                maxLength={120}
                defaultValue={name}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-herd-status">Status</Label>
              <Select name="status" defaultValue={status}>
                <SelectTrigger id="edit-herd-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-herd-notes">Notes</Label>
              <Textarea
                id="edit-herd-notes"
                name="notes"
                rows={2}
                maxLength={5000}
                defaultValue={notes}
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
  );
}
