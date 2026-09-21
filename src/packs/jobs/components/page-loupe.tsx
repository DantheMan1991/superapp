"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Crosshair, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loadPdfjs } from "@/modules/documents/components/pdf-canvas";

/**
 * ONE PAGE, BIG ENOUGH TO READ THE TITLE BLOCK OFF.
 *
 * The founder, having uploaded a real set: *"It did a really bad job of
 * reading sheet names and numbers... Also, the thumbnails should be able to
 * be clicked on and expanded so I can manually read the drawing name or
 * number."*
 *
 * **A THUMBNAIL CANNOT BE ENLARGED INTO AN ANSWER.** The index's thumbnail is
 * a 168px JPEG — scaling that up gives a blur, not a sheet number. So this
 * re-renders the page from the PDF at whatever zoom is asked for, which is
 * the only thing that can actually be read.
 *
 * **AND IT IS A PLACE TO TYPE, not just to look.** Reading the number is
 * half the job; the other half is putting it in the box, and a viewer you
 * have to close to type in turns forty sheets into eighty actions. The
 * number, the title and the revision are in here, and Next moves on with
 * them saved — so a set the reader could not make sense of is still one
 * pass, not two.
 *
 * **IT IS PORTALLED TO THE BODY, AND THAT IS LOAD-BEARING.** This opens from
 * inside the index dialog, and a dialog panel is positioned with the CSS
 * `translate` property — which makes it the containing block for anything
 * `fixed` inside it. Rendered in place, the loupe laid itself out inside the
 * dialog's own box and was clipped by its scroll: present in the DOM,
 * measurable, and invisible. Found by clicking it.
 *
 * The rendering mirrors `sheet-viewer.tsx` deliberately: whole page into one
 * canvas at `boxWidth * zoom` inside a scrolling box, `PIXEL_CAP` keeping the
 * canvas sane on a big sheet at high zoom, ctrl+wheel and drag to get about.
 * Two viewers that behave differently would be the surprise.
 */

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** The same cap the sheet viewer uses: a huge page at 8x must not eat the tab. */
const PIXEL_CAP = 24_000_000;
/** Where `Title block` lands. Enough to read 3mm type on an ARCH-D sheet. */
const CORNER_ZOOM = 4;

export interface LoupeRow {
  include: boolean;
  sheetNumber: string;
  title: string;
  revision: string;
  hint: string;
}

