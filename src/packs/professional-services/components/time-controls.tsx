"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  deleteTimeEntryAction,
  logTimeAction,
  setEngagementStatusAction,
  updateTimeEntryAction,
} from "../actions";
import {
  parseDuration,
  transitionDone,
  transitionVerb,
  type EngagementStatus,
} from "../vocabulary";

export function LogTimeForm({
  engagementId,
  today,
  disabled,
}: {
  engagementId: string;
  today: string;
  /** An ended engagement takes no time. The button says so rather than failing. */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    const minutes = parseDuration(String(formData.get("duration") ?? ""));
    if (minutes <= 0) {
      toast.error("How long? Try 1:30, 1.5 or 90m.");
      return;
    }
    startTransition(async () => {
      const result = await logTimeAction({
        engagementId,
        minutes,
        workDate: String(formData.get("workDate") ?? ""),
        note: String(formData.get("note") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Time logged");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>Log time</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Log time</DialogTitle>
            <DialogDescription>
              What you did and how long it took. This is what the month is measured against.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="duration">How long</Label>
                <Input
                  id="duration"
                  name="duration"
                  required
                  autoFocus
                  placeholder="1:30, 1.5 or 90m"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workDate">Day</Label>
                <Input id="workDate" name="workDate" type="date" required defaultValue={today} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="note">What you did</Label>
              <Input id="note" name="note" maxLength={1000} placeholder="Month-end close" />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Log time"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export interface TimeEntryView {
  id: string;
  version: number;
  minutes: number;
  workDate: string;
  note: string;
  /** Pre-formatted on the server. */
  durationLabel: string;
  who: string;
}

/** Edit or delete one entry. Both are member-level: a slip is fixed by whoever made it. */
export function TimeEntryRow({ entry }: { entry: TimeEntryView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(formData: FormData) {
    const minutes = parseDuration(String(formData.get("duration") ?? ""));
    if (minutes <= 0) {
      toast.error("How long? Try 1:30, 1.5 or 90m.");
      return;
    }
    startTransition(async () => {
      const result = await updateTimeEntryAction({
        entryId: entry.id,
        expectedVersion: entry.version,
        minutes,
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
            <DialogDescription>Logged by {entry.who}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor={`d-${entry.id}`}>How long</Label>
                <Input
                  id={`d-${entry.id}`}
                  name="duration"
                  required
                  defaultValue={(entry.minutes / 60).toFixed(2).replace(/\.?0+$/, "")}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`w-${entry.id}`}>Day</Label>
                <Input
                  id={`w-${entry.id}`}
                  name="workDate"
                  type="date"
                  required
                  defaultValue={entry.workDate}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`n-${entry.id}`}>What you did</Label>
              <Input id={`n-${entry.id}`} name="note" maxLength={1000} defaultValue={entry.note} />
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="destructive" disabled={pending} onClick={remove}>
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
 * Start, pause, resume, reopen, end. One button per move the engagement can
 * actually make — the rules live in `vocabulary.ts` so this component never
 * decides what is allowed.
 */
export function StatusButtons({
  engagementId,
  from,
  to,
}: {
  engagementId: string;
  from: EngagementStatus;
  to: readonly EngagementStatus[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      {to.map((status) => (
        <Button
          key={status}
          size="sm"
          variant={status === "ended" ? "outline" : "default"}
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setEngagementStatusAction({ engagementId, status });
              if ("error" in result) {
                toast.error(result.error);
                return;
              }
              toast.success(transitionDone(from, status));
              router.refresh();
            })
          }
        >
          {transitionVerb(from, status)}
        </Button>
      ))}
    </div>
  );
}
