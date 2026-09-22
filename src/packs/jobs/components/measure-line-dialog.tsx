"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SheetViewer } from "./sheet-viewer";
import {
  sheetForMeasuringAction,
  sheetsForMeasuringAction,
  type MeasurableSheet,
  type MeasurableSheetView,
} from "../measure-actions";
import { standBehindAction } from "../actions";
import { thousandthsToQuantityString } from "../billing-math";
import { parsePoints } from "../markups-math";
import {
  measure,
  measureKindForUnit,
  takeoffUnitFor,
  toThousandths,
  type LineMeasurements,
} from "../takeoff-math";
import { isMeasureKind, MARKUP_KIND_LABELS, MEASURE_KINDS, type MeasureKind } from "../vocabulary";

/**
 * MEASURED FROM WHERE IT IS PRICED (ADR 0109).
 *
 * The founder: *"I need the takeoff tool to get that a lot of the time."*
 * Every takeoff product works the same way round: you say what you are
 * pricing, then you draw — on as many sheets as it takes — and the figure
 * lands on that item. Here the estimate line is the thing being priced, so
 * the ruler sits on the line, and this dialog is the drawings opened FOR it.
 *
 * ── THE SET FOLLOWS THE LINE ACROSS SHEETS ──────────────────────────────────
 *
 * What stands behind the line is a set of traces on any of the job's sheets,
 * seeded from what stands behind it today. Each sheet lists what it holds;
 * inside a sheet the traces of the line's kind carry a tick, and a trace
 * drawn in here is ticked the moment it is saved. The footer adds the set up
 * across sheets, and *Use* writes the LINK only — the editor sets the line's
 * quantity from what comes back (ADR 0082: the editor holds the estimate).
 *
 * ── THE SAME VIEWER ─────────────────────────────────────────────────────────
 *
 * `SheetViewer` in its `forLine` mode; nothing here draws a sheet or reads a
 * scale. The sheet is a SNAPSHOT, so the viewer's `onChanged` re-reads it and
 * a trace drawn inside the dialog shows up in the dialog.
 */

export interface MeasuredLineResult {
  lineId: string;
  quantityThousandths: number;
  unit: string;
  behind: LineMeasurements | null;
}

