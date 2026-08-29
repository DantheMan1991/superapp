"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MapPin, Satellite, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  accuracyBand,
  canClose,
  pointsNeeded,
  tooCloseToLast,
  worstAccuracyM,
  type WalkPoint,
} from "../core/survey";
import { formatAccuracy, type LengthUnit } from "../core/length";
import type { GeometryShape } from "../core/geo";

/**
 * Walking a shape onto the map, one corner at a time.
 *
 * **THE POINT OF THIS SLICE, AND IT IS NOT ABOUT CONVENIENCE.** A line traced
 * off aerial imagery and a position read from a phone are wrong independently,
 * so their errors add — which is why a fence set from a traced line comes out
 * with a dogleg in it. A line WALKED and later navigated back to with the same
 * phone is wrong in much the same direction twice, and most of that cancels.
 * See docs/modules/land.md → The paddock layout.
 *
 * **IT WATCHES WHILE IT IS OPEN, AND THAT IS NOT THE BACKGROUND TRACKING THE
 * PACK REFUSED.** 2b.0 said "a button, not a background service" about knowing
 * where you are, and that still holds: nothing here records where anybody was,
 * nothing runs when the panel is shut, and the watch stops the moment the walk
 * ends. What it buys is the reason the accuracy figure is worth showing at all
 * — you can see the fix SETTLE before you commit a corner, instead of tapping
 * blind and discovering afterwards that the phone was guessing.
 */
export function WalkPanel({
  points,
  shape,
  lengthUnit,
  closed,
  onClosedChange,
  onDrop,
  onUndo,
}: {
  points: WalkPoint[];
  shape: GeometryShape;
  lengthUnit: LengthUnit;
  /** Whether the run comes back to where it started. */
  closed: boolean;
  onClosedChange: (closed: boolean) => void;
  onDrop: (point: WalkPoint) => void;
  onUndo: () => void;
}) {
  const [live, setLive] = useState<WalkPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchId = useRef<number | null>(null);

  /**
   * **THE PANEL ASSUMES GEOLOCATION EXISTS**, because the button that opens it
   * checks first and refuses with a toast — the same shape `locate()` in
   * site-plan-map.tsx already uses. Reporting the capability from in here would
   * mean setting state in the effect body on mount, which is the cascading
   * render React's own guidance warns about; every setState below happens in a
   * watch callback instead, which is what effects are for.
   */
  useEffect(() => {
    const id = navigator.geolocation.watchPosition(
      (position) => {
        setError(null);
        setLive({
          position: [position.coords.longitude, position.coords.latitude],
          accuracyM: position.coords.accuracy,
        });
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked for this site. Allow it in the browser, then reopen this."
            : "Could not get a location. Try again in the open.",
        );
      },
      // `maximumAge: 0` because a cached fix from where you were standing a
      // minute ago is the one thing this panel must never hand back — you have
      // walked to the next corner since.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    watchId.current = id;
    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
      }
    };
  }, []);

  const drop = useCallback(() => {
    if (!live) {
      toast.error("No location yet — wait for a fix.");
      return;
    }
    if (tooCloseToLast(points, live.position)) {
      // Refused rather than warned: two points a foot apart are a double tap,
      // and they render as a kink in a fence that measures nothing.
      toast.error("That is the corner you just placed. Walk to the next one.");
      return;
    }
    onDrop(live);
  }, [live, onDrop, points]);

  const needed = pointsNeeded(points, shape);
  const worst = worstAccuracyM(points);
  const band = live ? accuracyBand(live.accuracyM) : "poor";

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Satellite
            className={`h-4 w-4 ${
              band === "good"
                ? "text-success"
                : band === "fair"
                  ? "text-warning"
                  : "text-muted-foreground"
            }`}
          />
          <span className="text-sm tabular-nums">
            {live ? formatAccuracy(live.accuracyM, lengthUnit) : "Getting a fix…"}
          </span>
          {live && band !== "good" && (
            <span className="text-xs text-muted-foreground">
              {band === "fair"
                ? "usable — better in the open"
                : "poor — wait, or move clear of trees"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {points.length > 0 && (
            <Button size="sm" variant="ghost" onClick={onUndo}>
              <Undo2 className="mr-2 h-4 w-4" />
              Undo last
            </Button>
          )}
          <Button size="sm" onClick={drop} disabled={!live}>
            <MapPin className="mr-2 h-4 w-4" />
            Drop a point here
          </Button>
        </div>
      </div>

      {/*
        **FOUR CORNERS ARE THREE SIDES UNLESS YOU SAY OTHERWISE**, which is what
        walking a fence round a paddock found: the run stopped at the last
        corner instead of coming back. Both are real fences, so this is a
        choice and not a default — and it only appears once there are three
        corners, because closing two is a fence walked back along itself.
      */}
      {canClose(points, shape) && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={closed}
            onChange={(event) => onClosedChange(event.target.checked)}
            className="size-4 rounded border-input"
          />
          <span>Close it back to the first corner</span>
          <span className="text-xs text-muted-foreground">
            {/* The real counts, not a worked example: a run of six corners
                reading "3 sides from 4" is worse than no hint at all. */}
            {closed ? points.length : points.length - 1} sides from{" "}
            {points.length} corners
          </span>
        </label>
      )}

      <p className="mt-2 text-xs text-muted-foreground">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : points.length === 0 ? (
          <>
            Stand on the first corner and drop a point. Walk to the next one and
            drop again.
          </>
        ) : (
          <>
            <span className="tabular-nums">{points.length}</span>{" "}
            {points.length === 1 ? "corner" : "corners"} walked
            {needed > 0 && <> · {needed} more before you can save</>}
            {worst !== null && (
              <>
                {" "}
                · worst {formatAccuracy(worst, lengthUnit)}
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}
