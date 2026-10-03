import { fitEdge, PHOTO_QUALITY } from "../core/photos";

/**
 * A PHOTO, TAKEN FROM THE CAMERA'S PICTURE (H2b, ADR 0128): the frame on
 * screen drawn once onto a canvas no one sees, held to the longest side Health
 * keeps, and made a JPEG. The one place a picture becomes a file; it goes
 * from here to the review on screen, and to this phone's storage only on
 * Keep (`store.ts`).
 */
export function snapPhoto(video: HTMLVideoElement): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitEdge(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context || width === 0) return Promise.reject(new Error("The camera has no picture yet."));
  context.drawImage(video, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (blob) resolve({ blob, width, height });
        else reject(new Error("The photo could not be made."));
      },
      "image/jpeg",
      PHOTO_QUALITY,
    );
  });
}
