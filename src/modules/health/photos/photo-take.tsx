"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, useTransition } from "react";
import { ArrowLeft, Camera, Lock, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { HelpButton } from "@/components/app/help-button";
import { Button } from "@/components/ui/button";
import { cameraMessage } from "@/lib/camera-message";
import { useScreenPrivacy } from "@/lib/screen-privacy";
import { useWakeLock } from "@/lib/use-wake-lock";
import { cn } from "@/lib/utils";
import { BEEP_FROM_S, FIRST_COUNT_S, PHOTO_LINES, POSES, POSE_WORDS, TURN_COUNT_S, type Pose } from "../core/photos";
import { openBackCamera, stopCamera } from "./camera";
import { snapPhoto } from "./capture";
import { clearPhoto, drawPhoto } from "./draw";
import { keepPhotos, lastPhotoOf, photoKeys } from "./store";
import { beep, click, hushPhoto, sayPhoto, startPhotoVoice, stopPhotoVoice } from "./voice";

const PHOTOS = "/personal/m/health/photos";

type Taken = { blob: Blob; width: number; height: number };
type Phase = "idle" | "starting" | "ready" | "counting" | "review" | "error";

/**
 * TAKING PROGRESS PHOTOS (H2b, docs/help/health/photos-take.md; the founder's
 * calls from a mockup, 2026-10-03): the phone propped up across the room, its
 * back camera on the main lens; Start, then ten seconds to stand, and the
 * front, side and back taken in a row, the voice saying when to turn, a beep
 * each of the last three seconds and a click for each photo. The outline of
 * last time's photo of the same pose sits over the camera's picture, to stand
 * the same way. Then the three to check, any taken again on its own, and Keep,
 * which puts them in this phone's own storage, or Discard.
 *
 * Nothing here sends a picture anywhere (ADR 0128; `tests/health-photos-
 * privacy.test.ts`), and the page is locked to this site (ADR 0122's lock).
 * The screen stays on while the camera is, and inside the app no screenshot
 * can be taken of it.
 */
export function PhotoTake({ owner, today, naturalVoice }: { owner: string; today: string; naturalVoice: boolean }) {
  const router = useRouter();
  const video = useRef<HTMLVideoElement>(null);
  const outlineCanvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const outlines = useRef(new Map<Pose, Blob>());
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showOutline, setShowOutline] = useState(true);
  const [outlinesLoaded, setOutlinesLoaded] = useState(0);
  const [keptToday, setKeptToday] = useState(false);
  const [sequence, setSequence] = useState<Pose[]>([...POSES]);
  const [at, setAt] = useState(0);
  const [count, setCount] = useState(FIRST_COUNT_S);
  const [taken, setTaken] = useState<Partial<Record<Pose, Taken>>>({});
  const [discarding, setDiscarding] = useState(false);
  const [saving, startSaving] = useTransition();

  const cameraOn = phase === "ready" || phase === "counting" || phase === "starting";
  useWakeLock(cameraOn);
  useScreenPrivacy(phase !== "idle");

  const pose = sequence[at] ?? "front";

  // The camera and the voice go when the screen does.
  useEffect(() => {
    const canvas = outlineCanvas.current;
    return () => {
      stopCamera(stream.current);
      stream.current = null;
      stopPhotoVoice();
      clearPhoto(canvas);
    };
  }, []);

  // Last time's photo of the pose on screen, over the camera's picture.
  useEffect(() => {
    const canvas = outlineCanvas.current;
    if (!canvas) return;
    const blob = showOutline ? outlines.current.get(pose) : undefined;
    if (!blob) {
      clearPhoto(canvas);
      return;
    }
    void drawPhoto(canvas, blob).catch(() => clearPhoto(canvas));
  }, [pose, showOutline, outlinesLoaded]);

  async function openCamera() {
    setError(null);
    setPhase("starting");
    startPhotoVoice(naturalVoice);
    try {
      const opened = await openBackCamera();
      stream.current = opened;
      const el = video.current;
      if (el) {
        el.srcObject = opened;
        await el.play().catch(() => {});
      }
      setPhase("ready");
    } catch (err) {
      setError(cameraMessage(err instanceof Error ? `${err.name} ${err.message}` : String(err)));
      setPhase("error");
      return;
    }
    // Last time's photos, for the outline, and whether today's are kept already.
    try {
      for (const p of POSES) {
        const last = await lastPhotoOf(owner, p, today);
        if (last) outlines.current.set(p, last.blob);
      }
      setOutlinesLoaded((n) => n + 1);
      setKeptToday((await photoKeys(owner)).some((k) => k.day === today));
    } catch {
      // No outline: the photos are still taken.
    }
  }

  function startCount(poses: Pose[]) {
    setSequence(poses);
    setAt(0);
    setCount(FIRST_COUNT_S);
    setPhase("counting");
    sayPhoto(poses.length === 1 ? PHOTO_LINES.again[poses[0]] : PHOTO_LINES.start);
  }

  // One second gone: a beep near the end, the photo at zero, then the next pose or the review.
  const tick = useEffectEvent(() => {
    if (count > 1) {
      if (count - 1 <= BEEP_FROM_S) beep();
      setCount(count - 1);
      return;
    }
    const el = video.current;
    const shooting = sequence[at];
    click();
    setCount(0);
    if (!el || !shooting) return;
    void snapPhoto(el).then(
      (photo) => {
        setTaken((now) => ({ ...now, [shooting]: photo }));
        const next = sequence[at + 1];
        if (next) {
          setAt(at + 1);
          setCount(TURN_COUNT_S);
          sayPhoto(next === "side" ? PHOTO_LINES.side : PHOTO_LINES.back);
        } else {
          sayPhoto(sequence.length === 1 ? PHOTO_LINES.gotIt : PHOTO_LINES.done);
          setPhase("review");
        }
      },
      (err: unknown) => {
        setError(err instanceof Error ? err.message : "The photo could not be taken.");
        setPhase("ready");
      },
    );
  });

  useEffect(() => {
    if (phase !== "counting" || count === 0) return;
    const timer = window.setTimeout(() => tick(), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, count, at]);

  function keep() {
    const photos = POSES.flatMap((p) => {
      const t = taken[p];
      return t ? [{ owner, day: today, pose: p, blob: t.blob, width: t.width, height: t.height }] : [];
    });
    if (photos.length === 0) return;
    startSaving(async () => {
      try {
        await keepPhotos(photos);
      } catch {
        toast.error("This phone's storage would not keep them. Free some space on the phone, then try again.");
        return;
      }
      stopCamera(stream.current);
      stream.current = null;
      toast.success(`${photos.length === 1 ? "Photo" : `${photos.length} photos`} kept on this phone.`);
      router.push(PHOTOS);
    });
  }

  function discard() {
    hushPhoto();
    setDiscarding(false);
    setTaken({});
    setSequence([...POSES]);
    setAt(0);
    setPhase("ready");
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={PHOTOS}>
          <ArrowLeft aria-hidden /> Photos
        </Link>
      </Button>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 font-heading text-2xl font-medium tracking-heading">
            <Camera className="size-6 text-module-accent" aria-hidden /> Take photos
          </h1>
          <HelpButton />
        </div>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-3.5" aria-hidden /> Kept on this phone only. Never uploaded, never in your gallery.
        </p>
      </div>

      <div className={cn("relative overflow-hidden rounded-2xl bg-black", phase === "review" || phase === "idle" ? "hidden" : "aspect-[3/4]")}>
        <video ref={video} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
        <canvas
          ref={outlineCanvas}
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 h-full w-full object-contain opacity-35", !showOutline && "hidden")}
        />
        <p className="absolute top-2 left-3 rounded bg-black/50 px-2 py-0.5 text-sm text-white">
          {`${POSE_WORDS[pose]}${sequence.length > 1 ? ` · ${at + 1} of ${sequence.length}` : ""}`}
        </p>
        {phase === "counting" && count > 0 && (
          <p className="absolute inset-0 flex items-center justify-center text-9xl font-medium text-white tabular-nums [text-shadow:0_2px_12px_rgb(0_0_0/0.6)]" aria-live="off">
            {count}
          </p>
        )}
      </div>

      {phase === "idle" && (
        <div className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <p>Prop the phone up at about waist height, 2 to 3 metres away, so your whole body fits. Then Start, and step into place.</p>
          <p className="text-sm text-muted-foreground">
            Ten seconds to stand facing the phone, then it takes the front, side and back in a row, saying when to turn. Same
            spot, same light and the same time of day make the photos easiest to compare.
          </p>
          <Button className="h-12 w-full text-base" onClick={openCamera}>
            <Camera aria-hidden /> Open the camera
          </Button>
        </div>
      )}

      {phase === "error" && (
        <div className="space-y-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <p className="text-destructive">{error}</p>
          <Button variant="outline" onClick={openCamera}>
            Try again
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <div className="space-y-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {keptToday && <p className="text-sm text-muted-foreground">Today&apos;s photos are kept already. New ones replace them.</p>}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showOutline} onChange={(e) => setShowOutline(e.target.checked)} className="size-4" />
            Show the outline of last time&apos;s photo
          </label>
          <Button className="h-16 w-full text-lg" onClick={() => startCount([...POSES])}>
            Start
          </Button>
        </div>
      )}

      {phase === "counting" && (
        <Button variant="outline" className="h-12 w-full" onClick={discard}>
          Stop
        </Button>
      )}

      {phase === "review" && (
        <div className="space-y-4">
          <ul className="grid grid-cols-3 gap-2">
            {POSES.map((p) => (
              <li key={p} className="space-y-1 text-center">
                <ReviewTile photo={taken[p] ?? null} />
                <p className="text-sm font-medium">{POSE_WORDS[p]}</p>
                <Button variant="ghost" size="sm" onClick={() => startCount([p])}>
                  <RotateCcw aria-hidden /> Take again
                </Button>
              </li>
            ))}
          </ul>
          {discarding ? (
            <div className="space-y-2">
              <p>Discard these photos? They are not kept anywhere.</p>
              <div className="flex gap-2">
                <Button variant="destructive" className="h-12 flex-1" onClick={discard}>
                  Discard
                </Button>
                <Button variant="outline" className="h-12 flex-1" onClick={() => setDiscarding(false)}>
                  Keep them
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button className="h-12 flex-1 text-base" onClick={keep} disabled={saving}>
                {saving ? "Keeping…" : "Keep"}
              </Button>
              <Button variant="outline" className="h-12" onClick={() => setDiscarding(true)} disabled={saving}>
                Discard
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A photo just taken, drawn small to check. */
function ReviewTile({ photo }: { photo: Taken | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el || !photo) return;
    void drawPhoto(el, photo.blob).catch(() => clearPhoto(el));
    return () => clearPhoto(el);
  }, [photo]);
  return photo ? (
    <canvas ref={canvas} aria-label="The photo just taken" className="aspect-[3/4] w-full rounded-lg bg-black object-contain" />
  ) : (
    <div className="flex aspect-[3/4] w-full items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">Not taken</div>
  );
}
