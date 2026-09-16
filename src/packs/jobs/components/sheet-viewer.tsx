"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Cloud, Hand, Loader2, MapPin, Maximize, Minus, MoveUpRight, Pencil, Plus, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { loadPdfjs } from "@/modules/documents/components/pdf-canvas";
import { addMarkupAction, deleteMarkupAction, setPunchDoneAction, updateMarkupAction } from "../actions";
import { MIN_EXTENT, arrowHead, clampFraction, cloudPath, markupSentence, normaliseBox, pinNumbers, summariseMarkups } from "../markups-math";
import { MARKUP_COLORS, MARKUP_COLOR_HEX, MARKUP_COLOR_LABELS, MARKUP_KIND_LABELS, type MarkupColor, type MarkupKind } from "../vocabulary";
import { StatusBadge } from "./status-badge";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
/** The canvas is drawn at device resolution up to this many pixels; past it the sharpness gives way to memory. */
const PIXEL_CAP = 24_000_000;

export interface MarkupView {
  id: string;
  kind: MarkupKind;
  color: MarkupColor;
  geometry: Record<string, number>;
  text: string;
  version: number;
  /** The day it was drawn, in the tenant's zone. */
  createdOn: string;
  createdBy: string;
  workItemId: string | null;
  punch: { title: string; done: boolean; dueOn: string | null } | null;
}

type Tool = "select" | MarkupKind;

interface Draft {
  kind: "cloud" | "arrow";
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

/**
 * One sheet, large, and what is drawn on it (ADR 0073). The page is drawn by
 * pdf.js onto a canvas — the cabinet's trick, a stored PDF is never framed —
 * and the markups are an SVG laid over it in the page's own units, so a
 * cloud is the same cloud at every zoom. Coordinates leave here as fractions
 * of the page and come back the same way.
 *
 * The file is fetched ONCE and kept; zooming re-renders the page from the
 * parsed document. Two fingers pinch, one finger or the mouse drags the
 * sheet about, the wheel with ctrl zooms, and a tool turns the same drag
 * into a cloud or an arrow.
 */
export function SheetViewer({
  url,
  page,
  label,
  sheetId,
  projectId,
  markups,
  canEdit,
}: {
  url: string;
  page: number;
  label: string;
  sheetId: string;
  projectId: string;
  markups: MarkupView[];
  canEdit: boolean;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: "text" | "pin"; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<MarkupView | null>(null);
  const [saving, startTransition] = useTransition();
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pan = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);
  const pinch = useRef<{ startDist: number; startZoom: number; midX: number; midY: number; scrollLeft: number; scrollTop: number } | null>(null);

  // --- the box's width, the document, the page ---------------------------
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
        setPageSize({ w: base.width, h: base.height });
        const scale = (boxWidth * zoom) / base.width;
        const viewport = pdfPage.getViewport({ scale });
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

  function toFraction(e: ReactPointerEvent): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: clampFraction((e.clientX - rect.left) / rect.width), y: clampFraction((e.clientY - rect.top) / rect.height) };
  }

  function scrollTo(m: MarkupView) {
    const box = boxRef.current;
    if (!box || cssW === 0) return;
    const g = m.geometry;
    const cx = m.kind === "cloud" ? g.x + g.w / 2 : m.kind === "arrow" ? (g.x1 + g.x2) / 2 : g.x;
    const cy = m.kind === "cloud" ? g.y + g.h / 2 : m.kind === "arrow" ? (g.y1 + g.y2) / 2 : g.y;
    box.scrollTo({ left: cx * cssW - box.clientWidth / 2, top: cy * cssH - box.clientHeight / 2, behavior: "smooth" });
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
    } else {
      setPending({ kind: tool, x: f.x, y: f.y });
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

  function submit(input: { kind: MarkupKind; geometry: Record<string, number>; text?: string; raise?: boolean; dueOn?: string }) {
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
          <p className="text-xs text-muted-foreground">Drag to move about; pinch or ctrl+wheel to zoom.</p>
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
        <p className="text-xs text-muted-foreground">
          {tool === "cloud"
            ? "Drag a box around what changed."
            : tool === "arrow"
              ? "Drag from where the arrow starts to what it points at."
              : tool === "text"
                ? "Tap where the note goes."
                : "Tap where the problem is; the pin goes on the punch list."}{" "}
          Esc goes back to moving about.
        </p>
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
                <Shape key={m.id} markup={m} W={W} H={H} unit={unit} number={numbers.get(m.id)} selected={m.id === selectedId} />
              ))}
              {draft && <DraftShape draft={draft} color={color} W={W} H={H} unit={unit} />}
            </svg>
          )}
        </div>
      </div>

      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Markups</h3>
          <span className="text-xs text-muted-foreground">{markupSentence(summary)}</span>
        </div>
        {markups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {canEdit ? "Pick a tool above and draw on the sheet. A pin puts what needs doing on the job's punch list." : "Nothing drawn on this issue."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {markups.map((m) => (
              <MarkupRowView
                key={m.id}
                markup={m}
                number={numbers.get(m.id)}
                selected={m.id === selectedId}
                canEdit={canEdit}
                busy={saving}
                projectId={projectId}
                sheetId={sheetId}
                onSelect={() => {
                  setSelectedId(m.id);
                  scrollTo(m);
                }}
                onEdit={() => setEditing(m)}
              />
            ))}
          </ul>
        )}
        {selected && <p className="mt-1 text-xs text-muted-foreground">Selected: {describe(selected, numbers.get(selected.id))}. Esc clears.</p>}
      </div>

      <PointDialog
        pending={pending}
        color={color}
        busy={saving}
        onClose={() => setPending(null)}
        onSave={(text, raise, dueOn) => pending && submit({ kind: pending.kind, geometry: { x: pending.x, y: pending.y }, text, raise, dueOn })}
      />
      <EditDialog markup={editing} projectId={projectId} sheetId={sheetId} onClose={() => setEditing(null)} />
    </div>
  );
}

