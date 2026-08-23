"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
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
import { markRoundNormalAction, recordDailyCheckAction } from "../actions";
import { HAND_REMOVAL_REASONS, REMOVAL_REASON_LABELS } from "../vocabulary";

/**
 * The one tap the whole slice is built around.
 *
 * **MOST DAYS NOTHING HAPPENS**, and at 10x there are ~30 pens. A screen that
 * makes somebody open thirty records to type zeros is a screen that gets used
 * in April and abandoned in June — so the default path through this page is
 * one button, and only the exceptions cost a dialog.
 *
 * It is given the lots it can see rather than deriving them, because the person
 * is confirming a list in front of them. The server still refuses to overwrite
 * an exception, so a page left open cannot erase the note somebody made.
 */
export function MarkRoundNormalButton({
  remainingLotIds,
  today,
}: {
  remainingLotIds: string[];
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await markRoundNormalAction({
        livestockLotIds: remainingLotIds,
        loggedOn: today,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      // The count comes back from the insert rather than from the list length,
      // so it never claims credit for lots that were already done.
      const n = result.recorded ?? 0;
      toast.success(n === 1 ? "1 lot marked normal" : `${n} lots marked normal`);
      router.refresh();
    });
  }

  return (
    <Button onClick={submit} disabled={pending || remainingLotIds.length === 0}>
      <Check className="mr-2 h-4 w-4" />
      All normal ({remainingLotIds.length})
    </Button>
  );
}

/**
 * The same confirmation for a single lot, without opening anything.
 *
 * **OUTLINED AND VERB-LABELLED, and both were found by driving it.** It was a
 * ghost button reading "Normal", which sat in the same cell that shows a
 * "Normal" BADGE once the lot has been checked — so the control you press and
 * the state you reached looked nearly identical, and the row gave no clue which
 * one you were looking at. "Mark normal" is an instruction; "Normal" is a fact.
 */
export function QuickNormalButton({
  livestockLotId,
  today,
}: {
  livestockLotId: string;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const result = await recordDailyCheckAction({
        livestockLotId,
        loggedOn: today,
        status: "normal",
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={submit} disabled={pending}>
      Mark normal
    </Button>
  );
}

const NO_LOSS = "0";

/**
 * The exception: what was seen, and what was lost seeing it.
 *
 * **THE LOSS IS NOT A FIELD ON THE CHECK.** It goes to `inventory`'s ledger in
 * the same transaction, which is why the head count on the item page moves the
 * moment this is saved — one number, read in two places, rather than two
 * numbers that have to be kept in step.
 */
export function LotCheckForm({
  livestockLotId,
  lotCode,
  today,
  balance,
  hasEntry,
}: {
  livestockLotId: string;
  lotCode: string;
  today: string;
  balance: number;
  hasEntry: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState<string>(HAND_REMOVAL_REASONS[0]);

  function submit(formData: FormData) {
    const lost = Number(formData.get("lost") ?? NO_LOSS);
    const notes = String(formData.get("notes") ?? "");
    if (Number.isNaN(lost) || lost < 0) {
      toast.error("Head lost has to be a number.");
      return;
    }
    if (lost > balance) {
      toast.error(`Only ${balance} head are in this lot.`);
      return;
    }
    startTransition(async () => {
      const result = await recordDailyCheckAction({
        livestockLotId,
        loggedOn: today,
        // A check with nothing lost and nothing written is a normal day. One
        // with a note is worth coming back to, which is what `attention` means
        // — it is not a severity, it is a bookmark.
        status: lost > 0 || notes.trim() ? "attention" : "normal",
        notes,
        loss: lost > 0 ? { head: lost, reason: reason as "death" } : undefined,
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
        <Button variant="outline" size="sm">
          {hasEntry ? "Edit" : "Something's up"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>{lotCode}</DialogTitle>
            <DialogDescription>
              What you saw today. Losses go straight to the head count, so the
              two never disagree.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`lost-${livestockLotId}`}>Head lost</Label>
                <Input
                  id={`lost-${livestockLotId}`}
                  name="lost"
                  type="number"
                  min={0}
                  max={balance}
                  step="1"
                  defaultValue={NO_LOSS}
                  autoFocus
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`reason-${livestockLotId}`}>What happened</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger id={`reason-${livestockLotId}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HAND_REMOVAL_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {REMOVAL_REASON_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`notes-${livestockLotId}`}>Notes</Label>
              <Textarea
                id={`notes-${livestockLotId}`}
                name="notes"
                rows={3}
                maxLength={2000}
                placeholder="Lame in the left hind. Water was frozen."
              />
              <p className="text-xs text-muted-foreground">
                Leave both empty and this records a normal day — which still
                counts, because &ldquo;nothing died&rdquo; and &ldquo;nobody
                looked&rdquo; are different facts.
              </p>
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
