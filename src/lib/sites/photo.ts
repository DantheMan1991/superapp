import "server-only";
import { loadSharp } from "@/lib/vision-image";

/**
 * Turning an uploaded picture into the one photo the site will serve —
 * ADR 0023.
 *
 * ONE DERIVATIVE, MADE HERE, IS ALL THAT IS EVER KEPT. Whatever arrives
 * (a 12MB phone photo, a PNG with a transparent corner, a WebP) leaves as a
 * JPEG with its long edge at most `PHOTO_MAX_EDGE` pixels, or a PNG when
 * the upload had transparency worth keeping. `rotate()` bakes the EXIF
 * orientation into the pixels, and because nothing calls `withMetadata()`
 * every tag is dropped on the way — a photo's GPS position, the camera's
 * serial, the date it was taken — so nothing a phone wrote into the file
 * reaches the internet. The browser scales from there; a second, smaller
 * size is a later decision if pages ever get heavy.
 */

/** What an upload may weigh. Phone photos run 3–8MB; this is room, not a target. */
export const PHOTO_MAX_BYTES = 12 * 1024 * 1024;
/** The long edge of what is served. Wide enough for a hero at 2× on a laptop. */
export const PHOTO_MAX_EDGE = 1600;
export const PHOTO_UPLOAD_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Photos one site may hold. Storage is the platform's bill; a brochure is not a gallery. */
export const SITE_IMAGES_MAX = 60;

/** Pixels an upload may ask to decode. A 50-megapixel camera fits; a decompression bomb does not. */
const MAX_INPUT_PIXELS = 50_000_000;

export interface PreparedPhoto {
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
}

export class PhotoError extends Error {
  constructor(
    readonly code: "not_a_photo",
    message: string,
  ) {
    super(message);
    this.name = "PhotoError";
  }
}

export async function preparePhoto(input: Uint8Array): Promise<PreparedPhoto> {
  const sharp = (await loadSharp()).default;
  let meta: { format?: string; hasAlpha?: boolean };
  try {
    meta = await sharp(Buffer.from(input), { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (err) {
    throw new PhotoError("not_a_photo", err instanceof Error ? err.message : "unreadable");
  }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
    throw new PhotoError("not_a_photo", `format=${meta.format ?? "unknown"}`);
  }
  const keepPng = meta.format === "png" && meta.hasAlpha === true;
  const pipeline = sharp(Buffer.from(input), { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize({ width: PHOTO_MAX_EDGE, height: PHOTO_MAX_EDGE, fit: "inside", withoutEnlargement: true });
  const { data, info } = keepPng
    ? await pipeline.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return {
    bytes: new Uint8Array(data),
    mimeType: keepPng ? "image/png" : "image/jpeg",
    width: info.width,
    height: info.height,
  };
}
