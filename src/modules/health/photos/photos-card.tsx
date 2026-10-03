"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Camera, Images, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shortDay } from "../core/days";
import { photoDays, POSE_WORDS, type PhotoKey } from "../core/photos";
import { photoKeys } from "./store";

const PHOTOS = "/personal/m/health/photos";

/**
 * PROGRESS PHOTOS ON BODY (H2b; the founder's mockup, 2026-10-03): when the
 * last were taken and which poses, how many days this phone holds, and the
 * ways in: Take photos and Compare. It reads which days this phone holds,
 * never a picture; the photos themselves are only drawn on the locked photo
 * pages (ADR 0128).
 */
export function PhotosCard({ owner, today }: { owner: string; today: string }) {
  const [keys, setKeys] = useState<PhotoKey[] | null>(null);

  useEffect(() => {
    let live = true;
    photoKeys(owner).then(
      (found) => live && setKeys(found),
      () => live && setKeys([]),
    );
    return () => {
      live = false;
    };
  }, [owner]);

  const days = keys ? photoDays(keys) : [];
  const last = days[0] ?? null;

  return (
    <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <h2 className="flex items-center gap-2 font-medium">
        <Images className="size-4 text-module-accent" aria-hidden /> Progress photos
      </h2>
      {keys === null ? (
        <p className="text-sm text-muted-foreground">Reading this phone&apos;s photos…</p>
      ) : last ? (
        <div>
          <p>{`Last taken ${shortDay(last.day, today)}: ${last.poses.map((p) => POSE_WORDS[p].toLowerCase()).join(", ")}`}</p>
          <p className="text-sm text-muted-foreground">{`${days.length} ${days.length === 1 ? "day" : "days"} of photos on this phone`}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Front, side and back, taken on a timer with the phone propped up, and compared over the weeks.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`${PHOTOS}/take`}>
            <Camera aria-hidden /> Take photos
          </Link>
        </Button>
        {last && (
          <Button asChild variant="outline">
            <Link href={PHOTOS}>
              <Images aria-hidden /> Compare
            </Link>
          </Button>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Lock className="size-3" aria-hidden /> On this phone only, never uploaded. A new phone starts with none.
      </p>
    </section>
  );
}
