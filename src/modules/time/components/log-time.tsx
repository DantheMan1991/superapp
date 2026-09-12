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
import { logTimeAction } from "../actions";
import { formatDuration, parseDuration } from "../core/duration";
import { PAY_TYPES, payTypeLabel } from "../core/pay-types";

export interface WorkerOption {
  id: string;
  name: string;
}

/**
 * Log an hour. The one thing this module does in slice 0.
 *
 * THE DURATION ECHOES BACK BEFORE ANYTHING IS SAVED. `parseDuration` guesses on
 * a bare number — under 16 is hours, 16 or more is minutes — and a guess about
 * money has to be visible while it can still be corrected. "7h 30m" under the
 * box is cheaper than a timesheet somebody audits a fortnight later.
 */
export function LogTimeForm({
  workers,
  defaultWorkerId,
  today,
  dimensionTypes,
}: {
  workers: WorkerOption[];
  /** The signed-in person's own worker row, when they have one. */
  defaultWorkerId: string | null;
  today: string;
  /**
   * What this business can book an hour to. Empty for most tenants, and
   * `DimensionTags` renders nothing at all in that case — a business with no
   * paddocks and no lines of business should not carry a control that opens
   * an empty popover.
   */
  dimensionTypes: DimensionTypeOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [workerId, setWorkerId] = useState(defaultWorkerId ?? workers[0]?.id ?? "");
  const [payType, setPayType] = useState<string>("worked");
  const [duration, setDuration] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);

  const minutes = parseDuration(duration);

  function submit(formData: FormData) {
    if (!workerId) {
      toast.error("Who worked?");
      return;
    }
    if (minutes <= 0) {
      toast.error("How long? Try 1:30, 1.5 or 90m.");
      return;
    }
    startTransition(async () => {
      const result = await logTimeAction({
        workerId,
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
      toast.success(`${formatDuration(minutes)} logged`);
      setOpen(false);
      setDuration("");
      setMemberIds([]);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={workers.length === 0}>Log time</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Log time</DialogTitle>
            <DialogDescription>
              Who worked, how long, and on which day.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="worker">Who</Label>
              <Select value={workerId} onValueChange={setWorkerId}>
                <SelectTrigger id="worker">
                  <SelectValue placeholder="Pick a person" />
                </SelectTrigger>
                <SelectContent>
                  {workers.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="duration">How long</Label>
                <Input
                  id="duration"
                  name="duration"
                  required
                  autoFocus
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="1:30, 1.5 or 90m"
                />
                <p className="text-xs text-muted-foreground">
                  {duration.trim() === ""
                    ? "Hours and minutes, decimal hours, or minutes."
                    : minutes > 0
                      ? `That is ${formatDuration(minutes)}.`
                      : "Not a length we can read."}
                </p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="workDate">Day</Label>
                <Input
                  id="workDate"
                  name="workDate"
                  type="date"
                  required
                  max={today}
                  defaultValue={today}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="payType">Kind</Label>
              <Select value={payType} onValueChange={setPayType}>
                <SelectTrigger id="payType">
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
              <Label htmlFor="note">What they did</Label>
              <Input
                id="note"
                name="note"
                maxLength={1000}
                placeholder="Fencing on the top field"
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
                <p className="text-xs text-subtle-foreground">
                  Optional, and it is what lets these hours show up as a cost
                  against that part of the business.
                </p>
              </div>
            )}
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
