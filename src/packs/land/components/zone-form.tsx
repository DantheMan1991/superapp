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
import { createZoneAction } from "../actions";
import { AREA_UNIT_LABELS, toAcres, type AreaUnit } from "../core/area";

/**
 * Add a zone to a parcel.
 *
 * NO USE FIELD HERE, deliberately. A use is dated — it starts on a day and is
 * superseded on another — and offering it as a field on the create form would
 * make it feel like a property of the zone, which is the exact confusion the
 * separate table exists to prevent. The zone is created, then a use is
 * *started*, which is a different verb because it is a different fact.
 */
export function ZoneForm({
  parcelId,
  unit,
  zoneWord,
}: {
  parcelId: string;
  unit: AreaUnit;
  zoneWord: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const word = zoneWord.toLowerCase();

  function submit(formData: FormData) {
    const rawArea = String(formData.get("area") ?? "").trim();

    startTransition(async () => {
      const result = await createZoneAction({
        parcelId,
        name: String(formData.get("name") ?? ""),
        areaAcres: rawArea ? toAcres(Number(rawArea), unit) : null,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${zoneWord} added`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Add {word}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add a {word}</DialogTitle>
            <DialogDescription>
              A management unit inside this parcel. What it is for is set
              separately, because that changes with the season.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="zone-name">Name</Label>
              <Input
                id="zone-name"
                name="name"
                required
                maxLength={200}
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="zone-area">
                Area in {AREA_UNIT_LABELS[unit].many}
              </Label>
              <Input
                id="zone-area"
                name="area"
                type="number"
                min="0"
                step="0.0001"
                placeholder="Leave blank if unknown"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="zone-notes">Notes</Label>
              <Textarea id="zone-notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : `Add ${word}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
