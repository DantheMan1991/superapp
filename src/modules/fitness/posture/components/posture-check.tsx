"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Check, CircleDot, Crosshair, Eye, EyeOff, Loader2, Ruler, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Place } from "../core/placement";
import { stickersIn, VIEWS, type View } from "../core/sticker-map";
import { useWakeLock } from "../../components/workout/use-wake-lock";
import { askToKeepStorage, newCheckId, sweepAbandoned } from "../store/checks";
import type { CaptureAction } from "../client/capture-base";
import { CheckSession, HOLD_FRAMES, ROUNDS, VIEW_LABEL, type CheckResult, type CheckStep, type Marks } from "../client/check-session";
import { readDeviceSettings, writeDeviceSettings } from "../client/device-settings";
import { useScreenPrivacy } from "../client/screen-privacy";
import type { FrameResult } from "../worker/protocol";
import { cameraMessage } from "./camera-message";
import { PostureOverlay } from "./overlay";
import { PostureReport } from "./posture-report";

/**
 * THE POSTURE CHECK (docs/help/fitness/posture-check.md; docs/modules/
 * posture.md, slice 2): full screen and dark like the setup check, because the
 * phone is on its tripod and the person three meters away, listening.
 *
 * Four views, twice, each captured when the person is framed, facing the
 * right way and still; the report opens when it is done. The numbers are kept
 * on this phone, and a photo of each view only if the switch is on (ADR 0118).
 */

type Phase = "intro" | "running" | "failed" | "unsaved";

const SHORT: Record<View, string> = { front: "Front", right: "Right", back: "Back", left: "Left" };

function subscribe(): () => void {
  return () => undefined;
}

/** Whether this phone has run the setup check (its readout is kept on the phone). */
function setupRunSnapshot(): boolean {
  return !!readDeviceSettings().lastReadoutAt;
}

function keepPhotosSnapshot(): boolean {
  return readDeviceSettings().keepPhotos === true;
}

