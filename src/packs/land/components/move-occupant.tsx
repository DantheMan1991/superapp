"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
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
import { Combobox } from "@/components/app/combobox";
import { moveOccupantAction } from "../actions";
import { AREA_UNIT_LABELS, toAcres, type AreaUnit } from "../core/area";

/** A stay on the ground now, as the picker needs it. */
export interface MovableStay {
  id: string;
  zoneId: string;
  zoneName: string;
  occupantLabel: string;
  startedOn: string;
}

/** Somewhere they could go. */
export interface MoveTarget {
  id: string;
  name: string;
}

/**
 * Moving what is on one piece of ground onto another, in ONE act.
 *
 * **THE PACK HAD THE OP AND NOT THE BUTTON.** `moveOccupant` has been in
 * `ops.ts` since 2026-08-16 with a doc comment explaining that a move is one
 * act and that doing it as two invents a gap in ground nobody left — and only
 * `livestock` could reach it. Land's own screens did it the long way: `Move
 * off` here, then find the other paddock, then `Record a stay`, retyping the
 * name. The dossier had been calling that out as an open item the whole time.
 *
 * **TWO DIRECTIONS, ONE DIALOG, AND NEVER BOTH ON A PAGE AT ONCE.** Which one
 * a screen offers follows from what it knows:
 *
 *   - **`here`** — this is the destination, so pick what is coming. This is the
 *     field flow: `Which paddock am I in?` lands you on the paddock you just
 *     let them into, and the thing you want to say is *the cows are here now*.
 *   - **`away`** — this is where they are, so pick where they are going. This is
 *     the kitchen-table flow, and it is the one the guide used to describe as
 *     two separate acts.
 *
 * A zone's page offers `away` while something is on it and `here` while
 * nothing is, so the header never carries both.
 *
 * **THE PICKER IS ROWS, NOT NAMES.** A stay Land holds has no identity beyond
 * its row — `occupantId` belongs to whichever pack owns the animals — so the
 * person points at a stay that exists rather than retyping a name that has to
 * match. See `moveOccupantAction`.
 */
