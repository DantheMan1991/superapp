/**
 * A PHOTO MADE SMALLER ON THE PHONE before it is sent (Food D1): a recipe's
 * own photo to 1,600 px for Save, a page's photo to 1,568 px for Claude, the
 * size it reads at. Drawing it again on a canvas also leaves behind what the
 * camera wrote into the file (where, when, which phone) before a byte leaves
 * the device; the server's `preparePhoto` does the same again for what it keeps.
 */

export interface ShrunkPhoto {
  /** The JPEG, as base64. */
  jpeg: string;
  width: number;
  height: number;
}

async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Throws when the browser cannot read the file as a picture (a HEIC on Chrome, a PDF). */
export async function shrinkPhoto(file: Blob, maxEdge: number, quality = 0.85): Promise<ShrunkPhoto> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (!blob) throw new Error("no jpeg");
    return { jpeg: await base64Of(blob), width, height };
  } finally {
    bitmap.close();
  }
}

/** Smaller still, until it fits `limit` base64 characters; null if it never does. */
export async function shrinkToFit(file: Blob, maxEdge: number, limit: number): Promise<ShrunkPhoto | null> {
  for (const [edge, quality] of [
    [maxEdge, 0.85],
    [maxEdge, 0.7],
    [Math.round(maxEdge * 0.8), 0.7],
    [Math.round(maxEdge * 0.6), 0.65],
  ] as const) {
    const photo = await shrinkPhoto(file, edge, quality);
    if (photo.jpeg.length <= limit) return photo;
  }
  return null;
}

export function previewOf(photo: ShrunkPhoto): string {
  return `data:image/jpeg;base64,${photo.jpeg}`;
}
