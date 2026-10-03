"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Camera, ChevronLeft, ChevronRight, Download, Images, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { HelpButton } from "@/components/app/help-button";
import { Button } from "@/components/ui/button";
import { useScreenPrivacy } from "@/lib/screen-privacy";
import { cn } from "@/lib/utils";
import { poundsChange, poundsWords, trendOn, weightTrend, type Weighin } from "../core/body";
import { dayName, shortDay } from "../core/days";
import { copyName, daysWith, keptPair, photoDays, POSES, POSE_WORDS, stepDay, type PhotoKey, type Pose } from "../core/photos";
import { clearPhoto, drawPhoto } from "./draw";
import { saveCopy } from "./save-copy";
import { deletePhotoDay, photoKeys, photoOf } from "./store";

const HEALTH = "/personal/m/health";

/**
 * COMPARE (H2b, docs/help/health/photos.md; the founder's mockup, 2026-10-03):
 * one pose, two days side by side, the first and the latest to start with,
 * each with the trend on that day and how far it moved between them; arrows
 * to step either day; "Save a copy" under each; and the days on this phone,
 * each deleted with a second tap.
 *
 * Everything here is read from this phone's own storage (`store.ts`) for the
 * signed-in space; the weigh-ins came with the page. Nothing is sent (ADR
 * 0128), and the page is locked to this site. Inside the app the screen
 * cannot be screenshotted while it is open: it shows the photos.
 */
