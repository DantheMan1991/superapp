"use client";

import { cn } from "@/lib/utils";

/**
 * 0 TO 10 (H1): how rested after a night, how a plunge left you. The same
 * scale and the same look as Workouts' feel check, so a number means the same
 * on both. Optional: a second tap on the chosen number clears it.
 */
export function ScoreScale({
  value,
  onChange,
  label,
  low,
  high,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
  /** What 0 means, and what 10 means: "0 is worn out, 10 is fully rested." */
  low: string;
  high: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
            className={cn(
              "h-10 rounded-lg border text-base tabular-nums transition-colors",
              value === n ? "border-module-accent bg-module-accent text-white" : "border-border bg-card hover:bg-muted",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{`0 is ${low}, 10 is ${high}.`}</p>
    </fieldset>
  );
}
