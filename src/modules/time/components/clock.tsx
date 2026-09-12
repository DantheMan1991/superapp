"use client";

import { useEffect, useState, useTransition } from "react";
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
  adjustPunchStartAction,
  cancelPunchAction,
  clockInAction,
  clockOutAction,
} from "../actions";
import { formatDuration } from "../core/duration";
import { LONG_PUNCH_MINUTES } from "../core/rounding";

export interface ClockWorker {
  id: string;
  name: string;
}

export interface RunningClock {
  id: string;
  version: number;
  workerId: string;
  workerName: string;
  /**
   * How long it had been running when the SERVER rendered. The browser ticks
   * up from here rather than computing it, so the first paint is already right
   * and matches what the server sent.
   */
  elapsedMinutes: number;
  /** Pre-formatted on the server, in the TENANT's zone, never the browser's. */
  startedAtLabel: string;
  /** `yyyy-mm-ddThh:mm` in the tenant's zone, for the correction box. */
  startedAtLocal: string;
  note: string;
  mine: boolean;
}

/**
 * How long a clock has been running: the server's figure, ticking up.
 *
 * IT COUNTS FROM MOUNT RATHER THAN READING THE PUNCH'S OWN START. The browser's
 * clock and the server's disagree by seconds on a good day and by minutes on a
 * laptop that has not synced, and taking the difference here would show a
 * number nobody else can reproduce. Elapsed time since MOUNT is a duration, and
 * a duration is the one thing a local clock measures reliably.
 *
 * The server value is also what the first paint renders, so there is nothing
 * for hydration to mismatch on.
 *
 * Every fifteen seconds, not every second: the display is in whole minutes, so
 * a faster tick would re-render four times for every change a reader can see.
 */
function useElapsedMinutes(serverElapsedMinutes: number): number {
  const [sinceMount, setSinceMount] = useState(0);
  useEffect(() => {
    const mountedAt = Date.now();
    const id = setInterval(
      () => setSinceMount(Math.floor((Date.now() - mountedAt) / 60_000)),
      15_000,
    );
    return () => clearInterval(id);
  }, [serverElapsedMinutes]);
  return serverElapsedMinutes + sinceMount;
}

/** Start somebody's clock. */
export function ClockInButton({
  workers,
  defaultWorkerId,
  runningWorkerIds,
}: {
  workers: ClockWorker[];
  defaultWorkerId: string | null;
  /** Already on the clock: offering them again only earns a refusal. */
  runningWorkerIds: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const running = new Set(runningWorkerIds);
  const available = workers.filter((w) => !running.has(w.id));
  const [workerId, setWorkerId] = useState(
    defaultWorkerId && !running.has(defaultWorkerId)
      ? defaultWorkerId
      : (available[0]?.id ?? ""),
  );

  function submit(formData: FormData) {
    if (!workerId) {
      toast.error("Who is starting?");
      return;
    }
    startTransition(async () => {
      const result = await clockInAction({
        workerId,
        note: String(formData.get("note") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Clock started");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={available.length === 0}>
          Start a clock
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={submit}>
          <DialogHeader>
            <DialogTitle>Start a clock</DialogTitle>
            <DialogDescription>
              It runs until somebody stops it. Nothing is logged until then.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="clock-worker">Who</Label>
              <Select value={workerId} onValueChange={setWorkerId}>
                <SelectTrigger id="clock-worker">
                  <SelectValue placeholder="Pick a person" />
                </SelectTrigger>
                <SelectContent>
                  {available.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {available.length < workers.length && (
                <p className="text-xs text-muted-foreground">
                  Anybody already on the clock is left out of this list.
                </p>
              )}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clock-note">What they are doing</Label>
              <Input
                id="clock-note"
                name="note"
                maxLength={1000}
                placeholder="Fencing on the top field"
              />
              <p className="text-xs text-muted-foreground">
                Optional. You can add or change it when the clock stops.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Starting…" : "Start"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One running clock: how long, and the two ways it can end. */
export function RunningClockRow({
  clock,
  roundingMinutes,
  canWrite,
}: {
  clock: RunningClock;
  roundingMinutes: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fixOpen, setFixOpen] = useState(false);
  const elapsed = useElapsedMinutes(clock.elapsedMinutes);
  const tooLong = elapsed >= LONG_PUNCH_MINUTES;

  function stop() {
    startTransition(async () => {
      const result = await clockOutAction({ punchId: clock.id, note: "" });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      const { rawMinutes, paidMinutes, entryId } = result.data!;
      if (entryId === null) {
        // The honest outcome of a short punch on a coarse rounding policy.
        toast.success(
          `Clock stopped after ${formatDuration(rawMinutes)}. Rounding to ${roundingMinutes} minutes left nothing to log.`,
        );
      } else if (paidMinutes !== rawMinutes) {
        toast.success(
          `${formatDuration(rawMinutes)} worked, ${formatDuration(paidMinutes)} logged after rounding.`,
        );
      } else {
        toast.success(`${formatDuration(paidMinutes)} logged`);
      }
      router.refresh();
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelPunchAction({ punchId: clock.id });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Clock thrown away. Nothing was logged.");
      router.refresh();
    });
  }

  function fix(formData: FormData) {
    startTransition(async () => {
      const result = await adjustPunchStartAction({
        punchId: clock.id,
        expectedVersion: clock.version,
        startedAtLocal: String(formData.get("startedAtLocal") ?? ""),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Start time corrected");
      setFixOpen(false);
      router.refresh();
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">
        {clock.workerName}
        {clock.mine && (
          <span className="ml-2 text-xs text-subtle-foreground">you</span>
        )}
      </span>
      <span
        className={`tabular-nums ${tooLong ? "font-medium text-warning-foreground" : ""}`}
      >
        {formatDuration(elapsed)}
      </span>
      <span className="text-xs text-subtle-foreground">
        since {clock.startedAtLabel}
      </span>
      {/* A pale tint with dark text, never a saturated fill and never
          `--warning` drawn on — it measures 2.18:1 on the page. The dark twin
          is the legible half of the pair. */}
      {tooLong && (
        <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning-foreground">
          Running over 16 hours — correct the start or throw it away
        </span>
      )}
      {canWrite && (
        <div className="flex items-center gap-1">
          <Dialog open={fixOpen} onOpenChange={setFixOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                Fix start
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form action={fix}>
                <DialogHeader>
                  <DialogTitle>When did this start?</DialogTitle>
                  <DialogDescription>
                    For when somebody forgot to start the clock, or started it
                    late. Nothing is logged until it stops.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2 py-4">
                  <Label htmlFor={`s-${clock.id}`}>Started at</Label>
                  <Input
                    id={`s-${clock.id}`}
                    name="startedAtLocal"
                    type="datetime-local"
                    required
                    defaultValue={clock.startedAtLocal}
                  />
                  <p className="text-xs text-muted-foreground">
                    Your business&apos;s local time.
                  </p>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={pending}>
                    {pending ? "Saving…" : "Save"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
          <Button variant="ghost" size="sm" disabled={pending} onClick={cancel}>
            Throw away
          </Button>
          <Button size="sm" disabled={pending} onClick={stop}>
            Stop
          </Button>
        </div>
      )}
    </li>
  );
}
