"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRightToLine,
  Check,
  Cloud,
  Hand,
  Hash,
  Loader2,
  MapPin,
  Maximize,
  Minus,
  MoveUpRight,
  Pencil,
  Plus,
  Ruler,
  Square,
  Trash2,
  Type,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { loadPdfjs } from "@/modules/documents/components/pdf-canvas";
import {
  addMarkupAction,
  clearSheetScaleAction,
  deleteMarkupAction,
  pushTakeoffAction,
  setPunchDoneAction,
  setSheetScaleAction,
  unpushTakeoffAction,
  updateMarkupAction,
} from "../actions";
import { thousandthsToQuantityString } from "../billing-math";
import { MIN_EXTENT, MIN_POINTS, arrowHead, clampFraction, cloudPath, markupSentence, normaliseBox, pinNumbers, summariseMarkups, type PointGeometry } from "../markups-math";
import { STANDARD_SCALES, formatMeasure, matchingStandard, measure, sumMeasurements, takeoffUnitFor, toThousandths, type Measurement, type SheetScale } from "../takeoff-math";
import {
  MARKUP_COLORS,
  MARKUP_COLOR_HEX,
  MARKUP_COLOR_LABELS,
  MARKUP_KIND_LABELS,
  MEASURE_POINTS_MAX,
  SCALE_UNITS,
  isMeasureKind,
  type MarkupColor,
  type MarkupKind,
  type MeasureKind,
  type ScaleUnit,
} from "../vocabulary";
import { StatusBadge } from "./status-badge";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** The canvas is drawn at device resolution up to this many pixels; past it the sharpness gives way to memory. */
const PIXEL_CAP = 24_000_000;
const NONE = "__none__";
const NEW_LINE = "__new__";

export interface MarkupView {
  id: string;
  kind: MarkupKind;
  color: MarkupColor;
  geometry: Record<string, unknown>;
  text: string;
  version: number;
  /** The day it was drawn, in the tenant's zone. */
  createdOn: string;
  createdBy: string;
  workItemId: string | null;
  punch: { title: string; done: boolean; dueOn: string | null } | null;
  /** The estimate line a measurement was pushed onto, as it stands now (ADR 0074). */
  takeoff: { estimateId: string; estimateNumber: string; estimateStatus: string; lineDescription: string; lineUnit: string; lineQuantityThousandths: number } | null;
  pushedQuantityThousandths: number | null;
}

export interface EstimateOption {
  id: string;
  number: string;
  title: string;
  status: string;
  lines: Array<{ id: string; description: string; unit: string; quantityThousandths: number }>;
}

/** What a walk is waiting for, when the viewer was opened from one (X7). */
export interface MeasuringFor {
  name: string;
  unit: string;
  kind: MeasureKind;
  busy: boolean;
  /** The total in thousandths, and the trace it came from when it is one. */
  onUse: (valueThousandths: number, markupId: string | null, note: string) => void;
}

type Tool = "select" | MarkupKind | "calibrate";

interface Draft {
  kind: "cloud" | "arrow";
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

interface PointsDraft {
  kind: MeasureKind | "calibrate";
  points: PointGeometry[];
}

function pointsOf(m: MarkupView): PointGeometry[] {
  const list = (m.geometry as { points?: unknown }).points;
  return Array.isArray(list) ? (list as PointGeometry[]) : [];
}

function measurementOf(m: MarkupView, scale: SheetScale | null): Measurement | null {
  if (!isMeasureKind(m.kind)) return null;
  const points = pointsOf(m);
  if (points.length < MIN_POINTS[m.kind]) return null;
  return measure(m.kind, { points }, scale);
}

/**
 * One sheet, large, and what is drawn on it (ADRs 0073, 0074). The page is
 * drawn by pdf.js onto a canvas — the cabinet's trick, a stored PDF is never
 * framed — and the markups are an SVG laid over it in the page's own units,
 * so a cloud is the same cloud at every zoom. Coordinates leave here as
 * fractions of the page and come back the same way.
 *
 * The measuring tools read through the sheet's scale: a length, an area
 * and a count, each a list of points, each with its quantity beside it on
 * the sheet and in the list, and a *Takeoff* that puts the quantity onto
 * an estimate line.
 */
export function SheetViewer({
  url,
  page,
  label,
  sheetId,
  projectId,
  markups,
  canEdit,
  scale,
  estimates,
  codes,
  measuringFor = null,
}: {
  url: string;
  page: number;
  label: string;
  sheetId: string;
  projectId: string;
  markups: MarkupView[];
  canEdit: boolean;
  scale: SheetScale | null;
  estimates: EstimateOption[];
  codes: Array<{ id: string; label: string }>;
  /**
   * **THE WALK IS WAITING FOR THIS NUMBER (X7).** Set when the viewer was
   * opened from a walk that is asking what the building measures, and null
   * everywhere else — the drawings page passes nothing and behaves exactly
   * as it did.
   *
   * Only traces of the SAME KIND are offered: a length handed back for an
   * area is a number that means nothing, and it would multiply through
   * every line that read it.
   */
  measuringFor?: MeasuringFor | null;
}) {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const taskRef = useRef<{ destroy: () => Promise<void> } | null>(null);
  const [doc, setDoc] = useState<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [boxWidth, setBoxWidth] = useState(0);
  const [pageSize, setPageSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [gesture, setGesture] = useState(1);
  const gestureRef = useRef(1);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState<MarkupColor>("red");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pointsDraft, setPointsDraft] = useState<PointsDraft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: "text" | "pin"; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<MarkupView | null>(null);
  const [scaleOpen, setScaleOpen] = useState(false);
  const [calibration, setCalibration] = useState<{ a: PointGeometry; b: PointGeometry } | null>(null);
  const [takeoffFor, setTakeoffFor] = useState<MarkupView | null>(null);
  const [saving, startTransition] = useTransition();
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);
  const pinch = useRef<{ startDist: number; startZoom: number; midX: number; midY: number; scrollLeft: number; scrollTop: number } | null>(null);

