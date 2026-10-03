"use client";

import { useState, useTransition } from "react";
import { Pencil, Target } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearWeightGoalAction, setWeightGoalAction } from "../actions";
import {
  goalLine,
  goalTitle,
  kgFromPounds,
  PACES_LB,
  poundsFromKg,
  typedPounds,
  WEIGHT_LB_MAX,
  WEIGHT_LB_MIN,
  type GoalReading,
  type WeightGoal,
} from "../core/body";

/**
 * THE GOAL on Body (H2; the founder's call, 2026-10-03: a goal weight and a
 * pace). Set, it says which way and how fast, how far is left, and when the
 * last four weeks' pace gets there; Progress colours the weight row by it.
 * Whether it is to lose or to gain is never asked: it is wherever the goal is
 * from the trend.
 */
export function GoalCard({
  goal,
  reading,
  paceKg,
  today,
  onChange,
}: {
  goal: WeightGoal | null;
  reading: GoalReading | null;
  /** The last four weeks' pace, kg a week, or null before there is one. */
  paceKg: number | null;
  today: string;
  onChange: (goal: WeightGoal | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [pace, setPace] = useState<number>(1);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const pounds = typedPounds(text);

  function open() {
    setText(goal ? String(Math.round(poundsFromKg(goal.goalKg) * 10) / 10) : "");
    setPace(goal ? nearestPace(poundsFromKg(goal.paceKg)) : 1);
    setEditing(true);
  }

  function save() {
    if (pounds === null) return;
    startTransition(async () => {
      const outcome = await setWeightGoalAction({ goalPounds: pounds, pacePounds: pace });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      onChange({ goalKg: kgFromPounds(pounds), paceKg: kgFromPounds(pace) });
      setEditing(false);
    });
  }

  function remove() {
    startTransition(async () => {
      const outcome = await clearWeightGoalAction();
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      onChange(null);
      setConfirming(false);
    });
  }

  return (
    <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Target className="size-4 text-module-accent" aria-hidden /> Goal
        </h2>
        {goal && !editing && !confirming && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={open}>
              <Pencil aria-hidden /> Change
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="goal-weight">Goal weight</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="goal-weight"
                  inputMode="decimal"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className="w-28"
                />
                <span>lb</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="goal-pace">About how fast</Label>
              <select
                id="goal-pace"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={pace}
                onChange={(e) => setPace(Number(e.target.value))}
              >
                {PACES_LB.map((p) => (
                  <option key={p} value={p}>
                    {`${p} lb a week`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {text.trim() !== "" && pounds === null && (
            <p className="text-sm text-destructive">{`Type a weight between ${WEIGHT_LB_MIN} and ${WEIGHT_LB_MAX} lb.`}</p>
          )}
          <p className="text-xs text-muted-foreground">Losing or gaining is worked out from where the goal is against your trend.</p>
          <div className="flex gap-2">
            <Button type="submit" disabled={pending || pounds === null}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Remove the goal? Your weigh-ins stay.</span>
          <Button variant="destructive" size="sm" onClick={remove} disabled={pending}>
            Remove
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
            Keep it
          </Button>
        </div>
      ) : goal && reading ? (
        <div>
          <p>{goalTitle(goal, reading.aim)}</p>
          <p className="text-sm text-muted-foreground">{goalLine(goal, reading, paceKg, today)}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            A goal weight and about how fast. Body shows when you get there at your real pace, and Progress shows which way
            is better for you.
          </p>
          <Button variant="outline" onClick={open}>
            <Target aria-hidden /> Set a goal
          </Button>
        </div>
      )}
    </section>
  );
}

/** The pace on offer nearest to one kept (a kept pace converts back to a whole option, give or take a rounding). */
function nearestPace(pounds: number): number {
  return PACES_LB.reduce((best, p) => (Math.abs(p - pounds) < Math.abs(best - pounds) ? p : best), PACES_LB[0] as number);
}
