import type { FromWorker, ToWorker } from "../worker/protocol";

/**
 * HOW FRAMES REACH THE WORKER (docs/modules/posture.md, "How a frame is read").
 *
 * Best: the camera track's own stream of `VideoFrame`s
 * (`MediaStreamTrackProcessor`, Chrome 94+), handed to the worker whole, so no
 * frame ever touches the page's thread; the worker drops what it has no time
 * for. Otherwise (a browser without it): the preview `<video>`, one
 * `ImageBitmap` at a time, only when the worker asks for the next.
 *
 * Either way a frame is TRANSFERRED to the worker, not copied, and the worker
 * closes it once read (ADR 0118). Nothing here keeps one.
 */

export type FramePath = "track-processor" | "video-element";

type Processor = new (init: { track: MediaStreamTrack; maxBufferSize?: number }) => { readable: ReadableStream<VideoFrame> };

export function canStreamFrames(): boolean {
  return typeof window !== "undefined" && "MediaStreamTrackProcessor" in window;
}

function post(worker: Worker, message: ToWorker, transfer: Transferable[] = []): void {
  worker.postMessage(message, transfer);
}

/**
 * Start feeding the worker. Returns how, and a stop. The `<video>` path needs
 * the worker's `need` messages, so it listens for them itself.
 */
export function feedWorker(worker: Worker, source: { track?: MediaStreamTrack; video: HTMLVideoElement }): { path: FramePath; stop: () => void } {
  const Kind = (window as unknown as { MediaStreamTrackProcessor?: Processor }).MediaStreamTrackProcessor;
  if (source.track && Kind) {
    // Two frames queued at most: a slow worker reads the newest, not a backlog.
    const processor = new Kind({ track: source.track, maxBufferSize: 2 });
    post(worker, { type: "stream", readable: processor.readable }, [processor.readable as unknown as Transferable]);
    return { path: "track-processor", stop: () => undefined };
  }

  let wanted = true;
  let stopped = false;
  let handle = 0;
  const video = source.video;
  const onMessage = (event: MessageEvent<FromWorker>) => {
    if (event.data.type === "need") wanted = true;
  };
  worker.addEventListener("message", onMessage);

  const tick = async () => {
    if (stopped) return;
    if (wanted && video.readyState >= 2 && video.videoWidth > 0) {
      wanted = false;
      try {
        const bitmap = await createImageBitmap(video);
        if (stopped) {
          bitmap.close();
          return;
        }
        post(worker, { type: "bitmap", bitmap, t: performance.now() }, [bitmap]);
      } catch {
        wanted = true;
      }
    }
    schedule();
  };
  const schedule = () => {
    if (stopped) return;
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (typeof v.requestVideoFrameCallback === "function") handle = v.requestVideoFrameCallback(() => void tick());
    else handle = window.setTimeout(() => void tick(), 50);
  };
  schedule();
  return {
    path: "video-element",
    stop: () => {
      stopped = true;
      worker.removeEventListener("message", onMessage);
      const v = video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
      if (typeof v.cancelVideoFrameCallback === "function") v.cancelVideoFrameCallback(handle);
      window.clearTimeout(handle);
    },
  };
}

/** The worker, from its own module (bundled by Next as a module worker). */
export function startPostureWorker(): Worker {
  return new Worker(new URL("../worker/posture.worker.ts", import.meta.url), { type: "module", name: "posture" });
}
