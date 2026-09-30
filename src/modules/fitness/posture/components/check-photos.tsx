"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Point } from "../core/geometry";
import type { ViewCapture } from "../core/measures";
import { linesOf, type Report } from "../core/report";
import { stickerById, VIEWS, type View } from "../core/sticker-map";
import { useScreenPrivacy } from "../client/screen-privacy";
import { deletePhotos, photoKeys, readPhotos } from "../store/checks";
import type { StoredPhoto } from "../store/db";

/**
 * THE PHOTOS A CHECK KEPT, BEHIND A TAP (ADR 0118; docs/help/fitness/
 * posture-report.md). Only on the phone that took them, only when the person
 * turned "Keep a photo of each view on this phone" on. Read from the phone's
 * own storage and drawn into a canvas on this page: no link to them is made,
 * nothing is sent. In the app, screenshots are blocked while they show.
 */

const STICKER_FILL = { left: "#3b82f6", right: "#22c55e", mid: "#f5f5f4" } as const;
const LABEL: Record<View, string> = { front: "Front", right: "Right side", back: "Back", left: "Left side" };

export function CheckPhotos({
  owner,
  checkId,
  captures,
  report,
  onDeleted,
}: {
  owner: string;
  checkId: string;
  captures: ViewCapture[];
  report: Report;
  onDeleted: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [photos, setPhotos] = useState<StoredPhoto[] | null>(null);
  const [withLines, setWithLines] = useState(true);
  const [large, setLarge] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const shown = photos !== null;
  useScreenPrivacy(shown);
  // Each photo with the hold it was taken in and that hold's lines, worked out once.
  const tiles = useMemo(
    () =>
      VIEWS.flatMap((view) => {
        const photo = photos?.find((p) => p.view === view);
        if (!photo) return [];
        const capture = captures.find((c) => c.view === view && c.round === photo.round) ?? null;
        return [{ view, photo, capture, lines: capture ? linesOf(report, view, photo.round) : [] }];
      }),
    [photos, captures, report],
  );

  useEffect(() => {
    let live = true;
    photoKeys(checkId)
      .then((keys) => live && setCount(keys.length))
      .catch(() => live && setCount(0));
    return () => {
      live = false;
    };
  }, [checkId]);

  async function show() {
    setError(null);
    try {
      setPhotos(await readPhotos(owner, checkId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      await deletePhotos(owner, checkId);
      setPhotos(null);
      setCount(0);
      setConfirming(false);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  if (count === null || count === 0) return null;

  return (
    <section className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
      <div className="space-y-1">
        <h2 className="font-medium">Photos on this phone</h2>
        <p className="text-sm text-muted-foreground">
          {count === 1 ? "One photo" : `${count} photos`}, kept only in this browser on this phone. Never uploaded.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {shown ? (
          <Button variant="outline" onClick={() => setPhotos(null)}>
            <EyeOff aria-hidden /> Hide the photos
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void show()}>
            <Eye aria-hidden /> Show the photos
          </Button>
        )}
        {shown && (
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={withLines} onCheckedChange={setWithLines} aria-label="Show the lines" /> Show the lines
          </label>
        )}
        <Dialog open={confirming} onOpenChange={setConfirming}>
          <DialogTrigger asChild>
            <Button variant="ghost" className="text-destructive">
              <Trash2 aria-hidden /> Delete the photos
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this check&apos;s photos?</DialogTitle>
              <DialogDescription>
                They are gone from this phone for good. The check&apos;s numbers and its report stay.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep them
              </Button>
              <Button variant="destructive" onClick={() => void remove()} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete the photos"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {shown && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {tiles.map(({ view, photo, capture, lines }) => (
            <button
              key={view}
              type="button"
              onClick={() => setLarge(large === view ? null : view)}
              className={cn("space-y-1 text-left", large === view && "col-span-2 sm:col-span-4")}
              aria-label={`${LABEL[view]} photo: tap to make it ${large === view ? "smaller" : "bigger"}`}
            >
              <PhotoCanvas photo={photo} capture={capture} lines={lines} withLines={withLines} />
              <span className="block text-center text-xs text-muted-foreground">{LABEL[view]}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function PhotoCanvas({
  photo,
  capture,
  lines,
  withLines,
}: {
  photo: StoredPhoto;
  capture: ViewCapture | null;
  lines: [Point, Point][];
  withLines: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let bitmap: ImageBitmap | null = null;
    void createImageBitmap(photo.blob).then((b) => {
      if (cancelled) {
        b.close();
        return;
      }
      bitmap = b;
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (!c || !ctx) return;
      c.width = b.width;
      c.height = b.height;
      ctx.drawImage(b, 0, 0);
      if (!withLines || !capture) return;
      const k = photo.scale;
      const width = Math.max(2, b.width / 400);
      // True vertical through the feet, along the check's own up.
      const feet = feetOf(capture);
      if (feet) {
        const reach = b.height * 2;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.setLineDash([width * 4, width * 4]);
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo((feet.x - capture.up.x * reach) * k, (feet.y - capture.up.y * reach) * k);
        ctx.lineTo((feet.x + capture.up.x * reach) * k, (feet.y + capture.up.y * reach) * k);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = width * 1.5;
      ctx.lineCap = "round";
      for (const [a, z] of lines) {
        ctx.beginPath();
        ctx.moveTo(a.x * k, a.y * k);
        ctx.lineTo(z.x * k, z.y * k);
        ctx.stroke();
      }
      for (const [id, p] of Object.entries(capture.stickers)) {
        ctx.fillStyle = STICKER_FILL[stickerById(id)?.side ?? "mid"];
        ctx.strokeStyle = "#1c1917";
        ctx.lineWidth = width / 2;
        ctx.beginPath();
        ctx.arc(p.x * k, p.y * k, width * 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });
    return () => {
      cancelled = true;
      bitmap?.close();
    };
  }, [photo, capture, lines, withLines]);

  return <canvas ref={canvas} className="w-full rounded-xl bg-muted" />;
}

/** Where the feet are, frame pixels: the outer ankle bone from the side, else between the ankles. */
function feetOf(c: ViewCapture): Point | null {
  if (c.view === "right" || c.view === "left") {
    const s = c.stickers[`${c.view}-ankle-side`];
    if (s) return s;
  }
  const a = c.pose?.[27];
  const b = c.pose?.[28];
  if (a && b && a.visibility >= 0.3 && b.visibility >= 0.3) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return null;
}
