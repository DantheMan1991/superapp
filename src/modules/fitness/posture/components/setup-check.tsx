"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Crosshair,
  Camera,
  Check,
  CircleDot,
  Copy,
  Cpu,
  Eye,
  EyeOff,
  Focus,
  Loader2,
  PersonStanding,
  Ruler,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWakeLock } from "@/lib/use-wake-lock";
import { useScreenPrivacy } from "../client/screen-privacy";
import { SetupSession, type RowKey, type RowState, type SetupAction } from "../client/setup-session";
import type { FrameResult } from "../worker/protocol";
import { cameraMessage } from "./camera-message";
import { PostureOverlay } from "./overlay";

/**
 * CHECK YOUR SETUP (docs/help/fitness/posture-setup.md; docs/modules/
 * posture.md, slice 1): full screen and dark, like workout mode, because the
 * phone is on a tripod and the person is three metres away listening to it.
 *
 * It proves, on this phone, everything the posture check will lean on: the
 * main lens and its locks, the level, the plumb line, the pose model finding
 * the person, the stickers from all four sides, and how fast the model is
 * here. It ends with a readout of numbers to copy and send. Nothing is saved
 * to the account, and no picture is kept anywhere (ADR 0118).
 */

const ROWS: { key: RowKey; label: string; icon: typeof Camera }[] = [
  { key: "camera", label: "Camera", icon: Camera },
  { key: "locks", label: "Focus and color", icon: Focus },
  { key: "level", label: "Level", icon: Crosshair },
  { key: "plumb", label: "Plumb line", icon: Ruler },
  { key: "person", label: "You, head to toe", icon: PersonStanding },
  { key: "stickers", label: "Stickers", icon: CircleDot },
  { key: "model", label: "Pose model", icon: Cpu },
];

const WAITING: RowState = { status: "waiting", value: "Not yet" };

const STATUS_WORDS: Record<RowState["status"], string> = {
  waiting: "Waiting",
  working: "Checking",
  ready: "Ready",
  check: "Check",
  skipped: "Skipped",
};

type Phase = "intro" | "running" | "done" | "failed";

export function SetupCheck({ naturalVoice, backHref, testSources }: { naturalVoice: boolean; backHref: string; testSources: boolean }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [rows, setRows] = useState<Record<RowKey, RowState>>(() =>
    Object.fromEntries(ROWS.map((r) => [r.key, WAITING])) as Record<RowKey, RowState>,
  );
  const [instruction, setInstruction] = useState("");
  const [actions, setActions] = useState<SetupAction[]>([]);
  const [frame, setFrame] = useState<FrameResult | null>(null);
  const [hideCamera, setHideCamera] = useState(false);
  const [readout, setReadout] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<SetupSession | null>(null);
  const testFile = useRef<HTMLInputElement>(null);
  useWakeLock(phase === "running");
  // In the app: no screenshots or app-switcher picture while the camera is on.
  useScreenPrivacy(phase === "running");

  useEffect(() => () => session.current?.close(), []);

  async function start(testSource: MediaStream | null = null) {
    if (!video.current || session.current) return;
    setPhase("running");
    const s = new SetupSession(
      video.current,
      {
        row: (key, state) => setRows((prev) => ({ ...prev, [key]: state })),
        instruction: setInstruction,
        actions: setActions,
        frame: setFrame,
        hideCamera: setHideCamera,
        done: (text) => {
          setReadout(text);
          setPhase("done");
        },
        failed: (message) => {
          setFailure(cameraMessage(message));
          setPhase("failed");
        },
        warning: setWarning,
      },
      naturalVoice,
      testSource,
    );
    session.current = s;
    await s.run();
  }

  async function startWithFile(file: File) {
    // Development only: a picture or a film stands in for the camera, so the
    // whole check can be driven on a laptop. It never leaves this page.
    const url = URL.createObjectURL(file);
    let stream: MediaStream;
    if (file.type.startsWith("video/")) {
      const v = document.createElement("video");
      v.src = url;
      v.muted = true;
      v.loop = true;
      v.playsInline = true;
      await v.play();
      stream = (v as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
    } else {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      const paint = () => ctx.drawImage(img, 0, 0);
      paint();
      stream = canvas.captureStream(15);
      // A still picture: redraw so the stream keeps producing frames.
      window.setInterval(paint, 66);
    }
    await start(stream);
  }

  async function copyReadout() {
    if (!readout) return;
    try {
      await navigator.clipboard.writeText(readout);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const running = phase === "running";

  return (
    <div className="dark fixed inset-0 z-50 overflow-y-auto bg-background text-foreground">
      <div className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-4 pt-3 pb-10">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-heading text-lg font-medium tracking-heading">Check your setup</h1>
          <Button asChild variant="ghost" size="icon" aria-label="Close">
            <Link href={backHref}>
              <X aria-hidden />
            </Link>
          </Button>
        </div>

        <div className="relative aspect-[9/16] max-h-[52dvh] w-full overflow-hidden rounded-2xl bg-black">
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
          <div className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>Stand the phone upright on its tripod, at hip height, 3 to 3.5 m from your foot outline.</li>
              <li>Hang the plumb line beside the outline, so it runs from the top of the picture to the bottom.</li>
              <li>Put your stickers on. Turn the sound up.</li>
              <li>Tap Start, then follow the voice.</li>
            </ol>
            <Button className="h-14 w-full text-lg" onClick={() => void start()}>
              Start
            </Button>
            {testSources && (
              <div className="text-xs text-muted-foreground">
                <label className="underline-offset-4 hover:underline">
                  Development: test with a picture or a film instead of the camera
                  <input
                    ref={testFile}
                    type="file"
                    accept="image/*,video/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void startWithFile(file);
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        {phase !== "intro" && instruction && <p className="text-lg leading-snug">{instruction}</p>}

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
          <div className="flex gap-2 rounded-xl bg-destructive/15 p-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <span>{failure}</span>
          </div>
        )}

        {phase !== "intro" && (
          <ul className="divide-y divide-border rounded-2xl bg-card">
            {ROWS.map(({ key, label, icon: Icon }) => {
              const row = rows[key];
              return (
                <li key={key} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon className="size-5 shrink-0 text-module-accent" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="truncate text-xs text-muted-foreground">{row.value}</div>
                  </div>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                      row.status === "ready" && "bg-success/20 text-success-foreground",
                      row.status === "check" && "bg-warning/20 text-warning-foreground",
                      (row.status === "waiting" || row.status === "skipped") && "bg-muted text-muted-foreground",
                      row.status === "working" && "bg-muted text-foreground",
                    )}
                  >
                    {row.status === "working" && <Loader2 className="size-3 animate-spin" aria-hidden />}
                    {row.status === "ready" && <Check className="size-3" aria-hidden />}
                    {STATUS_WORDS[row.status]}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {phase === "done" && readout && (
          <div className="space-y-2">
            <Button className="h-12 w-full" onClick={() => void copyReadout()}>
              <Copy aria-hidden /> {copied ? "Copied" : "Copy the readout"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Numbers only: the phone, the camera, the level, the plumb line, the stickers and the model&apos;s speed. No
              picture of you is in it or anywhere else.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={backHref}>Back to the posture check</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
