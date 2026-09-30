"use client";

import { useEffect, useRef } from "react";
import { LM } from "../core/sticker-map";
import type { PosePoint } from "../core/views";
import type { FrameResult } from "../worker/protocol";

/**
 * WHAT THE SCREEN DRAWS OVER THE CAMERA (docs/help/fitness/posture-setup.md):
 * the plumb line it found, the pose model's figure, each sticker it found
 * (a ring in the sticker's colour) and where it looked for each one it did
 * not (a dashed circle).
 *
 * With `hideCamera` the drawing sits on a dark background instead of the
 * picture: once a person is in view the camera's own image is covered, so
 * whoever picks the phone up sees a stick figure, not the person (ADR 0118).
 * Only numbers reach this component; the picture underneath is the `<video>`
 * the browser shows.
 */

const BONES: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
  [LM.leftAnkle, LM.leftHeel],
  [LM.leftHeel, LM.leftFootIndex],
  [LM.rightAnkle, LM.rightHeel],
  [LM.rightHeel, LM.rightFootIndex],
];

const STICKER_COLOUR = { blue: "#3b82f6", green: "#22c55e" } as const;

export function PostureOverlay({ frame, hideCamera }: { frame: FrameResult | null; hideCamera: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const box = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(box.width * dpr));
    const h = Math.max(1, Math.round(box.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (hideCamera) {
      ctx.fillStyle = "#101010";
      ctx.fillRect(0, 0, w, h);
    }
    if (!frame) return;
    // The video is shown `object-contain`: the same fit here.
    const k = Math.min(w / frame.width, h / frame.height);
    const ox = (w - frame.width * k) / 2;
    const oy = (h - frame.height * k) / 2;
    const X = (x: number) => ox + x * k;
    const Y = (y: number) => oy + y * k;
    const line = Math.max(1.5, 2 * dpr);

    if (frame.plumb?.found && frame.plumb.a !== null && frame.plumb.b !== null) {
      ctx.strokeStyle = "#2dd4bf";
      ctx.lineWidth = line;
      ctx.beginPath();
      ctx.moveTo(X(frame.plumb.b), Y(0));
      ctx.lineTo(X(frame.plumb.a * frame.height + frame.plumb.b), Y(frame.height));
      ctx.stroke();
    }

    const points: PosePoint[] | null = frame.pose?.points ?? null;
    if (points) {
      ctx.strokeStyle = "rgba(230,226,219,0.9)";
      ctx.lineWidth = line;
      for (const [a, b] of BONES) {
        const p = points[a];
        const q = points[b];
        if (!p || !q || p.visibility < 0.3 || q.visibility < 0.3) continue;
        ctx.beginPath();
        ctx.moveTo(X(p.x), Y(p.y));
        ctx.lineTo(X(q.x), Y(q.y));
        ctx.stroke();
      }
      const nose = points[LM.nose];
      const ls = points[LM.leftShoulder];
      const rs = points[LM.rightShoulder];
      if (nose && ls && rs && nose.visibility > 0.3) {
        const r = (Math.hypot(ls.x - rs.x, ls.y - rs.y) / 3 || 20) * k;
        ctx.beginPath();
        ctx.arc(X(nose.x), Y(nose.y), Math.max(6, r), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const s = frame.stickers;
    if (s) {
      const foundIds = new Set(s.found.map((f) => f.id));
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeStyle = "rgba(251,191,36,0.9)";
      ctx.lineWidth = Math.max(1, dpr);
      for (const e of s.expected) {
        if (foundIds.has(e.id)) continue;
        ctx.beginPath();
        ctx.arc(X(e.at.x), Y(e.at.y), Math.max(6, e.radius * k * 0.35), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const f of s.found) {
        ctx.fillStyle = STICKER_COLOUR[f.blob.colour];
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.arc(X(f.blob.centre.x), Y(f.blob.centre.y), Math.max(4 * dpr, 5 * dpr), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }, [frame, hideCamera]);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
