"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRightToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Scissors,
  Expand,
  Hand,
  Hash,
  Loader2,
  MapPin,
  Maximize,
  Minus,
  MoveUpRight,
  PanelRight,
  Pencil,
  Plus,
  Ruler,
  Shrink,
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
import { formatMoney } from "@/lib/money";
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
import { priceHint } from "../price-memory";
import { MIN_EXTENT, MIN_POINTS, arrowHead, clampFraction, cloudPath, markupSentence, normaliseBox, pinNumbers, summariseMarkups, type PointGeometry } from "../markups-math";
import {
  STANDARD_SCALES,
  driftedSince,
  estimateFedBy,
  formatMeasure,
  matchingStandard,
  measure,
  parseFigures,
  sumMeasurements,
  takeoffUnitFor,
  toThousandths,
  unitAccepts,
  yieldsOf,
  type Measurement,
  type SheetScale,
  type SheetShare,
  type TraceFigures,
  type Yield,
} from "../takeoff-math";
import {
  FIGURE_FAMILY,
  MARKUP_COLORS,
  MARKUP_COLOR_HEX,
  MARKUP_COLOR_LABELS,
  MARKUP_KIND_LABELS,
  MEASURE_POINTS_MAX,
  SCALE_UNITS,
  TRACE_FIGURE_LABELS,
  isMeasureKind,
  type FigureFamily,
  type MarkupColor,
  type MarkupKind,
  type MeasureKind,
  type ScaleUnit,
  type TraceFigure,
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
  /** Every estimate line this trace stands behind, by which of its figures, as the estimate has them now (ADR 0074, 0110). */
  takeoffs: TakeoffLinkView[];
  /** What was typed onto the trace besides its points (ADR 0110), read tolerantly. */
  figures: TraceFigures;
}

/** One line a trace stands behind, by one of its figures. */
export interface TakeoffLinkView {
  lineId: string;
  figure: TraceFigure;
  /** What this figure of this trace came to when it was pushed, in thousandths of the line's unit. */
  shareThousandths: number;
  estimateId: string;
  estimateNumber: string;
  estimateStatus: string;
  lineDescription: string;
  lineUnit: string;
  lineQuantityThousandths: number;
}

export interface EstimateOption {
  id: string;
  number: string;
  title: string;
  status: string;
  lines: Array<{
    id: string;
    description: string;
    unit: string;
    quantityThousandths: number;
    /** What already stands behind the line, sheet by sheet (ADR 0109) — so a push from here can keep the other sheets' traces. */
    behind?: SheetShare[];
  }>;
}

/**
 * AN ESTIMATE LINE IS MEASURING (ADR 0109): which of this sheet's traces of
 * its kind stand behind it, and a way to tick one. The dialog around the
 * viewer keeps the set across sheets and adds it up; the viewer only shows
 * the ticks and hands over each trace's quantity as it is ticked or drawn.
 */
export interface MeasuringLine {
  /** What kind of figure the line wants: a length, an area, a count or a volume — a trace offers every figure it yields of that family (ADR 0110). */
  family: FigureFamily;
  description: string;
  /** `${markupId}:${figure}` for every figure ticked, across sheets. */
  selected: ReadonlySet<string>;
  onToggle: (markupId: string, figure: TraceFigure, on: boolean, quantityThousandths: number) => void;
  busy: boolean;
}

