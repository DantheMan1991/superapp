"use client";

import { useRef, useState, useTransition } from "react";
import { Bell, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveReminderAction } from "../actions";
import {
  clockWords,
  minuteOfTime,
  REMINDER_STEP_MINUTES,
  timeOfMinute,
  type ReminderSlot,
  type ReminderView,
} from "../core/reminders";

const LABELS: Record<ReminderSlot, string> = { morning: "Morning", evening: "Evening" };

/** How long after the last change to a time it is saved: typing "07:30" is several changes. */
const SAVE_AFTER_MS = 800;

/**
 * THE PROGRAM'S REMINDERS (docs/help/fitness/program.md; F4a, approved from a
 * mockup): a morning and an evening time, each on or off, each saved as it
 * changes. They go to the Yosher app on the person's phone, on a day whose
 * sets are not done yet (core/reminders.ts, the cron in reminder-ops.ts).
 */
export function ReminderCard({
  programId,
  reminders,
  hasPhone,
}: {
  programId: string;
  reminders: ReminderView[];
  /** The person has a phone registered for notifications: without one, the card says so. */
  hasPhone: boolean;
}) {
  return (
    <section aria-label="Reminders" className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
      <h2 className="flex items-center gap-2 font-medium">
        <Bell className="size-4 text-muted-foreground" aria-hidden /> Reminders
      </h2>
      <div className="divide-y divide-border">
        {reminders.map((reminder) => (
          <ReminderRow key={reminder.slot} programId={programId} reminder={reminder} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        A push to the Yosher app on your phone at these times, on any day whose sets are not done yet.
      </p>
      {!hasPhone && (
        <p className="flex items-start gap-1.5 text-xs text-warning-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          No phone is set up for notifications yet. Open the Yosher app on your phone and allow notifications.
        </p>
      )}
    </section>
  );
}

function ReminderRow({ programId, reminder }: { programId: string; reminder: ReminderView }) {
  const label = LABELS[reminder.slot];
  const [time, setTime] = useState(timeOfMinute(reminder.atMinute));
  const [enabled, setEnabled] = useState(reminder.enabled);
  const [pending, startTransition] = useTransition();
  /** What the server last took, to go back to when a save is refused. */
  const saved = useRef({ time: timeOfMinute(reminder.atMinute), enabled: reminder.enabled });
  /** The switch as it is now, for a time saved after it changed. */
  const enabledNow = useRef(reminder.enabled);
  const timer = useRef<number | null>(null);

  function save(next: { time: string; enabled: boolean }) {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (minuteOfTime(next.time) === null) {
      toast.error("Choose a time for the reminder.");
      setTime(saved.current.time);
      return;
    }
    if (next.time === saved.current.time && next.enabled === saved.current.enabled) return;
    startTransition(async () => {
      const outcome = await saveReminderAction({ programId, slot: reminder.slot, ...next });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setTime(saved.current.time);
        setEnabled(saved.current.enabled);
        enabledNow.current = saved.current.enabled;
        return;
      }
      const switched = outcome.enabled !== saved.current.enabled;
      saved.current = { time: outcome.time, enabled: outcome.enabled };
      // A time between the tens comes back rounded: 7:34 is kept as 7:30.
      setTime(outcome.time);
      const at = clockWords(minuteOfTime(outcome.time) ?? 0);
      toast.success(
        outcome.enabled
          ? `${label} reminder at ${at}`
          : switched
            ? `${label} reminder off`
            : `${label} reminder set for ${at}. It is off until you turn it on.`,
      );
    });
  }

  return (
    <div className="flex items-center gap-3 py-2.5">
      <label htmlFor={`reminder-${reminder.slot}`} className="text-sm">
        {label}
      </label>
      <Input
        id={`reminder-${reminder.slot}`}
        type="time"
        step={REMINDER_STEP_MINUTES * 60}
        value={time}
        className="ml-auto h-9 w-32"
        onChange={(e) => {
          const value = e.target.value;
          setTime(value);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => save({ time: value, enabled: enabledNow.current }), SAVE_AFTER_MS);
        }}
        onBlur={() => {
          if (timer.current !== null) save({ time, enabled: enabledNow.current });
        }}
      />
      <Switch
        checked={enabled}
        disabled={pending}
        aria-label={`${label} reminder`}
        onCheckedChange={(on) => {
          setEnabled(on);
          enabledNow.current = on;
          save({ time, enabled: on });
        }}
      />
    </div>
  );
}
