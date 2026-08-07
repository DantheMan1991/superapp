"use client";

import { useRef, useState, useSyncExternalStore, useTransition } from "react";
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

/**
 * The wall clock, as an external store — which is what it is. Reading
 * `Date.now()` in a render body is impure, and it showed: the running-timer
 * readout froze at whatever the first paint computed, and the number the server
 * rendered was never the number the browser would have.
 *
 * The snapshot is the minute, not the millisecond, for two reasons. React
 * compares snapshots by identity to decide whether to re-render, so a raw
 * `Date.now()` would look like a new value every single check and spin. And a
 * readout that says "~2h" has no use for finer resolution anyway. Polling
 * faster than the snapshot changes just means the display turns over promptly
 * when the minute does.
 */
const CLOCK_POLL_MS = 20_000;
const subscribeToClock = (onChange: () => void) => {
  const id = setInterval(onChange, CLOCK_POLL_MS);
  return () => clearInterval(id);
};
const currentMinute = () => Math.floor(Date.now() / 60_000);
/** No clock on the server, so there is nothing for hydration to disagree with. */
const noClock = () => null;

/**
 * Its own component so the clock subscription lives exactly where the readout
 * does. The retainers page renders a TimerControls per tenant and all but the
 * running one pass `timerStartedAt={null}` — subscribing up there would give
 * every idle row an interval with nothing to display.
 */
function ElapsedReadout({ startedAt }: { startedAt: string }) {
  const nowMinute = useSyncExternalStore(
    subscribeToClock,
    currentMinute,
    noClock,
  );
  // One paint before the client has a clock, so say the true thing meanwhile.
  if (nowMinute === null) return <>Timer running</>;
  const elapsedMin = Math.max(
    1,
    Math.ceil((nowMinute * 60_000 - new Date(startedAt).getTime()) / 60_000),
  );
  return <>Running for ~{formatMinutesAsHours(elapsedMin)}</>;
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
        <ElapsedReadout startedAt={timerStartedAt} />
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