/** The words for a family of figure: "an area", "a volume". */
function familyWords(family: FigureFamily): string {
  return family === "count" ? "a count" : family === "area" ? "an area" : family === "volume" ? "a volume (an area with a depth typed on it)" : "a length";
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

type Tool = "select" | MarkupKind | "calibrate" | "deduct";

interface Draft {
  kind: "cloud" | "arrow";
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

interface PointsDraft {
  kind: MeasureKind | "calibrate" | "deduct";
  points: PointGeometry[];
}

/** The fewest points a draft needs: the measuring kinds' own, two for a calibration, three for an opening. */
const MIN_FOR: Record<PointsDraft["kind"], number> = { ...MIN_POINTS, calibrate: 2, deduct: 3 };

function pointsOf(m: MarkupView): PointGeometry[] {
  const list = (m.geometry as { points?: unknown }).points;
  return Array.isArray(list) ? (list as PointGeometry[]) : [];
}

/** Everything a trace yields under the sheet's scale (ADR 0110): its own figure and the ones typed onto it. */
function yieldsFor(m: MarkupView, scale: SheetScale | null): Yield[] {
  if (!isMeasureKind(m.kind)) return [];
  const points = pointsOf(m);
  if (points.length < MIN_POINTS[m.kind]) return [];
  return yieldsOf(m.kind, { points }, m.figures, scale);
}

/** A trace's own figure — the NET area once openings are cut out — or null while it needs the scale. */
function measurementOf(m: MarkupView, scale: SheetScale | null): Measurement | null {
  if (!isMeasureKind(m.kind)) return null;
  return yieldsFor(m, scale).find((y) => y.figure === m.kind)?.measurement ?? null;
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
  currencySymbol = null,
  focusable = false,
  neighbours = null,
  subtitle = null,
  me = "",
  measuringFor = null,
  forLine = null,
  onChanged,
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
  /** The tenant's money symbol, for the toast that says what a new line was priced at; null prints the amount alone. */
  currencySymbol?: string | null;
  /** Whether the sheet may take the whole window: the drawings page says so; a dialog already holding the viewer says nothing. */
  focusable?: boolean;
  /** The sheets either side in the current set, for the top bar in focus. */
  neighbours?: { previous: { href: string; number: string } | null; next: { href: string; number: string } | null } | null;
  /** The set and its date, beside the sheet's number in focus. */
  subtitle?: string | null;
  /** How this viewer is named on a row it has just drawn, until the server says. */
  me?: string;
  /** An estimate line is measuring (ADR 0109): tick boxes on its kind of trace, nothing else changes. */
  forLine?: MeasuringLine | null;
  /**
   * Called after anything on the sheet was written — a trace drawn, rubbed
   * out, renamed, pushed, the scale set. The drawings page refreshes itself;
   * a dialog holding a SNAPSHOT of the sheet has to be told to read it again,
   * or a trace drawn inside it never appears in its own list.
   */
  onChanged?: () => void;
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
  /** The area an opening is being cut out of, while the deduct tool is up (ADR 0110). */
  const [deductFor, setDeductFor] = useState<string | null>(null);
  const [takeoffFor, setTakeoffFor] = useState<MarkupView | null>(null);
  /**
   * THE ROWS AS THIS VIEWER KNOWS THEM. Seeded from the server and taken
   * fresh whenever the server sends a new list; every write lands here the
   * moment its action returns, so a trace is in the list before the page has
   * re-read itself and the refresh that follows only confirms it. A Finish
   * used to wait on the whole page.
   */
  const [local, setLocal] = useState<{ base: MarkupView[]; rows: MarkupView[] }>({ base: markups, rows: markups });
  if (local.base !== markups) setLocal({ base: markups, rows: markups });
  const rows = local.base === markups ? local.rows : markups;
  const setRows = (f: (prev: MarkupView[]) => MarkupView[]) => setLocal((l) => ({ base: l.base, rows: f(l.rows) }));
  const patchRow = (id: string, patch: Partial<MarkupView> | ((m: MarkupView) => MarkupView)) =>
    setRows((prev) => prev.map((m) => (m.id !== id ? m : typeof patch === "function" ? patch(m) : { ...m, ...patch })));
  /**
   * FOCUS: the sheet fills the window with the measurements in a rail beside
   * it, and the page waits underneath. `?focus=1` on the address remembers
   * it across a reload and onto the next sheet. Only where the page says it
   * may — a dialog already holding the viewer never offers it.
   */
  const searchParams = useSearchParams();
  const [focused, setFocused] = useState(() => focusable && searchParams?.get("focus") === "1");
  const [railOpen, setRailOpen] = useState(true);
  const [sheetUp, setSheetUp] = useState(false);
  const narrow = useNarrow();
  useEffect(() => {
    if (!focused) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [focused]);
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

  /**
   * Esc, nearest thing first: a tool goes back to moving about, a selection
   * clears, and only a second Esc with nothing to cancel gives the page back.
   * A dialog open on top takes the key itself, so nothing here moves then.
   */
  const dialogOpen = editing !== null || scaleOpen || calibration !== null || takeoffFor !== null || pending !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || dialogOpen) return;
      const cancelling = tool !== "select" || draft !== null || pointsDraft !== null || selectedId !== null;
      setTool("select");
      setDraft(null);
      setPointsDraft(null);
      setSelectedId(null);
      setDeductFor(null);
      if (!cancelling && focused) {
        setFocused(false);
        setFocusParam(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen, tool, draft, pointsDraft, selectedId, focused]);

  // --- geometry ----------------------------------------------------------
  const cssW = Math.floor(boxWidth * zoom);
  const cssH = pageSize ? Math.floor((cssW * pageSize.h) / pageSize.w) : 0;
  const W = pageSize?.w ?? 1;
  const H = pageSize?.h ?? 1;
  /** Page units per CSS pixel: text and pins keep a screen size whatever the zoom. */
  const unit = cssW > 0 ? W / cssW : 1;
  const likes = useMemo(
    () => rows.map((m) => ({ id: m.id, kind: m.kind, createdAt: m.createdOn, workItemId: m.workItemId, punchDone: m.punch?.done ?? null })),
    [rows],
  );
  const numbers = useMemo(() => pinNumbers(likes), [likes]);
  const summary = useMemo(() => summariseMarkups(likes), [likes]);
  const yields = useMemo(() => new Map(rows.map((m) => [m.id, yieldsFor(m, scale)])), [rows, scale]);
  const measurements = useMemo(() => new Map(rows.map((m) => [m.id, measurementOf(m, scale)])), [rows, scale]);
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
      // A measurement, a calibration or an opening: every tap is a point; Finish (or Enter) closes it.
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
    if (pointsDraft.points.length < MIN_FOR[pointsDraft.kind]) return;
    const points = pointsDraft.points;
    if (pointsDraft.kind === "deduct") {
      /** An opening cut out of an area (ADR 0110): one more ring on that trace's figures, and its net area moves. */
      const target = deductFor ? rows.find((m) => m.id === deductFor) : null;
      setPointsDraft(null);
      setDeductFor(null);
      setTool("select");
      if (!target) return;
      startTransition(async () => {
        const result = await updateMarkupAction({
          sheetId,
          projectId,
          id: target.id,
          version: target.version,
          figures: { ...target.figures, deducts: [...(target.figures.deducts ?? []), points] },
        });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        toast.success("Opening cut out — the area reads net of it");
        patchRow(target.id, (m) => ({ ...m, version: result.version, figures: { ...m.figures, deducts: [...(m.figures.deducts ?? []), points] } }));
        onChanged?.();
        router.refresh();
      });
      return;
    }
    const kind = pointsDraft.kind;
    setPointsDraft(null);
    submit({ kind, geometry: { points } }, (id) => {
      /**
       * Drawn while a line was measuring (ADR 0109): the first figure it
       * yields of the line's family stands behind the line straight away —
       * its own for a like line, the run around a room for a baseboard.
       */
      if (forLine) {
        const fit = yieldsOf(kind, { points }, {}, scale).find((y) => FIGURE_FAMILY[y.figure] === forLine.family);
        if (fit) forLine.onToggle(id, fit.figure, true, toThousandths(fit.measurement.quantity));
      }
    });
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

  /** The row a fresh markup will have once the server describes it, drawn now from what was sent. */
  function madeView(id: string, workItemId: string | null, input: { kind: MarkupKind; geometry: Record<string, unknown>; text?: string; dueOn?: string }): MarkupView {
    return {
      id,
      kind: input.kind,
      color,
      geometry: input.geometry,
      text: input.text ?? "",
      version: 1,
      createdOn: today(),
      createdBy: me,
      workItemId,
      punch: input.kind === "pin" && workItemId ? { title: input.text ?? "", done: false, dueOn: input.dueOn || null } : null,
      takeoffs: [],
      figures: {},
    };
  }

  function submit(
    input: { kind: MarkupKind; geometry: Record<string, unknown>; text?: string; raise?: boolean; dueOn?: string },
    onMade?: (id: string) => void,
  ) {
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
      setRows((prev) => [...prev, madeView(result.id, result.workItemId, input)]);
      setSelectedId(result.id);
      onMade?.(result.id);
      onChanged?.();
      router.refresh();
    });
  }

  const cursor = !canEdit || tool === "select" ? "grab" : "crosshair";
  const selected = rows.find((m) => m.id === selectedId) ?? null;
  /**
   * The traces this walk could use, and what they come to together (X7).
   * A roof is three planes and a perimeter is one run; summing them here
   * saves a calculator, and `sumMeasurements` already refuses to add a
   * length to an area.
   */
  const forTheWalk = useMemo(
    () =>
      measuringFor
        ? rows.filter((m) => m.kind === measuringFor.kind && measurements.get(m.id))
        : [],
    [rows, measurements, measuringFor],
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
    pointsDraft && pointsDraft.kind !== "calibrate" && pointsDraft.points.length >= MIN_FOR[pointsDraft.kind]
      ? measure(pointsDraft.kind === "deduct" ? "area" : pointsDraft.kind, { points: pointsDraft.points }, scale)
      : null;
  const needsScale = (tool === "length" || tool === "area" || tool === "deduct") && !scale;
  const enterFocus = () => {
    setFocused(true);
    setFocusParam(true);
  };
  const leaveFocus = () => {
    setFocused(false);
    setFocusParam(false);
  };
  const renderRow = (m: MarkupView, compact = false) => (
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
      measuringFor={measuringFor && m.kind === measuringFor.kind ? measuringFor : null}
      forLine={forLine}
      yields={yields.get(m.id) ?? []}
      onDeduct={() => {
        setDeductFor(m.id);
        setSelectedId(m.id);
        setPointsDraft(null);
        setTool("deduct");
      }}
      onChanged={onChanged}
      onRemoved={() => setRows((prev) => prev.filter((x) => x.id !== m.id))}
      onPunched={(done) => patchRow(m.id, (x) => ({ ...x, punch: x.punch ? { ...x.punch, done } : x.punch }))}
      onUnpushed={(link) => patchRow(m.id, (x) => ({ ...x, takeoffs: x.takeoffs.filter((t) => !(t.lineId === link.lineId && t.figure === link.figure)) }))}
      compact={compact}
    />
  );
  /** In focus the measurements sit in a rail, newest first, so the trace just finished is at the top. */
  const measured = rows.filter((m) => isMeasureKind(m.kind)).reverse();
  const rail =
    focused && !narrow && railOpen ? (
      <aside data-sheet-rail="" className="flex w-[340px] shrink-0 flex-col border-l bg-background">
        <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
          <span className="font-medium">Measurements</span>
          <span className="text-xs text-muted-foreground">{measured.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {measured.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">Pick Length, Area or Count and draw on the sheet; each trace lands here with its Takeoff.</p>
          ) : (
            <ul className="divide-y text-sm">{measured.map((m) => renderRow(m, true))}</ul>
          )}
        </div>
        <p className="border-t px-3 py-2 text-[11px] text-muted-foreground">Clouds, notes and pins stay on the page below focus.</p>
      </aside>
    ) : null;
  const bottomSheet =
    focused && narrow ? (
      <div className="border-t bg-background">
        <button
          type="button"
          className="flex w-full justify-center py-1.5"
          onClick={() => setSheetUp((v) => !v)}
          aria-expanded={sheetUp}
          aria-label={sheetUp ? "Show the last measurement only" : "Show every measurement"}
        >
          <span className="block h-1 w-9 rounded-full bg-border" />
        </button>
        {measured.length === 0 ? (
          <p className="px-3 pb-2 text-xs text-muted-foreground">Pick Length, Area or Count and draw on the sheet.</p>
        ) : (
          <div className={sheetUp ? "max-h-[60vh] overflow-y-auto" : "overflow-hidden"}>
            <ul className="divide-y text-sm">{(sheetUp ? measured : measured.slice(0, 1)).map((m) => renderRow(m, true))}</ul>
          </div>
        )}
        <div className="flex items-center justify-between px-3 py-1 text-[11px] text-muted-foreground">
          <span>{measured.length} measured</span>
          <button type="button" className="underline underline-offset-2" onClick={() => setSheetUp((v) => !v)}>
            {sheetUp ? "The last one" : "All of them"}
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className={focused ? "fixed inset-0 z-[45] flex flex-col bg-background" : "space-y-3"} data-sheet-focus={focused ? "" : undefined}>
      {focused && (
        <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm">
          <span className="truncate font-medium">{label}</span>
          {subtitle && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{subtitle}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {neighbours?.previous && (
              <a href={`${neighbours.previous.href}?focus=1`} className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
                <ChevronLeft className="size-4" /> {neighbours.previous.number}
              </a>
            )}
            {neighbours?.next && (
              <a href={`${neighbours.next.href}?focus=1`} className="inline-flex h-7 items-center gap-0.5 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground">
                {neighbours.next.number} <ChevronRight className="size-4" />
              </a>
            )}
            <Button type="button" variant="outline" size="sm" className="h-7" onClick={leaveFocus} title="Give the page back">
              <Shrink className="mr-1 size-3.5" /> Exit focus <span className="ml-1.5 text-[10px] text-muted-foreground">Esc</span>
            </Button>
          </span>
        </div>
      )}
      <div className={`flex flex-wrap items-center justify-between gap-2${focused ? " px-3 pt-2" : ""}`}>
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
          {focusable && !focused && (
            <Button type="button" variant="outline" size="sm" className="h-7 px-2" onClick={enterFocus} title="Focus: the sheet fills the window">
              <Expand className="size-3.5" />
              <span className="ml-1 hidden sm:inline">Focus</span>
            </Button>
          )}
          {focused && !narrow && (
            <Button
              type="button"
              variant={railOpen ? "default" : "outline"}
              size="sm"
              className="h-7 px-2"
              onClick={() => setRailOpen((v) => !v)}
              aria-pressed={railOpen}
              title={railOpen ? "Hide the measurements" : "Show the measurements"}
            >
              <PanelRight className="size-3.5" />
              <span className="ml-1 hidden sm:inline">List</span>
            </Button>
          )}
        </div>
      </div>
      {/* THE TOOL LINE IS ALWAYS THERE while the sheet can be drawn on, so picking a tool does not push the sheet down under the finger about to draw. */}
      {canEdit && (
        <div className={`flex min-h-7 flex-wrap items-center gap-2 text-xs text-muted-foreground${focused ? " px-3" : ""}`}>
          <span>
            {tool === "select"
              ? "Pick a tool to draw or measure; drag to move about, pinch or ctrl+wheel to zoom."
              : tool === "cloud"
              ? "Drag a box around what changed."
              : tool === "arrow"
                ? "Drag from where the arrow starts to what it points at."
                : tool === "text"
                  ? "Tap where the note goes."
                  : tool === "pin"
                    ? "Tap where the problem is; the pin goes on the punch list."
                    : tool === "calibrate"
                      ? "Tap the two ends of a dimension the drawing states."
                      : tool === "deduct"
                        ? "Tap around the opening, corner by corner, then Finish — it comes off the area."
                        : needsScale
                        ? "Set the sheet's scale first; a count needs none."
                        : tool === "length"
                          ? "Tap along the wall, corner by corner, then Finish."
                          : tool === "area"
                            ? "Tap around the room, corner by corner, then Finish."
                            : "Tap each one to count it, then Finish."}
            {tool !== "select" ? " Esc goes back to moving about." : ""}
          </span>
          {pointsDraft && pointsDraft.kind !== "calibrate" && (
            <span className="flex items-center gap-1">
              <span className="font-medium text-foreground">
                {pointsDraft.points.length} {pointsDraft.points.length === 1 ? "point" : "points"}
                {draftMeasure ? ` · ${formatMeasure(draftMeasure)}` : ""}
              </span>
              <Button type="button" size="sm" className="h-7" onClick={finishPoints} disabled={saving || pointsDraft.points.length < MIN_FOR[pointsDraft.kind]}>
                <Check className="mr-1 size-3.5" /> Finish
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => setPointsDraft(null)}>
                <X className="mr-1 size-3.5" /> Start over
              </Button>
            </span>
          )}
        </div>
      )}

      {/* The box and the rail share a row in focus; out of it the wrapper has no box of its own, so the page keeps its shape and the canvas is never remounted. */}
      <div className={focused ? "flex min-h-0 flex-1" : "contents"}>
      <div
        ref={boxRef}
        className={focused ? "relative min-h-0 flex-1 overflow-auto bg-secondary/30" : "relative mt-3 max-h-[75vh] w-full min-w-0 overflow-auto rounded-md border bg-secondary/30"}
        style={{ touchAction: "none" }}
        onDoubleClick={() => {
          if (focusable && !focused && tool === "select") enterFocus();
        }}
      >
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
      {rail}
      </div>
      {bottomSheet}

      <div className={focused ? "hidden" : undefined}>
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
        {forLine && (
          <div className="mb-2 rounded-[3px] border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <span className="font-medium">{forLine.description}</span>
            <span className="text-muted-foreground">
              {" "}
              — draw {familyWords(forLine.family)} and it stands behind the line, or tick the figures below that do
              {scale || forLine.family === "count" ? "" : ". Set the scale first"}.
            </span>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {canEdit
              ? "Pick a tool above and draw on the sheet. A pin puts what needs doing on the job's punch list; a length, an area or a count is a quantity for the estimate."
              : "Nothing drawn on this issue."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {rows.map((m) => renderRow(m))}
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
      <EditDialog markup={editing} projectId={projectId} sheetId={sheetId} onClose={() => setEditing(null)} onChanged={onChanged} onSaved={(id, patch) => patchRow(id, patch)} />
      <ScaleDialog
        open={scaleOpen}
        scale={scale}
        scaleLabel={scaleLabel}
        pageSize={pageSize}
        projectId={projectId}
        sheetId={sheetId}
        onChanged={onChanged}
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
        onChanged={onChanged}
        onClose={() => setCalibration(null)}
      />
      <TakeoffDialog
        markup={takeoffFor}
        markups={rows}
        yields={yields}
        scale={scale}
        estimates={estimates}
        codes={codes}
        currencySymbol={currencySymbol}
        projectId={projectId}
        sheetId={sheetId}
        onChanged={onChanged}
        onPushed={(lineId, links) =>
          setRows((prev) =>
            prev.map((m) => {
              const own = links.get(m.id) ?? [];
              const kept = m.takeoffs.filter((t) => t.lineId !== lineId);
              return own.length === 0 && kept.length === m.takeoffs.length ? m : { ...m, takeoffs: [...kept, ...own] };
            }),
          )
        }
        onClose={() => setTakeoffFor(null)}
      />
    </div>
  );
}

/** Today as `YYYY-MM-DD`, for how long ago a remembered price was priced. */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function describe(m: MarkupView, number: number | undefined, measurement: Measurement | null): string {
  if (m.kind === "pin") return `pin ${number ?? ""} · ${m.text}`;
  if (m.kind === "text") return `note · ${m.text}`;
  if (isMeasureKind(m.kind)) return `${MARKUP_KIND_LABELS[m.kind].toLowerCase()}${measurement ? ` · ${formatMeasure(measurement)}` : ""}${m.text ? ` · ${m.text}` : ""}`;
  return `${MARKUP_KIND_LABELS[m.kind].toLowerCase()} in ${MARKUP_COLOR_LABELS[m.color].toLowerCase()}`;
}

/** Under 640px a rail would leave no sheet, so in focus the measurements come up from the bottom instead. */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);
  return narrow;
}

/** `?focus=1` on the address while the sheet has the window, so a reload and the next sheet keep it. */
function setFocusParam(on: boolean) {
  const address = new URL(window.location.href);
  if (on) address.searchParams.set("focus", "1");
  else address.searchParams.delete("focus");
  window.history.replaceState(window.history.state, "", address);
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
    const ring = (ps: readonly PointGeometry[]) => ps.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * W} ${p.y * H}`).join(" ") + " Z";
    const holes = m.figures.deducts ?? [];
    // The openings are holes in the fill (evenodd), each outlined dashed, so the tint reads as what is left.
    const d = [ring(pts), ...holes.map(ring)].join(" ");
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }}>
        <path d={d} fillRule="evenodd" fill={hex} fillOpacity={selected ? 0.25 : 0.15} stroke={hex} strokeWidth={stroke} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {holes.map((h, i) => (
          <path key={i} d={ring(h)} fill="none" stroke={hex} strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        ))}
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
  const closed = draft.kind === "area" || draft.kind === "deduct";
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x * W} ${p.y * H}`).join(" ") + (closed && pts.length >= 3 ? " Z" : "");
  return (
    <g pointerEvents="none">
      {pts.length >= 2 && draft.kind !== "count" && (
        <path d={d} fill={closed ? hex : "none"} fillOpacity={draft.kind === "deduct" ? 0.3 : 0.1} stroke={hex} strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
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
  yields,
  selected,
  canEdit,
  busy,
  projectId,
  sheetId,
  hasEstimates,
  onSelect,
  onEdit,
  onTakeoff,
  onDeduct,
  measuringFor,
  forLine,
  onChanged,
  onRemoved,
  onPunched,
  onUnpushed,
  compact = false,
}: {
  markup: MarkupView;
  number?: number;
  measurement: Measurement | null;
  /** Everything the trace yields under the sheet's scale (ADR 0110), its own figure among them. */
  yields: Yield[];
  selected: boolean;
  canEdit: boolean;
  busy: boolean;
  projectId: string;
  sheetId: string;
  hasEstimates: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onTakeoff: () => void;
  /** Start cutting an opening out of this area. */
  onDeduct: () => void;
  /** Non-null only when a walk is waiting for exactly this kind of number. */
  measuringFor: MeasuringFor | null;
  /** Non-null while an estimate line is measuring (ADR 0109): the row offers every figure it yields of the line's family. */
  forLine: MeasuringLine | null;
  onChanged?: () => void;
  /** The list keeps itself current from these, before the page has re-read the sheet. */
  onRemoved?: () => void;
  onPunched?: (done: boolean) => void;
  onUnpushed?: (link: TakeoffLinkView) => void;
  /** In a narrow rail the parts stack — words, chips, buttons — instead of squeezing the words beside the buttons. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const hex = MARKUP_COLOR_HEX[m.color];
  const measuring = isMeasureKind(m.kind);
  const own = yields.find((y) => y.figure === m.kind) ?? null;
  const derived = yields.filter((y) => y.figure !== m.kind);
  const offered = forLine ? yields.filter((y) => FIGURE_FAMILY[y.figure] === forLine.family) : [];

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
      onPunched?.(done);
      onChanged?.();
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
      onRemoved?.();
      onChanged?.();
      router.refresh();
    });
  }

  /** One link let go (ADR 0110): the line keeps its quantity; this figure of this trace no longer stands behind it. */
  function unpush(link: TakeoffLinkView) {
    startTransition(async () => {
      const result = await unpushTakeoffAction({ id: m.id, sheetId, projectId, lineId: link.lineId, figure: link.figure });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("The line keeps its quantity; this measurement no longer stands behind it");
      onUnpushed?.(link);
      onChanged?.();
      router.refresh();
    });
  }

  return (
    <li className={`${compact ? "flex flex-col items-stretch gap-1.5" : "flex flex-wrap items-center gap-2"} px-3 py-2 ${selected ? "bg-secondary/60" : ""}`}>
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
          {/* What else the trace yields (ADR 0110), each with its working on hover; an area's own working when openings came off it. */}
          {(derived.length > 0 || (own !== null && own.working !== "")) && (
            <span className="block text-xs text-muted-foreground">
              {own !== null && own.working !== "" ? <span title="net of the openings">{own.working}</span> : null}
              {derived.map((y, i) => (
                <span key={y.figure} title={y.working}>
                  {i > 0 || (own !== null && own.working !== "") ? " · " : ""}
                  {TRACE_FIGURE_LABELS[y.figure].toLowerCase()} <span className="tabular-nums text-foreground">{formatMeasure(y.measurement)}</span>
                </span>
              ))}
            </span>
          )}
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
      {/* Every line this trace stands behind, by which of its figures (ADR 0074, 0110), each read against ITS OWN share. */}
      {measuring &&
        m.takeoffs.map((link) => {
          const now = yields.find((y) => y.figure === link.figure)?.measurement ?? null;
          const drifted = driftedSince(link.shareThousandths, now);
          return (
            <span key={`${link.lineId}:${link.figure}`} className={compact ? "flex flex-wrap items-center gap-1" : "flex items-center gap-1"}>
              <StatusBadge tone={drifted ? "pending" : "good"}>
                {`→ ${link.estimateNumber} · ${link.lineDescription} · ${thousandthsToQuantityString(link.lineQuantityThousandths)} ${link.lineUnit}`}
                {link.figure !== m.kind ? ` · ${TRACE_FIGURE_LABELS[link.figure].toLowerCase()}` : ""}
                {drifted ? " · measured since" : ""}
              </StatusBadge>
              {canEdit && (
                <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => unpush(link)} disabled={pending || busy} title="No longer stands behind the line">
                  <X className="size-3.5" />
                  <span className="sr-only">Unpush</span>
                </Button>
              )}
            </span>
          );
        })}
      {forLine &&
        offered.map((y) => (
          <label
            key={y.figure}
            className="flex cursor-pointer items-center gap-1.5 text-xs"
            title={`${formatMeasure(y.measurement)} stands behind ${forLine.description}${y.working ? ` — ${y.working}` : ""}`}
          >
            <Checkbox
              checked={forLine.selected.has(`${m.id}:${y.figure}`)}
              disabled={pending || busy || forLine.busy}
              onCheckedChange={(v) => forLine.onToggle(m.id, y.figure, v === true, toThousandths(y.measurement.quantity))}
              aria-label={`${formatMeasure(y.measurement)} stands behind the line`}
            />
            {y.figure === m.kind ? "behind the line" : `${TRACE_FIGURE_LABELS[y.figure].toLowerCase()} ${formatMeasure(y.measurement)}`}
          </label>
        ))}
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
        <span className={compact ? "flex flex-wrap items-center gap-1" : "flex items-center gap-1"}>
          {m.kind === "area" && (
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onDeduct} disabled={pending || busy || !measurement} title={!measurement ? "Set the scale first" : "Cut an opening out of this area"}>
              <Scissors className="mr-1 size-3.5" /> Cut an opening
            </Button>
          )}
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

/**
 * A markup's words and colour, after the fact — and on a trace, what it
 * yields besides its own figure (ADR 0110): a height on a length, a pitch or
 * a depth on an area, and the openings cut out of it. The pin's punch item
 * keeps its own words in Work.
 */
function EditDialog({
  markup,
  projectId,
  sheetId,
  onClose,
  onChanged,
  onSaved,
}: {
  markup: MarkupView | null;
  projectId: string;
  sheetId: string;
  onClose: () => void;
  onChanged?: () => void;
  /** What was saved, as the row should now read it, with the version the server gave back. */
  onSaved?: (id: string, patch: Pick<MarkupView, "text" | "color" | "figures" | "version">) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState("");
  const [color, setColor] = useState<MarkupColor>("red");
  const [height, setHeight] = useState("");
  const [heightUnit, setHeightUnit] = useState<"ft" | "m">("ft");
  const [pitch, setPitch] = useState("");
  const [pitchUnit, setPitchUnit] = useState<"rise" | "degrees">("rise");
  const [depth, setDepth] = useState("");
  const [depthUnit, setDepthUnit] = useState<"in" | "mm">("in");
  const [keepOpenings, setKeepOpenings] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (markup && loadedFor !== markup.id) {
    setLoadedFor(markup.id);
    setText(markup.text);
    setColor(markup.color);
    setHeight(markup.figures.height ? String(markup.figures.height.value) : "");
    setHeightUnit(markup.figures.height?.unit ?? "ft");
    const p = markup.figures.pitch;
    setPitch(p ? String("rise" in p ? p.rise : p.degrees) : "");
    setPitchUnit(p && "degrees" in p ? "degrees" : "rise");
    setDepth(markup.figures.depth ? String(markup.figures.depth.value) : "");
    setDepthUnit(markup.figures.depth?.unit ?? "in");
    setKeepOpenings(true);
  }
  const needsWords = markup?.kind === "text" || markup?.kind === "pin";
  const measuring = markup ? isMeasureKind(markup.kind) : false;
  const openings = markup?.figures.deducts?.length ?? 0;

  /** The figures as typed, in the units typed; a blank box means none. */
  function figuresPatch(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (markup?.kind === "length") {
      const h = Number.parseFloat(height);
      if (height.trim() !== "" && Number.isFinite(h) && h > 0) out.height = { value: h, unit: heightUnit };
    }
    if (markup?.kind === "area") {
      const r = Number.parseFloat(pitch);
      if (pitch.trim() !== "" && Number.isFinite(r) && r >= 0) out.pitch = pitchUnit === "degrees" ? { degrees: r } : { rise: r };
      const d = Number.parseFloat(depth);
      if (depth.trim() !== "" && Number.isFinite(d) && d > 0) out.depth = { value: d, unit: depthUnit };
      if (keepOpenings && markup.figures.deducts && markup.figures.deducts.length > 0) out.deducts = markup.figures.deducts;
    }
    return out;
  }

  function save() {
    if (!markup) return;
    startTransition(async () => {
      const result = await updateMarkupAction({
        id: markup.id,
        sheetId,
        projectId,
        version: markup.version,
        text: text.trim(),
        color,
        ...(measuring ? { figures: figuresPatch() } : {}),
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Markup saved");
      onSaved?.(markup.id, { text: text.trim(), color, figures: measuring ? parseFigures(figuresPatch()) : markup.figures, version: result.version });
      onClose();
      onChanged?.();
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
          {markup && isMeasureKind(markup.kind) && (
            <DialogDescription>
              A name for the measurement — the room, the wall — its colour, and what it yields besides its own figure. The points stay where they are.
            </DialogDescription>
          )}
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
          {markup?.kind === "length" && (
            <div className="space-y-1.5">
              <Label htmlFor="mk-height">Height — the wall it stands</Label>
              <div className="flex items-center gap-2">
                <Input id="mk-height" value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" placeholder="9" className="w-28" />
                <Select value={heightUnit} onValueChange={(v) => setHeightUnit(v as "ft" | "m")}>
                  <SelectTrigger className="w-24" aria-label="Height unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ft">feet</SelectItem>
                    <SelectItem value="m">metres</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">With a height, the length also yields a wall area — length × height — that a drywall or paint line can take.</p>
            </div>
          )}
          {markup?.kind === "area" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="mk-pitch">Pitch — as a roof</Label>
                <div className="flex items-center gap-2">
                  <Input id="mk-pitch" value={pitch} onChange={(e) => setPitch(e.target.value)} inputMode="decimal" placeholder={pitchUnit === "degrees" ? "27" : "6"} className="w-24" />
                  <Select value={pitchUnit} onValueChange={(v) => setPitchUnit(v as "rise" | "degrees")}>
                    <SelectTrigger className="w-32" aria-label="Pitch unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rise">: 12</SelectItem>
                      <SelectItem value="degrees">degrees</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">A plan area at 6:12 — 26.6° — yields a roof area 1.118 times itself. Blank means the area is flat.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mk-depth">Depth — as a volume</Label>
                <div className="flex items-center gap-2">
                  <Input id="mk-depth" value={depth} onChange={(e) => setDepth(e.target.value)} inputMode="decimal" placeholder="4" className="w-24" />
                  <Select value={depthUnit} onValueChange={(v) => setDepthUnit(v as "in" | "mm")}>
                    <SelectTrigger className="w-32" aria-label="Depth unit">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in">inches</SelectItem>
                      <SelectItem value="mm">millimetres</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">A 400 sq ft slab at 4 in yields 4.9 cy, for a line priced by the yard.</p>
              </div>
              {openings > 0 && (
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={keepOpenings} onCheckedChange={(v) => setKeepOpenings(v === true)} />
                  Keep the {openings} {openings === 1 ? "opening" : "openings"} cut out of it
                </label>
              )}
            </>
          )}
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
  onChanged,
  onClose,
  onCalibrate,
}: {
  open: boolean;
  scale: SheetScale | null;
  scaleLabel: string | null;
  pageSize: { w: number; h: number } | null;
  projectId: string;
  sheetId: string;
  onChanged?: () => void;
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
      onChanged?.();
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
      onChanged?.();
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
  onChanged,
  onClose,
}: {
  calibration: { a: PointGeometry; b: PointGeometry } | null;
  pageSize: { w: number; h: number } | null;
  projectId: string;
  sheetId: string;
  onChanged?: () => void;
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
      onChanged?.();
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

/**
 * A trace's figure — or several of one family, across the sheet and across the
 * line's other sheets — onto an estimate line (ADR 0074, 0109, 0110).
 */
function TakeoffDialog({
  markup,
  markups,
  yields,
  scale,
  estimates,
  codes,
  currencySymbol,
  projectId,
  sheetId,
  onChanged,
  onPushed,
  onClose,
}: {
  markup: MarkupView | null;
  markups: MarkupView[];
  yields: Map<string, Yield[]>;
  scale: SheetScale | null;
  estimates: EstimateOption[];
  codes: Array<{ id: string; label: string }>;
  currencySymbol: string | null;
  /** The links this push made on this sheet, so the rows can show them before the page has re-read itself. */
  onPushed?: (lineId: string, links: Map<string, TakeoffLinkView[]>) => void;
  projectId: string;
  sheetId: string;
  onChanged?: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** The estimate this sheet already feeds, else the only one, else the first — never `estimates[0]` by habit. */
  const aimedAt = estimateFedBy(markups.flatMap((m) => m.takeoffs), estimates) ?? NONE;
  const [estimateId, setEstimateId] = useState<string>(aimedAt);
  const [lineId, setLineId] = useState<string>(NEW_LINE);
  const [description, setDescription] = useState("");
  const [costCodeId, setCostCodeId] = useState<string>(NONE);
  /** Which of the clicked trace's figures is going: its own kind unless picked otherwise (ADR 0110). */
  const [figure, setFigure] = useState<TraceFigure>("area");
  /** `${markupId}:${figure}` for every figure ticked on this sheet. */
  const [included, setIncluded] = useState<Set<string>>(new Set());
  /**
   * THE LINE'S TRACES ON OTHER SHEETS STAY UNLESS UNTICKED (ADR 0109). A push
   * states the whole set behind the line, so a push from A-102 that named only
   * A-102's traces would silently drop the downstairs floor on A-101. They are
   * listed, ticked, and go into the push unless somebody unticks a sheet.
   */
  const [leftOut, setLeftOut] = useState<Set<string>>(new Set());
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const family: FigureFamily = FIGURE_FAMILY[figure];
  const lineUnit = takeoffUnitFor(family, scale?.unit ?? "");
  /** This sheet's figures already standing behind a line, of the family going: ticked with it, so a push keeps them. */
  const behindHere = (id: string, fam: FigureFamily) =>
    markups.flatMap((m) => m.takeoffs.filter((t) => t.lineId === id && FIGURE_FAMILY[t.figure] === fam).map((t) => `${m.id}:${t.figure}`));
  if (markup && loadedFor !== markup.id && isMeasureKind(markup.kind)) {
    setLoadedFor(markup.id);
    setLeftOut(new Set());
    setFigure(markup.kind);
    const fam = FIGURE_FAMILY[markup.kind];
    const link = markup.takeoffs.find((t) => FIGURE_FAMILY[t.figure] === fam) ?? null;
    const preselected = link ? pushedLineId(estimates, link, takeoffUnitFor(fam, scale?.unit ?? "")) : NEW_LINE;
    setIncluded(new Set([`${markup.id}:${markup.kind}`, ...(preselected === NEW_LINE ? [] : behindHere(preselected, fam))]));
    setDescription(markup.text || MARKUP_KIND_LABELS[markup.kind]);
    setEstimateId(link?.estimateId ?? aimedAt);
    setLineId(preselected);
  }
  const ownYields = markup ? (yields.get(markup.id) ?? []) : [];
  /** Every figure on the sheet of the family going, each a tick: a room's run around it sits beside a wall's length. */
  const candidates = markups.flatMap((m) =>
    (yields.get(m.id) ?? [])
      .filter((y) => FIGURE_FAMILY[y.figure] === family)
      .map((y) => ({ key: `${m.id}:${y.figure}`, markupId: m.id, figure: y.figure, label: m.text || MARKUP_KIND_LABELS[m.kind], yield: y, own: y.figure === m.kind })),
  );
  const chosen = candidates.filter((c) => included.has(c.key));
  const total = chosen.reduce((s, c) => s + c.yield.measurement.quantity, 0);
  const unitWord = chosen[0]?.yield.measurement.unit ?? "";
  const estimate = estimates.find((e) => e.id === estimateId) ?? null;
  /** What stands behind the chosen line on OTHER sheets, kept unless unticked. */
  const elsewhere = (estimate?.lines.find((l) => l.id === lineId)?.behind ?? []).filter((s) => s.sheetId !== sheetId);
  const kept = elsewhere.filter((s) => !leftOut.has(s.sheetId));
  const elsewhereThousandths = kept.reduce((sum, s) => sum + (s.nowThousandths ?? s.shareThousandths), 0);
  const lineTotalThousandths = toThousandths(total) + elsewhereThousandths;

  function changeFigure(next: TraceFigure) {
    if (!markup) return;
    setFigure(next);
    // A different family is a different set: start it from this trace's figure and what already stands behind the line.
    const fam = FIGURE_FAMILY[next];
    setIncluded(new Set([`${markup.id}:${next}`, ...(lineId === NEW_LINE ? [] : behindHere(lineId, fam))]));
  }

  function push() {
    if (!markup || !estimate || chosen.length === 0) return;
    startTransition(async () => {
      const result = await pushTakeoffAction({
        sheetId,
        projectId,
        estimateId: estimate.id,
        picks: [...chosen.map((c) => ({ markupId: c.markupId, figure: c.figure })), ...kept.flatMap((s) => s.picks)],
        lineId: lineId === NEW_LINE ? "" : lineId,
        newLine: lineId === NEW_LINE ? { description: description.trim(), costCodeId: costCodeId === NONE ? "" : costCodeId, unit: lineUnit } : null,
      });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`${thousandthsToQuantityString(result.quantityThousandths)} ${result.unit} onto ${estimate.number}`, {
        description: result.priced
          ? `Priced from memory — ${priceHint(result.priced, formatMoney(result.priced.unitCostCents, currencySymbol), today())}. Check it: a price can be a year old.`
          : undefined,
      });
      const lineDescription = lineId === NEW_LINE ? description.trim() : (estimate.lines.find((l) => l.id === lineId)?.description ?? "");
      const links = new Map<string, TakeoffLinkView[]>();
      for (const c of chosen) {
        const link: TakeoffLinkView = {
          lineId: result.lineId,
          figure: c.figure,
          shareThousandths: toThousandths(c.yield.measurement.quantity),
          estimateId: estimate.id,
          estimateNumber: estimate.number,
          estimateStatus: estimate.status,
          lineDescription,
          lineUnit: result.unit,
          lineQuantityThousandths: result.quantityThousandths,
        };
        links.set(c.markupId, [...(links.get(c.markupId) ?? []), link]);
      }
      onPushed?.(result.lineId, links);
      setLoadedFor(null);
      onClose();
      onChanged?.();
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
            {family === "count" ? "A count" : family === "length" ? "A length" : family === "volume" ? "A volume" : "An area"}{" "}
            onto an estimate line. The line&apos;s quantity becomes the total; its unit price does the rest.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {ownYields.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="to-figure">What goes</Label>
              <Select value={figure} onValueChange={(v) => changeFigure(v as TraceFigure)}>
                <SelectTrigger className="w-full" id="to-figure">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ownYields.map((y) => (
                    <SelectItem key={y.figure} value={y.figure}>
                      {TRACE_FIGURE_LABELS[y.figure]} · {formatMeasure(y.measurement)}
                      {y.working ? ` — ${y.working}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {candidates.length > 1 && (
            <div className="space-y-1.5">
              <Label>Measurements to add up</Label>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
                {candidates.map((c) => (
                  <li key={c.key}>
                    <label className="flex items-center gap-2" title={c.yield.working}>
                      <Checkbox
                        checked={included.has(c.key)}
                        onCheckedChange={(v) => {
                          const next = new Set(included);
                          if (v === true) next.add(c.key);
                          else next.delete(c.key);
                          setIncluded(next);
                        }}
                      />
                      <span className="tabular-nums">{formatMeasure(c.yield.measurement)}</span>
                      <span className="text-muted-foreground">
                        {c.label}
                        {c.own ? "" : ` · ${TRACE_FIGURE_LABELS[c.figure].toLowerCase()}`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-sm">
            <span className="font-medium tabular-nums">{formatMeasure({ quantity: total, unit: unitWord })}</span>
            {kept.length > 0 && (
              <>
                <span className="text-muted-foreground"> here, with </span>
                <span className="font-medium tabular-nums">
                  {thousandthsToQuantityString(elsewhereThousandths)} {lineUnit}
                </span>
                <span className="text-muted-foreground"> on {kept.map((s) => s.sheetNumber).join(", ")},</span>
              </>
            )}
            <span className="text-muted-foreground"> goes on the line as </span>
            <span className="font-medium tabular-nums">
              {thousandthsToQuantityString(lineTotalThousandths)} {lineUnit}
            </span>
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="to-estimate">Estimate</Label>
            <Select
              value={estimateId}
              onValueChange={(v) => {
                setEstimateId(v);
                setLineId(NEW_LINE);
                setLeftOut(new Set());
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
            <Select
              value={lineId}
              onValueChange={(v) => {
                setLineId(v);
                setLeftOut(new Set());
                if (v !== NEW_LINE) setIncluded((prev) => new Set([...prev, ...behindHere(v, family)]));
              }}
            >
              <SelectTrigger className="w-full" id="to-line">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NEW_LINE}>A new line</SelectItem>
                {(estimate?.lines ?? []).map((l) => {
                  /** A line priced in another unit is shown and cannot be picked: the quantity would be wrong in a way nothing downstream can see. */
                  const takes = unitAccepts(l.unit, lineUnit);
                  return (
                    <SelectItem key={l.id} value={l.id} disabled={!takes}>
                      {l.description} · {thousandthsToQuantityString(l.quantityThousandths)} {l.unit}
                      {takes ? "" : ` · priced per ${l.unit.trim()}, cannot take ${lineUnit}`}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {elsewhere.length > 0 && (
            <div className="space-y-1.5">
              <Label>Already behind this line, on other sheets</Label>
              <ul className="space-y-1 rounded-md border p-2 text-sm">
                {elsewhere.map((s) => (
                  <li key={s.sheetId}>
                    <label className="flex items-center gap-2">
                      <Checkbox
                        checked={!leftOut.has(s.sheetId)}
                        onCheckedChange={(v) => {
                          const next = new Set(leftOut);
                          if (v === true) next.delete(s.sheetId);
                          else next.add(s.sheetId);
                          setLeftOut(next);
                        }}
                      />
                      <span className="font-medium">{s.sheetNumber}</span>
                      <span className="tabular-nums">
                        {thousandthsToQuantityString(s.nowThousandths ?? s.shareThousandths)} {lineUnit}
                      </span>
                      <span className="text-muted-foreground">
                        {s.traces} {s.traces === 1 ? "trace" : "traces"}
                        {s.isCurrent ? "" : " · superseded issue"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">Ticked, they stay behind the line and count in its total. Unticked, they let go.</p>
            </div>
          )}
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

/** The line a link already names, by its id — while the estimate still has it and it can take this unit; else a new line. */
function pushedLineId(estimates: EstimateOption[], link: TakeoffLinkView, lineUnit: string): string {
  const line = estimates.find((e) => e.id === link.estimateId)?.lines.find((l) => l.id === link.lineId);
  return line && unitAccepts(line.unit, lineUnit) ? line.id : NEW_LINE;
}
