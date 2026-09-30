import { z } from "zod";
import type { ViewCapture } from "./measures";
import { STICKERS, VIEWS } from "./sticker-map";

/**
 * WHAT A PHONE SENDS THE ACCOUNT FOR ONE POSTURE CHECK (docs/modules/posture.md,
 * slice 3; ADRs 0118 and 0120). The one door numbers take off the phone, so
 * the schema is the promise: every object is `strict` (a field it does not
 * name is refused, not dropped), every value is a number, one of a few known
 * words, or a short line of the check's own notes. There is no place in it
 * for a picture, and nothing binary can pass a number or an enum.
 */

const STICKER_IDS = STICKERS.map((s) => s.id) as [string, ...string[]];

/** Frame pixels: a 4K frame is 3840 on its long side; room to spare, never a runaway. */
const coordinate = z.number().finite().min(-100_000).max(100_000);

const point = z.strictObject({ x: coordinate, y: coordinate });

const posePoint = z.strictObject({ x: coordinate, y: coordinate, visibility: z.number().finite().min(0).max(1) });

export const postureCaptureSchema = z.strictObject({
  view: z.enum(VIEWS),
  round: z.number().int().min(1).max(4),
  // True up in frame pixels: a direction, so about one long.
  up: point.refine((p) => Math.abs(Math.hypot(p.x, p.y) - 1) < 0.01, "up is a direction"),
  upFrom: z.enum(["plumb", "sensor", "none"]),
  pxPerMetre: z.number().finite().positive().max(100_000).nullable(),
  width: z.number().int().min(1).max(20_000),
  height: z.number().int().min(1).max(20_000),
  stickers: z.partialRecord(z.enum(STICKER_IDS), point),
  pose: z.array(posePoint).length(33).nullable(),
  frames: z.number().int().min(0).max(1_000),
  stillPx: z.number().finite().min(0).max(100_000).nullable(),
});

export const postureCheckDocSchema = z.strictObject({
  /** The phone's id for the check, made when it started. */
  id: z.string().uuid(),
  /** When it started, as the phone said it. */
  takenAt: z.string().datetime({ offset: true }),
  /** The person's own calendar day, as the phone said it. */
  localDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Four views, twice, is eight; a round can be repeated no more than that.
  captures: z.array(postureCaptureSchema).min(1).max(16),
  notes: z.array(z.string().max(200)).max(12),
  version: z.literal(1),
});

export type PostureCheckDoc = z.infer<typeof postureCheckDocSchema>;

/** The phone's own calendar day for a moment, as workout sessions count days. */
export function localDayOf(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * A check kept on the phone, as the account takes it: only the fields the
 * schema names, and a NaN (which the phone's storage keeps but the trip to
 * the account does not) as nothing.
 */
export function toCheckDoc(check: { id: string; at: string; captures: readonly ViewCapture[]; notes: readonly string[] }): PostureCheckDoc {
  const finiteOrNull = (n: number | null) => (n !== null && Number.isFinite(n) ? n : null);
  return {
    id: check.id,
    takenAt: new Date(check.at).toISOString(),
    localDay: localDayOf(new Date(check.at)),
    captures: check.captures.map((c) => ({
      view: c.view,
      round: c.round,
      up: { x: c.up.x, y: c.up.y },
      upFrom: c.upFrom,
      pxPerMetre: finiteOrNull(c.pxPerMetre),
      width: Math.round(c.width),
      height: Math.round(c.height),
      stickers: Object.fromEntries(Object.entries(c.stickers).map(([id, p]) => [id, { x: p.x, y: p.y }])),
      pose: c.pose ? c.pose.map((p) => ({ x: p.x, y: p.y, visibility: Math.min(1, Math.max(0, p.visibility)) })) : null,
      frames: c.frames,
      stillPx: finiteOrNull(c.stillPx),
    })),
    notes: check.notes.map((n) => n.slice(0, 200)).slice(0, 12),
    version: 1,
  };
}