export function MoveOccupant({
  mode,
  zoneId,
  zoneName,
  zoneWord,
  stays,
  targets,
  unit,
  today,
  trigger,
  open: openProp,
  onOpenChange,
}: {
  mode: "here" | "away";
  /** In `here` mode the destination; in `away` mode where they are now. */
  zoneId: string;
  zoneName: string;
  zoneWord: string;
  /** What can be moved. In `away` mode, the open stays on THIS zone. */
  stays: MovableStay[];
  /** Where they could go. Only read in `away` mode. */
  targets: MoveTarget[];
  unit: AreaUnit;
  /** The TENANT's today, never the browser's. */
  today: string;
  trigger?: React.ReactNode;
  /**
   * Driven from outside, for a row menu.
   *
   * **A `DropdownMenuItem` CANNOT BE A `DialogTrigger`.** Choosing the item
   * closes the menu, which unmounts the trigger before the dialog it was
   * supposed to open ever mounts. So the menu owns the flag and this takes it.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [selfOpen, setSelfOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : selfOpen;
  const setOpen = (next: boolean) => {
    onOpenChange?.(next);
    if (!controlled) setSelfOpen(next);
  };
  const [pending, startTransition] = useTransition();
  const [stayId, setStayId] = useState<string>(
    stays.length === 1 ? stays[0].id : "",
  );
  const [toZoneId, setToZoneId] = useState<string>(
    mode === "here" ? zoneId : "",
  );

  const word = zoneWord.toLowerCase();
  const chosen = stays.find((stay) => stay.id === stayId) ?? null;
  const destination =
    mode === "here"
      ? zoneName
      : (targets.find((t) => t.id === toZoneId)?.name ?? "");

  /** Nothing to move, or nowhere to move it. Say so instead of a dead dialog. */
  const nothingToMove = stays.length === 0;
  const nowhereToGo = mode === "away" && targets.length === 0;

  function submit(formData: FormData) {
    if (!stayId || !toZoneId) return;
    const rawArea = String(formData.get("area") ?? "").trim();
    const label = chosen?.occupantLabel ?? "";
    const to = destination;

    startTransition(async () => {
      const result = await moveOccupantAction({
        occupancyId: stayId,
        toZoneId,
        startedOn: String(formData.get("startedOn") ?? today),
        areaAcres: rawArea ? toAcres(Number(rawArea), unit) : null,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // The closing date is the half a person cannot see, and it is the half
      // the inclusive bound gets right — say it rather than leaving them to
      // trust it.
      toast.success(
        result.endedOn
          ? `${label} is on ${to} — last day on the old one was ${result.endedOn}`
          : `${label} is on ${to}`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!controlled && (
        <DialogTrigger asChild>
          {trigger ?? (
            <Button size="sm" variant="outline">
              <ArrowRight className="mr-2 h-4 w-4" />
              {mode === "here" ? `Move something here` : `Move to…`}
            </Button>
          )}
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>
              {mode === "here"
                ? `Move something onto ${zoneName}`
                : `Move off ${zoneName} — where to?`}
            </DialogTitle>
            <DialogDescription>
              {nothingToMove
                ? mode === "here"
                  ? `Nothing is recorded on this parcel to move. Record a stay instead.`
                  : `Nothing is on this ${word} to move.`
                : nowhereToGo
                  ? `There is nowhere else on this parcel to move to yet.`
                  : `One act, not two. The ${word} they leave is closed the day before they arrive, so the same day is never grazed twice.`}
            </DialogDescription>
          </DialogHeader>

          {!nothingToMove && !nowhereToGo && (
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor={`moving-${zoneId}`}>What is moving</Label>
                <Select value={stayId} onValueChange={setStayId}>
                  <SelectTrigger
                    id={`moving-${zoneId}`}
                    aria-label="What is moving"
                  >
                    <SelectValue placeholder="Pick what is moving" />
                  </SelectTrigger>
                  <SelectContent>
                    {stays.map((stay) => (
                      <SelectItem key={stay.id} value={stay.id}>
                        {stay.occupantLabel}
                        {mode === "here" && ` — on ${stay.zoneName}`}
                        {` since ${stay.startedOn}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {mode === "away" && (
                <div className="grid gap-2">
                  <Label htmlFor={`to-${zoneId}`}>Where to</Label>
                  {/* A farm at 10x has two hundred of these, so it types. */}
                  <Combobox
                    id={`to-${zoneId}`}
                    aria-label="Where to"
                    options={targets.map((t) => ({
                      value: t.id,
                      label: t.name,
                    }))}
                    value={toZoneId || undefined}
                    onValueChange={setToZoneId}
                    placeholder={`Pick a ${word}`}
                    searchPlaceholder={`Search ${word}s`}
                    emptyText={`No ${word} matches that.`}
                  />
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor={`moved-${zoneId}`}>On</Label>
                <Input
                  id={`moved-${zoneId}`}
                  name="startedOn"
                  type="date"
                  defaultValue={today}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  The first day on the new {word}. The day they leave the old
                  one is the day before, so a day is never counted twice.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`movearea-${zoneId}`}>
                  Area used, in {AREA_UNIT_LABELS[unit].many}
                </Label>
                <Input
                  id={`movearea-${zoneId}`}
                  name="area"
                  type="number"
                  step="0.0001"
                  min="0"
                  inputMode="decimal"
                  placeholder="Leave blank for all of it"
                />
                <p className="text-xs text-muted-foreground">
                  Blank on purpose: a strip on the {word} they left says nothing
                  about the one they are going to.
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`movenotes-${zoneId}`}>Notes</Label>
                <Textarea id={`movenotes-${zoneId}`} name="notes" rows={2} />
              </div>
            </div>
          )}

          <DialogFooter>
            {nothingToMove || nowhereToGo ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            ) : (
              <Button type="submit" disabled={pending || !stayId || !toZoneId}>
                {pending ? "Moving…" : "Move"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
