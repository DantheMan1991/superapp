import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { MEASURES } from "../core/measures";
import type { Trend } from "../core/history";

/**
 * ONE MEASURE ACROSS YOUR CHECKS (docs/help/fitness/posture.md): the latest in
 * words, every check as a dot, and a shaded band around the first check as
 * wide as a real change must be. A dot outside the band is a real change from
 * the first; inside it, the checks cannot be told apart (ADR 0119). Never
 * colored good or bad: a change is a change.
 */
export function TrendCard({ trend }: { trend: Trend }) {
  const W = 160;
  const H = 44;
  const pad = 5;
  const values = trend.points.map((p) => p.value);
  const first = values[0];
  const lo = Math.min(...values, first - trend.noise.used);
  const hi = Math.max(...values, first + trend.noise.used);
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, values.length - 1);
  const y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
  const bandTop = y(first + trend.noise.used);
  const bandBottom = y(first - trend.noise.used);
  const unit = (v: number) => (trend.unit === "mm" ? `${Math.round(Math.abs(v))} mm` : `${Math.abs(v).toFixed(1)}°`);

  return (
    <li className="space-y-1 rounded-xl bg-card p-3 shadow-elevation-1">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-muted-foreground">{MEASURES[trend.key].name}</span>
        {trend.tier === "trend" && <Badge variant="outline">Trend only</Badge>}
      </div>
      <p className="text-sm font-medium">{trend.latestWords}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-11 w-full" role="img" aria-label={`${trend.points.length} checks`}>
        <rect x={0} y={bandTop} width={W} height={Math.max(1, bandBottom - bandTop)} className="fill-muted" />
        <polyline
          points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
          fill="none"
          className={trend.beyond ? "stroke-module-accent" : "stroke-muted-foreground"}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {values.map((v, i) => (
          <circle
            key={trend.points[i].id}
            cx={x(i)}
            cy={y(v)}
            r={2.5}
            className={i === values.length - 1 ? (trend.beyond ? "fill-module-accent" : "fill-foreground") : "fill-muted-foreground"}
          />
        ))}
      </svg>
      <p className={cn("text-xs", trend.beyond ? "text-module-accent" : "text-muted-foreground")}>
        {trend.beyond
          ? `${trend.changeWords} since your first check: more than the ${unit(trend.noise.used)} a real change needs.`
          : `Within your noise since your first check (a real change needs ${unit(trend.noise.used)}).`}
      </p>
    </li>
  );
}
