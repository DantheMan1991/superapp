/**
 * A KEPT PHOTO, DRAWN ON THE SCREEN (H2b, ADR 0128): the JPEG decoded and
 * painted onto a canvas the screen owns. No address is ever made for it (an
 * object URL would outlive the screen and could be handed on), and the canvas
 * keeps the photo's own shape; CSS sizes it.
 */
export async function drawPhoto(canvas: HTMLCanvasElement, blob: Blob): Promise<void> {
  const bitmap = await createImageBitmap(blob);
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }
}

/** Clear a canvas that showed a photo, so nothing of it stays in the page. */
export function clearPhoto(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}
