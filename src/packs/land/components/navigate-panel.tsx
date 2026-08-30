"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Navigation,
  Satellite,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  arrival,
  arrivalNote,
  arrivalRadiusM,
  bearingDegrees,
  compassPoint,
  nearestTarget,
  progressOf,
  targetsOf,
  type Progress,
} from "../core/navigate";
import { accuracyBand } from "../core/survey";
import { haversineM, type FeatureGeometry, type Position } from "../core/geo";
import { formatAccuracy, formatLength, type LengthUnit } from "../core/length";

/**
 * Standing in a field, being walked to a corner you drew. Slice 2b.3.
 *
 * **THIS IS WHAT THE REST OF 2b WAS FOR.** The layout, the walk mode, the
 * snapping and the enclosure work all end here or they end as a picture:
 * *"out in the field, you click on the start of a paddock and using GPS it
 * directs you until you are standing right in the right spot to set the posts
 * and wire."*
 *
 * **THE DISTANCE IS THE INSTRUMENT AND THE BEARING IS SUPPORT.** A bearing of
 * 271 degrees only helps if you know which way you are facing, and a phone
 * being carried does not reliably know — the compass needs a permission prompt
 * on iOS, is thrown by a truck door, and is wrong in a way nobody can see. What
 * always works is walking a few paces and watching the number: it drops, or it
 * climbs and you turned wrong. So the number is the hero, the trend beside it
 * is the feedback, and the compass point is there to save the first guess.
 *
 * **IT WATCHES ONLY WHILE IT IS OPEN**, the rule `walk-panel.tsx` set: nothing
 * records where anybody was, nothing runs when the panel is shut, and the watch
 * stops the moment you close it.
 */
export function NavigatePanel({
  name,
  geometry,
  lengthUnit,
  onClose,
}: {
  name: string;
  geometry: FeatureGeometry;
  lengthUnit: LengthUnit;
  onClose: () => void;
}) {
  const targets = useMemo(() => targetsOf(geometry), [geometry]);
  const [index, setIndex] = useState(0);
  const [live, setLive] = useState<{
    position: Position;
    accuracyM: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>("holding");

  /**
   * **EVERYTHING THE WATCH NEEDS TRAVELS IN REFS, AND EVERY `setState` HAPPENS
   * INSIDE THE FIX.** The first version chose the starting corner and computed
   * the trend in effects, which React's own lint rule refuses — and rightly:
   * both are reactions to a new POSITION, which is an event, not a
   * consequence of rendering. Doing them in effects also means a render that
   * immediately schedules another one, twice per fix, for the whole time
   * somebody is walking.
   */
  const targetsRef = useRef(targets);
  const indexRef = useRef(0);
  /** Whether a fix has yet been allowed to choose which corner to start at. */
  const started = useRef(false);
  /** The distance last shown, for the trend. Null means "no basis to compare". */
  const lastDistance = useRef<number | null>(null);

  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  useEffect(() => {
    const id = navigator.geolocation.watchPosition(
      (position) => {
        const here: Position = [
          position.coords.longitude,
          position.coords.latitude,
        ];
        setError(null);
        setLive({ position: here, accuracyM: position.coords.accuracy });

        const list = targetsRef.current;
        /**
         * **THE FIRST FIX CHOOSES WHICH CORNER TO START AT, and only the
         * first.** Somebody opening this is already somewhere, usually at one
         * end of the run, and being sent to the far end because that vertex
         * happens to be index 1 wastes a walk. Re-choosing on every fix would
         * be worse than useless: the moment you arrived at a corner it would
         * hand you that same corner forever.
         */
        if (!started.current && list.length > 0) {
          started.current = true;
          const nearest = nearestTarget(here, list);
          if (nearest) {
            indexRef.current = nearest.index - 1;
            setIndex(nearest.index - 1);
          }
        }

        const target = list[indexRef.current];
        if (target) {
          const distance = haversineM(here, target.position);
          setProgress(progressOf(lastDistance.current, distance));
          lastDistance.current = distance;
        }
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location is blocked for this site. Allow it in the browser, then reopen this."
            : "Could not get a location. Try again in the open.",
        );
      },
      // `maximumAge: 0` for the reason the walk panel gives: a cached fix from
      // where you were standing a minute ago is the one answer this must never
      // give, because you have been walking since.
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const target = targets[index] ?? null;
  const distanceM =
    live && target ? haversineM(live.position, target.position) : null;

  // Moving to another corner makes the previous distance meaningless — it was
  // measured to somewhere else.
  function goTo(next: number) {
    lastDistance.current = null;
    indexRef.current = next;
    setProgress("holding");
    setIndex(next);
  }

  const state =
    distanceM !== null && live ? arrival(distanceM, live.accuracyM) : null;
  const bearing =
    live && target ? bearingDegrees(live.position, target.position) : null;
  const band = live ? accuracyBand(live.accuracyM) : "poor";

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4" />
          <span className="text-sm font-medium">{name}</span>
          {target && target.total > 1 && (
            <span className="text-xs text-muted-foreground">
              corner {target.index} of {target.total}
            </span>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X className="mr-2 h-4 w-4" />
          Stop
        </Button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-destructive">{error}</p>
      ) : targets.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing here to walk to — this has not been drawn yet.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`font-heading text-3xl font-semibold tabular-nums ${
                    state === "arrived" ? "text-success" : ""
                  }`}
                >
                  {distanceM === null
                    ? "—"
                    : formatLength(distanceM, lengthUnit)}
                </span>
                {/*
                  The trend, in words rather than an arrow: an arrow implies a
                  direction on the ground, and this is about the number.
                */}
                {distanceM !== null && progress !== "holding" && (
                  <span
                    className={`text-xs ${
                      progress === "closer" ? "text-success" : "text-warning"
                    }`}
                  >
                    {progress === "closer" ? "getting closer" : "further away"}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {live && state
                  ? arrivalNote(
                      state,
                      formatAccuracy(arrivalRadiusM(live.accuracyM), lengthUnit)
                        // The note reads "Within 20 ft"; the plus-or-minus
                        // belongs on the instrument beside it, not in a
                        // sentence about where you are standing.
                        .replace("±", ""),
                    )
                  : "Getting a fix…"}
              </p>
            </div>

            {bearing !== null && (
              <div>
                <div className="font-heading text-xl font-semibold tabular-nums">
                  {compassPoint(bearing)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    {Math.round(bearing)}°
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  from true north
                </p>
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
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
                {live
                  ? formatAccuracy(live.accuracyM, lengthUnit)
                  : "Getting a fix…"}
              </span>
              {state === "arrived" && <Badge variant="outline">you are on it</Badge>}
            </span>

            {targets.length > 1 && (
              <span className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index === 0}
                  onClick={() => goTo(index - 1)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Back
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={index >= targets.length - 1}
                  onClick={() => goTo(index + 1)}
                >
                  Next corner
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </span>
            )}
          </div>

          {/*
            **THE WARNING IS ABOUT THE TARGET, NOT ABOUT THE FIX.** A corner
            somebody TRACED off aerial imagery and a position read from a phone
            are wrong independently, so the errors add — five to ten metres.
            Walking to a corner that was itself walked cancels most of one.
            Nothing here can tell which this was, so it says the thing that is
            true either way and lets the person decide whether to dig.
          */}
          <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
            Good enough for polywire. For a permanent corner post, check it
            against something you can see — a fence you can touch beats a
            reading you cannot.
          </p>
        </>
      )}
    </div>
  );
}
