"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { zoneAtPointAction } from "../actions";

export interface ZoneHere {
  zoneId: string;
  zoneName: string;
  parcelId: string;
  parcelName: string;
  areaAcres: number | null;
}

/**
 * The button that answers "which paddock am I in".
 *
 * **THE LAND DESIGN RANKED THIS ABOVE THE MAP**, and it is worth remembering
 * why: every other data-entry saving in this pack is a better form, and this
 * one is the field answering the question. A person standing in a paddock with
 * a phone should not be scrolling a list of twenty paddock names to find the
 * one under their boots.
 *
 * It reports rather than assumes. GPS is good to a handful of metres, a
 * boundary traced off aerial imagery is good to a few more, and a fence line is
 * exactly where those errors matter — so the answer is offered and the person
 * confirms it. Nothing here submits anything.
 */
export function WhereAmIButton({
  onFound,
  label = "Use where I am",
  size = "sm",
  variant = "outline",
}: {
  onFound: (zone: ZoneHere) => void;
  label?: string;
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "default";
}) {
  const [pending, setPending] = useState(false);

  const locate = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("This browser will not share a location.");
      return;
    }
    setPending(true);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const result = await zoneAtPointAction({
          lon: position.coords.longitude,
          lat: position.coords.latitude,
        });
        setPending(false);
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        const zone = (result.zone ?? null) as ZoneHere | null;
        if (!zone) {
          // Two different reasons, one message, because from here they are
          // indistinguishable: no boundary is drawn near you, or you are
          // genuinely off the mapped ground.
          toast.error(
            "You are not inside any mapped paddock. Trace its boundary and this will find it.",
          );
          return;
        }
        // `zoneAtPoint` already resolved any overlap by returning the SMALLEST
        // containing zone — a strip inside a paddock is the more specific
        // answer, and it is what somebody standing on it means.
        onFound(zone);
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
  }, [onFound]);

  return (
    <Button type="button" size={size} variant={variant} onClick={locate} disabled={pending}>
      <Crosshair className="mr-2 h-4 w-4" />
      {pending ? "Finding you…" : label}
    </Button>
  );
}

/**
 * The same answer, used as navigation: tap it in a paddock and land on that
 * paddock's record.
 *
 * Worth its own component because the useful thing on the Land page is not a
 * form to fill in — it is getting to the right record without reading a list.
 * Standing on the ground and having the app open the right page is the whole
 * of what geometry buys somebody who is not at a desk.
 */
export function WhereAmIShortcut({ zoneHref }: { zoneHref: (zoneId: string) => string }) {
  const router = useRouter();
  return (
    <WhereAmIButton
      label="Which paddock am I in?"
      onFound={(zone) => router.push(zoneHref(zone.zoneId))}
    />
  );
}
