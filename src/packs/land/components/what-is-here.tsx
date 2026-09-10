"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Crosshair, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { whatIsHereAction } from "../actions";
import { featureKindLabel } from "../core/features";
import { NEARBY_RADIUS_M } from "../core/nearby";
import { formatAccuracy, formatLength, type LengthUnit } from "../core/length";

interface FeatureHere {
  id: string;
  kind: string;
  name: string;
  parcelName: string;
  metres: number;
  notes: string;
  attributes: Record<string, string | number | boolean>;
}

interface ZoneHere {
  zoneId: string;
  zoneName: string;
  parcelId: string;
  parcelName: string;
}

interface Answer {
  zone: ZoneHere | null;
  features: FeatureHere[];
  accuracyM: number | null;
}

/**
 * What is on the ground where you are standing.
 *
 * **THE STRONGEST ITEM ON THE 2b LIST, AND THE LAST ONE UNBUILT.** The
 * founder's words were *"it auto displays relevant information to whatever is
 * at your location"*, and the design's answer was: which zone you are in, plus
 * everything within a hundred feet, plus the attribute bag — *three strands
 * hot, buried electric here, this trough is on the north line*. Every piece of
 * it has been in `geo.ts` since 2b.0. Nothing ever asked.
 *
 * **A BUTTON, NOT A BACKGROUND SERVICE.** One fix, one answer, nothing stored.
 * No watch, no breadcrumb, no history — the rule the whole pack follows about a
 * phone's position, and the reason this is a dialog rather than a panel that
 * stays open.
 *
 * **THE ACCURACY FIGURE IS PART OF THE ANSWER.** `walk-panel.tsx` set that rule
 * for placing a post and it applies just as hard to reading: *the buried
 * electric is 4 m away* means something different at ±3 m and at ±20 m, and a
 * screen that hides which one it is, is the screen that gets somebody digging.
 */
export function WhatIsHere({
  basePath,
  lengthUnit,
}: {
  basePath: string;
  lengthUnit: LengthUnit;
}) {
  const [pending, setPending] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);

  const look = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("This browser will not share a location.");
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const result = await whatIsHereAction({
          lon: position.coords.longitude,
          lat: position.coords.latitude,
        });
        setPending(false);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setAnswer({
          zone: (result.zone ?? null) as ZoneHere | null,
          features: (result.features ?? []) as FeatureHere[],
          accuracyM: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
        });
      },
      (error) => {
        setPending(false);
        toast.error(
          error.code === error.PERMISSION_DENIED
            ? "Location is blocked for this site. Allow it in the browser to use this."
            : "Could not get a location. Under trees it can take a moment — try again.",
        );
      },
      // A farm has no wifi to triangulate from, so the high-accuracy path is
      // the only one that produces a usable fix — and it is slower.
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 },
    );
  }, []);

  const radius = formatLength(NEARBY_RADIUS_M, lengthUnit);

  return (
    <>
      <Button type="button" variant="outline" onClick={look} disabled={pending}>
        <Crosshair className="mr-2 h-4 w-4" />
        {pending ? "Looking…" : "What is here?"}
      </Button>

      <Dialog
        open={answer !== null}
        onOpenChange={(open) => !open && setAnswer(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>What is here</DialogTitle>
            <DialogDescription>
              Everything built within {radius} of you, nearest first. Proposals
              are not on the ground, so they are not on this list.
            </DialogDescription>
          </DialogHeader>

          {answer && (
            <div className="space-y-4 py-2">
              <div className="rounded-lg bg-muted p-3">
                {answer.zone ? (
                  <>
                    <p className="text-sm">
                      You are on{" "}
                      <Link
                        href={`${basePath}/${answer.zone.parcelId}/zones/${answer.zone.zoneId}`}
                        className="font-medium hover:underline"
                        onClick={() => setAnswer(null)}
                      >
                        {answer.zone.zoneName}
                      </Link>
                      {answer.zone.parcelName && `, on ${answer.zone.parcelName}`}.
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {/* Two different reasons, one message, because from here
                        they are indistinguishable: nothing is traced near you,
                        or you are genuinely off the mapped ground. */}
                    You are not inside any mapped area. Trace its boundary and
                    this will say where you are.
                  </p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  The phone puts you within {formatAccuracy(answer.accuracyM, lengthUnit)}.
                </p>
              </div>

              {answer.features.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing built is drawn within {radius} of you. That may mean
                  there is nothing here, or that it has not been drawn yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {answer.features.map((feature) => (
                    <li
                      key={feature.id}
                      className="rounded-2xl bg-card p-4 shadow-elevation-1"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {feature.name || featureKindLabel(feature.kind)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {featureKindLabel(feature.kind)}
                          </p>
                        </div>
                        <p className="shrink-0 text-right tabular-nums">
                          {/* Standing ON a thing is not "0 ft away". */}
                          {feature.metres < 1 ? (
                            <Badge variant="outline">
                              <MapPin className="mr-1 h-3 w-3" />
                              you are on it
                            </Badge>
                          ) : (
                            formatLength(feature.metres, lengthUnit)
                          )}
                        </p>
                      </div>

                      {/* The attribute bag IS the point of this screen — three
                          strands hot, buried thirty inches. */}
                      {Object.keys(feature.attributes).length > 0 && (
                        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          {Object.entries(feature.attributes).map(
                            ([key, value]) => (
                              <div key={key} className="contents">
                                <dt className="text-muted-foreground">
                                  {key.replace(/_/g, " ")}
                                </dt>
                                <dd className="tabular-nums">
                                  {typeof value === "boolean"
                                    ? value
                                      ? "yes"
                                      : "no"
                                    : String(value)}
                                </dd>
                              </div>
                            ),
                          )}
                        </dl>
                      )}

                      {feature.notes && (
                        <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                          {feature.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-muted-foreground">
                Nothing is recorded about where you were.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAnswer(null)}>
              Close
            </Button>
            <Button onClick={look} disabled={pending}>
              {pending ? "Looking…" : "Look again"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
