"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { photoNudgeDue, photosAgo } from "../core/photos";
import { lastPhotoDay } from "./store";

/**
 * TODAY'S REMINDER (H2b; the founder's call: every 4 weeks, a line on Today's
 * Weight card, no notification): once the last photos on this phone are four
 * weeks old, "Progress photos: 4 weeks ago" and Take. Nothing before the
 * first photos (Body has the way in), and nothing on another phone, which
 * holds none of them. It reads the latest day, never a picture.
 */
export function PhotoNudge({ owner, today }: { owner: string; today: string }) {
  const [last, setLast] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    lastPhotoDay(owner).then(
      (day) => live && setLast(day),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [owner]);

  if (!last || !photoNudgeDue(last, today)) return null;
  return (
    <p className="flex flex-wrap items-center justify-between gap-x-2 border-t border-border pt-2 text-sm text-muted-foreground">
      <span>{`Progress photos: ${photosAgo(last, today)}.`}</span>
      <Link className="text-module-accent underline" href="/personal/m/health/photos/take">
        Take
      </Link>
    </p>
  );
}