export function PageLoupe({
  bytes,
  fileName,
  page,
  pageCount,
  row,
  duplicate,
  onPage,
  onPatch,
  onClose,
}: {
  /** The set's bytes, already in the browser — never fetched again for this. */
  bytes: Uint8Array;
  fileName: string;
  page: number;
  pageCount: number;
  row: LoupeRow;
  duplicate: boolean;
  onPage: (pageNumber: number) => void;
  onPatch: (change: Partial<LoupeRow>) => void;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holdRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const [doc, setDoc] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [boxWidth, setBoxWidth] = useState(0);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  /**
   * **THE CORNER IS SCROLLED TO AFTER THE PAGE IS DRAWN, NOT WHEN IT IS
   * ASKED FOR.** The first cut set the zoom and scrolled on the next frame,
   * when React had not re-rendered and the box was still its old size: it
   * scrolled to the far edge of a 1x page and then the canvas grew under it,
   * leaving the view at the top-left. Nothing errored; the button simply did
   * not work. The render effect consumes this once the canvas has its size.
   */
  const wantCorner = useRef(false);

  /**
   * **ITS OWN COPY OF THE BYTES.** pdf.js may hand the array to its worker
   * and leave the original detached, and these bytes belong to the index
   * table, which needs them again for the next page somebody expands.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const lib = await loadPdfjs();
        const task = lib.getDocument({ data: new Uint8Array(bytes) });
        holdRef.current = task;
        const opened = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setDoc(opened);
      } catch (err) {
        if (cancelled) return;
        console.error("loupe: could not open the set", err);
        setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      const held = holdRef.current;
      holdRef.current = null;
      if (held) void held.destroy();
    };
  }, [bytes]);

  /** The box's width drives the render, so it must be measured, not assumed. */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setBoxWidth(box.clientWidth));
    observer.observe(box);
    setBoxWidth(box.clientWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!doc || boxWidth === 0) return;
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    void (async () => {
      try {
        setStatus("loading");
        const target = Math.min(Math.max(page, 1), doc.numPages);
        const pdfPage = await doc.getPage(target);
        if (cancelled) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const base = pdfPage.getViewport({ scale: 1 });
        setPageSize({ w: base.width, h: base.height });
        const viewport = pdfPage.getViewport({ scale: (boxWidth * zoom) / base.width });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(PIXEL_CAP / (viewport.width * viewport.height)),
        );
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        /** pdf.js tasks must be cancelled, or a fast page flick paints the old page over the new. */
        task = pdfPage.render({ canvas, canvasContext: context, viewport });
        await (task as unknown as { promise: Promise<void> }).promise;
        if (cancelled) return;
        setStatus("ready");
        if (wantCorner.current) {
          wantCorner.current = false;
          toCorner();
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof Error && err.name === "RenderingCancelledException") return;
        console.error("loupe: page render failed", err);
        setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, boxWidth, zoom]);

  /** ctrl+wheel zooms about the cursor; a plain wheel scrolls, as everywhere else. */
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * Math.exp(-e.deltaY * 0.002)));
        const rect = box.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const s = next / z;
        requestAnimationFrame(() => {
          box.scrollLeft = (box.scrollLeft + mx) * s - mx;
          box.scrollTop = (box.scrollTop + my) * s - my;
        });
        return next;
      });
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  /** Drag to move about, the way the sheet viewer does. */
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  function onPointerDown(e: React.PointerEvent) {
    const box = boxRef.current;
    if (!box || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: box.scrollLeft, top: box.scrollTop };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const box = boxRef.current;
    const from = drag.current;
    if (!box || !from) return;
    box.scrollLeft = from.left - (e.clientX - from.x);
    box.scrollTop = from.top - (e.clientY - from.y);
  }
  function endDrag(e: React.PointerEvent) {
    drag.current = null;
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }

  /**
   * **THE CORNER IS WHERE THE ANSWER IS.** Every convention puts the sheet
   * number at the bottom right, so the button that gets you there in one
   * press is the whole point of this screen on a set the reader missed.
   */
  function toCorner() {
    const box = boxRef.current;
    if (!box) return;
    box.scrollLeft = box.scrollWidth;
    box.scrollTop = box.scrollHeight;
  }

  function toTitleBlock() {
    /** Already there: no render is coming, so this is the only chance to move. */
    if (zoom === CORNER_ZOOM) {
      toCorner();
      return;
    }
    wantCorner.current = true;
    setZoom(CORNER_ZOOM);
  }

  /**
   * Escape closes, and the arrows walk the set — this is a keyboard loop.
   *
   * **IN THE CAPTURE PHASE, AND THE ESCAPE IS STOPPED HERE.** The index it
   * opens from is a Radix dialog, which closes itself on Escape from its own
   * document listener: one press shut the loupe AND threw away the whole
   * index, every number typed with it. Catching the key on the way down and
   * stopping it means Escape means "close the page I am looking at", which
   * is the only thing anybody would expect it to mean. Found by pressing it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (typing) return;
      if (e.key === "ArrowLeft" && page > 1) onPage(page - 1);
      if (e.key === "ArrowRight" && page < pageCount) onPage(page + 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onPage, page, pageCount]);

  const cssW = Math.floor(boxWidth * zoom);
  const cssH = pageSize ? Math.floor((cssW * pageSize.h) / pageSize.w) : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label={`Page ${page} of ${fileName}`}
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="icon" className="size-8" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-4" />
        </Button>
        <span className="text-sm tabular-nums">
          Page {page} <span className="text-muted-foreground">of {pageCount}</span>
        </span>
        <Button variant="outline" size="icon" className="size-8" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
          <ChevronRight className="size-4" />
        </Button>

        <Button variant="secondary" size="sm" className="h-8" onClick={toTitleBlock}>
          <Crosshair className="mr-1.5 size-4" /> Title block
        </Button>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-8" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5))}>
            <Minus className="size-4" />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
            {zoom.toFixed(zoom >= 3 ? 0 : 1)}×
          </span>
          <Button variant="outline" size="icon" className="size-8" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))}>
            <Plus className="size-4" />
          </Button>
          <Button variant="outline" size="icon" className="size-8 ml-1" aria-label="Close" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/**
        * **THE BOXES ARE ABOVE THE PAGE, NOT BEHIND IT.** What somebody is
        * doing here is copying three things off the drawing; making them
        * close the page to write any of it down is the whole complaint.
        */}
      <div className="flex flex-wrap items-end gap-3 border-b px-3 py-2">
        <div className="flex items-center gap-2 pb-1.5">
          <Checkbox
            id="loupe-include"
            checked={row.include}
            onCheckedChange={(v) => onPatch({ include: v === true })}
          />
          <Label htmlFor="loupe-include" className="text-xs font-normal">
            This page is a sheet
          </Label>
        </div>
        <div>
          <Label htmlFor="loupe-number" className="text-xs">Sheet</Label>
          <Input
            id="loupe-number"
            autoFocus
            value={row.sheetNumber}
            onChange={(e) => onPatch({ sheetNumber: e.target.value, include: e.target.value.trim() !== "" ? true : row.include })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && page < pageCount) onPage(page + 1);
            }}
            placeholder="A-101"
            maxLength={40}
            aria-invalid={duplicate}
            className="mt-0.5 h-8 w-32 font-mono text-xs uppercase"
          />
        </div>
        <div className="min-w-48 flex-1">
          <Label htmlFor="loupe-title" className="text-xs">Title</Label>
          <Input
            id="loupe-title"
            value={row.title}
            onChange={(e) => onPatch({ title: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && page < pageCount) onPage(page + 1);
            }}
            placeholder="First floor plan"
            maxLength={300}
            className="mt-0.5 h-8 text-xs"
          />
        </div>
        <div>
          <Label htmlFor="loupe-rev" className="text-xs">Rev</Label>
          <Input
            id="loupe-rev"
            value={row.revision}
            onChange={(e) => onPatch({ revision: e.target.value })}
            placeholder="—"
            maxLength={40}
            className="mt-0.5 h-8 w-20 text-xs"
          />
        </div>
        <p className="pb-2 text-[11px] text-muted-foreground">
          {duplicate ? "That number is already on another page." : row.hint}
        </p>
      </div>

      <div
        ref={boxRef}
        className="min-h-0 flex-1 cursor-grab overflow-auto bg-muted/40 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div style={{ width: cssW, height: cssH }} className="relative mx-auto">
          <canvas ref={canvasRef} className="block bg-white" />
          {status === "loading" && (
            <p className="absolute left-1/2 top-8 -translate-x-1/2 rounded bg-card px-2 py-1 text-xs text-muted-foreground shadow">
              Drawing the page…
            </p>
          )}
          {status === "failed" && (
            <p className="absolute left-1/2 top-8 -translate-x-1/2 rounded bg-card px-2 py-1 text-xs text-destructive shadow">
              This page could not be drawn.
            </p>
          )}
        </div>
      </div>

      <p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        Drag to move about · ctrl+wheel to zoom · ← → for the next page · Enter moves on · Esc closes
      </p>
    </div>,
    document.body,
  );
}
