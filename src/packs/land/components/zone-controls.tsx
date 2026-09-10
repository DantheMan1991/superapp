"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal } from "lucide-react";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { retireZoneAction, updateZoneAction } from "../actions";
import { MoveOccupant, type MovableStay } from "./move-occupant";
import { ZoneUseForm, type ZoneUseRow } from "./zone-use-form";

export type { ZoneUseRow };
import { AREA_UNIT_LABELS, toAcres, type AreaUnit } from "../core/area";


export interface ZoneRowView {
  id: string;
  name: string;
  /** Already converted into the tenant's unit, as a plain input value. */
  areaInput: string;
  notes: string;
  history: ZoneUseRow[];
}

/**
 * Per-zone actions: set what it is for, edit it, retire it.
 *
 * The use picker offers the suggested list AND a free-text escape, because
 * `land_zone_uses.use` is an open taxonomy — the database constrains the
 * format and never the values. A closed dropdown would quietly turn an open
 * column into a fixed enum in the UI instead of the schema.
 *
 * "Productive" is a switch rather than a derived value. The pack proposes a
 * default for uses it knows and the tenant can disagree, because the taxonomy
 * is open and the pack genuinely cannot know whether a use it has never heard
 * of earns anything.
 */
export function ZoneControls({
  zone,
  unit,
  zoneWord,
  today,
  usesInUse,
  movableStays = [],
}: {
  zone: ZoneRowView;
  unit: AreaUnit;
  zoneWord: string;
  /** The TENANT's today, never the browser's. */
  today: string;
  /** Uses this tenant has already used, so its own vocabulary comes first. */
  usesInUse: string[];
  /**
   * What is on this parcel today and is NOT already on this row's ground.
   *
   * The row menu's `Move something here` picks one of these, so the person
   * points at a stay that exists instead of retyping a name that has to match.
   * Empty means there is nothing to bring, and the item does not render.
   */
  movableStays?: MovableStay[];
}) {
  const router = useRouter();
  const [settingUse, setSettingUse] = useState(false);
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [moving, setMoving] = useState(false);
  const [pending, startTransition] = useTransition();

  function saveEdit(formData: FormData) {
    const rawArea = String(formData.get("area") ?? "").trim();
    startTransition(async () => {
      const result = await updateZoneAction({
        id: zone.id,
        name: String(formData.get("name") ?? ""),
        areaAcres: rawArea ? toAcres(Number(rawArea), unit) : null,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${zoneWord} updated`);
      setEditing(false);
      router.refresh();
    });
  }

  function retire() {
    startTransition(async () => {
      const result = await retireZoneAction({ id: zone.id, endedOn: today });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${zoneWord} retired`);
      setRetiring(false);
      router.refresh();
    });
  }

  const word = zoneWord.toLowerCase();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Actions for ${zone.name}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {movableStays.length > 0 && (
            <DropdownMenuItem onSelect={() => setMoving(true)}>
              Move something here
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setSettingUse(true)}>
            Set what it is for
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            Edit {word}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRetiring(true)}>
            Retire {word}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {movableStays.length > 0 && (
        <MoveOccupant
          mode="here"
          zoneId={zone.id}
          zoneName={zone.name}
          zoneWord={zoneWord}
          stays={movableStays}
          targets={[]}
          unit={unit}
          today={today}
          open={moving}
          onOpenChange={setMoving}
        />
      )}

      <ZoneUseForm
        zoneId={zone.id}
        zoneName={zone.name}
        today={today}
        usesInUse={usesInUse}
        history={zone.history}
        open={settingUse}
        onOpenChange={setSettingUse}
      />

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <form action={saveEdit}>
            <DialogHeader>
              <DialogTitle>Edit {zone.name}</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor={`name-${zone.id}`}>Name</Label>
                <Input
                  id={`name-${zone.id}`}
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={zone.name}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`area-${zone.id}`}>
                  Area in {AREA_UNIT_LABELS[unit].many}
                </Label>
                <Input
                  id={`area-${zone.id}`}
                  name="area"
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="Leave blank if unknown"
                  defaultValue={zone.areaInput}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor={`notes-${zone.id}`}>Notes</Label>
                <Textarea
                  id={`notes-${zone.id}`}
                  name="notes"
                  rows={2}
                  maxLength={5000}
                  defaultValue={zone.notes}
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

      <Dialog open={retiring} onOpenChange={setRetiring}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retire {zone.name}?</DialogTitle>
            <DialogDescription>
              Its history stays, and so does every cost recorded against it. It
              stops being offered anywhere new, and whatever it is currently for
              is closed today.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetiring(false)}>
              Cancel
            </Button>
            <Button onClick={retire} disabled={pending}>
              {pending ? "Retiring…" : `Retire ${word}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
