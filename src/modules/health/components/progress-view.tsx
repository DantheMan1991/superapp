import { TrendingDown, TrendingUp } from "lucide-react";
import type { ProgressRow, ProgressWindow } from "@/lib/progress-sources/types";
import { cn } from "@/lib/utils";
import { barHeights, readRow, weekLabel, weekWords } from "../core/progress";

/**
 * PROGRESS, BY WEEK (H1, docs/help/health/progress.md; the founder's call: the
 * last four weeks). Each row: what it is, its newest week in words and which
 * way it is going against the weeks before, and a bar for each week, the
 * newest on the right, each labelled with its value for a screen reader.
 * Workouts' rows come through the progress slot; Health draws them all alike.
 *
 * The arrow is which way the number moved; the colour is whether that is the
 * better way. A week with nothing, or a zero, is a flat line, not a bar.
 */
export function ProgressView({ rows, windows }: { rows: ProgressRow[]; windows: ProgressWindow[] }) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
      {rows.map((row) => {
        const reading = readRow(row);
        const heights = barHeights(row.values, row.format, row.unit);
        return (
          <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 px-4 py-3">
            <div className="min-w-0 text-sm">
              <p className="text-base font-medium">{row.name}</p>
              {reading.latest === null ? (
                <p className="text-muted-foreground">Nothing in the last 7 days</p>
              ) : (
                <p>{`Last 7 days: ${reading.latest}`}</p>
              )}
              {reading.change && (
                <p className={cn("text-muted-foreground", reading.direction === "better" && "text-module-accent")}>
                  {reading.moved === "up" && <TrendingUp className="mr-1 inline size-3.5" aria-hidden />}
                  {reading.moved === "down" && <TrendingDown className="mr-1 inline size-3.5" aria-hidden />}
                  {reading.change}
                </p>
              )}
            </div>
            <div className="flex h-12 items-end gap-1.5" role="img" aria-label={barsLabel(row, windows)}>
              {heights.map((h, i) => (
                <span
                  key={i}
                  className={cn(
                    "w-3.5 rounded-t-sm",
                    !h ? "h-0.5 bg-muted" : i === heights.length - 1 ? "bg-module-accent" : "bg-module-accent/45",
                  )}
                  style={h ? { height: `${Math.max(6, Math.round(h * 100))}%` } : undefined}
                />
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function barsLabel(row: ProgressRow, windows: ProgressWindow[]): string {
  return row.values
    .map(
      (v, i) =>
        `${windows[i] ? `Week of ${weekLabel(windows[i])}` : `Week ${i + 1}`}: ${v === null ? "nothing" : weekWords(v, row.format, row.unit)}`,
    )
    .join(", ");
}
