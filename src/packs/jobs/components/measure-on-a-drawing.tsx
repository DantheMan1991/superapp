"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeft, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { measureFromSheetAction } from "../walk-actions";
import type { WalkView } from "../walk-ops";
import type { MeasureKind } from "../vocabulary";

/**
 * THE DRAWINGS, OVER THE WALK (X7).
 *
 * The founder: *"I don't see where it allows you to open the takeoff
 * inline. Everything should be seamless and snappy and just part of the
 * flow. There are numerous times it asks for a square footage. I need the
 * takeoff tool to get that a lot of the time."*
 *
 * ── IT IS THE SAME VIEWER, NOT A SECOND ONE ─────────────────────────────────
 *
 * `SheetViewer` is a thousand lines of pdf.js, scale and geometry, and a
 * cut-down copy of it inside the walk would be a second thing to keep
 * right — which is the mistake this pack has already made once, with four
 * hand-rolled copies of one answer shape. It takes one new optional prop
 * and behaves exactly as it does on the drawings page without it.
 *
 * ── NOTHING IS LOADED UNTIL IT IS OPENED ────────────────────────────────────
 *
 * The sheets, the markups and the PDF are all fetched on demand. A walk
 * that never reaches for a drawing pays nothing for this, which matters:
 * the founder has already had to say this screen felt slow once.
 */
export function MeasureOnADrawing({
  interviewId,
  projectId,
  measure,
  onMeasured,
}: {
  interviewId: string;
  projectId: string;
  measure: { name: string; unit: string; kind: MeasureKind };
  /** The fresh walk view, so the screen never has to guess what changed. */
  onMeasured: (view: WalkView | null, finished: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [sheets, setSheets] = useState<MeasurableSheet[] | null>(null);
  const [sheet, setSheet] = useState<MeasurableSheetView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, startSaving] = useTransition();

  function openIt() {
    setOpen(true);
    if (sheets) return;
    setLoading(true);
    void sheetsForMeasuringAction({ projectId })
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
      })
      .finally(() => setLoading(false));
  }

  function pick(id: string) {
    setLoading(true);
    void sheetForMeasuringAction({ projectId, sheetId: id })
      .then((r) => {
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        setSheet(r.view);
      })
      .catch(() => toast.error("That sheet did not open. Try again."))
      .finally(() => setLoading(false));
  }

  function use(valueThousandths: number, markupId: string | null, note: string) {
    startSaving(async () => {
      try {
        const result = await measureFromSheetAction({
          interviewId,
          valueThousandths,
          sheetId: sheet?.sheetId ?? "",
          markupId: markupId ?? undefined,
          note: `${note}${sheet ? ` · ${sheet.label}` : ""}`.slice(0, 200),
        });
        if ("error" in result) {
          toast.error(result.error);
          /** The view comes back even on a failure, so the screen stays true. */
          if (result.view) onMeasured(result.view, false);
          return;
        }
        setOpen(false);
        setSheet(null);
        onMeasured(result.view ?? null, result.finished);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={openIt}>
        <Ruler className="mr-1.5 size-4" /> Measure it on a drawing
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          /** Leaving goes back to the list, not back into the last sheet. */
          if (!next) setSheet(null);
        }}
      >
        <DialogContent className="sm:max-w-[min(96rem,calc(100vw-3rem))]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {sheet && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => setSheet(null)}
                  aria-label="Back to the sheets"
                >
                  <ChevronLeft className="size-4" />
                </Button>
              )}
              {measure.name}
              {measure.unit ? <span className="text-muted-foreground">· {measure.unit}</span> : null}
            </DialogTitle>
            <DialogDescription>
              {sheet
                ? "Draw it, then use the number. It goes on the job, so every question after this one can read it."
                : "Pick the sheet it is on."}
            </DialogDescription>
          </DialogHeader>

          {sheet ? (
            <SheetViewer
              url={sheet.url}
              page={sheet.page}
              label={sheet.label}
              sheetId={sheet.sheetId}
              projectId={sheet.projectId}
              markups={sheet.markups}
              canEdit
              scale={sheet.scale}
              /** Nothing to push a quantity onto from in here: the number
               *  is going to the building, not to an estimate line. */
              estimates={[]}
              codes={[]}
              measuringFor={{
                name: measure.name,
                unit: measure.unit,
                kind: measure.kind,
                busy: saving,
                onUse: use,
              }}
            />
          ) : loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Looking…</p>
          ) : sheets && sheets.length > 0 ? (
            <ul className="max-h-[60vh] divide-y overflow-y-auto rounded-md border text-sm">
              {sheets.map((s) => (
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
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No drawings on this job yet. Type the number instead, or add a set under Drawings.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
