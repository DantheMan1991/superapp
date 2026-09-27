"use client";

import { cn } from "@/lib/utils";

/**
 * "HOW DOES YOUR BODY FEEL?", 0 to 10, before the first exercise and after the
 * last. The founder's program promises "some improvement immediately
 * following your exercises"; this is how he finds out whether that is true
 * for him. Optional: a second tap on the chosen number clears it.
 */
export function FeelScale({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  label: string;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-base">{label}</legend>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            aria-pressed={value === n}
            onClick={() => onChange(value === n ? null : n)}
            className={cn(
              "h-11 rounded-lg border text-base tabular-nums transition-colors",
              value === n
                ? "border-module-accent bg-module-accent text-white"
                : "border-border bg-card hover:bg-muted",
            )}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">0 is stiff and sore, 10 is loose and easy.</p>
    </fieldset>
  );
}