export function PostureCheck({
  owner,
  naturalVoice,
  backHref,
  reportHref,
  setupHref,
  testSources,
  repeatOf,
  lastPlaces,
}: {
  owner: string;
  naturalVoice: boolean;
  backHref: string;
  /** Where a saved check's report opens: the check's id is added to it. */
  reportHref: string;
  setupHref: string;
  testSources: boolean;
  /** The check this one repeats, stickers taken off and put back on (3b); null for an ordinary check. */
  repeatOf: { id: string; takenAt: string } | null;
  /** Where each sticker sat on the last check (3b); null before a first check. */
  lastPlaces: Record<string, Place> | null;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("intro");
  // Off until turned on, then as last set on this phone.
  const storedKeepPhotos = useSyncExternalStore(subscribe, keepPhotosSnapshot, () => false);
  const [keepPhotosSet, setKeepPhotosSet] = useState<boolean | null>(null);
  const keepPhotos = keepPhotosSet ?? storedKeepPhotos;
  const [step, setStep] = useState<CheckStep | null>(null);
  const [round, setRound] = useState(1);
  const [marks, setMarks] = useState<Marks | null>(null);
  const [vertical, setVertical] = useState<{ from: "plumb" | "sensor" | "none"; pxPerMetre: number | null } | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [actions, setActions] = useState<CaptureAction[]>([]);
  const [frame, setFrame] = useState<FrameResult | null>(null);
  const [hideCamera, setHideCamera] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState<CheckResult | null>(null);
  const setupRun = useSyncExternalStore(subscribe, setupRunSnapshot, () => true);
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<CheckSession | null>(null);
  const testView = useRef<View>("front");
  const running = phase === "running";
  useWakeLock(running);
  // In the app: no screenshots or app-switcher picture while the camera is on.
  useScreenPrivacy(running);

  useEffect(() => {
    // A check this page was reloaded out of, or closed in the middle of, goes now.
    void sweepAbandoned(owner).catch(() => 0);
    return () => session.current?.close();
  }, [owner]);

  function changeKeepPhotos(on: boolean) {
    setKeepPhotosSet(on);
    writeDeviceSettings({ keepPhotos: on });
    // So the phone does not clear them to make room, where Chrome allows it.
    if (on) void askToKeepStorage();
  }

  async function start(testSource: MediaStream | null = null) {
    if (!video.current || session.current) return;
    setPhase("running");
    const id = newCheckId();
    const s = new CheckSession(
      video.current,
      {
        instruction: setInstruction,
        actions: setActions,
        frame: setFrame,
        hideCamera: setHideCamera,
        warning: setWarning,
        step: (next) => {
          if (next.kind === "view") {
            testView.current = next.view;
            setRound(next.round);
          } else if (next.kind === "between") {
            setRound(ROUNDS);
          }
          setStep(next);
        },
        marks: setMarks,
        vertical: (from, pxPerMetre) => setVertical({ from, pxPerMetre }),
        modelReady: setModelReady,
        done: (result) => {
          if (result.saved) {
            router.replace(`${reportHref}/${result.checkId}`);
          } else {
            setUnsaved(result);
            setPhase("unsaved");
          }
        },
        failed: (message) => {
          setFailure(cameraMessage(message));
          setPhase("failed");
        },
      },
      naturalVoice,
      { id, owner, keepPhotos, repeatOf: repeatOf?.id ?? null, lastPlaces },
      testSource,
    );
    session.current = s;
    await s.run();
  }

  async function startWithFiles(files: File[]) {
    // Development only: pictures or a film stand in for the camera, one
    // picture per view in the order front, right, back, left (the first
    // stands in for any view without its own). They never leave this page.
    const first = files[0];
    if (!first) return;
    let stream: MediaStream;
    if (first.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.src = URL.createObjectURL(first);
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      await v.play();
      stream = (v as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
    } else {
      const images = await Promise.all(
        files.slice(0, 4).map(async (file) => {
          const img = new Image();
          img.src = URL.createObjectURL(file);
          await img.decode();
          return img;
        }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = images[0].naturalWidth;
      canvas.height = images[0].naturalHeight;
      const ctx = canvas.getContext("2d")!;
      const paint = () => {
        const img = images[VIEWS.indexOf(testView.current)] ?? images[0];
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      paint();
      stream = canvas.captureStream(15);
      // A still picture: redraw so the stream keeps producing frames.
      window.setInterval(paint, 66);
    }
    await start(stream);
  }

  if (phase === "unsaved" && unsaved) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <div className="flex gap-2 rounded-xl bg-warning/15 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
          <span>
            This check could not be kept on this phone or in your account ({unsaved.saveError}). Copy its numbers now:
            they are gone when you leave this page.
          </span>
        </div>
        <PostureReport
          check={{ id: unsaved.checkId, at: unsaved.at, captures: unsaved.captures, notes: unsaved.notes, keepPhotos: false }}
          owner={owner}
          backHref={backHref}
          history={[]}
          canDelete={false}
        />
      </div>
    );
  }

  const viewStep = step?.kind === "view" ? step : null;
  const stickers = frame?.stickers;

  return (
    <div className="dark fixed inset-0 z-50 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-3 px-4 pt-3 pb-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-heading text-lg font-medium tracking-heading">Posture check</h1>
          <Button asChild variant="ghost" size="icon" aria-label="Close">
            <Link href={backHref}>
              <X aria-hidden />
            </Link>
          </Button>
        </div>

        {phase !== "intro" && marks && (
          <div className="flex items-center gap-2">
            <ol className="flex flex-1 gap-1.5" aria-label={`Round ${round} of ${ROUNDS}`}>
              {VIEWS.map((v) => {
                const mark = marks[round - 1]?.[v] ?? "waiting";
                return (
                  <li
                    key={v}
                    className={cn(
                      "inline-flex flex-1 items-center justify-center gap-1 rounded-full px-2 py-1 text-xs",
                      mark === "now" && "bg-primary text-primary-foreground",
                      mark === "done" && "bg-success/20 text-success-foreground",
                      mark === "skipped" && "bg-muted text-muted-foreground line-through",
                      mark === "waiting" && "bg-muted text-muted-foreground",
                    )}
                  >
                    {mark === "done" && <Check className="size-3" aria-hidden />}
                    {SHORT[v]}
                  </li>
                );
              })}
            </ol>
            <span className="shrink-0 text-xs text-muted-foreground">
              Round {round} of {ROUNDS}
            </span>
          </div>
        )}

        <div
          className={cn(
            "relative w-full overflow-hidden rounded-2xl bg-black",
            // Before Start there is nothing to show yet: a short box keeps Start on a phone's first screen.
            phase === "intro" ? "h-28" : "aspect-[9/16] max-h-[48dvh]",
          )}
        >
          <video ref={video} muted playsInline aria-hidden className="absolute inset-0 h-full w-full object-contain" />
          <PostureOverlay frame={frame} hideCamera={hideCamera} />
          {phase === "intro" && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
              The camera starts when you tap Start.
            </div>
          )}
          {running && hideCamera && (
            <button
              type="button"
              onClick={() => setHideCamera(false)}
              className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white"
            >
              <Eye className="size-3.5" aria-hidden /> Show the camera
            </button>
          )}
          {running && !hideCamera && frame && (
            <button
              type="button"
              onClick={() => setHideCamera(true)}
              className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white"
            >
              <EyeOff className="size-3.5" aria-hidden /> Hide the camera
            </button>
          )}
        </div>

        {phase === "intro" && (
          <div className="space-y-4 text-sm">
            {repeatOf && (
              <div className="space-y-1 rounded-xl bg-card p-3">
                <p className="font-medium">
                  A repeat of your check from{" "}
                  {new Date(repeatOf.takenAt).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" })}
                </p>
                <p className="text-muted-foreground">
                  Take every sticker off, then put them back on the way you usually do. The difference between the two
                  checks is your own measuring noise: after three repeats it replaces the published figures.
                </p>
              </div>
            )}
            {!setupRun && (
              <div className="flex gap-2 rounded-xl bg-warning/15 p-3">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
                <span>
                  This phone has not run the setup check yet. <Link href={setupHref} className="underline underline-offset-4">Check your setup</Link> first: it
                  finds the main lens and proves the stickers can be seen.
                </span>
              </div>
            )}
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>The phone upright on its tripod, at hip height, 3 to 3.5 m from your foot outline. The plumb line hanging beside the outline.</li>
              <li>Your stickers on. The sound up.</li>
              <li>Tap Start and stay by the phone until the voice sends you to your outline.</li>
              <li>Then face the phone, and turn when you are told: front, right side, back, left side, twice.</li>
            </ol>
            <label className="flex items-start justify-between gap-4 rounded-xl bg-card p-3">
              <span className="space-y-1">
                <span className="block font-medium">Keep a photo of each view on this phone</span>
                <span className="block text-xs text-muted-foreground">
                  One photo from each side, kept in this browser on this phone only, to compare with later checks. Never
                  uploaded, and never put in your gallery. Clearing the site&apos;s data removes them, and the phone may
                  too if it runs short of space.
                </span>
              </span>
              <Switch checked={keepPhotos} onCheckedChange={changeKeepPhotos} aria-label="Keep a photo of each view on this phone" />
            </label>
            <Button className="h-14 w-full text-lg" onClick={() => void start()}>
              Start
            </Button>
            {testSources && (
              <div className="text-xs text-muted-foreground">
                <label className="underline-offset-4 hover:underline">
                  Development: test with pictures (front, right, back, left) or a film instead of the camera
                  <input
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      const files = Array.from(e.target.files ?? []);
                      if (files.length > 0) void startWithFiles(files);
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {running && (
          <>
            <p className="text-2xl leading-snug font-medium">{instruction}</p>
            {viewStep && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{VIEW_LABEL[viewStep.view]}</span>
                  <span>
                    {viewStep.read > 0 ? `Reading ${viewStep.read} of ${HOLD_FRAMES}` : "Waiting for you to be framed and still"}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full bg-primary transition-[width]" style={{ width: `${(viewStep.read / HOLD_FRAMES) * 100}%` }} />
                </div>
              </div>
            )}
            {step?.kind === "slipped" && (
              <ul className="space-y-1 rounded-xl bg-warning/15 p-3 text-sm" aria-label="Stickers not where they were last time">
                {step.shifts.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3">
                    <span className="first-letter:uppercase">{s.name}</span>
                    <span className="text-warning-foreground">{s.words}</span>
                  </li>
                ))}
              </ul>
            )}
            {step?.kind === "starting" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {step.message}
              </p>
            )}
            {step?.kind === "saving" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Saving the numbers
              </p>
            )}
            <div className="flex flex-wrap gap-2 text-xs">
              {step?.kind === "level" && (
                <Chip ok={step.roll !== null && Math.abs(step.roll) <= 1 && step.pitch !== null && Math.abs(step.pitch) <= 2} icon={Crosshair}>
                  {step.roll === null || step.pitch === null
                    ? "Reading the tilt"
                    : Math.abs(step.roll) <= 1 && Math.abs(step.pitch) <= 2
                      ? `Level · turned ${step.roll.toFixed(1)}° · tipped ${step.pitch.toFixed(1)}°`
                      : `Not level · turned ${step.roll.toFixed(1)}° · tipped ${step.pitch.toFixed(1)}°`}
                </Chip>
              )}
              {step?.kind === "plumb" && (
                <Chip ok={null} icon={Ruler}>
                  Finding the plumb line
                </Chip>
              )}
              {vertical && (
                <Chip ok={vertical.from === "plumb"} icon={Ruler}>
                  {vertical.from === "plumb"
                    ? vertical.pxPerMetre
                      ? "Plumb line found, with its meter marks"
                      : "Plumb line found, no meter marks"
                    : "No plumb line: the phone's level stands in"}
                </Chip>
              )}
              {viewStep && !modelReady && (
                <Chip ok={null} icon={Loader2}>
                  Loading the pose model
                </Chip>
              )}
              {viewStep && stickers && stickers.view === viewStep.view && (
                <Chip ok={stickers.missing.length === 0} icon={CircleDot}>
                  Stickers {stickers.found.length} of {stickersIn(viewStep.view).length}
                </Chip>
              )}
            </div>
          </>
        )}

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button key={a.id} variant="outline" onClick={() => session.current?.act(a.id)}>
                {a.label}
              </Button>
            ))}
          </div>
        )}

        {warning && !failure && (
          <div className="flex gap-2 rounded-xl bg-warning/15 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
            <span>{warning}</span>
          </div>
        )}

        {failure && (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-xl bg-destructive/15 p-3 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <span>{failure}</span>
            </div>
            <Button asChild variant="outline" className="w-full">
              <Link href={backHref}>Back to the posture check</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function Chip({ ok, icon: Icon, children }: { ok: boolean | null; icon: typeof Ruler; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-1",
        ok === true && "bg-success/20 text-success-foreground",
        ok === false && "bg-warning/20 text-warning-foreground",
        ok === null && "bg-muted text-foreground",
      )}
    >
      <Icon className={cn("size-3", Icon === Loader2 && "animate-spin")} aria-hidden />
      {children}
    </span>
  );
}