function describe(m: MarkupView, number: number | undefined): string {
  if (m.kind === "pin") return `pin ${number ?? ""} · ${m.text}`;
  if (m.kind === "text") return `note · ${m.text}`;
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

/** A markup in the page's units. Strokes keep two screen pixels at any zoom. */
function Shape({ markup: m, W, H, unit, number, selected }: { markup: MarkupView; W: number; H: number; unit: number; number?: number; selected: boolean }) {
  const hex = MARKUP_COLOR_HEX[m.color];
  const g = m.geometry;
  if (m.kind === "cloud") {
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }}>
        <path
          d={cloudPath(g.x * W, g.y * H, g.w * W, g.h * H, 14 * unit)}
          fill="none"
          stroke={hex}
          strokeWidth={selected ? 3.5 : 2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
        />
        <rect x={g.x * W} y={g.y * H} width={g.w * W} height={g.h * H} fill="transparent" />
      </g>
    );
  }
  if (m.kind === "arrow") {
    const [hx1, hy1, hx2, hy2] = arrowHead(g.x1 * W, g.y1 * H, g.x2 * W, g.y2 * H, 12 * unit);
    return (
      <g data-markup={m.id} style={{ cursor: "pointer" }}>
        <line x1={g.x1 * W} y1={g.y1 * H} x2={g.x2 * W} y2={g.y2 * H} stroke={hex} strokeWidth={selected ? 3.5 : 2} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
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

function MarkupRowView({
  markup: m,
  number,
  selected,
  canEdit,
  busy,
  projectId,
  sheetId,
  onSelect,
  onEdit,
}: {
  markup: MarkupView;
  number?: number;
  selected: boolean;
  canEdit: boolean;
  busy: boolean;
  projectId: string;
  sheetId: string;
  onSelect: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [armed, setArmed] = useState(false);
  const hex = MARKUP_COLOR_HEX[m.color];

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

  return (
    <li className={`flex flex-wrap items-center gap-2 px-3 py-2 ${selected ? "bg-secondary/60" : ""}`}>
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: hex }}>
          {m.kind === "pin" ? (number ?? "") : m.kind === "cloud" ? "◌" : m.kind === "arrow" ? "→" : "A"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{m.text || MARKUP_KIND_LABELS[m.kind]}</span>
          <span className="block text-xs text-muted-foreground">
            {MARKUP_KIND_LABELS[m.kind]}
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
      {canEdit && (
        <span className="flex items-center gap-1">
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