  // --- the box's width, the document, the page ---------------------------
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const measureBox = () => setBoxWidth(Math.max(0, node.clientWidth - 2));
    measureBox();
    const observer = new ResizeObserver(measureBox);
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
        setPageSize({ w: base.width, h: base.height });
        const scaleTo = (boxWidth * zoom) / base.width;
        const viewport = pdfPage.getViewport({ scale: scaleTo });
        const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PIXEL_CAP / (viewport.width * viewport.height)));
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
  }, [doc, page, boxWidth, zoom]);

  // ctrl+wheel zooms about the cursor; a plain wheel scrolls the box as usual.
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTool("select");
        setDraft(null);
        setPointsDraft(null);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- geometry ----------------------------------------------------------
  const cssW = Math.floor(boxWidth * zoom);
  const cssH = pageSize ? Math.floor((cssW * pageSize.h) / pageSize.w) : 0;
  const W = pageSize?.w ?? 1;
  const H = pageSize?.h ?? 1;
  /** Page units per CSS pixel: text and pins keep a screen size whatever the zoom. */
  const unit = cssW > 0 ? W / cssW : 1;
  const likes = useMemo(
    () => markups.map((m) => ({ id: m.id, kind: m.kind, createdAt: m.createdOn, workItemId: m.workItemId, punchDone: m.punch?.done ?? null })),
    [markups],
  );
  const numbers = useMemo(() => pinNumbers(likes), [likes]);
  const summary = useMemo(() => summariseMarkups(likes), [likes]);
  const measurements = useMemo(() => new Map(markups.map((m) => [m.id, measurementOf(m, scale)])), [markups, scale]);
  const scaleLabel = scale ? (matchingStandard(scale)?.label ?? `${scale.pointsPerUnit.toFixed(2)} pt per ${scale.unit}`) : null;

  function toFraction(e: ReactPointerEvent): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: clampFraction((e.clientX - rect.left) / rect.width), y: clampFraction((e.clientY - rect.top) / rect.height) };
  }

  function centreOf(m: MarkupView): { x: number; y: number } {
    const g = m.geometry as Record<string, number>;
    if (m.kind === "cloud") return { x: g.x + g.w / 2, y: g.y + g.h / 2 };
    if (m.kind === "arrow") return { x: (g.x1 + g.x2) / 2, y: (g.y1 + g.y2) / 2 };
    if (isMeasureKind(m.kind)) {
      const pts = pointsOf(m);
      if (pts.length === 0) return { x: 0.5, y: 0.5 };
      return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
    }
    return { x: g.x, y: g.y };
  }

  function scrollTo(m: MarkupView) {
    const box = boxRef.current;
    if (!box || cssW === 0) return;
    const c = centreOf(m);
    box.scrollTo({ left: c.x * cssW - box.clientWidth / 2, top: c.y * cssH - box.clientHeight / 2, behavior: "smooth" });
  }

  // --- pointers: pinch, pan, draw ---------------------------------------
  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    const box = boxRef.current;
    if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const rect = box.getBoundingClientRect();
      pinch.current = {
        startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        startZoom: zoom,
        midX: (a.x + b.x) / 2 - rect.left,
        midY: (a.y + b.y) / 2 - rect.top,
        scrollLeft: box.scrollLeft,
        scrollTop: box.scrollTop,
      };
      pan.current = null;
      setDraft(null);
      return;
    }
    if (!canEdit || tool === "select") {
      pan.current = { startX: e.clientX, startY: e.clientY, scrollLeft: box.scrollLeft, scrollTop: box.scrollTop, moved: false };
      return;
    }
    const f = toFraction(e);
    if (tool === "cloud" || tool === "arrow") {
      setDraft({ kind: tool, ax: f.x, ay: f.y, bx: f.x, by: f.y });
    } else if (tool === "text" || tool === "pin") {
      setPending({ kind: tool, x: f.x, y: f.y });
    } else {
      // A measurement or a calibration: every tap is a point; Finish (or Enter) closes it.
      const next = pointsDraft && pointsDraft.kind === tool ? [...pointsDraft.points, f] : [f];
      if (next.length > MEASURE_POINTS_MAX) return;
      if (tool === "calibrate" && next.length === 2) {
        setPointsDraft(null);
        setCalibration({ a: next[0], b: next[1] });
        setTool("select");
        return;
      }
      setPointsDraft({ kind: tool, points: next });
    }
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    const box = boxRef.current;
    if (!box) return;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const wanted = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.startDist) * pinch.current.startZoom));
      const s = wanted / pinch.current.startZoom;
      gestureRef.current = s;
      setGesture(s);
      box.scrollLeft = (pinch.current.scrollLeft + pinch.current.midX) * s - pinch.current.midX;
      box.scrollTop = (pinch.current.scrollTop + pinch.current.midY) * s - pinch.current.midY;
      return;
    }
    if (pan.current) {
      const dx = e.clientX - pan.current.startX;
      const dy = e.clientY - pan.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) pan.current.moved = true;
      box.scrollLeft = pan.current.scrollLeft - dx;
      box.scrollTop = pan.current.scrollTop - dy;
      return;
    }
    if (draft) {
      const f = toFraction(e);
      setDraft({ ...draft, bx: f.x, by: f.y });
    }
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.current.startZoom * gestureRef.current));
        pinch.current = null;
        gestureRef.current = 1;
        setGesture(1);
        setZoom(next);
      }
      return;
    }
    if (pan.current) {
      const moved = pan.current.moved;
      pan.current = null;
      if (!moved) {
        const id = (e.target as Element).closest("[data-markup]")?.getAttribute("data-markup") ?? null;
        setSelectedId(id);
      }
      return;
    }
    if (draft) {
      const d = draft;
      setDraft(null);
      if (d.kind === "cloud") {
        const b = normaliseBox(d.ax, d.ay, d.bx, d.by);
        if (b.w < MIN_EXTENT || b.h < MIN_EXTENT) return;
        submit({ kind: "cloud", geometry: { x: b.x, y: b.y, w: Math.min(b.w, 1 - b.x), h: Math.min(b.h, 1 - b.y) } });
      } else {
        if (Math.hypot(d.bx - d.ax, d.by - d.ay) < MIN_EXTENT) return;
        submit({ kind: "arrow", geometry: { x1: d.ax, y1: d.ay, x2: d.bx, y2: d.by } });
      }
    }
  }

  function finishPoints() {
    if (!pointsDraft || pointsDraft.kind === "calibrate") return;
    const kind = pointsDraft.kind;
    if (pointsDraft.points.length < MIN_POINTS[kind]) return;
    const points = pointsDraft.points;
    setPointsDraft(null);
    submit({ kind, geometry: { points } });
  }

  useEffect(() => {
    if (!pointsDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") finishPoints();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsDraft]);

  function submit(input: { kind: MarkupKind; geometry: Record<string, unknown>; text?: string; raise?: boolean; dueOn?: string }) {
    startTransition(async () => {
      const result = await addMarkupAction({ sheetId, projectId, color, ...input });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        input.kind === "pin" ? (result.workItemId ? "Pin placed — it is on the punch list" : "Pin placed") : `${MARKUP_KIND_LABELS[input.kind]} drawn`,
      );
      setPending(null);
      router.refresh();
    });
  }

  const cursor = !canEdit || tool === "select" ? "grab" : "crosshair";
  const selected = markups.find((m) => m.id === selectedId) ?? null;
  /**
   * The traces this walk could use, and what they come to together (X7).
   * A roof is three planes and a perimeter is one run; summing them here
   * saves a calculator, and `sumMeasurements` already refuses to add a
   * length to an area.
   */
  const forTheWalk = useMemo(
    () =>
      measuringFor
        ? markups.filter((m) => m.kind === measuringFor.kind && measurements.get(m.id))
        : [],
    [markups, measurements, measuringFor],
  );
  const forTheWalkTotal = useMemo(() => {
    if (!measuringFor || forTheWalk.length < 2) return null;
    try {
      return sumMeasurements(
        forTheWalk.map((m) => ({
          kind: measuringFor.kind,
          measurement: measurements.get(m.id) ?? null,
        })),
      ).total;
    } catch {
      /** Different units on one sheet: no total worth offering. */
      return null;
    }
  }, [forTheWalk, measurements, measuringFor]);
  const draftMeasure =
    pointsDraft && pointsDraft.kind !== "calibrate" && pointsDraft.points.length >= MIN_POINTS[pointsDraft.kind]
      ? measure(pointsDraft.kind, { points: pointsDraft.points }, scale)
      : null;
  const needsScale = (tool === "length" || tool === "area") && !scale;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-1">
            <ToolButton active={tool === "select"} onClick={() => setTool("select")} label="Move about">
              <Hand className="size-4" />
            </ToolButton>
            <ToolButton active={tool === "cloud"} onClick={() => setTool("cloud")} label="Cloud">
              <Cloud className="size-4" />
            </ToolButton>
            <ToolButton active={tool === "arrow"} onClick={() => setTool("arrow")} label="Arrow">
              <MoveUpRight className="size-4" />
            </ToolButton>
            <ToolButton active={tool === "text"} onClick={() => setTool("text")} label="Note">
              <Type className="size-4" />
            </ToolButton>
            <ToolButton active={tool === "pin"} onClick={() => setTool("pin")} label="Pin">
              <MapPin className="size-4" />
            </ToolButton>
            <span className="mx-1 h-5 w-px bg-border" />
            <ToolButton active={tool === "length"} onClick={() => setTool("length")} label="Length">
              <Ruler className="size-4" />
            </ToolButton>
            <ToolButton active={tool === "area"} onClick={() => setTool("area")} label="Area">
              <Square className="size-4" />
            </ToolButton>
            <ToolButton active={tool === "count"} onClick={() => setTool("count")} label="Count">
              <Hash className="size-4" />
            </ToolButton>
            <Button type="button" variant={scale ? "outline" : "secondary"} size="sm" className="h-8 px-2" onClick={() => setScaleOpen(true)} title="The sheet's scale">
              <ArrowRightToLine className="size-4" />
              <span className="ml-1">{scaleLabel ?? "Set the scale"}</span>
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            {MARKUP_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={MARKUP_COLOR_LABELS[c]}
                aria-pressed={color === c}
                className={`size-6 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                style={{ backgroundColor: MARKUP_COLOR_HEX[c] }}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Drag to move about; pinch or ctrl+wheel to zoom.{scaleLabel ? ` Scale ${scaleLabel}.` : ""}
          </p>
        )}
        <div className="flex items-center gap-1">
          <span className="mr-1 text-xs text-muted-foreground">
            {status === "failed" ? "This page could not be drawn; download the file instead." : `Page ${page} · ${zoom.toFixed(zoom >= 3 ? 0 : 1)}×`}
          </span>
          <Button variant="outline" size="icon" className="size-7" disabled={zoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5))}>
            <Minus className="size-3.5" />
            <span className="sr-only">Zoom out</span>
          </Button>
          <Button variant="outline" size="icon" className="size-7" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))}>
            <Plus className="size-3.5" />
            <span className="sr-only">Zoom in</span>
          </Button>
          <Button variant="outline" size="icon" className="size-7" disabled={zoom === 1} onClick={() => setZoom(1)}>
            <Maximize className="size-3.5" />
            <span className="sr-only">Fit the width</span>
          </Button>
        </div>
      </div>
      {canEdit && tool !== "select" && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {tool === "cloud"
              ? "Drag a box around what changed."
              : tool === "arrow"
                ? "Drag from where the arrow starts to what it points at."
                : tool === "text"
                  ? "Tap where the note goes."
                  : tool === "pin"
                    ? "Tap where the problem is; the pin goes on the punch list."
                    : tool === "calibrate"
                      ? "Tap the two ends of a dimension the drawing states."
                      : needsScale
                        ? "Set the sheet's scale first; a count needs none."
                        : tool === "length"
                          ? "Tap along the wall, corner by corner, then Finish."
                          : tool === "area"
                            ? "Tap around the room, corner by corner, then Finish."
                            : "Tap each one to count it, then Finish."}{" "}
            Esc goes back to moving about.
          </span>
          {pointsDraft && pointsDraft.kind !== "calibrate" && (
            <span className="flex items-center gap-1">
              <span className="font-medium text-foreground">
                {pointsDraft.points.length} {pointsDraft.points.length === 1 ? "point" : "points"}
                {draftMeasure ? ` · ${formatMeasure(draftMeasure)}` : ""}
              </span>
              <Button type="button" size="sm" className="h-7" onClick={finishPoints} disabled={saving || pointsDraft.points.length < MIN_POINTS[pointsDraft.kind]}>
                <Check className="mr-1 size-3.5" /> Finish
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setPointsDraft(null)}>
                <X className="mr-1 size-3.5" /> Start over
              </Button>
            </span>
          )}
        </div>
      )}

      <div ref={boxRef} className="relative max-h-[75vh] w-full min-w-0 overflow-auto rounded-md border bg-secondary/30" style={{ touchAction: "none" }}>
        {status !== "ready" && status !== "failed" && (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        <div
          className={status === "ready" ? "relative" : "hidden"}
          style={{ width: cssW, height: cssH, transform: gesture !== 1 ? `scale(${gesture})` : undefined, transformOrigin: "0 0" }}
        >
          <canvas ref={canvasRef} aria-label={label} className="block" />
          {pageSize && (
            <svg
              ref={svgRef}
              className="absolute inset-0"
              width={cssW}
              height={cssH}
              viewBox={`0 0 ${W} ${H}`}
              style={{ cursor }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              role="img"
              aria-label={`Markups on ${label}`}
            >
              {markups.map((m) => (
                <Shape key={m.id} markup={m} W={W} H={H} unit={unit} number={numbers.get(m.id)} selected={m.id === selectedId} measurement={measurements.get(m.id) ?? null} />
              ))}
              {draft && <DraftShape draft={draft} color={color} W={W} H={H} unit={unit} />}
              {pointsDraft && <PointsDraftShape draft={pointsDraft} color={color} W={W} H={H} unit={unit} measurement={draftMeasure} />}
            </svg>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Markups</h3>
          <span className="text-xs text-muted-foreground">{markupSentence(summary)}</span>
        </div>
        {measuringFor && (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-[3px] border border-primary/30 bg-primary/5 px-3 py-2">
            <p className="text-xs">
              <span className="font-medium">{measuringFor.name}</span>
              <span className="text-muted-foreground">
                {" "}
                — draw {measuringFor.kind === "count" ? "a count" : measuringFor.kind === "area" ? "an area" : "a length"} and use it
                {forTheWalk.length > 0
                  ? `, or use what is already drawn`
                  : scale
                    ? ""
                    : ". Set the scale first"}
                .
              </span>
            </p>
            {forTheWalk.length > 1 && forTheWalkTotal !== null && (
              <Button
                type="button"
                size="sm"
                className="h-7"
                disabled={measuringFor.busy}
                onClick={() =>
                  measuringFor.onUse(
                    toThousandths(forTheWalkTotal.quantity),
                    null,
                    `${forTheWalk.length} traces on ${label}`,
                  )
                }
              >
                Use the total of {forTheWalk.length} · {formatMeasure(forTheWalkTotal)}
              </Button>
            )}
          </div>
        )}
        {markups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {canEdit
              ? "Pick a tool above and draw on the sheet. A pin puts what needs doing on the job's punch list; a length, an area or a count is a quantity for the estimate."
              : "Nothing drawn on this issue."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {markups.map((m) => (
              <MarkupRowView
                key={m.id}
                markup={m}
                number={numbers.get(m.id)}
                measurement={measurements.get(m.id) ?? null}
                selected={m.id === selectedId}
                canEdit={canEdit}
                busy={saving}
                projectId={projectId}
                sheetId={sheetId}
                hasEstimates={estimates.length > 0}
                onSelect={() => {
                  setSelectedId(m.id);
                  scrollTo(m);
                }}
                onEdit={() => setEditing(m)}
                onTakeoff={() => setTakeoffFor(m)}
                measuringFor={
                  measuringFor && m.kind === measuringFor.kind ? measuringFor : null
                }
              />
            ))}
          </ul>
        )}
        {selected && <p className="mt-1 text-xs text-muted-foreground">Selected: {describe(selected, numbers.get(selected.id), measurements.get(selected.id) ?? null)}. Esc clears.</p>}
      </div>

      <PointDialog
        pending={pending}
        color={color}
        busy={saving}
        onClose={() => setPending(null)}
        onSave={(text, raise, dueOn) => pending && submit({ kind: pending.kind, geometry: { x: pending.x, y: pending.y }, text, raise, dueOn })}
      />
      <EditDialog markup={editing} projectId={projectId} sheetId={sheetId} onClose={() => setEditing(null)} />
      <ScaleDialog
        open={scaleOpen}
        scale={scale}
        scaleLabel={scaleLabel}
        pageSize={pageSize}
        projectId={projectId}
        sheetId={sheetId}
        onClose={() => setScaleOpen(false)}
        onCalibrate={() => {
          setScaleOpen(false);
          setPointsDraft(null);
          setTool("calibrate");
        }}
      />
      <KnownLengthDialog
        calibration={calibration}
        pageSize={pageSize}
        projectId={projectId}
        sheetId={sheetId}
        onClose={() => setCalibration(null)}
      />
      <TakeoffDialog
        markup={takeoffFor}
        markups={markups}
        measurements={measurements}
        scale={scale}
        estimates={estimates}
        codes={codes}
        projectId={projectId}
        sheetId={sheetId}
        onClose={() => setTakeoffFor(null)}
      />
    </div>
  );
}

function describe(m: MarkupView, number: number | undefined, measurement: Measurement | null): string {
  if (m.kind === "pin") return `pin ${number ?? ""} · ${m.text}`;
  if (m.kind === "text") return `note · ${m.text}`;
  if (isMeasureKind(m.kind)) return `${MARKUP_KIND_LABELS[m.kind].toLowerCase()}${measurement ? ` · ${formatMeasure(measurement)}` : ""}${m.text ? ` · ${m.text}` : ""}`;
  return `${MARKUP_KIND_LABELS[m.kind].toLowerCase()} in ${MARKUP_COLOR_LABELS[m.color].toLowerCase()}`;
}

function ToolButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: ReactNode }) {
  return (
    <Button type="button" variant={active ? "default" : "outline"} size="sm" className="h-8 px-2" onClick={onClick} aria-pressed={active} title={label}>
      {children}
      <span className="ml-1 hidden sm:inline">{label}</span>
    </Button>
  );
}

/** A label on the sheet with a white halo, in screen-sized type whatever the zoom. */
function Halo({ x, y, unit, hex, children, anchor = "middle" }: { x: number; y: number; unit: number; hex: string; children: ReactNode; anchor?: "middle" | "start" }) {
  return (
    <text x={x} y={y} fontSize={12 * unit} fontFamily="system-ui, sans-serif" fontWeight={700} fill={hex} stroke="white" strokeWidth={3.5 * unit} paintOrder="stroke" textAnchor={anchor} dominantBaseline="central">
      {children}
    </text>
  );
}

/** A markup in the page's units. Strokes keep two screen pixels at any zoom. */
function Shape({
  markup: m,
  W,
  H,
  unit,
  number,
  selected,
  measurement,
}: {
  markup: MarkupView;
  W: number;
  H: number;
  unit: number;
  number?: number;
  selected: boolean;
  measurement: Measurement | null;
}) {
  const hex = MARKUP_COLOR_HEX[m.color];
  const g = m.geometry as Record<string, number>;
  const stroke = selected ? 3.5 : 2;
  if (m.kind === "cloud") {
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }}>
        <path d={cloudPath(g.x * W, g.y * H, g.w * W, g.h * H, 14 * unit)} fill="none" stroke={hex} strokeWidth={stroke} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <rect x={g.x * W} y={g.y * H} width={g.w * W} height={g.h * H} fill="transparent" />
      </g>
    );
  }
  if (m.kind === "arrow") {
    const [hx1, hy1, hx2, hy2] = arrowHead(g.x1 * W, g.y1 * H, g.x2 * W, g.y2 * H, 12 * unit);
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }}>
        <line x1={g.x1 * W} y1={g.y1 * H} x2={g.x2 * W} y2={g.y2 * H} stroke={hex} strokeWidth={stroke} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
        <polygon points={`${g.x2 * W},${g.y2 * H} ${hx1},${hy1} ${hx2},${hy2}`} fill={hex} />
        <line x1={g.x1 * W} y1={g.y1 * H} x2={g.x2 * W} y2={g.y2 * H} stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" />
      </g>
    );
  }
  if (m.kind === "text") {
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }}>
        <text
          x={g.x * W}
          y={g.y * H}
          fontSize={13 * unit}
          fontFamily="system-ui, sans-serif"
          fontWeight={600}
          fill={hex}
          stroke="white"
          strokeWidth={3.5 * unit}
          paintOrder="stroke"
          style={{ textDecoration: selected ? "underline" : undefined }}
        >
          {m.text}
        </text>
      </g>
    );
  }
  if (m.kind === "pin") {
    const done = m.punch?.done ?? false;
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }} opacity={done ? 0.55 : 1}>
        <circle cx={g.x * W} cy={g.y * H} r={11 * unit} fill={hex} stroke="white" strokeWidth={selected ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
        <text x={g.x * W} y={g.y * H} fontSize={11 * unit} fontFamily="system-ui, sans-serif" fontWeight={700} fill="white" textAnchor="middle" dominantBaseline="central">
          {done ? "✓" : (number ?? "")}
        </text>
      </g>
    );
  }
  const pts = pointsOf(m);
  if (pts.length === 0) return null;
  const label = measurement ? formatMeasure(measurement) : "needs the scale";
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  if (m.kind === "length") {
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * W} ${p.y * H}`).join(" ");
    const mid = pts[Math.floor((pts.length - 1) / 2)];
    const nxt = pts[Math.min(pts.length - 1, Math.floor((pts.length - 1) / 2) + 1)];
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }}>
        <path d={d} fill="none" stroke={hex} strokeWidth={stroke} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke="transparent" strokeWidth={12} vectorEffect="non-scaling-stroke" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x * W} cy={p.y * H} r={3 * unit} fill={hex} />
        ))}
        <Halo x={((mid.x + nxt.x) / 2) * W} y={((mid.y + nxt.y) / 2) * H - 9 * unit} unit={unit} hex={hex}>
          {label}
        </Halo>
      </g>
    );
  }
  if (m.kind === "area") {
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * W} ${p.y * H}`).join(" ") + " Z";
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }}>
        <path d={d} fill={hex} fillOpacity={selected ? 0.25 : 0.15} stroke={hex} strokeWidth={stroke} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x * W} cy={p.y * H} r={3 * unit} fill={hex} />
        ))}
        <Halo x={cx * W} y={cy * H} unit={unit} hex={hex}>
          {label}
        </Halo>
      </g>
    );
  }
  return (
    <g data-markup={m.id} style={{ cursor: "pointer" }}>
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x * W} cy={p.y * H} r={7 * unit} fill={hex} fillOpacity={0.25} stroke={hex} strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
          <circle cx={p.x * W} cy={p.y * H} r={1.5 * unit} fill={hex} />
        </g>
      ))}
      <Halo x={pts[0].x * W + 10 * unit} y={pts[0].y * H - 10 * unit} unit={unit} hex={hex} anchor="start">
        {label}
        {m.text ? ` ${m.text}` : ""}
      </Halo>
    </g>
  );
}

function DraftShape({ draft, color, W, H, unit }: { draft: Draft; color: MarkupColor; W: number; H: number; unit: number }) {
  const hex = MARKUP_COLOR_HEX[color];
  if (draft.kind === "cloud") {
    const b = normaliseBox(draft.ax, draft.ay, draft.bx, draft.by);
    return (
      <path
        d={cloudPath(b.x * W, b.y * H, Math.max(b.w, 0.001) * W, Math.max(b.h, 0.001) * H, 14 * unit)}
        fill="none"
        stroke={hex}
        strokeWidth={2}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    );
  }
  const [hx1, hy1, hx2, hy2] = arrowHead(draft.ax * W, draft.ay * H, draft.bx * W, draft.by * H, 12 * unit);
  return (
    <g pointerEvents="none">
      <line x1={draft.ax * W} y1={draft.ay * H} x2={draft.bx * W} y2={draft.by * H} stroke={hex} strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      <polygon points={`${draft.bx * W},${draft.by * H} ${hx1},${hy1} ${hx2},${hy2}`} fill={hex} opacity={0.7} />
    </g>
  );
}

/** The points tapped so far, the line or the ring between them, the quantity so far. */
function PointsDraftShape({ draft, color, W, H, unit, measurement }: { draft: PointsDraft; color: MarkupColor; W: number; H: number; unit: number; measurement: Measurement | null }) {
  const hex = draft.kind === "calibrate" ? "#111827" : MARKUP_COLOR_HEX[color];
  const pts = draft.points;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * W} ${p.y * H}`).join(" ") + (draft.kind === "area" && pts.length >= 3 ? " Z" : "");
  return (
    <g pointerEvents="none">
      {pts.length >= 2 && draft.kind !== "count" && (
        <path d={d} fill={draft.kind === "area" ? hex : "none"} fillOpacity={0.1} stroke={hex} strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      )}
      {pts.map((p, i) => (
        <circle key={i} cx={p.x * W} cy={p.y * H} r={(draft.kind === "count" ? 7 : 4) * unit} fill={hex} fillOpacity={draft.kind === "count" ? 0.35 : 1} stroke={hex} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ))}
      {measurement && pts.length > 0 && (
        <Halo x={pts[pts.length - 1].x * W + 10 * unit} y={pts[pts.length - 1].y * H - 10 * unit} unit={unit} hex={hex} anchor="start">
          {formatMeasure(measurement)}
        </Halo>
      )}
    </g>
  );
}

