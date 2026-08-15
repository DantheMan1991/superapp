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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { retireParcelAction, updateParcelAction } from "../actions";
import { TENURES, TENURE_LABELS } from "../vocabulary";
import { AREA_UNIT_LABELS, toAcres, type AreaUnit } from "../core/area";

export interface ParcelDetailView {
  id: string;
  name: string;
  tenure: string;
  /** Already converted into the tenant's unit, as a plain input value. */
  areaInput: string;
  identifier: string;
  notes: string;
  status: string;
  /** How many active zones would be retired along with the parcel. */
  activeZones: number;
}

/**
 * Edit and retire a parcel.
 *
 * The retire dialog says how many zones go with it BEFORE the button is
 * pressed. Retiring a parcel cascades to its paddocks — ground you no longer
 * hold has no active paddocks on it — and a cascade the user did not expect is
 * the kind of thing they find out about a week later when a picker is empty.
 */
export function ParcelControls({
  parcel,
  unit,
  zoneWord,
}: {
  parcel: ParcelDetailView;
  unit: AreaUnit;
  zoneWord: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [pending, startTransition] = useTransition();

  function saveEdit(formData: FormData) {
    const rawArea = String(formData.get("area") ?? "").trim();
    startTransition(async () => {
      const result = await updateParcelAction({
        id: parcel.id,
        name: String(formData.get("name") ?? ""),
        tenure: String(formData.get("tenure") ?? parcel.tenure),
        areaAcres: rawArea ? toAcres(Number(rawArea), unit) : null,
        identifier: String(formData.get("identifier") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Parcel updated");
      setEditing(false);
      router.refresh();
    });
  }

  function retire() {
    startTransition(async () => {
      const result = await retireParcelAction({ id: parcel.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.zonesRetired > 0
          ? `Parcel retired, with ${result.zonesRetired} ${zoneWord.toLowerCase()}${result.zonesRetired === 1 ? "" : "s"}`
          : "Parcel retired",
      );
      setRetiring(false);
      router.refresh();
    });
  }

  if (parcel.status === "retired") return null;

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button variant="outline" onClick={() => setRetiring(true)}>
        Retire
      </Button>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-lg">
          <form action={saveEdit}>
            <DialogHeader>
              <DialogTitle>Edit parcel</DialogTitle>
            </DialogHeader>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  name="name"
                  required
                  maxLength={200}
                  defaultValue={parcel.name}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="edit-tenure">Tenure</Label>
                  <Select name="tenure" defaultValue={parcel.tenure}>
                    <SelectTrigger id="edit-tenure">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TENURES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TENURE_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-area">
                    Area in {AREA_UNIT_LABELS[unit].many}
                  </Label>
                  <Input
                    id="edit-area"
                    name="area"
                    type="number"
                    min="0"
                    step="0.0001"
                    placeholder="Leave blank if unknown"
                    defaultValue={parcel.areaInput}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-identifier">Deed or lease reference</Label>
                <Input
                  id="edit-identifier"
                  name="identifier"
                  maxLength={200}
                  defaultValue={parcel.identifier}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edit-notes">Notes</Label>
                <Textarea
                  id="edit-notes"
                  name="notes"
                  rows={2}
                  maxLength={5000}
                  defaultValue={parcel.notes}
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
            <DialogTitle>Retire {parcel.name}?</DialogTitle>
            <DialogDescription>
              Ground that has been sold, or a lease that has ended. Nothing is
              deleted — every cost recorded against it keeps reporting, and it
              stops being offered anywhere new.
            </DialogDescription>
          </DialogHeader>

          {parcel.activeZones > 0 && (
            <p className="text-sm text-muted-foreground">
              {parcel.activeZones}{" "}
              {parcel.activeZones === 1
                ? zoneWord.toLowerCase()
                : `${zoneWord.toLowerCase()}s`}{" "}
              will be retired with it.
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setRetiring(false)}>
              Cancel
            </Button>
            <Button onClick={retire} disabled={pending}>
              {pending ? "Retiring…" : "Retire parcel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
