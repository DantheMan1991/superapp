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
  deleteWeightAction,
  recordWeightAction,
  updateWeightAction,
} from "../actions";
import {
  WEIGHT_METHOD_LABELS,
  WEIGHT_METHOD_NOTES,
} from "../core/weights";

/**
 * Remove a weighing entered by mistake — a duplicate, or one against the wrong
 * pen.
 *
 * **A DELETE, not a void**, and the confirm step is what makes that safe. A
 * voided row would be one every fold in this pack had to remember to exclude,
 * and the thing it would preserve — that somebody once typed a wrong number —
 * goes to `logAudit` instead.
 *
 * The copy deliberately does NOT tell a farmer their old number is in the audit
 * log. It is, in the column; but nothing in the app renders it, and pointing
 * somebody at a record they cannot open is worse than not mentioning it.
 */
export function RemoveWeightButton({
  weightId,
  weighedOn,
}: {
  weightId: string;
  weighedOn: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await deleteWeightAction({ id: weightId });
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
        <Button variant="ghost" size="sm">
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remove the weighing from {weighedOn}?</DialogTitle>
          <DialogDescription>
            {/* Named, because a gain and a conversion are both folds over these
                rows and removing one moves both. */}
            For a weighing that never happened — a duplicate, or one recorded
            against the wrong pen. If the number was simply typed wrong, correct
            it instead. Gain and feed conversion are worked out from these rows,
            so both will change.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={submit} disabled={pending}>
            {pending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ExistingWeight {
  id: string;
  weighedOn: string;
  method: string;
  sampleSize: number;
  sampleWeightLb: number | null;
  heartGirthIn: number | null;
  bodyLengthIn: number | null;
  notes: string;
}

/**
 * Record what they weighed, and how — and correct it when the number was wrong.
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
  existing,
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
  /**
   * The weighing being CORRECTED, if this is a correction.
   *
   * One form for both, because they are the same act done twice: somebody at a
   * scale saying what it read. A separate edit dialog would drift from this one
   * the first time a field changed, and the fields are the whole of the
   * interesting part — the method decides which of them exist at all.
   */
  existing?: ExistingWeight;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [method, setMethod] = useState<string>(
    existing ? existing.method : head > 1 ? "sample" : "scale",
  );

  // Unique per dialog: a lot page carries the header's "Weigh" form and one
  // "Correct" form per row, and duplicate ids would point every label at the
  // first of them.
  const fieldId = existing ? existing.id : livestockLotId;
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

    const fields = {
      weighedOn: String(formData.get("weighedOn") ?? today),
      method,
      sampleSize,
      sampleWeightLb: isTape ? null : number("sampleWeightLb"),
      heartGirthIn: isTape ? number("heartGirthIn") : null,
      bodyLengthIn: isTape ? number("bodyLengthIn") : null,
      notes: String(formData.get("notes") ?? ""),
    };

    startTransition(async () => {
      const result = existing
        ? await updateWeightAction({ id: existing.id, ...fields })
        : await recordWeightAction({ livestockLotId, ...fields });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(existing ? "Corrected" : "Weighed");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant={existing ? "ghost" : "outline"} size="sm">
            {existing ? "Correct" : "Weigh"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>
              {existing ? `Correct this weighing` : `Weigh ${lotCode}`}
            </DialogTitle>
            <DialogDescription>
              {existing
                ? "A weighing is an observation, not a ledger entry: if the number was typed wrong, no such measurement ever happened. So this replaces it rather than adding a correction beside it. Gain and feed conversion are worked out from these rows, so both will move."
                : "How they were weighed is kept with the weight, because a crate on a scale and a tape round the girth are not the same kind of fact."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`method-${fieldId}`}>How</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id={`method-${fieldId}`}>
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
                <Label htmlFor={`weighed-${fieldId}`}>When</Label>
                <Input
                  id={`weighed-${fieldId}`}
                  name="weighedOn"
                  type="date"
                  defaultValue={existing?.weighedOn ?? today}
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
                  <Label htmlFor={`girth-${fieldId}`}>
                    Heart girth (in)
                  </Label>
                  <Input
                    id={`girth-${fieldId}`}
                    name="heartGirthIn"
                    type="number"
                    min="0"
                    step="0.25"
                    required
                    autoFocus
                    defaultValue={existing?.heartGirthIn ?? undefined}
                    placeholder="round, behind the front legs"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor={`length-${fieldId}`}>Length (in)</Label>
                  <Input
                    id={`length-${fieldId}`}
                    name="bodyLengthIn"
                    type="number"
                    min="0"
                    step="0.25"
                    required
                    defaultValue={existing?.bodyLengthIn ?? undefined}
                    placeholder="shoulder to pin bone"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {!isVisual && (
                  <div className="grid gap-2">
                    <Label htmlFor={`n-${fieldId}`}>How many</Label>
                    <Input
                      id={`n-${fieldId}`}
                      name="sampleSize"
                      type="number"
                      min="1"
                      step="1"
                      max={head > 0 ? head : undefined}
                      defaultValue={
                        existing?.sampleSize ?? (method === "sample" ? 10 : 1)
                      }
                      required
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor={`w-${fieldId}`}>
                    {isVisual ? "Each, roughly (lb)" : "Together (lb)"}
                  </Label>
                  <Input
                    id={`w-${fieldId}`}
                    name="sampleWeightLb"
                    type="number"
                    min="0"
                    step="0.001"
                    required
                    autoFocus
                    defaultValue={existing?.sampleWeightLb ?? undefined}
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
              <Label htmlFor={`wnotes-${fieldId}`}>Notes</Label>
              <Textarea
                id={`wnotes-${fieldId}`}
                name="notes"
                rows={2}
                maxLength={2000}
                defaultValue={existing?.notes}
                placeholder="Off feed overnight. Wet fleece."
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : existing ? "Correct" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
