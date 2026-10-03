"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CHART_RANGES, chartScale, goalWords, poundsFromKg, poundsWords, type TrendPoint } from "../core/body";
import { daysFrom, shortDay } from "../core/days";
import { shiftDay } from "../core/progress";

/** The chart's height, and its width until the card has been measured (a phone's). */
const H = 170;
const START_WIDTH = 320;
const LEFT = 30;
const TOP = 10;
const BOTTOM = 146;
const FONT = 11;

/**
 * THE WEIGHT CHART on Body (H2; the founder's mockup, 2026-10-03): each
 * weigh-in a dot, the trend a line through them, and the goal a dashed line
 * when it is near enough to draw without flattening the rest. The last 30 or
 * 90 days, or all of it, from the first weigh-in in them.
 *
 * Drawn at the card's own width in pixels (measured), so its words are the
 * same size on a phone and a desktop: a fixed viewBox scaled to a wide card
 * drew 17-pixel tick labels (the drive, 2026-10-03).
 */
export function WeightChart({ points, goalKg, today }: { points: TrendPoint[]; goalKg: number | null; today: string }) {
  const [range, setRange] = useState<(typeof CHART_RANGES)[number]["key"]>("30");
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(START_WIDTH);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const right = width - 6;
  const days = CHART_RANGES.find((r) => r.key === range)?.days ?? null;
  const from = days === null ? null : shiftDay(today, -(days - 1));
  const shown = from === null ? points : points.filter((p) => p.day >= from);
  const goalPounds = goalKg === null ? null : poundsFromKg(goalKg);
  const scale = chartScale(
    shown.flatMap((p) => [poundsFromKg(p.kg), poundsFromKg(p.trend)]),
    goalPounds,
  );

  // From the first weigh-in shown: a week of weigh-ins fills the chart, not a quarter of 30 days.
  const first = shown[0]?.day ?? from ?? today;
  const span = Math.max(1, daysFrom(first, today));
  const x = (day: string) => LEFT + ((right - LEFT) * daysFrom(first, day)) / span;
  const y = (pounds: number) => (scale ? BOTTOM - ((BOTTOM - TOP) * (pounds - scale.low)) / (scale.high - scale.low) : BOTTOM);
  const goalShown = scale !== null && goalPounds !== null && goalPounds >= scale.low && goalPounds <= scale.high;

  return (
    <section className="space-y-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <div className="flex flex-wrap gap-1" role="group" aria-label="How far back">
        {CHART_RANGES.map((r) => (
          <Button
            key={r.key}
            size="sm"
            variant={r.key === range ? "default" : "ghost"}
            aria-pressed={r.key === range}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </Button>
        ))}
      </div>
      <div ref={box}>
        {shown.length === 0 || scale === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {points.length === 0 ? "No weigh-ins yet. Weigh in on Today to start the line." : "No weigh-ins in these days. Try All."}
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${width} ${H}`}
            width={width}
            height={H}
            className="block"
            role="img"
            aria-label={`${shown.length} ${shown.length === 1 ? "weigh-in" : "weigh-ins"} from ${shortDay(shown[0].day, today)}; the trend now ${poundsWords(shown[shown.length - 1].trend)}${goalKg === null ? "" : `; the goal ${goalWords(goalKg)}`}.`}
          >
            {scale.ticks.map((t) => (
              <g key={t}>
                <line x1={LEFT} x2={right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={0.6} />
                <text x={LEFT - 4} y={y(t) + 4} textAnchor="end" fontSize={FONT} className="fill-muted-foreground">
                  {t}
                </text>
              </g>
            ))}
            {goalShown && goalPounds !== null && (
              <g>
                <line
                  x1={LEFT}
                  x2={right}
                  y1={y(goalPounds)}
                  y2={y(goalPounds)}
                  className="stroke-muted-foreground"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                />
                <text x={right} y={y(goalPounds) - 3} textAnchor="end" fontSize={FONT} className="fill-muted-foreground">
                  goal
                </text>
              </g>
            )}
            {shown.map((p) => (
              <circle key={p.day} cx={x(p.day)} cy={y(poundsFromKg(p.kg))} r={2.6} className="fill-module-accent/40" />
            ))}
            <polyline
              points={shown.map((p) => `${x(p.day).toFixed(1)},${y(poundsFromKg(p.trend)).toFixed(1)}`).join(" ")}
              fill="none"
              className="stroke-module-accent"
              strokeWidth={2}
              strokeLinejoin="round"
            />
            <text x={LEFT} y={H - 6} fontSize={FONT} className="fill-muted-foreground">
              {shortDay(first, today)}
            </text>
            <text x={right} y={H - 6} textAnchor="end" fontSize={FONT} className="fill-muted-foreground">
              Today
            </text>
          </svg>
        )}
      </div>
      <p className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2 rounded-full bg-module-accent/40" aria-hidden /> a weigh-in
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 bg-module-accent" aria-hidden /> the trend
        </span>
        {goalShown && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-4 border-t border-dashed border-muted-foreground" aria-hidden /> your goal
          </span>
        )}
      </p>
    </section>
  );
}
