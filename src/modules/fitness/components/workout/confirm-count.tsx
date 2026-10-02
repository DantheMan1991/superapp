"use client";

import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REPLY } from "../../core/hands-free";
import { UNIT_WORDS, type FitnessUnitValue } from "../../core/program";
import { useWorkoutCommands } from "./hands-free";
import { coachSay } from "./sound";

/**
 * REPS AND ROLLS CONFIRM THE TARGET (the founder's call, 2026-09-27): the set
 * shows what the program asks, Done records it, and minus is one tap for the
 * set that came up short. Nobody on a foam roller taps fifteen times.
 */
export function ConfirmCount({
  target,
  start = target,
  unit,
  onFinish,
}: {
  target: number;
  /**
   * Where the count starts: the target, or for an exercise with levels (F4c)
   * the set before's count, since a level's reps climb toward its mark and
   * nobody should tap up to it on every set.
   */
  start?: number;
  unit: FitnessUnitValue;
  onFinish: (count: number) => void;
}) {
  const [value, setValue] = useState(start);
  const words = UNIT_WORDS[unit][value === 1 ? "one" : "many"];

  // Hands-free (F6): "set done" is Done, with the count as it stands. A
  // counted set has no timer to start or pause.
  useWorkoutCommands((command) => {
    if (command === "done") onFinish(value);
    else if (command === "start") coachSay(REPLY.counted);
    else if (command === "pause" || command === "resume") coachSay(REPLY.noTimer);
    else return false;
    return true;
  });

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="flex items-center gap-6">
        <Button
          size="icon"
          variant="outline"
          className="size-14 rounded-full"
          aria-label="One fewer"
          disabled={value === 0}
          onClick={() => setValue((v) => Math.max(0, v - 1))}
        >
          <Minus className="size-6" aria-hidden />
        </Button>
        <div className="min-w-32 text-center">
          <div className="text-6xl font-medium tabular-nums leading-none">{value}</div>
          <div className="mt-1 text-base opacity-80">{words}</div>
        </div>
        <Button
          size="icon"
          variant="outline"
          className="size-14 rounded-full"
          aria-label="One more"
          disabled={value >= 1000}
          onClick={() => setValue((v) => Math.min(1000, v + 1))}
        >
          <Plus className="size-6" aria-hidden />
        </Button>
      </div>
      <p className="text-center text-sm opacity-80">
        Tap Done when the set is finished, or minus if you did fewer.
      </p>
      <Button size="lg" className="h-14 w-full text-lg" onClick={() => onFinish(value)}>
        <Check aria-hidden /> Done
      </Button>
    </div>
  );
}