function MarkupRowView({
  markup: m,
  number,
  measurement,
  selected,
  canEdit,
  busy,
  projectId,
  sheetId,
  hasEstimates,
  onSelect,
  onEdit,
  onTakeoff,
  measuringFor,
}: {
  markup: MarkupView;
  number?: number;
  measurement: Measurement | null;
  selected: boolean;
  canEdit: boolean;
  busy: boolean;
  projectId: string;
  sheetId: string;
  hasEstimates: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onTakeoff: () => void;
  /** Non-null only when a walk is waiting for exactly this kind of number. */
  measuringFor: MeasuringFor | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const hex = MARKUP_COLOR_HEX[m.color];
  const measuring = isMeasureKind(m.kind);
  const drifted =
    measuring && m.takeoff && m.pushedQuantityThousandths !== null && measurement !== null && Math.abs(toThousandths(measurement.quantity) - m.pushedQuantityThousandths) > Math.max(5, m.pushedQuantityThousandths * 0.005);

  function toggleDone(done: boolean) {
    const itemId = m.workItemId;
    if (!itemId) return;
    startTransition(async () => {
      const result = await setPunchDoneAction({ projectId, itemId, done });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(done ? "Punch item done" : "Punch item reopened");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteMarkupAction({ id: m.id, sheetId, projectId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(m.kind === "pin" && m.punch ? "Pin rubbed out — its punch item stays on the list" : "Rubbed out");
      router.refresh();
    });
  }

  function unpush() {
    startTransition(async () => {
      const result = await unpushTakeoffAction({ id: m.id, sheetId, projectId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("The line keeps its quantity; this measurement no longer stands behind it");
      router.refresh();
    });
  }

  return (
    <li className={`flex flex-wrap items-center gap-2 px-3 py-2 ${selected ? "bg-secondary/60" : ""}`}>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: hex }}>
          {m.kind === "pin" ? (number ?? "") : m.kind === "cloud" ? "◌" : m.kind === "arrow" ? "→" : m.kind === "text" ? "A" : m.kind === "length" ? "L" : m.kind === "area" ? "▱" : "#"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            {measuring ? (
              <>
                <span className="font-medium tabular-nums">{measurement ? formatMeasure(measurement) : "needs the scale"}</span>
                {m.text ? ` · ${m.text}` : ""}
              </>
            ) : (
              m.text || MARKUP_KIND_LABELS[m.kind]
            )}
          </span>
          <span className="block text-xs text-muted-foreground">
            {MARKUP_KIND_LABELS[m.kind]}
            {measuring ? ` · ${pointsOf(m).length} ${pointsOf(m).length === 1 ? "point" : "points"}` : ""}
            {m.createdBy ? ` · ${m.createdBy}` : ""} · {m.createdOn}
          </span>
        </span>
      </button>
      {m.kind === "pin" &&
        (m.punch ? (
          <span className="flex items-center gap-2">
            <StatusBadge tone={m.punch.done ? "good" : m.punch.dueOn ? "pending" : "info"}>
              {m.punch.done ? "Done" : m.punch.dueOn ? `Due ${m.punch.dueOn}` : "On the punch list"}
            </StatusBadge>
            {canEdit && (
              <Checkbox checked={m.punch.done} disabled={pending || busy} onCheckedChange={(v) => toggleDone(v === true)} aria-label={`Punch item ${number ?? ""} done`} />
            )}
          </span>
        ) : (
          <StatusBadge tone="quiet">{m.workItemId ? "Punch item gone" : "Marker only"}</StatusBadge>
        ))}
      {measuring &&
        (m.takeoff ? (
          <span className="flex items-center gap-1">
            <StatusBadge tone={drifted ? "pending" : "good"}>
              {`→ ${m.takeoff.estimateNumber} · ${m.takeoff.lineDescription} · ${thousandthsToQuantityString(m.takeoff.lineQuantityThousandths)} ${m.takeoff.lineUnit}`}
              {drifted ? " · measured since" : ""}
            </StatusBadge>
            {canEdit && (
              <Button type="button" variant="ghost" size="icon" className="size-7" onClick={unpush} disabled={pending || busy} title="No longer stands behind the line">
                <X className="size-3.5" />
                <span className="sr-only">Unpush</span>
              </Button>
            )}
          </span>
        ) : m.pushedQuantityThousandths !== null ? (
          <StatusBadge tone="quiet">Line gone</StatusBadge>
        ) : null)}
      {measuringFor && measurement && (
        <Button
          type="button"
          size="sm"
          className="h-7"
          disabled={pending || busy || measuringFor.busy}
          onClick={() =>
            measuringFor.onUse(
              toThousandths(measurement.quantity),
              m.id,
              `${m.kind} on this sheet`,
            )
          }
          title={`Use ${formatMeasure(measurement)} as ${measuringFor.name}`}
        >
          Use this
        </Button>
      )}
      {canEdit && (
        <span className="flex items-center gap-1">
          {measuring && (
            <Button type="button" variant="outline" size="sm" className="h-7" onClick={onTakeoff} disabled={pending || busy || !measurement || !hasEstimates} title={!hasEstimates ? "Start an estimate first" : !measurement ? "Set the scale first" : "Onto an estimate line"}>
              <ArrowRightToLine className="mr-1 size-3.5" /> Takeoff
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onEdit} disabled={pending || busy}>
            <Pencil className="size-3.5" />
            <span className="sr-only">Edit</span>
          </Button>
          {armed ? (
            <Button type="button" variant="destructive" size="sm" className="h-7" onClick={remove} disabled={pending || busy}>
              <Check className="mr-1 size-3.5" /> Rub out
            </Button>
          ) : (
            <Button type="button" variant="ghost" size="icon" className="size-7 text-destructive" onClick={() => setArmed(true)} disabled={pending || busy}>
              <Trash2 className="size-3.5" />
              <span className="sr-only">Rub out</span>
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

/** The words for a note or a pin, asked for where it was tapped. */
function PointDialog({
  pending,
  color,
  busy,
  onClose,
  onSave,
}: {
  pending: { kind: "text" | "pin"; x: number; y: number } | null;
  color: MarkupColor;
  busy: boolean;
  onClose: () => void;
  onSave: (text: string, raise: boolean, dueOn: string) => void;
}) {
  const [text, setText] = useState("");
  const [raise, setRaise] = useState(true);
  const [dueOn, setDueOn] = useState("");
  const kind = pending?.kind ?? "text";

  function reset() {
    setText("");
    setRaise(true);
    setDueOn("");
  }

  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          reset();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === "pin" ? "A pin" : "A note"}</DialogTitle>
          <DialogDescription>
            {kind === "pin"
              ? "What needs doing here. It goes on the job's punch list as a work item, where it can be assigned, dated and chased."
              : `A note on the sheet, in ${MARKUP_COLOR_LABELS[color].toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mk-text">{kind === "pin" ? "What needs doing" : "Note"}</Label>
            <Textarea
              id="mk-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              maxLength={2000}
              autoFocus
              placeholder={kind === "pin" ? "Touch up the paint by the window" : "Verify in field"}
            />
          </div>
          {kind === "pin" && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={raise} onCheckedChange={(v) => setRaise(v === true)} /> Put it on the punch list
              </label>
              {raise && (
                <div className="space-y-1.5">
                  <Label htmlFor="mk-due">Due</Label>
                  <Input id="mk-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="w-44" />
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onSave(text.trim(), raise, dueOn);
              reset();
            }}
            disabled={busy || text.trim() === ""}
          >
            {busy ? "Saving…" : kind === "pin" ? "Place the pin" : "Add the note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A markup's words and colour, after the fact. The pin's punch item keeps its own words in Work. */
function EditDialog({ markup, projectId, sheetId, onClose }: { markup: MarkupView | null; projectId: string; sheetId: string; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [color, setColor] = useState<MarkupColor>("red");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (markup && loadedFor !== markup.id) {
    setLoadedFor(markup.id);
    setText(markup.text);
    setColor(markup.color);
  }
  const needsWords = markup?.kind === "text" || markup?.kind === "pin";

  function save() {
    if (!markup) return;
    startTransition(async () => {
      const result = await updateMarkupAction({ id: markup.id, sheetId, projectId, version: markup.version, text: text.trim(), color });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Markup saved");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={markup !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setLoadedFor(null);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{markup ? MARKUP_KIND_LABELS[markup.kind] : ""}</DialogTitle>
          {markup?.kind === "pin" && markup.workItemId && (
            <DialogDescription>The pin&apos;s own words. Its punch item is edited on the job&apos;s punch list or in Work.</DialogDescription>
          )}
          {markup && isMeasureKind(markup.kind) && <DialogDescription>A name for the measurement — the room, the wall — and its colour. The points stay where they are.</DialogDescription>}
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="mk-edit-text">{needsWords ? "Words" : "Words (optional)"}</Label>
            <Textarea id="mk-edit-text" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={2000} />
          </div>
          <div className="space-y-1.5">
            <Label>Colour</Label>
            <div className="flex items-center gap-1.5">
              {MARKUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={MARKUP_COLOR_LABELS[c]}
                  aria-pressed={color === c}
                  className={`size-6 rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: MARKUP_COLOR_HEX[c] }}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending || (needsWords && text.trim() === "")}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The sheet's scale: from a dimension the drawing states, or from the title block. */
function ScaleDialog({
  open,
  scale,
  scaleLabel,
  pageSize,
  projectId,
  sheetId,
  onClose,
  onCalibrate,
}: {
  open: boolean;
  scale: SheetScale | null;
  scaleLabel: string | null;
  pageSize: { w: number; h: number } | null;
  projectId: string;
  sheetId: string;
  onClose: () => void;
  onCalibrate: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [key, setKey] = useState<string>(NONE);

  function saveStandard() {
    if (!pageSize || key === NONE) return;
    startTransition(async () => {
      const result = await setSheetScaleAction({ sheetId, projectId, pageWidthPt: pageSize.w, pageHeightPt: pageSize.h, scale: { by: "standard", key } });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Scale set — every length and area on the sheet reads through it");
      onClose();
      router.refresh();
    });
  }

  function clear() {
    startTransition(async () => {
      const result = await clearSheetScaleAction({ sheetId, projectId });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Scale cleared");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>The sheet&apos;s scale</DialogTitle>
          <DialogDescription>
            {scaleLabel ? `Set to ${scaleLabel}. ` : "Not set. "}
            Every length and area on this sheet reads through it; a count needs none.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">From a dimension the drawing states</p>
            <p className="text-xs text-muted-foreground">The honest way, right on a half-size plot too: tap the two ends of a dimension, then type what it says.</p>
            <Button type="button" variant="outline" size="sm" onClick={onCalibrate} disabled={pending || !pageSize}>
              <Ruler className="mr-1.5 size-4" /> Tap a known dimension
            </Button>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">From the title block</p>
            <p className="text-xs text-muted-foreground">Only right when the PDF is the sheet&apos;s own size — a 24×36 set printed at 24×36.</p>
            <div className="flex items-center gap-2">
              <Select value={key} onValueChange={setKey}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Pick a scale" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Pick a scale</SelectItem>
                  {STANDARD_SCALES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" onClick={saveStandard} disabled={pending || key === NONE || !pageSize}>
                {pending ? "Saving…" : "Use it"}
              </Button>
            </div>
          </div>
          {pageSize && (
            <p className="text-xs text-muted-foreground">
              This page is {(pageSize.w / 72).toFixed(1)} × {(pageSize.h / 72).toFixed(1)} inches.
            </p>
          )}
        </div>
        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          {scale ? (
            <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={clear} disabled={pending}>
              Clear the scale
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** After the two taps: what the drawing says the dimension is. */
function KnownLengthDialog({
  calibration,
  pageSize,
  projectId,
  sheetId,
  onClose,
}: {
  calibration: { a: PointGeometry; b: PointGeometry } | null;
  pageSize: { w: number; h: number } | null;
  projectId: string;
  sheetId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [length, setLength] = useState("");
  const [unit, setUnit] = useState<ScaleUnit>("ft");
  const value = Number.parseFloat(length);

  function save() {
    if (!calibration || !pageSize || !(value > 0)) return;
    startTransition(async () => {
      const result = await setSheetScaleAction({
        sheetId,
        projectId,
        pageWidthPt: pageSize.w,
        pageHeightPt: pageSize.h,
        scale: { by: "known", a: calibration.a, b: calibration.b, length: value, unit },
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Scale set — every length and area on the sheet reads through it");
      setLength("");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={calibration !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>The dimension you tapped</DialogTitle>
          <DialogDescription>What the drawing says it is, end to end.</DialogDescription>
        </DialogHeader>
        <div className="flex items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="cal-length">Length</Label>
            <Input id="cal-length" value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" placeholder="24.5" className="w-32" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-unit">Unit</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as ScaleUnit)}>
              <SelectTrigger className="w-28" id="cal-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCALE_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u === "ft" ? "feet" : "metres"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Feet as a decimal: 24&apos;-6&quot; is 24.5.</p>
        <DialogFooter>
          <Button onClick={save} disabled={pending || !(value > 0)}>
            {pending ? "Saving…" : "Set the scale"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A measurement, or several of one kind, onto an estimate line. */
function TakeoffDialog({
  markup,
  markups,
  measurements,
  scale,
  estimates,
  codes,
  projectId,
  sheetId,
  onClose,
}: {
  markup: MarkupView | null;
  markups: MarkupView[];
  measurements: Map<string, Measurement | null>;
  scale: SheetScale | null;
  estimates: EstimateOption[];
  codes: Array<{ id: string; label: string }>;
  projectId: string;
  sheetId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [estimateId, setEstimateId] = useState<string>(estimates[0]?.id ?? NONE);
  const [lineId, setLineId] = useState<string>(NEW_LINE);
  const [description, setDescription] = useState("");
  const [costCodeId, setCostCodeId] = useState<string>(NONE);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (markup && loadedFor !== markup.id) {
    setLoadedFor(markup.id);
    setIncluded(new Set([markup.id]));
    setDescription(markup.text || MARKUP_KIND_LABELS[markup.kind]);
    setEstimateId(markup.takeoff?.estimateId ?? estimates[0]?.id ?? NONE);
    setLineId(markup.takeoff ? findLineId(estimates, markup.takeoff.estimateId, markup.takeoff.lineDescription) : NEW_LINE);
  }
  const kind = markup && isMeasureKind(markup.kind) ? markup.kind : null;
  const siblings = kind ? markups.filter((m) => m.kind === kind && measurements.get(m.id)) : [];
  const chosen = siblings.filter((m) => included.has(m.id));
  const total = chosen.reduce((s, m) => s + (measurements.get(m.id)?.quantity ?? 0), 0);
  const unitWord = chosen[0] ? (measurements.get(chosen[0].id)?.unit ?? "") : "";
  const estimate = estimates.find((e) => e.id === estimateId) ?? null;
  const lineUnit = kind ? takeoffUnitFor(kind, scale?.unit ?? "") : "";

  function push() {
    if (!markup || !kind || !estimate || chosen.length === 0) return;
    startTransition(async () => {
      const result = await pushTakeoffAction({
        sheetId,
        projectId,
        estimateId: estimate.id,
        markupIds: chosen.map((m) => m.id),
        lineId: lineId === NEW_LINE ? "" : lineId,
        newLine: lineId === NEW_LINE ? { description: description.trim(), costCodeId: costCodeId === NONE ? "" : costCodeId, unit: lineUnit } : null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${thousandthsToQuantityString(result.quantityThousandths)} ${result.unit} onto ${estimate.number}`);
      setLoadedFor(null);
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={markup !== null}
      onOpenChange={(next) => {
        if (!next) {
          onClose();
          setLoadedFor(null);
        }
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Takeoff</DialogTitle>
          <DialogDescription>
            {kind === "count" ? "A count" : kind === "length" ? "A length" : "An area"}{" "}
            onto an estimate line. The line&apos;s quantity becomes the total; its unit price does the rest.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {siblings.length > 1 && (
            <div className="space-y-1.5">
              <Label>Measurements to add up</Label>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {siblings.map((m) => (
                  <li key={m.id}>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={included.has(m.id)}
                        onCheckedChange={(v) => {
                          const next = new Set(included);
                          if (v === true) next.add(m.id);
                          else next.delete(m.id);
                          setIncluded(next);
                        }}
                      />
                      <span className="tabular-nums">{formatMeasure(measurements.get(m.id)!)}</span>
                      <span className="text-muted-foreground">{m.text || MARKUP_KIND_LABELS[m.kind]}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm">
            <span className="font-medium tabular-nums">{formatMeasure({ quantity: total, unit: unitWord })}</span>
            <span className="text-muted-foreground"> goes on the line as </span>
            <span className="font-medium tabular-nums">
              {thousandthsToQuantityString(toThousandths(total))} {lineUnit}
            </span>
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="to-estimate">Estimate</Label>
            <Select
              value={estimateId}
              onValueChange={(v) => {
                setEstimateId(v);
                setLineId(NEW_LINE);
              }}
            >
              <SelectTrigger className="w-full" id="to-estimate">
                <SelectValue placeholder="Pick an estimate" />
              </SelectTrigger>
              <SelectContent>
                {estimates.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.number}
                    {e.title ? ` · ${e.title}` : ""} · {e.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to-line">Line</Label>
            <Select value={lineId} onValueChange={setLineId}>
              <SelectTrigger className="w-full" id="to-line">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_LINE}>A new line</SelectItem>
                {(estimate?.lines ?? []).map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.description} · {thousandthsToQuantityString(l.quantityThousandths)} {l.unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {lineId === NEW_LINE && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="to-description">The new line</Label>
                <Input id="to-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Flooring, kitchen" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to-code">Cost code</Label>
                <Select value={costCodeId} onValueChange={setCostCodeId}>
                  <SelectTrigger className="w-full" id="to-code">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No code</SelectItem>
                    {codes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={push} disabled={pending || !estimate || chosen.length === 0 || (lineId === NEW_LINE && description.trim() === "")}>
            {pending ? "Pushing…" : lineId === NEW_LINE ? "Add the line" : "Set the quantity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function findLineId(estimates: EstimateOption[], estimateId: string, description: string): string {
  const line = estimates.find((e) => e.id === estimateId)?.lines.find((l) => l.description === description);
  return line?.id ?? NEW_LINE;
}
