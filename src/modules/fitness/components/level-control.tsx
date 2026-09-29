"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setLevelAction } from "../actions";

/**
 * YOUR LEVEL (docs/help/fitness/program.md; F4c, approved from a mockup): on
 * an exercise card with levels, the level the person is on, Move up and Back
 * a level (his call: a level can be gone back to), and the "Ready for" line
 * when the last session at this level made the mark. Moving is the person's
 * decision, never the app's.
 */
export function LevelControl({
  programId,
  itemId,
  names,
  level,
  ready,
}: {
  programId: string;
  itemId: string;
  /** Every level's name, in order. */
  names: string[];
  level: number;
  /** "Ready for Progression 2: …", when the last session at this level made the mark. */
  ready: string | null;
}) {
  const router = useRouter();
  const [pending, startMoving] = useTransition();

  function go(to: number) {
    startMoving(async () => {
      const outcome = await setLevelAction({ programId, itemId, level: to });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      toast.success(`Now on ${names[to]}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-2">
          <TrendingUp className="size-4 shrink-0 text-module-accent" aria-hidden />
          <span>
            Your level: <span className="font-medium">{names[level]}</span>
            {` of ${names.length}`}
          </span>
        </span>
        <span className="flex gap-1">
          {level > 0 && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => go(level - 1)}>
              Back a level
            </Button>
          )}
          {level < names.length - 1 && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => go(level + 1)}>
              Move up
            </Button>
          )}
        </span>
      </div>
      {ready && <p className="rounded-lg bg-module-accent/10 px-3 py-2 text-sm text-module-accent">{ready}</p>}
    </div>
  );
}
