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
import { recordWeightAction } from "../actions";
import {
  WEIGHT_METHOD_LABELS,
  WEIGHT_METHOD_NOTES,
} from "../core/weights";

/**
 * Record what they weighed, and how.
 *
 * **THE METHOD PICKER IS THE FIRST FIELD BECAUSE IT CHANGES THE REST OF THE
 * FORM**, and that is the point of the whole slice: a scale asks how many went
 * on it and what they came to, a tape asks for a girth and a length, and an eye
 * asks for a guess. Collapsing those into one "weight" box would throw away the
 * distinction the feed conversion downstream depends on.
 *
 * A crate of ten birds is the pilot's only method for broilers, so the sample
 * fields are the default path and the total is what the scale actually reads —
 * the division into an average happens on the way out, not in somebody's head.
 */
export function RecordWeightForm({
  livestockLotId,
  lotCode,
  head,
  today,
  tapeAvailable,
  trigger,
}: {
  livestockLotId: string;
  lotCode: string;
  head: number;
  today: string;
  /**
   * Whether the profile supplies a tape divisor for this species. Without one a
   * girth and a length produce no weight at all, so offering the method would be
   * offering a dead end — nobody tapes a chicken.
   */
  tapeAvailable: boolean;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<string>(head > 1 ? "sample" : "scale");

  const methods = ["scale", "sample", ...(tapeAvailable ? ["tape"] : []), "visual"];
  const isTape = method === "tape";
  const isVisual = method === "visual";

  function submit(formData: FormData) {
    const number = (name: string): number | null => {
      const raw = String(formData.get(name) ?? "").trim();
      if (!raw) return null;
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    };

    const sampleSize = isTape || isVisual ? 1 : Number(formData.get("sampleSize") ?? 1);
    if (!isTape && !isVisual && (!Number.isInteger(sampleSize) || sampleSize < 1)) {
      toast.error("Say how many head went on the scale.");
      return;
    }
    if (!isTape && number("sampleWeightLb") === null) {
      toast.error("What did the scale say?");
      return;
    }
    if (isTape && (number("heartGirthIn") === null || number("bodyLengthIn") === null)) {
      toast.error("A tape needs both the heart girth and the body length.");
      return;
    }

    startTransition(async () => {
      const result = await recordWeightAction({
        livestockLotId,
        weighedOn: String(formData.get("weighedOn") ?? today),
        method,
        sampleSize,
        sampleWeightLb: isTape ? null : number("sampleWeightLb"),
        heartGirthIn: isTape ? number("heartGirthIn") : null,
        bodyLengthIn: isTape ? number("bodyLengthIn") : null,
        notes: String(formData.get("notes") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Weighed");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            Weigh
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Weigh {lotCode}</DialogTitle>
            <DialogDescription>
              How they were weighed is kept with the weight, because a crate on a
              scale and a tape round the girth are not the same kind of fact.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`method-${livestockLotId}`}>How</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id={`method-${livestockLotId}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {methods.map((m) => (
                      <SelectItem key={m} value={m}>
                        {WEIGHT_METHOD_LABELS[m] ?? m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`weighed-${livestockLotId}`}>When</Label>
                <Input
                  id={`weighed-${livestockLotId}`}
                  name="weighedOn"
                  type="date"
                  defaultValue={today}
                  required
                />
              </div>
            </div>

            {/* The method's own caveat, where the choice is made rather than in
                a help page nobody opens. */}
            <p className="text-xs text-muted-foreground">
              {WEIGHT_METHOD_NOTES[method]}
            </p>

            {isTape ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor={`girth-${livestockLotId}`}>
                    Heart girth (in)
                  </Label>
                  <Input
                    id={`girth-${livestockLotId}`}
                    name="heartGirthIn"
                    type="number"
                    min="0"
                    step="0.25"
                    required
                    autoFocus
                    placeholder="round, behind the front legs"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`length-${livestockLotId}`}>Length (in)</Label>
                  <Input
                    id={`length-${livestockLotId}`}
                    name="bodyLengthIn"
                    type="number"
                    min="0"
                    step="0.25"
                    required
                    placeholder="shoulder to pin bone"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {!isVisual && (
                  <div className="grid gap-2">
                    <Label htmlFor={`n-${livestockLotId}`}>How many</Label>
                    <Input
                      id={`n-${livestockLotId}`}
                      name="sampleSize"
                      type="number"
                      min="1"
                      step="1"
                      max={head > 0 ? head : undefined}
                      defaultValue={method === "sample" ? 10 : 1}
                      required
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor={`w-${livestockLotId}`}>
                    {isVisual ? "Each, roughly (lb)" : "Together (lb)"}
                  </Label>
                  <Input
                    id={`w-${livestockLotId}`}
                    name="sampleWeightLb"
                    type="number"
                    min="0"
                    step="0.001"
                    required
                    autoFocus
                  />
                </div>
              </div>
            )}

            {!isTape && !isVisual && (
              <p className="text-xs text-muted-foreground">
                {/* The division is the app's job, not the farmer's. */}
                What the scale read for all of them at once. The average a head
                is worked out from it, so nothing has to be divided in the yard.
              </p>
            )}

            <div className="grid gap-2">
              <Label htmlFor={`wnotes-${livestockLotId}`}>Notes</Label>
              <Textarea
                id={`wnotes-${livestockLotId}`}
                name="notes"
                rows={2}
                maxLength={2000}
                placeholder="Off feed overnight. Wet fleece."
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
