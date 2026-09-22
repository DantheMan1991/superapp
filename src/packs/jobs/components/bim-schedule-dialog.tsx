"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScheduleInput } from "./schedule-input";
import type { SchedulePreview } from "../bim-schedule-ops";
import { importBimScheduleAction, previewBimScheduleAction } from "../walk-actions";
import type { WalkView } from "../walk-ops";

/**
 * A SCHEDULE OFF THE MODEL (X14, ADR 0106).
 *
 * The founder draws in Revit, and every number the measure-up asks for is in
 * the model before anybody opens a PDF: *File → Export → Reports → Schedule*
 * writes a text file, and this dialog reads it. Drop the file or paste it;
 * the preview says what it found — the rooms with their floors and areas,
 * each quantity column with its total — and which of the outline's
 * measurements each column looks like. **A person confirms every match.**
 * The words in a header are a suggestion, never a decision, because a wrong
 * measurement multiplies through every line that reads it.
 *
 * The file becomes text in `ScheduleInput`, the one decoder the measure-up
 * and the takeoff share, and the server reads that text for the preview and
 * again for the write. Nothing this component holds describes a row.
 */

const SELECT =
  "h-8 max-w-full rounded-md border border-input bg-background px-2 text-sm";

export function BimScheduleDialog({
  interviewId,
  onDone,
  label = "From the model",
  size = "sm",
}: {
  interviewId: string;
  /** The walk's fresh view once the numbers are on the building. */
  onDone: (view: WalkView | null, finished: boolean) => void;
  label?: string;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  /** Column index → "measureId|total" or "measureId|each"; "" leaves it. */
  const [picks, setPicks] = useState<Record<number, string>>({});
  const [rowsPick, setRowsPick] = useState("");
  const [addRooms, setAddRooms] = useState(true);
  const [pending, startTransition] = useTransition();

  function reset() {
    setText("");
    setFileName("");
    setPreview(null);
    setPicks({});
    setRowsPick("");
    setAddRooms(true);
  }

  function look(next: string, name: string) {
    startTransition(async () => {
      try {
        const result = await previewBimScheduleAction({ interviewId, text: next, fileName: name });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setPreview(result.preview);
        /**
         * The words already agree: start from what the file looks like —
         * unless every row carries the same figure, when only the person
         * can say whether the total or that figure is wanted, and the row
         * says which measurement it looks like instead.
         */
        const suggested: Record<number, string> = {};
        for (const s of result.preview.suggested) {
          if (s.use) suggested[s.column] = `${s.measureId}|${s.use}`;
        }
        setPicks(suggested);
        setRowsPick("");
        setAddRooms(true);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  const choices: { measureId: string; column: number | null; use: "total" | "each" | "rows" }[] =
    Object.entries(picks)
      .filter(([, v]) => v !== "")
      .map(([column, v]) => {
        const [measureId, use] = v.split("|");
        return { measureId, column: Number(column), use: use === "each" ? "each" : "total" };
      });
  if (rowsPick !== "") choices.push({ measureId: rowsPick, column: null, use: "rows" });
  const roomsToAdd = addRooms && preview?.rooms !== null && (preview?.rooms?.count ?? 0) > 0;
  const anything = choices.length > 0 || roomsToAdd;

  function commit() {
    if (!preview || !anything) return;
    startTransition(async () => {
      try {
        const result = await importBimScheduleAction({
          interviewId,
          text,
          fileName,
          rooms: roomsToAdd,
          choices,
        });
        if ("error" in result) {
          toast.error(result.error);
          if (result.view) onDone(result.view, false);
          return;
        }
        const bits: string[] = [];
        for (const m of result.imported.measured) bits.push(`${m.name} ${m.figure}`);
        if (result.imported.rooms) {
          const r = result.imported.rooms;
          if (r.added > 0) bits.push(`${r.added} ${r.added === 1 ? "room" : "rooms"} added`);
          if (r.alreadyThere > 0) bits.push(`${r.alreadyThere} already there`);
        }
        toast.success(bits.length > 0 ? bits.join(" · ") : "Nothing new to bring in.");
        /** Nothing is refused quietly — the walk would only ask again. */
        if (result.imported.refused.length > 0) {
          toast.message(
            `${result.imported.refused.length} not written`,
            { description: result.imported.refused.map((r) => `${r.name}: ${r.reason}`).join(" · ") },
          );
        }
        setOpen(false);
        reset();
        onDone(result.view, !!result.finished);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  const rooms = preview?.rooms ?? null;
  const levels = rooms ? [...new Set(rooms.list.map((r) => r.level))] : [];
  const measureById = new Map((preview?.measures ?? []).map((m) => [m.id, m]));

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={size === "xs" ? "h-7 px-2 text-xs" : undefined}
        onClick={() => setOpen(true)}
      >
        <FileSpreadsheet className="mr-1.5 size-4" /> {label}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>A schedule off the model</DialogTitle>
            <DialogDescription>
              Export any schedule from your model — in Revit, <span className="whitespace-nowrap">File → Export → Reports → Schedule</span> — and drop the file here, or paste it. Rooms come in as rooms; a column&apos;s total goes against a measurement you pick.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <ScheduleInput
              text={text}
              fileName={fileName}
              pending={pending}
              showRead={preview === null}
              onChange={(next, name, read) => {
                setText(next);
                setFileName(name);
                setPreview(null);
                if (read) look(next, name);
              }}
              onRead={() => look(text, fileName)}
              placeholder={
                '"Room Schedule"\n"Number"\t"Name"\t"Level"\t"Area"\n"101"\t"Kitchen"\t"Level 1"\t"310 SF"'
              }
            />

            {preview && (
              <div className="space-y-4 rounded-md border p-3 text-sm">
                <p>
                  <span className="font-medium">{preview.title || preview.fileName || "The schedule"}</span>
                  <span className="text-muted-foreground">
                    {" "}— {preview.rowCount} {preview.rowCount === 1 ? "row" : "rows"}
                    {preview.footers > 0 &&
                      `, ${preview.footers} total ${preview.footers === 1 ? "row" : "rows"} left out`}
                  </span>
                </p>

                {rooms && (
                  <div>
                    <label className="flex cursor-pointer items-center gap-2 font-medium">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={addRooms}
                        onChange={(e) => setAddRooms(e.target.checked)}
                      />
                      Add the rooms — {rooms.count} on {levels.length}{" "}
                      {levels.length === 1 ? "floor" : "floors"}, {rooms.withArea} with an area
                    </label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Read from {rooms.nameHeader}
                      {rooms.levelHeader !== "" && `, ${rooms.levelHeader}`}
                      {rooms.areaHeader !== "" && ` and ${rooms.areaHeader}`}.
                      {rooms.alreadyThere > 0 &&
                        ` ${rooms.alreadyThere} ${rooms.alreadyThere === 1 ? "is" : "are"} already on the job — ${rooms.alreadyThere === 1 ? "its" : "their"} area is updated, nothing is doubled.`}
                    </p>
                    <ul className="mt-2 max-h-40 overflow-y-auto rounded-md border text-xs">
                      {levels.map((level) => (
                        <li key={level || "__none__"}>
                          {level.trim() !== "" && (
                            <p className="bg-muted/50 px-2 py-1 font-medium">{level}</p>
                          )}
                          {rooms.list
                            .filter((r) => r.level === level)
                            .map((r) => (
                              <p
                                key={`${r.level}/${r.name}`}
                                className="flex justify-between gap-3 px-2 py-0.5"
                              >
                                <span className={r.alreadyThere ? "text-muted-foreground" : undefined}>
                                  {r.name}
                                  {r.alreadyThere && " · already there"}
                                </span>
                                <span className={r.area === null ? "italic text-muted-foreground" : undefined}>
                                  {r.area ?? "no area"}
                                </span>
                              </p>
                            ))}
                        </li>
                      ))}
                    </ul>
                    {rooms.skipped.length > 0 && (
                      <div className="mt-2 rounded-md bg-warning/20 p-2">
                        <p className="flex items-center gap-1.5 text-xs font-medium text-warning-foreground">
                          <AlertTriangle className="size-3.5" />
                          {rooms.skipped.length} {rooms.skipped.length === 1 ? "row" : "rows"} not taken
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {rooms.skipped.slice(0, 5).map((s) => (
                            <li key={s.line} className="text-xs text-muted-foreground">
                              Line {s.line}: {s.reason}
                            </li>
                          ))}
                          {rooms.skipped.length > 5 && (
                            <li className="text-xs text-muted-foreground">
                              and {rooms.skipped.length - 5} more
                            </li>
                          )}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <p className="font-medium">The building&apos;s numbers</p>
                  {preview.measures.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      This outline has no measure-first list, so there is nothing to put a total
                      against. Add one on the outline page and the columns below become choices.
                    </p>
                  ) : preview.columns.length === 0 && preview.countMeasures.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No column in this file holds figures.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {preview.columns.map((c) => {
                        const takers = c.canTake.map((id) => measureById.get(id)).filter((m) => !!m);
                        const open = preview.suggested.find((s) => s.column === c.index && s.use === null);
                        const looksLike = open ? measureById.get(open.measureId) : undefined;
                        return (
                          <li key={c.index} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <span className="min-w-32 font-medium">{c.header}</span>
                            <span className="text-xs text-muted-foreground">
                              {c.total}
                              {c.count > 1 && ` across ${c.count} rows`}
                              {c.each !== null && ` · ${c.each} on every row`}
                              {c.unit === "" && " · no unit in the file"}
                            </span>
                            {takers.length === 0 ? (
                              <span className="text-xs italic text-muted-foreground">
                                nothing on the list is {c.dimension === null ? "a bare number" : `${c.dimension === "area" ? "an" : "a"} ${c.dimension}`}
                              </span>
                            ) : (
                              <select
                                className={SELECT}
                                value={picks[c.index] ?? ""}
                                aria-label={`What ${c.header} answers`}
                                onChange={(e) => setPicks((was) => ({ ...was, [c.index]: e.target.value }))}
                              >
                                <option value="">— leave it</option>
                                {takers.map((m) => (
                                  <optgroup key={m.id} label={m.has ? `${m.name} (now ${m.has})` : m.name}>
                                    <option value={`${m.id}|total`}>
                                      {m.name} ← {c.total}
                                      {c.count > 1 ? " (the total)" : ""}
                                    </option>
                                    {c.each !== null && (
                                      <option value={`${m.id}|each`}>
                                        {m.name} ← {c.each} (the same on every row)
                                      </option>
                                    )}
                                  </optgroup>
                                ))}
                              </select>
                            )}
                            {looksLike && (picks[c.index] ?? "") === "" && (
                              <span className="text-xs text-muted-foreground">
                                looks like {looksLike.name} — the total, or the figure on every row?
                              </span>
                            )}
                          </li>
                        );
                      })}
                      {preview.countMeasures.length > 0 && (
                        <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span className="min-w-32 font-medium">Rows</span>
                          <span className="text-xs text-muted-foreground">{preview.rowCount}</span>
                          <select
                            className={SELECT}
                            value={rowsPick}
                            aria-label="What the row count answers"
                            onChange={(e) => setRowsPick(e.target.value)}
                          >
                            <option value="">— leave it</option>
                            {preview.countMeasures.map((id) => {
                              const m = measureById.get(id);
                              return m ? (
                                <option key={id} value={id}>
                                  {m.name} ← {preview.rowCount}
                                </option>
                              ) : null;
                            })}
                          </select>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={commit} disabled={pending || !preview || !anything}>
              {pending ? "Working…" : "Bring it in"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
