"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChevronRight, Pencil, Weight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteWeighinAction, saveWeighinAction } from "../actions";
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
  weightTrend,
  WEIGHT_LB_MAX,
  WEIGHT_LB_MIN,
  type Weighin,
  type WeightGoal,
} from "../core/body";
import { dayPhrase } from "../core/days";
import { PhotoNudge } from "../photos/photo-nudge";

const BODY = "/personal/m/health/body";

/**
 * THE WEIGHT CARD on Today (H2, docs/help/health/overview.md; the founder's
 * calls from a mockup, 2026-10-03): the day's weigh-in, typed in, starting
 * from the last one; once kept, the trend through it and how it moved this
 * week, and how far the goal is. Below, when the tape measures were last
 * taken, and Measure.
 *
 * Like the sleep card, it shows what it just kept at once (the action answers
 * before the page it re-rendered arrives), and the server's weigh-in takes
 * over the moment it differs from the one last seen. On today's, once the
 * progress photos on this phone are four weeks old, a line says so (H2b). The trend is worked out
 * here, from the weeks of weigh-ins the page sends, so it moves with the
 * weigh-in just kept.
 */
export function WeightCard({
  owner,
  day,
  today,
  asToday,
  weighins,
  goal,
  measures,
}: {
  /** The personal space: the photos on this phone are kept under it. */
  owner: string;
  day: string;
  today: string;
  /** The page shows today (not a day being filled in). */
  asToday: boolean;
  /** The two months of weigh-ins ending `day`, oldest first, the day's own among them when kept. */
  weighins: Weighin[];
  goal: WeightGoal | null;
  measures: { count: number; lastMeasured: string | null };
}) {
  const kept = weighins.find((w) => w.day === day)?.kg ?? null;
  const [shown, setShown] = useState(kept);
  const [seen, setSeen] = useState(kept);
  if (kept !== seen) {
    setSeen(kept);
    setShown(kept);
  }
  const before = weighins.filter((w) => w.day < day).at(-1) ?? null;
  const [editing, setEditing] = useState(kept === null);
  const [text, setText] = useState(startText(kept, asToday ? before : null));
  const [pending, startTransition] = useTransition();
  const pounds = typedPounds(text);

  const withShown = [...weighins.filter((w) => w.day !== day), ...(shown === null ? [] : [{ day, kg: shown }])];
  const points = weightTrend(withShown);
  const trend = trendOn(points, day);
  const week = weekChange(points, day);
  const reading = goal && trend !== null ? readGoal(goal, trend, null, day) : null;

  function save() {
    if (pounds === null) return;
    startTransition(async () => {
      const outcome = await saveWeighinAction({ day, pounds, asToday });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setShown(kgFromPounds(pounds));
      setEditing(false);
    });
  }

  function remove() {
    startTransition(async () => {
      const outcome = await deleteWeighinAction({ day });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setShown(null);
      setText(startText(null, asToday ? before : null));
      setEditing(true);
    });
  }

  const measureHref = `${BODY}/measure${asToday ? "" : `?day=${day}`}`;

  return (
    <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Weight className="size-4 text-module-accent" aria-hidden /> Weight
        </h2>
        <div className="flex items-center gap-1">
          {shown !== null && !editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setText(startText(shown, null));
                setEditing(true);
              }}
            >
              <Pencil aria-hidden /> Change
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href={BODY}>
              Body <ChevronRight aria-hidden />
            </Link>
          </Button>
        </div>
      </div>

      {shown !== null && !editing ? (
        <div>
          <p className="text-lg">{poundsWords(shown)}</p>
          {asToday && trend !== null && (
            <p className="text-sm text-muted-foreground">
              {`Trend ${poundsWords(trend)}${week === null ? "" : ` · ${poundsChange(week)} this week`}`}
            </p>
          )}
          {asToday && goal && reading && (
            <p className="text-sm text-muted-foreground">
              {reading.aim === "there"
                ? `At your goal of ${goalWords(goal.goalKg)}`
                : `${poundsWords(reading.toGoKg ?? 0)} to go to ${goalWords(goal.goalKg)}`}
            </p>
          )}
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              inputMode="decimal"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-28 text-base"
              aria-label="Weight, in pounds"
              placeholder="lb"
            />
            <span>lb</span>
            <Button type="submit" className="ml-auto" disabled={pending || pounds === null}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </div>
          {text.trim() !== "" && pounds === null && (
            <p className="text-sm text-destructive">{`Type a weight between ${WEIGHT_LB_MIN} and ${WEIGHT_LB_MAX} lb.`}</p>
          )}
          {shown !== null ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" variant="ghost" onClick={remove} disabled={pending}>
                Remove
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {asToday
                ? before
                  ? `Last weigh-in ${poundsWords(before.kg)} ${dayPhrase(before.day, today)}. The same scale, first thing in the morning, is the steadiest.`
                  : "The same scale, first thing in the morning, is the steadiest."
                : "No weigh-in that day. Type it in if you have it."}
            </p>
          )}
        </form>
      )}

      <p className="flex flex-wrap items-center justify-between gap-x-2 border-t border-border pt-2 text-sm text-muted-foreground">
        <span>
          {measures.count === 0
            ? "Your waist and other tape measures go on Body."
            : measures.lastMeasured === null
              ? "Tape measures: not taken yet."
              : `Tape measures last taken ${dayPhrase(measures.lastMeasured, today)}.`}
        </span>
        <Link className="text-module-accent underline" href={measures.count === 0 ? `${BODY}/measures` : measureHref}>
          {measures.count === 0 ? "Choose them" : "Measure"}
        </Link>
      </p>
      {asToday && <PhotoNudge owner={owner} today={today} />}
    </section>
  );
}

/** What the box starts with: the weigh-in being changed, the last one on today's, or nothing. */
function startText(kg: number | null, last: Weighin | null): string {
  const from = kg ?? last?.kg ?? null;
  return from === null ? "" : (Math.round(poundsFromKg(from) * 10) / 10).toFixed(1);
}
