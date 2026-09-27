"use client";

import { useState } from "react";
import { Check, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UNIT_WORDS, type FitnessUnitValue } from "../../core/program";

/**
 * REPS AND ROLLS CONFIRM THE TARGET (the founder's call, 2026-09-27): the set
 * shows what the program asks, Done records it, and minus is one tap for the
 * set that came up short. Nobody on a foam roller taps fifteen times.
 */
export function ConfirmCount({
  target,
  unit,
  onFinish,
}: {
  target: number;
  unit: FitnessUnitValue;
  onFinish: (count: number) => void;
}) {
  const [value, setValue] = useState(target);
  const words = UNIT_WORDS[unit][value === 1 ? "one" : "many"];

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
