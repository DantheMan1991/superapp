import { levelFrame, toLevel, type Point } from "../core/geometry";
import type { ViewCapture } from "../core/measures";
import { BONES } from "../core/skeleton";
import { LM, stickerById } from "../core/sticker-map";

/**
 * ONE VIEW OF A CHECK, DRAWN FROM ITS NUMBERS (docs/help/fitness/
 * posture-report.md): the pose model's figure, each sticker where it was
 * found, a true vertical line, and the lines each measure was taken along.
 * Turned so gravity's up is straight up the drawing, whatever the phone's
 * tilt: the plumb line's vertical, not the picture's edge.
 *
 * Numbers only: no picture of the person is involved (ADR 0118).
 */

const STICKER_FILL = { left: "#3b82f6", right: "#22c55e", mid: "#f5f5f4" } as const;

export function ReportFigure({
  capture,
  lines,
  label,
}: {
  capture: ViewCapture;
  /** The measures' lines, frame pixels. */
  lines: [Point, Point][];
  label: string;
}) {
  const frame = levelFrame(capture.up);
  const at = (p: Point) => {
    const l = toLevel(frame, p);
    return { x: l.x, y: -l.y };
  };
  const pose = capture.pose;
  const seen = (i: number) => (pose?.[i] && pose[i].visibility >= 0.3 ? at(pose[i]) : null);
  const stickers = Object.entries(capture.stickers).map(([id, p]) => ({ id, ...at(p), side: stickerById(id)?.side ?? "mid" }));

  const all: Point[] = [...stickers];
  if (pose) for (let i = 0; i < pose.length; i++) if (pose[i].visibility >= 0.3) all.push(at(pose[i]));
  if (all.length === 0) return null;
  const minX = Math.min(...all.map((p) => p.x));
  const maxX = Math.max(...all.map((p) => p.x));
  const minY = Math.min(...all.map((p) => p.y));
  const maxY = Math.max(...all.map((p) => p.y));
  const h = maxY - minY || 1;
  const pad = h * 0.1;
  // A tall, narrow person is still given room to either side, so front and
  // side figures draw at the same height.
  const w = Math.max(maxX - minX, h * 0.5);
  const cx = (minX + maxX) / 2;
  const box = { x: cx - w / 2 - pad, y: minY - pad * 1.6, width: w + 2 * pad, height: h + pad * 2.6 };
  const dot = h * 0.014;

  // True vertical through the feet: the outer ankle bone from the side, the
  // middle of the ankles from the front or back.
  const sideView = capture.view === "right" || capture.view === "left";
  const ankleSticker = sideView ? capture.stickers[`${capture.view}-ankle-side`] : null;
  const feet = ankleSticker
    ? at(ankleSticker)
    : (() => {
        const a = seen(LM.leftAnkle);
        const b = seen(LM.rightAnkle);
        return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : (a ?? b);
      })();

  const nose = seen(LM.nose);
  const ls = seen(LM.leftShoulder);
  const rs = seen(LM.rightShoulder);
  const head = nose && ls && rs ? Math.max(dot * 3, Math.hypot(ls.x - rs.x, ls.y - rs.y) / 3) : null;

  return (
    <figure className="space-y-1">
      <svg viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} className="h-56 w-full rounded-xl bg-muted/40" role="img" aria-label={`${label}, drawn from the check's points`}>
        {feet && (
          <line
            x1={feet.x}
            y1={box.y}
            x2={feet.x}
            y2={box.y + box.height}
            className="stroke-muted-foreground"
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {pose &&
          BONES.map(([a, b]) => {
            const p = seen(a);
            const q = seen(b);
            if (!p || !q) return null;
            return (
              <line key={`${a}-${b}`} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="stroke-muted-foreground/60" strokeWidth={2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            );
          })}
        {nose && head && <circle cx={nose.x} cy={nose.y} r={head} fill="none" className="stroke-muted-foreground/60" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
        {lines.map(([a, b], i) => {
          const p = at(a);
          const q = at(b);
          return <line key={i} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className="stroke-module-accent" strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke" />;
        })}
        {stickers.map((s) => (
          <circle key={s.id} cx={s.x} cy={s.y} r={dot} fill={STICKER_FILL[s.side]} stroke="#1c1917" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <figcaption className="text-center text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}
