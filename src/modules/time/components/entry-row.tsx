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
import {
  DimensionTags,
  type DimensionTypeOption,
} from "@/components/app/dimension-tags";
import {
  amendEntryAction,
  deleteTimeEntryAction,
  splitEntryAction,
  updateTimeEntryAction,
} from "../actions";
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
  /** The dimension members this entry already carries. */
  memberIds: string[];
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
export function EntryRow({
  entry,
  today,
  dimensionTypes,
}: {
  entry: EntryView;
  today: string;
  dimensionTypes: DimensionTypeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [payType, setPayType] = useState(entry.payType);
  const [duration, setDuration] = useState(decimalHours(entry.minutes));
  const [memberIds, setMemberIds] = useState<string[]>(entry.memberIds);

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
        memberIds,
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
            {dimensionTypes.length > 0 && (
              <div className="grid gap-2">
                <Label>What it was for</Label>
                <DimensionTags
                  types={dimensionTypes}
                  value={memberIds}
                  onValue={setMemberIds}
                  layout="inline"
                />
              </div>
            )}
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

/**
 * Put right an entry inside a LOCKED period.
 *
 * It does not edit anything. It adds a new entry in the open period carrying
 * the difference and pointing back at the original, so the record still says
 * what the pay run actually saw. That is the whole reason locking is safe to
 * offer: a mistake found after payroll has an answer that is not "unlock it and
 * hope nobody notices".
 */
export function AmendEntryButton({
  entry,
  correctionDate,
}: {
  entry: EntryView;
  /**
   * Where the correction lands: the first day in a period nobody has locked,
   * which is today only when today's own period is still open.
   */
  correctionDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [duration, setDuration] = useState("");

  const minutes = parseDuration(duration);

  function submit(formData: FormData) {
    if (minutes <= 0) {
      toast.error("How long? Try 1:30, 1.5 or 90m.");
      return;
    }
    startTransition(async () => {
      const result = await amendEntryAction({
        originalEntryId: entry.id,
        minutes,
        workDate: correctionDate,
        payType: entry.payType as (typeof PAY_TYPES)[number],
        note: String(formData.get("note") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Correction added to the open period");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Correct
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Add a correction</DialogTitle>
            <DialogDescription>
              {entry.workerName} was logged {formatDuration(entry.minutes)} on{" "}
              {entry.workDate}, in a period that is now locked. That entry stays
              exactly as it is. This adds the difference to today instead.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`a-${entry.id}`}>How much to add</Label>
              <Input
                id={`a-${entry.id}`}
                name="duration"
                required
                autoFocus
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="1:30, 1.5 or 90m"
              />
              <p className="text-xs text-subtle-foreground">
                {duration.trim() === ""
                  ? "The hours that were missed, not the corrected total."
                  : minutes > 0
                    ? `That is ${formatDuration(minutes)}, dated ${correctionDate}.`
                    : "Not a length we can read."}
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`an-${entry.id}`}>Why</Label>
              <Input
                id={`an-${entry.id}`}
                name="note"
                maxLength={1000}
                defaultValue={`Correction to ${entry.workDate}`}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Divide an entry so each half can say what it was for.
 *
 * "Five hours on the north field and three on the barn" is two entries, not one
 * entry with two tags — the hours really were divided, and a single row
 * carrying both could never say how much went where.
 *
 * THE DAY'S TOTAL NEVER MOVES. The original keeps the remainder, so somebody
 * watching a figure they already believe does not see it change.
 */
export function SplitEntryButton({
  entry,
  dimensionTypes,
}: {
  entry: EntryView;
  dimensionTypes: DimensionTypeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [duration, setDuration] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const minutes = parseDuration(duration);
  const left = entry.minutes - minutes;

  function submit() {
    if (minutes <= 0) {
      toast.error("How long? Try 1:30, 1.5 or 90m.");
      return;
    }
    if (left <= 0) {
      toast.error("A split has to leave some time on the original entry.");
      return;
    }
    startTransition(async () => {
      const result = await splitEntryAction({
        entryId: entry.id,
        minutes,
        memberIds,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Split into ${formatDuration(left)} and ${formatDuration(minutes)}`,
      );
      setOpen(false);
      setDuration("");
      setMemberIds([]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Split
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Split this entry</DialogTitle>
          <DialogDescription>
            {entry.workerName} has {formatDuration(entry.minutes)} on{" "}
            {entry.workDate}. Take part of it out so it can be booked to
            something else. The day&apos;s total does not change.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor={`sp-${entry.id}`}>How much to take out</Label>
            <Input
              id={`sp-${entry.id}`}
              autoFocus
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="1:30, 1.5 or 90m"
            />
            <p className="text-xs text-subtle-foreground">
              {duration.trim() === ""
                ? "The part that was something else."
                : minutes <= 0
                  ? "Not a length we can read."
                  : left <= 0
                    ? "That is the whole entry. Leave something behind."
                    : `Leaves ${formatDuration(left)} on the original.`}
            </p>
          </div>
          {dimensionTypes.length > 0 && (
            <div className="grid gap-2">
              <Label>What the split-off part was for</Label>
              <DimensionTags
                types={dimensionTypes}
                value={memberIds}
                onValue={setMemberIds}
                layout="inline"
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" disabled={pending} onClick={submit}>
            {pending ? "Splitting…" : "Split"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