export function MeasureLineDialog({
  projectId,
  estimateId,
  line,
  behind,
  onUsed,
  onClose,
}: {
  projectId: string;
  estimateId: string;
  line: { id: string; description: string; unit: string };
  /** What stands behind the line today, if anything. */
  behind: LineMeasurements | null;
  onUsed: (result: MeasuredLineResult) => void;
  onClose: () => void;
}) {
  const fixedKind = measureKindForUnit(line.unit);
  /** A blank unit takes the kind from what is behind the line, else asks. */
  const [kind, setKind] = useState<MeasureKind | null>(
    fixedKind === "ask" || fixedKind === null ? (behind?.kind ?? null) : fixedKind,
  );
  const [sheets, setSheets] = useState<MeasurableSheet[] | null>(null);
  const [sheet, setSheet] = useState<MeasurableSheetView | null>(null);
  const [opening, setOpening] = useState(false);
  const [saving, startSaving] = useTransition();
  /** Which traces stand behind the line, by sheet — seeded from what does today. */
  const [selected, setSelected] = useState<Map<string, Set<string>>>(() => {
    const seed = new Map<string, Set<string>>();
    for (const s of behind?.sheets ?? []) seed.set(s.sheetId, new Set(s.markupIds));
    return seed;
  });
  /** Each trace's quantity in thousandths, learned when its sheet is opened or it is drawn. */
  const [quantities, setQuantities] = useState<Map<string, number>>(new Map());
  const kicked = useRef(false);

  useEffect(() => {
    if (kicked.current) return;
    kicked.current = true;
    void sheetsForMeasuringAction({ projectId, estimateId, lineId: line.id })
      .then((r) => {
        if ("error" in r) {
          toast.error(r.error);
          setSheets([]);
          return;
        }
        setSheets(r.sheets);
      })
      .catch(() => {
        toast.error("The drawings did not load. Try again.");
        setSheets([]);
      });
  }, [projectId, estimateId, line.id]);

  /** Open a sheet, and learn what every trace of the line's kind on it comes to. */
  function pick(id: string) {
    setOpening(true);
    void sheetForMeasuringAction({ projectId, sheetId: id })
      .then((r) => {
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        setSheet(r.view);
        if (!kind) return;
        setQuantities((prev) => {
          const next = new Map(prev);
          for (const m of r.view.markups) {
            if (!isMeasureKind(m.kind) || m.kind !== kind) continue;
            const q = measure(m.kind, parsePoints(m.kind, m.geometry), r.view.scale);
            if (q) next.set(m.id, toThousandths(q.quantity));
          }
          return next;
        });
      })
      .catch(() => toast.error("That sheet did not open. Try again."))
      .finally(() => setOpening(false));
  }

  function toggle(sheetId: string, markupId: string, on: boolean, quantityThousandths: number) {
    setQuantities((prev) => new Map(prev).set(markupId, quantityThousandths));
    setSelected((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(sheetId) ?? []);
      if (on) set.add(markupId);
      else set.delete(markupId);
      if (set.size === 0) next.delete(sheetId);
      else next.set(sheetId, set);
      return next;
    });
  }

  const unit = kind ? takeoffUnitFor(kind, sheet?.scale?.unit ?? "") : line.unit.trim();
  const numberOf = (sheetId: string) =>
    behind?.sheets.find((s) => s.sheetId === sheetId)?.sheetNumber ??
    sheets?.find((s) => s.id === sheetId)?.label.split(" · ")[0] ??
    "";
  /**
   * A sheet's total: its ticked traces' quantities when every one is known,
   * else what the drawings say they come to today — a sheet nobody opened in
   * this dialog still counts for what stands behind the line there.
   */
  function sheetTotal(sheetId: string, ids: ReadonlySet<string>): number {
    let sum = 0;
    for (const id of ids) {
      const q = quantities.get(id);
      if (q === undefined) {
        const was = behind?.sheets.find((s) => s.sheetId === sheetId);
        return was ? (was.nowThousandths ?? was.shareThousandths) : 0;
      }
      sum += q;
    }
    return sum;
  }
  const parts = [...selected.entries()]
    .filter(([, ids]) => ids.size > 0)
    .map(([sheetId, ids]) => ({ sheetId, number: numberOf(sheetId), thousandths: sheetTotal(sheetId, ids), traces: ids.size }));
  const total = parts.reduce((s, p) => s + p.thousandths, 0);
  const anything = parts.length > 0;
  const lettingGo = !anything && behind !== null;

  function use() {
    startSaving(async () => {
      const markupIds = [...selected.values()].flatMap((ids) => [...ids]);
      try {
        const result = await standBehindAction({ projectId, estimateId, lineId: line.id, markupIds });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        onUsed({ lineId: result.lineId, quantityThousandths: result.quantityThousandths, unit: result.unit, behind: result.behind });
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  const qty = (t: number) => `${thousandthsToQuantityString(t)} ${unit}`;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[min(96rem,calc(100vw-3rem))]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {sheet && (
              <Button type="button" variant="ghost" size="icon" className="size-7" onClick={() => setSheet(null)} aria-label="Back to the sheets">
                <ChevronLeft className="size-4" />
              </Button>
            )}
            {line.description.trim() || "This line"}
            {unit ? <span className="text-muted-foreground">· {unit}</span> : null}
          </DialogTitle>
          <DialogDescription>
            {fixedKind === null
              ? `This line is priced per ${line.unit.trim()}; a drawing measures lf, sf or ea. Change the unit, or type the quantity.`
              : !kind
                ? "How does a drawing measure this line?"
                : sheet
                  ? "Draw on the sheet, or tick the traces that stand behind this line. The total below follows across sheets."
                  : "Pick a sheet. Each says what already stands behind this line there."}
          </DialogDescription>
        </DialogHeader>

        {fixedKind !== null && !kind && (
          <div className="flex flex-wrap gap-2">
            {MEASURE_KINDS.map((k) => (
              <Button key={k} type="button" variant="outline" size="sm" onClick={() => setKind(k)}>
                {MARKUP_KIND_LABELS[k]}
                <span className="ml-1 text-muted-foreground">· {takeoffUnitFor(k, "")}</span>
              </Button>
            ))}
          </div>
        )}

        {kind && sheet ? (
          <SheetViewer
            url={sheet.url}
            page={sheet.page}
            label={sheet.label}
            sheetId={sheet.sheetId}
            projectId={sheet.projectId}
            markups={sheet.markups}
            canEdit
            scale={sheet.scale}
            /** The quantity goes to the line through this dialog, never through the viewer's own Takeoff. */
            estimates={[]}
            codes={[]}
            onChanged={() => pick(sheet.sheetId)}
            forLine={{
              kind,
              description: line.description.trim() || "this line",
              selected: selected.get(sheet.sheetId) ?? new Set<string>(),
              onToggle: (markupId, on, q) => toggle(sheet.sheetId, markupId, on, q),
              busy: saving,
            }}
          />
        ) : kind && (sheets === null || opening) ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Looking…</p>
        ) : kind && sheets && sheets.length > 0 ? (
          <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border text-sm">
            {sheets.map((s) => {
              const ids = selected.get(s.id);
              const here = ids && ids.size > 0 ? sheetTotal(s.id, ids) : null;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-baseline gap-x-2 px-3 py-2 text-left hover:bg-muted"
                    onClick={() => pick(s.id)}
                  >
                    <span className="font-medium">{s.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {s.setName}, {s.issuedOn}
                      {s.hasScale ? "" : " · no scale set yet"}
                    </span>
                    {here !== null && ids && (
                      <span className="ml-auto text-xs tabular-nums">
                        {qty(here)} <span className="text-muted-foreground">· {ids.size} {ids.size === 1 ? "trace" : "traces"} behind this line</span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : kind && sheets ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No drawings on this job yet. Type the quantity instead, or add a set under Drawings.
          </p>
        ) : null}

        {kind && (
          <DialogFooter className="flex-row flex-wrap items-center justify-between gap-3 sm:justify-between">
            <p className="text-sm">
              {anything ? (
                <>
                  <span className="text-muted-foreground">So far </span>
                  {parts.map((p, i) => (
                    <span key={p.sheetId} className="tabular-nums">
                      {i > 0 ? <span className="text-muted-foreground"> + </span> : null}
                      <span className="font-medium">{p.number}</span> {qty(p.thousandths)}
                    </span>
                  ))}
                  {parts.length > 1 && (
                    <>
                      <span className="text-muted-foreground"> = </span>
                      <span className="font-medium tabular-nums">{qty(total)}</span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">Nothing stands behind this line yet.</span>
              )}
            </p>
            <span className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={use} disabled={saving || (!anything && !lettingGo)}>
                {saving ? "Working…" : lettingGo ? "Let the drawings go" : `Use ${qty(total)} on the line`}
              </Button>
            </span>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