export function PhotoCompare({ owner, today, weighins }: { owner: string; today: string; weighins: Weighin[] }) {
  const [keys, setKeys] = useState<PhotoKey[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [pose, setPose] = useState<Pose>("front");
  const [picked, setPicked] = useState<{ left: string; right: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, startDeleting] = useTransition();
  useScreenPrivacy(true);

  useEffect(() => {
    let live = true;
    photoKeys(owner).then(
      (found) => live && setKeys(found),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [owner]);

  const points = weightTrend(weighins);
  const days = keys ? daysWith(keys, pose) : [];
  // The first and the latest, until a day is stepped; a day since deleted gives way to the nearest.
  const fixedPair = keptPair(days, picked);

  function choosePose(next: Pose) {
    setPose(next);
    setPicked(null);
  }

  function move(side: "left" | "right", by: -1 | 1) {
    if (!fixedPair) return;
    setPicked({ ...fixedPair, [side]: stepDay(days, fixedPair[side], by) });
  }

  function removeDay(day: string) {
    startDeleting(async () => {
      try {
        await deletePhotoDay(owner, day);
        setKeys((now) => (now ?? []).filter((k) => k.day !== day));
        setPicked(null);
        toast.success(`The photos of ${shortDay(day, today)} are deleted from this phone.`);
      } catch {
        toast.error("They could not be deleted. Try again.");
      }
      setConfirming(null);
    });
  }

  const trendAt = (day: string) => trendOn(points, day);
  const leftTrend = fixedPair ? trendAt(fixedPair.left) : null;
  const rightTrend = fixedPair ? trendAt(fixedPair.right) : null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`${HEALTH}/body`}>
          <ArrowLeft aria-hidden /> Body
        </Link>
      </Button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <h1 className="flex items-center gap-2 font-heading text-2xl font-medium tracking-heading">
              <Images className="size-6 text-module-accent" aria-hidden /> Progress photos
            </h1>
            <HelpButton />
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="size-3.5" aria-hidden /> On this phone only. Never uploaded.
          </p>
        </div>
        <Button asChild>
          <Link href={`${HEALTH}/photos/take`}>
            <Camera aria-hidden /> Take photos
          </Link>
        </Button>
      </div>

      {failed ? (
        <p className="text-destructive">This phone&apos;s storage could not be read. Reload the page to try again.</p>
      ) : keys === null ? (
        <p className="text-sm text-muted-foreground">Reading this phone&apos;s photos…</p>
      ) : keys.length === 0 ? (
        <div className="space-y-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <p>No photos on this phone yet.</p>
          <p className="text-sm text-muted-foreground">
            Take your first front, side and back today. In a few weeks, take them again, and compare them here.
          </p>
        </div>
      ) : (
        <>
          <div className="flex gap-1" role="group" aria-label="Pose">
            {POSES.map((p) => (
              <Button key={p} size="sm" variant={p === pose ? "default" : "ghost"} aria-pressed={p === pose} onClick={() => choosePose(p)}>
                {POSE_WORDS[p]}
              </Button>
            ))}
          </div>

          {!fixedPair ? (
            <p className="text-sm text-muted-foreground">{`No ${POSE_WORDS[pose].toLowerCase()} photos on this phone yet.`}</p>
          ) : (
            <section className="space-y-3 rounded-2xl bg-card px-3 py-3 shadow-elevation-1">
              <div className={cn("grid gap-2", fixedPair.left === fixedPair.right ? "grid-cols-1 justify-items-center" : "grid-cols-2")}>
                <PhotoPanel
                  owner={owner}
                  day={fixedPair.left}
                  pose={pose}
                  today={today}
                  trend={leftTrend}
                  canBack={days.indexOf(fixedPair.left) > 0}
                  canForward={days.indexOf(fixedPair.left) < days.indexOf(fixedPair.right) - 1}
                  onStep={(by) => move("left", by)}
                />
                {fixedPair.left !== fixedPair.right && (
                  <PhotoPanel
                    owner={owner}
                    day={fixedPair.right}
                    pose={pose}
                    today={today}
                    trend={rightTrend}
                    canBack={days.indexOf(fixedPair.right) > days.indexOf(fixedPair.left) + 1}
                    canForward={days.indexOf(fixedPair.right) < days.length - 1}
                    onStep={(by) => move("right", by)}
                  />
                )}
              </div>
              {fixedPair.left === fixedPair.right ? (
                <p className="text-center text-sm text-muted-foreground">Take them again in a few weeks, and compare the two here.</p>
              ) : (
                leftTrend !== null &&
                rightTrend !== null && (
                  <p className="text-center">
                    <span className="text-module-accent">{poundsChange(rightTrend - leftTrend)}</span>
                    <span className="text-sm text-muted-foreground"> between them, by your trend</span>
                  </p>
                )
              )}
            </section>
          )}

          <section className="space-y-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
            <h2 className="font-medium">On this phone</h2>
            <ul className="divide-y divide-border">
              {photoDays(keys).map(({ day, poses }) => (
                <li key={day} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="text-sm">
                    {dayName(day)}
                    <span className="text-muted-foreground">{` · ${poses.map((p) => POSE_WORDS[p].toLowerCase()).join(", ")}`}</span>
                  </span>
                  {confirming === day ? (
                    <span className="flex flex-wrap items-center gap-1">
                      <span className="text-sm">Delete this day&apos;s photos from this phone?</span>
                      <Button variant="destructive" size="sm" onClick={() => removeDay(day)} disabled={deleting}>
                        Delete
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirming(null)} disabled={deleting}>
                        Keep them
                      </Button>
                    </span>
                  ) : (
                    <Button variant="ghost" size="icon" aria-label={`Delete the photos of ${dayName(day)}`} onClick={() => setConfirming(day)}>
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              A new phone, or clearing this site&apos;s data in the browser, starts with none. Save a copy of any you want to keep
              elsewhere.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/** One day's photo of the pose, its date and trend, arrows to step the day, and Save a copy. */
function PhotoPanel({
  owner,
  day,
  pose,
  today,
  trend,
  canBack,
  canForward,
  onStep,
}: {
  owner: string;
  day: string;
  pose: Pose;
  today: string;
  trend: number | null;
  canBack: boolean;
  canForward: boolean;
  onStep: (by: -1 | 1) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [missing, setMissing] = useState(false);
  const [saving, startSaving] = useTransition();

  useEffect(() => {
    const el = canvas.current;
    let live = true;
    if (!el) return;
    photoOf(owner, day, pose).then(
      (photo) => {
        if (!live) return;
        setMissing(photo === null);
        if (photo) void drawPhoto(el, photo.blob).catch(() => clearPhoto(el));
      },
      () => live && setMissing(true),
    );
    return () => {
      live = false;
      clearPhoto(el);
    };
  }, [owner, day, pose]);

  function save() {
    startSaving(async () => {
      const photo = await photoOf(owner, day, pose).catch(() => null);
      if (!photo) {
        toast.error("That photo is not on this phone any more.");
        return;
      }
      try {
        const where = await saveCopy(photo.blob, copyName(day, pose));
        if (where === "update-app") toast.error("This version of the app cannot save a copy. Update the app, or open yosherapp.com in Chrome.");
        else toast.success(where === "documents" ? "Saved to Documents, in the Yosher folder." : "Saved to your Downloads.");
      } catch {
        toast.error("The copy could not be saved. Try again.");
      }
    });
  }

  return (
    <div className="w-full max-w-xs space-y-1 text-center">
      {missing ? (
        <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">Not on this phone</div>
      ) : (
        <canvas ref={canvas} aria-label={`${POSE_WORDS[pose]} photo, ${shortDay(day, today)}`} className="aspect-[3/4] w-full rounded-lg bg-black object-contain" />
      )}
      <div className="flex items-center justify-between gap-1">
        <Button variant="ghost" size="icon" aria-label="An earlier day" onClick={() => onStep(-1)} disabled={!canBack}>
          <ChevronLeft aria-hidden />
        </Button>
        <div>
          <p className="font-medium">{shortDay(day, today)}</p>
          <p className="text-sm text-muted-foreground">{trend === null ? "No weigh-in yet" : `Trend ${poundsWords(trend)}`}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label="A later day" onClick={() => onStep(1)} disabled={!canForward}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <Button variant="outline" size="sm" onClick={save} disabled={saving || missing}>
        <Download aria-hidden /> {saving ? "Saving…" : "Save a copy"}
      </Button>
    </div>
  );
}
