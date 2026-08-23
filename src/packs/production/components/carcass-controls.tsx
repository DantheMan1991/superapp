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
  addRunCarcassAction,
  removeRunCarcassAction,
  updateRunCarcassAction,
} from "../actions";

const PASSED = "passed";
const CONDEMNED = "condemned";

export interface CarcassInputOption {
  id: string;
  /** "PEN-2 · Whole broilers · 50 head" — enough to tell two pens apart. */
  label: string;
}

export interface CarcassValues {
  id: string;
  runInputId: string;
  tag: string;
  headCount: number;
  liveLb: number | null;
  hangingLb: number | null;
  condemned: boolean;
  condemnReason: string;
  notes: string;
}

function numberOrNull(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * One line of the kill sheet, added or corrected.
 *
 * **THE FORM CHANGES SHAPE WHEN A CARCASS IS CONDEMNED, rather than accepting a
 * number it will throw away.** A condemned carcass has no hanging weight — the
 * database says so with a CHECK and ops says so with a sentence — and a field
 * that stays on screen, takes a number and then silently drops it is how a farm
 * ends up believing it recorded something. The cause takes its place, because
 * that is the field that matters on a condemned line and the one somebody is
 * actually looking at the sheet to copy.
 *
 * **THE TWO LIVE WEIGHTS ARE NAMED APART ON THE FORM.** "At the plant" is not
 * decoration: the trailer weight is already on the input, animals lose 3–5% on
 * the way, and a person who types the farm's figure in here has not entered a
 * duplicate — they have entered a wrong number that will quietly improve the
 * dressing percentage.
 */
export function CarcassDialog({
  runId,
  inputs,
  existing,
  sheetWord,
  trigger,
}: {
  runId: string;
  inputs: CarcassInputOption[];
  /** Set when correcting a line; absent when adding one. */
  existing?: CarcassValues;
  sheetWord: string;
  trigger: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [runInputId, setRunInputId] = useState<string>(
    existing?.runInputId ?? inputs[0]?.id ?? "",
  );
  const [disposition, setDisposition] = useState<string>(
    existing?.condemned ? CONDEMNED : PASSED,
  );
  const condemned = disposition === CONDEMNED;
  const isEdit = existing !== undefined;

  function submit(formData: FormData) {
    if (!runInputId) {
      toast.error("Pick which of this run's inputs the carcass came out of.");
      return;
    }
    const shared = {
      tag: String(formData.get("tag") ?? ""),
      headCount: Number(formData.get("headCount") ?? 1),
      liveLb: numberOrNull(formData.get("liveLb")),
      // Sent as an explicit null rather than omitted, so that condemning a line
      // that already had a hanging weight CLEARS it. Omitting the field would
      // leave the old pounds behind and ops would refuse the whole edit.
      hangingLb: condemned ? null : numberOrNull(formData.get("hangingLb")),
      condemned,
      condemnReason: condemned ? String(formData.get("condemnReason") ?? "") : "",
      notes: String(formData.get("notes") ?? ""),
    };
    startTransition(async () => {
      const result = isEdit
        ? await updateRunCarcassAction({ id: existing.id, ...shared })
        : await addRunCarcassAction({ runId, runInputId, ...shared });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isEdit
          ? "Corrected"
          : condemned
            ? "Condemnation recorded"
            : "Carcass recorded",
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Correct this line" : `Add to the ${sheetWord.toLowerCase()}`}
            </DialogTitle>
            <DialogDescription>
              {isEdit
                ? "A weight typed wrong never happened, so this is corrected in place. Nothing in the ledger moves — the sheet records what the plant found, not what anything cost."
                : "One line per outcome. A hundred birds with three condemned is two lines: ninety-seven that passed and three that did not."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {!isEdit && (
              <div className="grid gap-2">
                <Label htmlFor="carcass-input">Came out of</Label>
                <Select value={runInputId} onValueChange={setRunInputId}>
                  <SelectTrigger id="carcass-input">
                    <SelectValue placeholder="Pick an input" />
                  </SelectTrigger>
                  <SelectContent>
                    {inputs.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {inputs.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nothing has gone into this run yet. A carcass has to have come
                    out of something.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="carcass-disposition">Outcome</Label>
                <Select value={disposition} onValueChange={setDisposition}>
                  <SelectTrigger id="carcass-disposition">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PASSED}>Passed</SelectItem>
                    <SelectItem value={CONDEMNED}>Condemned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="carcass-head">Head on this line</Label>
                <Input
                  id="carcass-head"
                  name="headCount"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  required
                  defaultValue={existing?.headCount ?? 1}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="carcass-tag">Tag or carcass number</Label>
              <Input
                id="carcass-tag"
                name="tag"
                maxLength={120}
                defaultValue={existing?.tag ?? ""}
                placeholder="Leave empty for a batch line"
              />
              <p className="text-xs text-muted-foreground">
                A beef has one; seventy broilers do not, and inventing identities
                for them would be a worse record than none.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="carcass-live">Live weight at the plant (lb)</Label>
                <Input
                  id="carcass-live"
                  name="liveLb"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  defaultValue={existing?.liveLb ?? ""}
                />
              </div>
              {!condemned && (
                <div className="grid gap-2">
                  <Label htmlFor="carcass-hanging">Hanging weight (lb)</Label>
                  <Input
                    id="carcass-hanging"
                    name="hangingLb"
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    defaultValue={existing?.hangingLb ?? ""}
                  />
                </div>
              )}
            </div>

            {/* Said where somebody is about to type the wrong number into it. */}
            <p className="text-xs text-muted-foreground">
              The plant&rsquo;s scale, not the farm&rsquo;s — what left the yard is
              already on the input. Animals lose 3–5% on a trailer, so the two
              disagree for a real reason and neither is corrected to match the
              other. Filling this in is what lets a condemnation be taken out of
              the dressing percentage properly.
            </p>

            {condemned && (
              <div className="grid gap-2 rounded-md border p-3">
                <Label htmlFor="carcass-reason">Cause, as the sheet gives it</Label>
                <Input
                  id="carcass-reason"
                  name="condemnReason"
                  maxLength={500}
                  defaultValue={existing?.condemnReason ?? ""}
                  placeholder="e.g. airsacculitis, bruising"
                />
                <p className="text-xs text-muted-foreground">
                  Optional — a sheet can be smudged or silent, and refusing to
                  record the condemnation until somebody supplies a cause would
                  trade a real fact for an invented one. Causes are counted
                  together, so a cause given twice is the one worth acting on.
                </p>
                <p className="text-xs text-muted-foreground">
                  There is no hanging weight on a condemned line: nothing off it
                  can be sold, so it is out of both sides of the cutting yield
                  rather than dragging it down.
                </p>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="carcass-notes">Notes</Label>
              <Textarea
                id="carcass-notes"
                name="notes"
                rows={2}
                maxLength={2000}
                defaultValue={existing?.notes ?? ""}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || inputs.length === 0}>
              {pending ? "Saving…" : isEdit ? "Save" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Take a transcribed line off the sheet.
 *
 * Nothing is reversed and nothing is compensated for, because nothing was ever
 * posted: this row is a copy of somebody else's paperwork, not an event. It is
 * still audited, because removing a condemnation erases a statement about
 * whether meat was fit to sell.
 */
export function RemoveCarcassButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function remove() {
    startTransition(async () => {
      const result = await removeRunCarcassAction({ id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed");
      router.refresh();
    });
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={remove}
      disabled={pending}
      className="text-muted-foreground"
    >
      Remove
    </Button>
  );
}
