"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const BASE = "/dashboard/m/inventory";

/** Nothing to subscribe to: the answer is fixed for the life of the page. */
const subscribe = () => () => {};

/**
 * **`useSyncExternalStore`, NOT `useState` + `useEffect`.** The server has no
 * `window`, so the answer has to be false while the HTML is built and true
 * afterwards — and writing that with state in an effect is the cascading render
 * `react-hooks/set-state-in-effect` exists to stop. This is the same shape
 * `AfterHydration` uses, and for the same reason: the server snapshot is what
 * React hydrates against, so the two agree by construction.
 */
function useScannerSupport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      "BarcodeDetector" in window &&
      Boolean(navigator.mediaDevices?.getUserMedia),
    () => false,
  );
}

/**
 * **THE CAMERA IS THE SECOND WAY TO SCAN, AND THE LESS IMPORTANT ONE.**
 *
 * A barcode scanner is a keyboard: it types the code and presses Enter. So the
 * search box beside this button already scans, on any device, with no
 * permission and no API — and the hub opens the thing when the term is exactly
 * one barcode. This button exists for the person holding a phone in a freezer
 * with no scanner in their hand.
 *
 * **`BarcodeDetector` IS NOT EVERYWHERE, so the button is not either.** It ships
 * in Chrome on Android — which is what the mobile app wraps — and is absent in
 * Safari and Firefox. Rendering a camera button that cannot work would be worse
 * than not offering one, so this renders NOTHING until it has checked, and the
 * check goes through `useSyncExternalStore` because `window` does not exist on
 * the server.
 *
 * **THE TRACK IS STOPPED ON EVERY EXIT PATH.** A camera left running is a light
 * on somebody's phone and a battery going flat, and it is the defect this kind
 * of component always ships with: closing the dialog, finding a code,
 * unmounting, and the browser tab being hidden all land in `stop()`.
 */
export function ScanButton() {
  const router = useRouter();
  const supported = useScannerSupport();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppedRef = useRef(false);

  /** Every exit path comes through here, and it is safe to call twice. */
  function stop() {
    stoppedRef.current = true;
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }

  // Unmounting is an exit path too — a route change while the dialog is open
  // would otherwise leave the camera on with nothing left to close.
  useEffect(() => stop, []);

  useEffect(() => {
    if (!open) {
      stop();
      return;
    }
    // The error is cleared where the dialog is OPENED, not here: a setState in
    // an effect body is the cascading render the lint rule refuses.
    stoppedRef.current = false;
    let cancelled = false;

    async function run() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The back camera on a phone. Ignored on a laptop, which has one.
          video: { facingMode: "environment" },
        });
        if (cancelled || stoppedRef.current) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        /**
         * The formats a business actually meets: the UPC/EAN family off a
         * bought product, Code 128 off a printed shelf label, and QR for a
         * code somebody generated. Naming them is faster than the default of
         * every format, and a detector asked for a format the device lacks
         * throws — so this list stays to what is widely supported.
         */
        const Detector = (
          window as unknown as {
            BarcodeDetector: new (options?: { formats?: string[] }) => {
              detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
            };
          }
        ).BarcodeDetector;
        const detector = new Detector({
          formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "qr_code"],
        });

        // A frame every 400ms. Faster is wasted work on a phone; slower feels
        // like the camera is not looking.
        while (!cancelled && !stoppedRef.current) {
          try {
            const found = await detector.detect(video);
            const code = found[0]?.rawValue?.trim();
            if (code) {
              stop();
              setOpen(false);
              // Straight into the search the hub already understands: an exact
              // match opens the thing, anything else lands on a narrowed list
              // rather than a dead end.
              router.push(`${BASE}?q=${encodeURIComponent(code)}`);
              return;
            }
          } catch {
            // A frame that could not be read is ordinary — a blurred hand, a
            // dark shelf. Keep looking rather than tearing the camera down.
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      } catch {
        // Refused permission, no camera, or a browser that lied about the API.
        // One sentence, and the box below it still takes a typed code.
        setError(
          "The camera could not be opened. Allow it in your browser, or type the code into the search box.",
        );
        stop();
      }
    }
    void run();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, router]);

  if (!supported) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // A second try after a refused permission has to start clean.
          setError(null);
          setOpen(true);
        }}
      >
        <ScanLine className="mr-1.5 size-3.5" />
        Scan
      </Button>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Point it at the code</DialogTitle>
          <DialogDescription>
            Whatever carries it opens. Nothing is recorded by scanning.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="py-4 text-sm text-muted-foreground">{error}</p>
        ) : (
          <video
            ref={videoRef}
            className="w-full rounded-md bg-muted"
            muted
            playsInline
            // Decorative: the sentence above says what it is for, and a
            // reader who cannot see the picture cannot use it either.
            aria-hidden
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
