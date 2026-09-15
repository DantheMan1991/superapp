"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadPdfjs } from "@/modules/documents/components/pdf-canvas";

const ZOOMS = [1, 1.5, 2, 3, 4, 6] as const;

/**
 * One sheet, large. The page is drawn by pdf.js onto a canvas — the same
 * trick the cabinet's viewer uses and for the same reason (a stored PDF is
 * never framed) — at the panel's width times the zoom, inside a box that
 * scrolls, because a plan sheet at phone width is a picture of a plan and
 * the zoom is how it becomes one you can read.
 *
 * The file is fetched ONCE per sheet and kept; zooming re-renders the page
 * from the parsed document rather than downloading a forty-sheet set again.
 */
export function SheetViewer({ url, page, label }: { url: string; page: number; label: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [boxWidth, setBoxWidth] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [doc, setDoc] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const taskRef = useRef<{ destroy: () => Promise<void> } | null>(null);

  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const measure = () => setBoxWidth(Math.max(0, node.clientWidth - 2));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const lib = await loadPdfjs();
        if (cancelled) return;
        setStatus("loading");
        setDoc(null);
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`file fetch failed: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;
        const task = lib.getDocument({ data: bytes });
        const loaded = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        taskRef.current = task;
        setDoc(loaded);
      } catch (err) {
        if (cancelled) return;
        console.error("sheet load failed", err);
        setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      const held = taskRef.current;
      taskRef.current = null;
      if (held) void held.destroy();
    };
  }, [url]);

  useEffect(() => {
    if (!doc || boxWidth === 0) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      try {
        const target = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(target);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = (boxWidth * ZOOMS[zoomIndex]) / base.width;
        const viewport = pdfPage.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
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
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "RenderingCancelledException") return;
        console.error("sheet render failed", err);
        setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, boxWidth, zoomIndex]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {status === "failed" ? "This page could not be drawn; download the file instead." : `Page ${page} of the file · ${ZOOMS[zoomIndex]}×`}
        </p>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-7" disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}>
            <Minus className="size-3.5" />
            <span className="sr-only">Zoom out</span>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-7"
            disabled={zoomIndex === ZOOMS.length - 1}
            onClick={() => setZoomIndex((i) => Math.min(ZOOMS.length - 1, i + 1))}
          >
            <Plus className="size-3.5" />
            <span className="sr-only">Zoom in</span>
          </Button>
        </div>
      </div>
      <div ref={boxRef} className="relative max-h-[75vh] w-full min-w-0 overflow-auto rounded-md border bg-secondary/30">
        {status !== "ready" && status !== "failed" && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <canvas ref={canvasRef} aria-label={label} className={status === "ready" ? "block" : "hidden"} />
      </div>
    </div>
  );
}
