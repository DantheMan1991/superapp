"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Play, Snowflake, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deletePlungeAction } from "../actions";
import { plungeWords, waterWords } from "../core/plunge";
import { useRunningPlunge } from "./plunge-store";

/**
 * TODAY'S COLD PLUNGES (H1): any taken today, with Remove for one logged by
 * mistake (asked twice: a wet thumb finds the wrong button); how many this
 * week; and Start the timer, or Back to the timer when one is still running on
 * this phone.
 */
export function PlungeCard({
  plunges,
  thisWeek,
}: {
  plunges: { id: string; seconds: number; waterF: number | null; feelAfter: number | null }[];
  /** In the seven days ending today. */
  thisWeek: number;
}) {
  const running = useRunningPlunge();
  const [confirming, setConfirming] = useState<string | null>(null);
  // Removed here, and gone from the list at once: the page the action
  // re-rendered streams in seconds after it answers (the sleep card's gap).
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const listed = plunges.filter((p) => !removed.includes(p.id));
  const week = thisWeek - (plunges.length - listed.length);

  function remove(id: string) {
    startTransition(async () => {
      const outcome = await deletePlungeAction({ id });
      if ("error" in outcome) toast.error(outcome.error);
      else setRemoved((ids) => [...ids, id]);
      setConfirming(null);
    });
  }

  return (
    <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <h2 className="flex items-center gap-2 font-medium">
        <Snowflake className="size-4 text-module-accent" aria-hidden /> Cold plunge
      </h2>
      {listed.length === 0 ? (
        <p className="text-sm text-muted-foreground">{`Not yet today · ${week} in the last 7 days`}</p>
      ) : (
        <ul className="space-y-1">
          {listed.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-x-2">
              <span>
                {plungeWords(p.seconds)}
                {p.waterF !== null && ` in ${waterWords(p.waterF)}`}
                {p.feelAfter !== null && <span className="text-muted-foreground">{` · felt ${p.feelAfter}`}</span>}
              </span>
              {confirming === p.id ? (
                <span className="ml-auto flex items-center gap-1">
                  <span className="text-sm">Remove it?</span>
                  <Button variant="destructive" size="sm" onClick={() => remove(p.id)} disabled={pending}>
                    Remove
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={pending}>
                    Keep it
                  </Button>
                </span>
              ) : (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove the ${plungeWords(p.seconds)} plunge`}
                  onClick={() => setConfirming(p.id)}
                  disabled={pending}
                >
                  <X aria-hidden />
                </Button>
              )}
            </li>
          ))}
          <li className="text-sm text-muted-foreground">{`${week} in the last 7 days`}</li>
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/personal/m/health/plunge">
            <Play aria-hidden /> {running ? "Back to the timer" : "Start the timer"}
          </Link>
        </Button>
        {!running && (
          <Button asChild variant="outline">
            <Link href="/personal/m/health/plunge?typed=1">Type one in</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
