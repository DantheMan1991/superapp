"use client";

import { useMemo } from "react";
import {
  featureKindLabel,
  featureStyle,
  resolveWidth,
  FEATURE_STATUS_LABELS,
  STATUS_STYLES,
  type FeatureStatus,
} from "../core/features";
import { asFeatureGeometry, shapeOf, type GeometryShape } from "../core/geo";
import type { PlanFeature } from "./site-plan-map";

/**
 * The key. What each line on this plan means.
 *
 * **ONLY WHAT IS ACTUALLY ON THIS PARCEL**, never the whole vocabulary. A key
 * listing fourteen kinds when three are drawn is a catalogue, and a catalogue
 * is the thing you stop reading — the point of a legend is that it is shorter
 * than the drawing.
 *
 * It renders the SAME styles the map does, from the same functions, because a
 * legend drawn from a second copy of the palette is a legend that goes quietly
 * wrong. The swatches are inline SVG rather than divs with borders for the same
 * reason: a dash pattern and a casing are hard to fake in CSS and easy to get
 * subtly different, and subtly different is worse than absent.
 *
 * GROUPED BY KIND AND SHAPE TOGETHER, because they are what the symbology takes
 * — woods and a tree line are both vegetation green and would otherwise collapse
 * into one row that describes neither.
 */
export function PlanLegend({
  features,
  className,
}: {
  features: PlanFeature[];
  className?: string;
}) {
  const entries = useMemo(() => {
    const seen = new Map<string, { kind: string; shape: GeometryShape }>();
    for (const feature of features) {
      const geometry = asFeatureGeometry(feature.geometry);
      if (!geometry) continue;
      const shape = shapeOf(geometry);
      const key = `${feature.kind}:${shape}`;
      if (!seen.has(key)) seen.set(key, { kind: feature.kind, shape });
    }
    return [...seen.values()].sort((a, b) =>
      featureKindLabel(a.kind).localeCompare(featureKindLabel(b.kind)),
    );
  }, [features]);

  const statuses = useMemo(() => {
    const present = new Set(features.map((f) => f.status));
    // Only worth explaining once there is something to tell apart. On a plan of
    // nothing but built fences, "Built" is not news.
    return present.size > 1
      ? (["built", "planned", "removed"] as FeatureStatus[]).filter((s) =>
          present.has(s),
        )
      : [];
  }, [features]);

  if (entries.length === 0) return null;

  return (
    <div className={className}>
      <h3 className="text-xs font-medium text-muted-foreground">Key</h3>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {entries.map(({ kind, shape }) => (
          <div key={`${kind}:${shape}`} className="flex items-center gap-2">
            <Swatch kind={kind} shape={shape} status="built" />
            <span className="text-xs">{featureKindLabel(kind)}</span>
          </div>
        ))}
      </div>

      {statuses.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 border-t pt-2">
          {statuses.map((status) => (
            <div key={status} className="flex items-center gap-2">
              {/* Shown on a neutral kind, so the row explains the STATUS and
                  not whichever colour happened to be drawn in it. */}
              <Swatch kind="fence" shape="line" status={status} />
              <span className="text-xs text-muted-foreground">
                {FEATURE_STATUS_LABELS[status]}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One sample, drawn the way the map draws it. */
function Swatch({
  kind,
  shape,
  status,
}: {
  kind: string;
  shape: GeometryShape;
  status: FeatureStatus;
}) {
  const style = featureStyle(kind, shape);
  const width = resolveWidth(kind, shape, null);
  const statusStyle = STATUS_STYLES[status];
  const dash = statusStyle.keepKindDash ? style.dash : statusStyle.dash;
  // The map expresses a dash in line-widths; SVG expresses it in user units, so
  // it is multiplied here rather than copied. Getting this wrong is how a
  // legend ends up looking almost but not quite like the thing it describes.
  const dashArray = dash ? dash.map((d) => d * width).join(" ") : undefined;

  if (shape === "point") {
    return (
      <svg width="22" height="12" aria-hidden className="shrink-0">
        <circle
          cx="11"
          cy="6"
          r={width + 2}
          fill={style.casing}
          opacity={statusStyle.opacity}
        />
        <circle
          cx="11"
          cy="6"
          r={width}
          fill={style.color}
          opacity={statusStyle.opacity}
        />
      </svg>
    );
  }

  if (shape === "area") {
    return (
      <svg width="22" height="12" aria-hidden className="shrink-0">
        <rect
          x="1"
          y="1"
          width="20"
          height="10"
          fill={style.color}
          fillOpacity={style.fill * statusStyle.opacity}
          stroke={style.color}
          strokeWidth={width}
          strokeDasharray={dashArray}
          opacity={statusStyle.opacity}
        />
      </svg>
    );
  }

  return (
    <svg width="22" height="12" aria-hidden className="shrink-0">
      <line
        x1="1"
        y1="6"
        x2="21"
        y2="6"
        stroke={style.casing}
        strokeWidth={width + 2.5}
        strokeDasharray={dashArray}
        opacity={statusStyle.opacity * 0.55}
        strokeLinecap="round"
      />
      <line
        x1="1"
        y1="6"
        x2="21"
        y2="6"
        stroke={style.color}
        strokeWidth={width}
        strokeDasharray={dashArray}
        opacity={statusStyle.opacity}
        strokeLinecap="round"
      />
    </svg>
  );
}
