import { mainBackCamera } from "@/lib/camera-label";

/**
 * THE BACK CAMERA, MAIN LENS (H2b; the founder's call: the phone propped up,
 * the back camera). Asked for once by facing, which lets the browser fill in
 * the cameras' names; then, if the browser opened another back lens (a
 * Samsung opens the ultrawide, which bends a body at the edges), the main one
 * is opened instead (`src/lib/camera-label.ts`). The stream is stopped by
 * whoever opened it. Nothing here keeps or sends a frame.
 */

const SIZE = { width: { ideal: 1920 }, height: { ideal: 1080 } };

export function stopCamera(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

export async function openBackCamera(): Promise<MediaStream> {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, ...SIZE } });
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    const main = mainBackCamera(devices);
    const opened = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null;
    if (main && opened !== main) {
      stopCamera(stream);
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: main }, ...SIZE } });
    }
  } catch {
    // The main lens would not open: the one the browser chose stays.
    if (!stream.active) {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, ...SIZE } });
    }
  }
  return stream;
}
