"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { changeWeighinAction, deleteWeighinAction } from "../actions";
import {
  goalWords,
  kgFromPounds,
  poundsChange,
  poundsFromKg,
  poundsWords,
  readGoal,
  trendOn,
  typedPounds,
  weekChange,
  weeklyPace,
  weightTrend,
  WEIGHT_LB_MAX,
  WEIGHT_LB_MIN,
  type Weighin,
  type WeightGoal,
} from "../core/body";
import { dayWords, shortDay } from "../core/days";
import { GoalCard } from "./goal-card";
import { WeightChart } from "./weight-chart";

/** How many weigh-ins the list shows before Show all. */
const LISTED = 14;

function weighinsKey(weighins: readonly Weighin[]): string {
  return weighins.map((w) => `${w.day}:${w.kg}`).join("|");
}

/**
 * BODY (H2, docs/help/health/body.md; the founder's mockup, 2026-10-03): the
 * trend now, how it moved this week and when the goal is reached; the chart;
 * the goal; the tape measures (drawn by the page and handed in); and every
 * weigh-in, newest first, each changed or removed in place.
 *
 * What was changed shows at once, and the server's weigh-ins and goal take
 * over the moment they differ from the ones last seen (the action answers
 * before the page it re-rendered arrives: the sleep card's gap).
 */
export function BodyView({
  today,
  weighins,
  goal: keptGoal,
  measures,
}: {
  today: string;
  /** Every weigh-in, oldest first. */
  weighins: Weighin[];
  goal: WeightGoal | null;
  /** The tape measures' card, drawn on the server. */
  measures: ReactNode;
}) {
  const [list, setList] = useState(weighins);
  const [seen, setSeen] = useState(weighinsKey(weighins));
  if (weighinsKey(weighins) !== seen) {
    setSeen(weighinsKey(weighins));
    setList(weighins);
  }
  const [goal, setGoal] = useState(keptGoal);
  const goalKey = keptGoal ? `${keptGoal.goalKg}|${keptGoal.paceKg}` : "";
  const [seenGoal, setSeenGoal] = useState(goalKey);
  if (goalKey !== seenGoal) {
    setSeenGoal(goalKey);
    setGoal(keptGoal);
  }

  const points = weightTrend(list);
  const trend = trendOn(points, today);
  const week = weekChange(points, today);
  const pace = weeklyPace(list, today);
  const reading = goal ? readGoal(goal, trend, pace, today) : null;
  const weekBetter =
    week !== null && reading !== null && ((reading.aim === "lose" && week < 0) || (reading.aim === "gain" && week > 0));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Tile label="Trend" value={trend === null ? "None yet" : poundsWords(trend)} />
        <Tile label="This week" value={week === null ? "Not yet" : poundsChange(week)} accent={weekBetter} />
        <Tile
          label={goal ? `Goal ${goalWords(goal.goalKg)}` : "Goal"}
          value={
            !goal || !reading
              ? "Not set"
              : reading.aim === "there"
                ? "You're there"
                : reading.reachedOn
                  ? `Around ${shortDay(reading.reachedOn, today)}`
                  : "No date yet"
          }
        />
      </div>

      <WeightChart points={points} goalKg={goal?.goalKg ?? null} today={today} />

      <GoalCard goal={goal} reading={reading} paceKg={pace} today={today} onChange={setGoal} />

      {measures}

      <WeighinList
        today={today}
        weighins={list}
        onChanged={(day, kg) => setList((now) => now.map((w) => (w.day === day ? { ...w, kg } : w)))}
        onRemoved={(day) => setList((now) => now.filter((w) => w.day !== day))}
      />
    </div>
  );
}

function Tile({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-card px-3 py-2 shadow-elevation-1">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-medium sm:text-base", accent && "text-module-accent")}>{value}</p>
    </div>
  );
}

/** Every weigh-in, newest first, each changed or removed where it is. */
function WeighinList({
  today,
  weighins,
  onChanged,
  onRemoved,
}: {
  today: string;
  weighins: Weighin[];
  onChanged: (day: string, kg: number) => void;
  onRemoved: (day: string) => void;
}) {
  const [all, setAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const newest = [...weighins].reverse();
  const listed = all ? newest : newest.slice(0, LISTED);
  const pounds = typedPounds(text);

  function open(w: Weighin) {
    setEditing(w.day);
    setText((Math.round(poundsFromKg(w.kg) * 10) / 10).toFixed(1));
    setConfirming(false);
  }

  function save(day: string) {
    if (pounds === null) return;
    startTransition(async () => {
      const outcome = await changeWeighinAction({ day, pounds });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      onChanged(day, kgFromPounds(pounds));
      setEditing(null);
    });
  }

  function remove(day: string) {
    startTransition(async () => {
      const outcome = await deleteWeighinAction({ day });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      onRemoved(day);
      setEditing(null);
      setConfirming(false);
    });
  }

  return (
    <section className="space-y-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <h2 className="font-medium">Weigh-ins</h2>
      {newest.length === 0 ? (
        <p className="text-sm text-muted-foreground">None yet. Your weigh-ins from Today are listed here, newest first.</p>
      ) : (
        <ul className="divide-y divide-border">
          {listed.map((w) => {
            // "Today", "Yesterday", "Tuesday, Sep 29"; a year back, "Sep 29, 2025".
            const label = w.day.slice(0, 4) === today.slice(0, 4) ? dayWords(w.day, today) : shortDay(w.day, today);
            return (
              <li key={w.day} className="py-1.5">
                {editing === w.day ? (
                  <form
                    className="space-y-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      save(w.day);
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mr-auto text-sm">{label}</span>
                      <Input
                        autoFocus
                        inputMode="decimal"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        className="w-24"
                        aria-label={`Weight on ${label}, in pounds`}
                      />
                      <span className="text-sm">lb</span>
                    </div>
                    {text.trim() !== "" && pounds === null && (
                      <p className="text-sm text-destructive">{`Type a weight between ${WEIGHT_LB_MIN} and ${WEIGHT_LB_MAX} lb.`}</p>
                    )}
                    {confirming ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm">Remove this weigh-in?</span>
                        <Button type="button" variant="destructive" size="sm" onClick={() => remove(w.day)} disabled={pending}>
                          Remove
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
                          Keep it
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" size="sm" disabled={pending || pounds === null}>
                          {pending ? "Saving…" : "Save"}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} disabled={pending}>
                          Cancel
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={pending}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </form>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="mr-auto text-sm">{label}</span>
                    <span>{poundsWords(w.kg)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Change the weigh-in on ${label}`}
                      onClick={() => open(w)}
                      disabled={pending}
                    >
                      <Pencil aria-hidden />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {newest.length > LISTED && (
        <Button variant="ghost" size="sm" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${newest.length}`}
        </Button>
      )}
    </section>
  );
}
