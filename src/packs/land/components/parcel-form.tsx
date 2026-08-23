"use client";

import { useState, useTransition } from "react";
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
import { createParcelAction } from "../actions";
import { TENURES, TENURE_LABELS } from "../vocabulary";
import { AREA_UNIT_LABELS, toAcres, type AreaUnit } from "../core/area";

/**
 * Add a parcel.
 *
 * The tenure picker is CLOSED, unlike the asset kind picker, and the
 * difference is not an inconsistency: a kind is a word for the same shape,
 * while each tenure books differently. There is no "something else" here
 * because a fourth arrangement would have no defined accounting behaviour.
 *
 * Area is entered in the tenant's own unit and converted to acres on the way
 * out, because acres is a storage decision and the form is the last place the
 * unit is still known.
 */
export function ParcelForm({ unit }: { unit: AreaUnit }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const rawArea = String(formData.get("area") ?? "").trim();

    startTransition(async () => {
      const result = await createParcelAction({
        name: String(formData.get("name") ?? ""),
        tenure: String(formData.get("tenure") ?? "owned"),
        areaAcres: rawArea ? toAcres(Number(rawArea), unit) : null,
        identifier: String(formData.get("identifier") ?? ""),
        notes: String(formData.get("notes") ?? ""),
      });
      // `in` rather than `result.error`: the action returns a UNION, and a
      // property access on the union does not narrow it.
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Parcel added");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Add parcel</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add a parcel</DialogTitle>
            <DialogDescription>
              A deed or a lease — the unit the business holds ground by.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" required maxLength={200} autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="tenure">Tenure</Label>
                <Select name="tenure" defaultValue="owned">
                  <SelectTrigger id="tenure">
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
                <Label htmlFor="area">
                  Area in {AREA_UNIT_LABELS[unit].many}
                </Label>
                <Input
                  id="area"
                  name="area"
                  type="number"
                  min="0"
                  step="0.0001"
                  placeholder="Leave blank if unknown"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="identifier">Deed or lease reference</Label>
              <Input id="identifier" name="identifier" maxLength={200} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" rows={2} maxLength={5000} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Add parcel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
