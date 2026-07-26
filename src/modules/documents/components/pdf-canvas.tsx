"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * PDF rendering, WITHOUT an iframe.
 *
 * This is the whole trick, and it is worth understanding before changing it.
 * File responses carry `frame-ancestors 'none'` and a `sandbox` directive, so a
 * stored PDF can never be framed on one of our pages and the browser's built-in
 * viewer is disabled anyway. Both headers exist to stop user-uploaded content
 * executing in our origin, and neither is negotiable.
 *
 * But those headers govern the file as a DOCUMENT. They say nothing about our
 * own page fetching the same bytes and drawing them: `fetch()` is subject to
 * OUR page's policy, not the response's, and a canvas is not a browsing
 * context. So pdf.js reads the bytes and paints pixels — no frame, no script
 * from the file ever runs, and the CSP is untouched.
 *
 * The same component serves thumbnails and the full viewer, so there is one
 * place where PDF rendering can be wrong.
 */

/** Loaded once per process, lazily — pdf.js is large and most pages never need it. */
let pdfjs: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs(): Promise<typeof import("pdfjs-dist")> {
  if (pdfjs) return pdfjs;
  const lib = await import("pdfjs-dist");
  // The worker keeps parsing off the main thread; without it a large drawing
  // set freezes the tab while it renders.
  lib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  pdfjs = lib;
  return lib;
}

interface RenderState {
  status: "idle" | "loading" | "ready" | "failed";
  pageCount: number;
}

/**
 * Draw one page of a PDF into a canvas sized to `width`.
 *
 * `enabled` exists so thumbnails can stay inert until scrolled into view — a
 * folder of fifty drawings must not parse fifty PDFs on first paint.
 */
export function PdfCanvas({
  url,
  page = 1,
  width,
  enabled = true,
  className,
  onPageCount,
}: {
  url: string;
  page?: number;
  /** CSS pixels. The canvas is drawn at devicePixelRatio for sharpness. */
  width: number;
  enabled?: boolean;
  className?: string;
  onPageCount?: (count: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<RenderState>({
    status: "idle",
    pageCount: 0,
  });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    // pdf.js render tasks must be cancelled explicitly, or a fast re-render
    // (page flick, resize) paints the old page over the new one.
    let task: { cancel: () => void } | null = null;

    void (async () => {
      setState((s) => ({ ...s, status: "loading" }));
      try {
        const lib = await loadPdfjs();
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`file fetch failed: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;

        const doc = await lib.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        onPageCount?.(doc.numPages);

        const target = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(target);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = width / base.width;
        const viewport = pdfPage.getViewport({ scale });
        // Draw at device resolution, present at CSS size — otherwise a
        // retina screen renders visibly soft text.
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.setTransform(ratio, 0, 0, ratio, 0, 0);

        task = pdfPage.render({ canvas, canvasContext: context, viewport });
        await (task as unknown as { promise: Promise<void> }).promise;
        if (cancelled) return;
        setState({ status: "ready", pageCount: doc.numPages });
      } catch (err) {
        if (cancelled) return;
        // A failed preview is cosmetic — the file itself still downloads, so
        // this degrades to the same typed tile a Word document gets.
        console.error("pdf preview failed", err);
        setState((s) => ({ ...s, status: "failed" }));
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [url, page, width, enabled, onPageCount]);

  if (state.status === "failed") {
    return (
      <div className="flex flex-col items-center gap-1 text-muted-foreground">
        <FileText className="size-8" />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          PDF
        </span>
      </div>
    );
  }

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {state.status !== "ready" && (
        <Loader2 className="absolute size-4 animate-spin text-muted-foreground" />
      )}
      <canvas
        ref={canvasRef}
        className={cn(
          "max-h-full max-w-full",
          state.status !== "ready" && "opacity-0",
        )}
      />
    </div>
  );
}

/**
 * A page-1 thumbnail that does nothing until it is scrolled into view.
 *
 * Without the observer, opening a folder of drawings downloads and parses every
 * PDF in it at once — which is slow, and on a phone tethered to a job site it
 * is worse than slow.
 */
export function PdfThumbnail({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div ref={ref} className="flex size-full items-center justify-center">
      {visible ? (
        <PdfCanvas url={url} width={220} className="size-full" />
      ) : (
        <FileText className="size-8 text-muted-foreground" />
      )}
    </div>
  );
}
