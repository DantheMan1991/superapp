/// <reference lib="webworker" />
import { finished, openPostureDb, PHOTOS, type StoredPhoto } from "../store/db";
import type { PhotoRequest } from "./protocol";

/**
 * ONE KEPT PHOTO (ADR 0118; docs/modules/posture.md, slice 2), made and
 * stored here in the worker, so the picture never crosses to the page by
 * message: the worker's `send` still refuses anything binary, and this only
 * ever writes to the phone's own storage for this site (`store/db.ts`).
 *
 * Only on a `photo` request, which the check sends only when the person
 * turned "Keep a photo of each view on this phone" on, once per view of the
 * first round. Scaled down to `longSide`: enough to compare one check with
 * another on the phone's screen, and a few hundred kilobytes, not megabytes.
 */
export async function keepPhoto(
  source: VideoFrame | ImageBitmap,
  width: number,
  height: number,
  request: PhotoRequest,
): Promise<{ width: number; height: number; bytes: number }> {
  const k = Math.min(1, request.longSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("the phone could not make the photo");
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: request.quality });
  const photo: StoredPhoto = {
    checkId: request.checkId,
    view: request.view,
    round: request.round,
    blob,
    width: w,
    height: h,
    scale: k,
    at: new Date().toISOString(),
  };
  const db = await openPostureDb();
  try {
    const tx = db.transaction(PHOTOS, "readwrite");
    tx.objectStore(PHOTOS).put(photo);
    await finished(tx);
  } finally {
    db.close();
  }
  return { width: w, height: h, bytes: blob.size };
}
