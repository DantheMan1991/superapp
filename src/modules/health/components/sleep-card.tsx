"use client";

import { useState, useTransition } from "react";
import { Moon, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteSleepAction, saveSleepAction } from "../actions";
import { clockWords, durationWords, sleepMinutes } from "../core/sleep";
import { ScoreScale } from "./score-scale";

interface Night {
  bedTime: string;
  wokeTime: string;
  minutes: number;
  rested: number | null;
}

function nightKey(night: Night | null): string {
  return night ? `${night.bedTime}|${night.wokeTime}|${night.minutes}|${night.rested ?? ""}` : "";
}

/**
 * LAST NIGHT'S SLEEP on Today (H1; the founder's call: bed and wake times,
 * filled in from the night before, so most mornings it is one tap; the hours
 * worked out; how rested, 0 to 10). Kept, it reads "7 h 20 min · rested 8 of
 * 10" with Change; not yet, it is the form, already filled in.
 *
 * The card shows the night it just saved at once. A server action answers
 * before the page it re-rendered has streamed in (seconds, on a slow line),
 * and in between the props still hold the night before the save: drawn from
 * them, the card showed the old night after a Save (the drive, 2026-10-02).
 * So it keeps what it saved, and the server's night takes over the moment it
 * differs from the one last seen (the save landing, a new day, another tab).
 */
export function SleepCard({
  today,
  night,
  start,
}: {
  today: string;
  /** This morning's night, when it has been kept. */
  night: Night | null;
  /** The times the form starts from: this morning's, the last night kept, or a usual night. */
  start: { bedTime: string; wokeTime: string; rested: number | null };
}) {
  const [shown, setShown] = useState(night);
  const [seen, setSeen] = useState(nightKey(night));
  if (nightKey(night) !== seen) {
    setSeen(nightKey(night));
    setShown(night);
  }
  const [editing, setEditing] = useState(night === null);
  const [bedTime, setBedTime] = useState(start.bedTime);
  const [wokeTime, setWokeTime] = useState(start.wokeTime);
  const [rested, setRested] = useState<number | null>(night ? night.rested : null);
  const [pending, startTransition] = useTransition();
  const minutes = sleepMinutes(bedTime, wokeTime);

  function save() {
    if (minutes === null) return;
    const kept = { bedTime, wokeTime, minutes, rested };
    startTransition(async () => {
      const outcome = await saveSleepAction({ wokeOn: today, bedTime, wokeTime, rested });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setShown(kept);
      setEditing(false);
    });
  }

  function remove() {
    startTransition(async () => {
      const outcome = await deleteSleepAction({ wokeOn: today });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setShown(null);
      setEditing(true);
    });
  }

  return (
    <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Moon className="size-4 text-module-accent" aria-hidden /> Last night&apos;s sleep
        </h2>
        {shown && !editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden /> Change
          </Button>
        )}
      </div>

      {shown && !editing ? (
        <div>
          <p className="text-lg">
            {durationWords(shown.minutes)}
            {shown.rested !== null && <span className="text-muted-foreground">{` · rested ${shown.rested} of 10`}</span>}
          </p>
          <p className="text-sm text-muted-foreground">{`${clockWords(shown.bedTime)} to ${clockWords(shown.wokeTime)}`}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="bed-time">Into bed</Label>
              <Input id="bed-time" type="time" value={bedTime} onChange={(e) => setBedTime(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="woke-time">Woke up</Label>
              <Input id="woke-time" type="time" value={wokeTime} onChange={(e) => setWokeTime(e.target.value)} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {minutes === null ? "Bed and wake times are the same." : `${durationWords(minutes)} of sleep.`}
          </p>
          <ScoreScale label="How rested do you feel?" value={rested} onChange={setRested} low="worn out" high="fully rested" />
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={pending || minutes === null}>
              {pending ? "Saving…" : "Save"}
            </Button>
            {shown && (
              <>
                <Button variant="outline" onClick={() => setEditing(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button variant="ghost" onClick={remove} disabled={pending}>
                  Remove
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
