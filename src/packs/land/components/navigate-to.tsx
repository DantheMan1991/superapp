"use client";

import { useState } from "react";
import { Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NavigatePanel } from "./navigate-panel";
import type { FeatureGeometry } from "../core/geo";
import type { LengthUnit } from "../core/length";

/**
 * `Take me there`, for anything with a shape.
 *
 * **IT WAS ONLY EVER ON A FEATURE, AND `targetsOf` NEVER CARED.** 2b.3 built
 * the navigator against a `FeatureGeometry`, handled polygons from the first
 * commit — *"the vertices are the posts, and a ring's closing repeat is
 * dropped"* — and then the only button that opened it lived in the feature
 * panel. A paddock is a shape with corners you go and stand on; a PROPOSED
 * paddock is a shape whose corners are the whole reason it exists. Neither
 * could be walked to.
 *
 * **NOT OWNER-GATED AND NOT EDIT-GATED**, the rule the feature panel already
 * set: walking to a corner changes nothing, and the person setting the posts is
 * often not the person who drew them.
 *
 * **A PLAIN FLAG IS ENOUGH NOW.** The feature panel used to key this on the
 * feature id, because it stayed mounted while you clicked from one fence to the
 * next and a boolean would have left you being navigated to the thing you had
 * stopped looking at. Slice 2 keyed the panel's wrapper on the feature, so it
 * no longer survives a selection change — the reason for the keyed flag went
 * with it, and every caller here mounts one of these per shape anyway.
 */
export function NavigateTo({
  name,
  geometry,
  lengthUnit,
  label = "Take me there",
  variant = "outline",
  size = "sm",
}: {
  name: string;
  geometry: FeatureGeometry;
  lengthUnit: LengthUnit;
  label?: string;
  variant?: "outline" | "ghost";
  size?: "sm" | "default";
}) {
  const [going, setGoing] = useState(false);

  // Unmounting is what stops the watch — `navigate-panel.tsx` watches only
  // while it is open, and closing it here is the only way it ever closes.
  if (going) {
    return (
      <NavigatePanel
        name={name}
        geometry={geometry}
        lengthUnit={lengthUnit}
        onClose={() => setGoing(false)}
      />
    );
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={() => setGoing(true)}
      aria-label={`Take me to ${name}`}
    >
      <Navigation className="mr-2 h-4 w-4" />
      {label}
    </Button>
  );
}
