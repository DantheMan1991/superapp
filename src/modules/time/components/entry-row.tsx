"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { deleteTimeEntryAction, updateTimeEntryAction } from "../actions";
import { decimalHours, formatDuration, parseDuration } from "../core/duration";
import { PAY_TYPES, payTypeLabel } from "../core/pay-types";

export interface EntryView {
  id: string;
  version: number;
  minutes: number;
  workDate: string;
  payType: string;
  note: string;
  workerName: string;
  /** Shown only when somebody else typed it — see below. */
  enteredBy: string | null;
}

/**
 * Fix or remove one entry. Both are member-level: a slip is put right by
 * whoever made it, and there is nothing downstream yet that a correction could
 * contradict.
 *
 * From slice 3 that stops being true. Once a timesheet is approved and a period
 * locked, an edit becomes an amendment in the open period rather than a
 * rewrite — paid history is not restated. The delete button goes away for
 * locked entries then, which is the right time for the guard because that is
 * the first moment the state it guards against can exist.
 */
export function EntryRow({ entry, today }: { entry: EntryView; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [payType, setPayType] = useState(entry.payType);
  const [duration, setDuration] = useState(decimalHours(entry.minutes));

  const minutes = parseDuration(duration);

  function save(formData: FormData) {
    if (minutes <= 0) {
      toast.error("How long? Try 1:30, 1.5 or 90m.");
      return;
    }
    startTransition(async () => {
      const result = await updateTimeEntryAction({
        entryId: entry.id,
        expectedVersion: entry.version,
        minutes,
        payType: payType as (typeof PAY_TYPES)[number],
        workDate: String(formData.get("workDate") ?? ""),
        note: String(formData.get("note") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Entry saved");
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteTimeEntryAction({ entryId: entry.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Entry deleted");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={save}>
          <DialogHeader>
            <DialogTitle>Edit this entry</DialogTitle>
            <DialogDescription>
              {entry.workerName}
              {/* Only when it was somebody else. "Logged by you" on your own
                  entry is noise on every row of your own week. */}
              {entry.enteredBy ? ` · logged by ${entry.enteredBy}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`d-${entry.id}`}>How long</Label>
                <Input
                  id={`d-${entry.id}`}
                  name="duration"
                  required
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {minutes > 0
                    ? `That is ${formatDuration(minutes)}.`
                    : "Not a length we can read."}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`w-${entry.id}`}>Day</Label>
                <Input
                  id={`w-${entry.id}`}
                  name="workDate"
                  type="date"
                  required
                  max={today}
                  defaultValue={entry.workDate}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`p-${entry.id}`}>Kind</Label>
              <Select value={payType} onValueChange={setPayType}>
                <SelectTrigger id={`p-${entry.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAY_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {payTypeLabel(t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`n-${entry.id}`}>What they did</Label>
              <Input
                id={`n-${entry.id}`}
                name="note"
                maxLength={1000}
                defaultValue={entry.note}
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={remove}
            >
              Delete
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
