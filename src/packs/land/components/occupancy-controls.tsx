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
  deleteOccupancyAction,
  endOccupancyAction,
  startOccupancyAction,
} from "../actions";
import { AREA_UNIT_LABELS, toAcres, type AreaUnit } from "../core/area";

/**
 * Recording what is on a zone, and moving it off again.
 *
 * THIS EXISTS BEFORE `livestock` DOES, on purpose. The occupancy record is what
 * every rest and rotation number is computed from, and a rest clock that only
 * starts working after two more packs ship is a rest clock nobody ever sees.
 * So the occupant is a name typed by a person today, and the same table takes a
 * real lot reference later without changing shape.
 *
 * MOVING OFF IS ONE BUTTON, not an edit buried in a form. Closing a stay is
 * what starts the rest clock — it is the single most consequential act in the
 * pack and the one that has to survive being done from a tractor.
 */

export interface OccupancyRow {
  id: string;
  occupantLabel: string;
  startedOn: string;
  endedOn: string | null;
  /** Already converted into the tenant's unit, or null for the whole zone. */
  areaLabel: string | null;
  notes: string;
  /** How long the stay ran. Null while it is still open. */
  daysLabel: string | null;
}

export function RecordOccupancy({
  zoneId,
  zoneWord,
  unit,
  today,
  occupied,
}: {
  zoneId: string;
  zoneWord: string;
  unit: AreaUnit;
  /** The TENANT's today, never the browser's. */
  today: string;
  /** Something is already here. The form still opens — for a past stay. */
  occupied: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const rawArea = String(formData.get("area") ?? "").trim();
    const endedOn = String(formData.get("endedOn") ?? "").trim();

    startTransition(async () => {
      const result = await startOccupancyAction({
        zoneId,
        occupantLabel: String(formData.get("occupantLabel") ?? ""),
        startedOn: String(formData.get("startedOn") ?? today),
        endedOn: endedOn || null,
        areaAcres: rawArea ? toAcres(Number(rawArea), unit) : null,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Recorded");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Record a stay</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>What is on this {zoneWord.toLowerCase()}?</DialogTitle>
            <DialogDescription>
              {occupied
                ? "Something is already here — move it off first, or record a stay that has already finished."
                : "Leave the end date blank while it is still there. Rest is counted from the day it moves off."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`occupant-${zoneId}`}>What is on it</Label>
              <Input
                id={`occupant-${zoneId}`}
                name="occupantLabel"
                required
                maxLength={200}
                autoFocus
                placeholder="e.g. Cow herd"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`start-${zoneId}`}>On</Label>
                <Input
                  id={`start-${zoneId}`}
                  name="startedOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`end-${zoneId}`}>Off</Label>
                <Input id={`end-${zoneId}`} name="endedOn" type="date" />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`occ-area-${zoneId}`}>
                Area used, in {AREA_UNIT_LABELS[unit].many}
              </Label>
              <Input
                id={`occ-area-${zoneId}`}
                name="area"
                type="number"
                min="0"
                step="0.0001"
                placeholder="Blank means the whole thing"
              />
              {/* The strip decision, in one sentence the user can act on: a
                  polywire strip has no persistent identity, so it is an area on
                  THIS stay rather than a place of its own. */}
              <p className="text-xs text-muted-foreground">
                Running polywire? Put the strip size here — it is recorded
                against this stay, not as a place of its own.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`occ-notes-${zoneId}`}>Notes</Label>
              <Textarea
                id={`occ-notes-${zoneId}`}
                name="notes"
                rows={2}
                maxLength={5000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Move an open stay off. One button — this is what starts the rest clock. */
export function EndOccupancy({
  stay,
  today,
}: {
  stay: OccupancyRow;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      const result = await endOccupancyAction({
        occupancyId: stay.id,
        endedOn: String(formData.get("endedOn") ?? today),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Moved off — the rest clock starts now");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Move off
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Move {stay.occupantLabel} off?</DialogTitle>
            <DialogDescription>
              Rest is counted from this day. It went on {stay.startedOn}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor={`off-${stay.id}`}>Last day on it</Label>
            <Input
              id={`off-${stay.id}`}
              name="endedOn"
              type="date"
              defaultValue={today}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Move off"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Remove a stay entered by mistake. Correcting a record is not rewriting history. */
export function DeleteOccupancy({ stay }: { stay: OccupancyRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await deleteOccupancyAction({ occupancyId: stay.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label={`Remove the stay by ${stay.occupantLabel}`}
        >
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove this stay?</DialogTitle>
          <DialogDescription>
            {stay.occupantLabel}, from {stay.startedOn}
            {stay.endedOn ? ` to ${stay.endedOn}` : " (still on it)"}. Every rest
            and rotation figure for this {""}
            area is computed from these records, so remove it only if it did not
            happen.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={remove} disabled={pending}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
