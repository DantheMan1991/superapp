"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatMinutesAsHours } from "@/lib/retainer-core";
import {
  cancelTimer,
  deleteTimeEntry,
  logManualTime,
  setRetainerAllotment,
  startTimer,
  stopTimer,
  updateTimeEntry,
} from "./actions";

export function AllotmentForm({
  tenantId,
  includedHours,
}: {
  tenantId: string;
  includedHours: number;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await setRetainerAllotment(formData);
          if (res?.error) toast.error(res.error);
          else toast.success("Allotment updated (this month onward)");
        })
      }
      className="flex items-center gap-2"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <Input
        name="includedHours"
        type="number"
        step="0.5"
        min="0"
        max="500"
        defaultValue={includedHours}
        className="w-24"
        aria-label="Included hours per month"
      />
      <span className="text-xs text-muted-foreground">h/mo</span>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}

export function TimerControls({
  tenantId,
  timerStartedAt,
  timerNote,
}: {
  tenantId: string;
  timerStartedAt: string | null;
  timerNote: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");

  // The clock is impure and must not be read while rendering. Doing so was
  // wrong twice over: the server rendered ITS current time and the client then
  // hydrated with a different one, and after that the figure sat frozen until
  // some unrelated state change happened to re-render the component. Holding it
  // in state on an interval fixes both, and makes a running timer actually tick.
  // Tagged with the timer it was measured against, so a stopped-then-restarted
  // timer can never show the previous run's figure for a frame. That also means
  // the effect never has to reset anything, and so never calls setState
  // synchronously — which would cascade an extra render before paint.
  const [elapsed, setElapsed] = useState<{
    startedAt: string;
    min: number;
  } | null>(null);

  useEffect(() => {
    if (!timerStartedAt) return;
    const startedAt = new Date(timerStartedAt).getTime();
    const tick = () =>
      setElapsed({
        startedAt: timerStartedAt,
        min: Math.max(1, Math.ceil((Date.now() - startedAt) / 60_000)),
      });
    // Scheduled rather than taken inline, for the reason above; a zero-delay
    // timer lands in the next macrotask, so the figure is there immediately.
    const first = setTimeout(tick, 0);
    // The display is in minutes; half a minute keeps it honest without churn.
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [timerStartedAt]);

  if (!timerStartedAt) {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What are you working on? (optional)"
          className="h-8 w-56"
          maxLength={2000}
        />
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await startTimer({
                tenantId,
                note: note || undefined,
              });
              if (res?.error) toast.error(res.error);
              else {
                toast.success("Timer started");
                setNote("");
              }
            })
          }
        >
          {pending ? "Starting…" : "Start timer"}
        </Button>
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await stopTimer(formData);
          if (res?.error) toast.error(res.error);
          else toast.success("Time logged");
        })
      }
      className="space-y-2"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <p className="text-xs text-muted-foreground">
        {elapsed?.startedAt === timerStartedAt
          ? `Running for ~${formatMinutesAsHours(elapsed.min)}`
          : "Running…"}
      </p>
      <Textarea
        name="note"
        defaultValue={timerNote ?? ""}
        placeholder="What got done? The client reads this."
        required
        maxLength={2000}
        rows={2}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Stopping…" : "Stop & log"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (!confirm("Discard this timer without logging any time?")) {
                return;
              }
              const res = await cancelTimer({ tenantId });
              if (res?.error) toast.error(res.error);
              else toast.success("Timer discarded");
            })
          }
        >
          Cancel timer
        </Button>
      </div>
    </form>
  );
}

export function ManualLogForm({
  tenantId,
  today,
}: {
  tenantId: string;
  today: string;
}) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          const res = await logManualTime(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Time logged");
            formRef.current?.reset();
          }
        })
      }
      className="space-y-2"
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="flex gap-2">
        <Input
          name="hours"
          type="number"
          step="0.1"
          min="0.1"
          max="24"
          placeholder="1.5"
          required
          className="w-24"
          aria-label="Hours"
        />
        <Input
          name="workDate"
          type="date"
          defaultValue={today}
          max={today}
          required
          className="w-40"
          aria-label="Work date"
        />
      </div>
      <Textarea
        name="note"
        placeholder="What got done? The client reads this."
        required
        maxLength={2000}
        rows={2}
      />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Logging…" : "Log time"}
      </Button>
    </form>
  );
}

export function EntryEditRow({
  entry,
  today,
}: {
  entry: {
    id: string;
    tenantId: string;
    minutes: number;
    workDate: string;
    note: string;
    source: string;
  };
  today: string;
}) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-2 py-1.5 text-sm">
        <div className="min-w-0">
          <span className="text-muted-foreground">{entry.workDate}</span>{" "}
          <span className="font-medium">
            {formatMinutesAsHours(entry.minutes)}
          </span>{" "}
          <span className="break-words">{entry.note}</span>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                if (!confirm("Delete this time entry?")) return;
                const res = await deleteTimeEntry({
                  entryId: entry.id,
                  tenantId: entry.tenantId,
                });
                if (res?.error) toast.error(res.error);
                else toast.success("Entry deleted");
              })
            }
          >
            Delete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          const res = await updateTimeEntry(formData);
          if (res?.error) toast.error(res.error);
          else {
            toast.success("Entry updated");
            setEditing(false);
          }
        })
      }
      className="space-y-2 rounded-md border p-2"
    >
      <input type="hidden" name="entryId" value={entry.id} />
      <input type="hidden" name="tenantId" value={entry.tenantId} />
      <div className="flex gap-2">
        <Input
          name="hours"
          type="number"
          step="0.1"
          min="0.1"
          max="24"
          defaultValue={(entry.minutes / 60).toFixed(1)}
          required
          className="w-24"
          aria-label="Hours"
        />
        <Input
          name="workDate"
          type="date"
          defaultValue={entry.workDate}
          max={today}
          required
          className="w-40"
          aria-label="Work date"
        />
      </div>
      <Textarea name="note" defaultValue={entry.note} required maxLength={2000} rows={2} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
