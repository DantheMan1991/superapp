import "server-only";
import sharp from "sharp";

/**
 * Vision payload normalization. The Claude API caps images at 5MB and
 * ~1600px is where its accuracy plateaus; oversized uploads (phone
 * photos) are downscaled to a JPEG before the call — ~3x token savings,
 * no visible extraction quality loss. PDFs pass through untouched.
 */

export const VISION_MAX_BYTES = 4 * 1024 * 1024; // headroom under the 5MB API cap
export const VISION_MAX_EDGE_PX = 2576;

export async function normalizeImageForVision(
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (mimeType === "application/pdf") return { bytes, mimeType };

  const image = sharp(Buffer.from(bytes), { animated: false });
  const meta = await image.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const oversized = bytes.byteLength > VISION_MAX_BYTES || longEdge > VISION_MAX_EDGE_PX;
  if (!oversized) return { bytes, mimeType };

  const out = await image
    .rotate() // honor EXIF orientation before it's stripped
    .resize({
      width: VISION_MAX_EDGE_PX,
      height: VISION_MAX_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { bytes: new Uint8Array(out), mimeType: "image/jpeg" };
}
