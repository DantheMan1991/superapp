"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { ScheduleInput } from "./schedule-input";
import {
  previewTakeoffAction,
  takeoffFromModelAction,
  type TakeoffPreview,
  type TakeoffResult,
} from "../bim-takeoff-actions";

/**
 * THE TAKEOFF OFF THE MODEL (X15, ADR 0107).
 *
 * The founder: *"Lumber takeoff, drywall etc from the model."* A wall
 * schedule, a material takeoff or a framing schedule is things with
 * quantities; an assembly is what the business builds a thing out of. This
 * dialog is the join: each thing the model names, with its figures, and a
 * choice — the assembly it means, dropped at the figure the model states;
 * or the thing as a plain line by one of its figures; or leave it out.
 *
 * **A name the business has mapped before maps itself**, marked
 * *remembered*. One the words plainly point at is suggested and ticked to be
 * remembered on confirmation. Everything else waits for the person, because
 * a takeoff that guessed which assembly a wall type meant would price the
 * wrong wall with perfect confidence.
 */

const SELECT =
  "h-8 max-w-full rounded-md border border-input bg-background px-2 text-sm";

type Pick = { kind: "assembly"; id: string } | { kind: "line"; from: string } | null;

function parsePick(value: string): Pick {
  if (value.startsWith("asm:")) return { kind: "assembly", id: value.slice(4) };
  if (value.startsWith("line:")) return { kind: "line", from: value.slice(5) };
  return null;
}

export function BimTakeoffDialog({
  projectId,
  open,
  onOpenChange,
  onDone,
  symbol,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The items and lines the model made, for the editor to append. */
  onDone: (result: TakeoffResult) => void;
  symbol: string | null;
}) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<TakeoffPreview | null>(null);
  /** Row key → "asm:<id>" | "line:<header>" | "line:count" | "". */
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();

  function reset() {
    setText("");
    setFileName("");
    setPreview(null);
    setPicks({});
    setRemember({});
  }

  function look(next: string, name: string) {
    startTransition(async () => {
      try {
        const result = await previewTakeoffAction({ projectId, text: next, fileName: name });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        setPreview(result.preview);
        const starts: Record<string, string> = {};
        const ticks: Record<string, boolean> = {};
        for (const row of result.preview.rows) {
          if (!row.match) continue;
          /** Only an assembly the row can actually drive is a match worth starting from. */
          if (!row.canDrive.some((c) => c.assemblyId === row.match?.assemblyId)) continue;
          starts[row.key] = `asm:${row.match.assemblyId}`;
          ticks[row.key] = row.match.how === "words";
        }
        setPicks(starts);
        setRemember(ticks);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  const assemblyById = new Map((preview?.assemblies ?? []).map((a) => [a.id, a]));
  const choices: { key: string; assemblyId?: string; lineFrom?: string; remember?: boolean }[] = [];
  for (const row of preview?.rows ?? []) {
    const pick = parsePick(picks[row.key] ?? "");
    if (!pick) continue;
    if (pick.kind === "assembly") {
      const already = row.match?.how === "remembered" && row.match.assemblyId === pick.id;
      choices.push({ key: row.key, assemblyId: pick.id, remember: !already && (remember[row.key] ?? false) });
    } else {
      choices.push({ key: row.key, lineFrom: pick.from });
    }
  }
  const itemCount = choices.filter((c) => "assemblyId" in c).length;
  const lineCount = choices.length - itemCount;

  function commit() {
    if (!preview || choices.length === 0) return;
    startTransition(async () => {
      try {
        const result = await takeoffFromModelAction({ projectId, text, fileName, choices });
        if ("error" in result) {
          toast.error(result.error);
          return;
        }
        const r = result.result;
        const bits: string[] = [];
        if (r.items.length > 0) bits.push(`${r.items.length} ${r.items.length === 1 ? "item" : "items"}`);
        if (r.loose.length > 0) bits.push(`${r.loose.length} ${r.loose.length === 1 ? "line" : "lines"}`);
        if (r.remembered > 0) bits.push(`${r.remembered} ${r.remembered === 1 ? "name" : "names"} remembered`);
        toast.success(bits.length > 0 ? `Added ${bits.join(", ")} off the model` : "Nothing to add.");
        /** Nothing refused is refused quietly — a wall nobody priced is the omission that eats the margin. */
        if (r.refused.length > 0) {
          toast.message(`${r.refused.length} not brought in`, {
            description: r.refused.map((x) => `${x.key}: ${x.reason}`).join(" · "),
          });
        }
        onOpenChange(false);
        reset();
        onDone(r);
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>A takeoff off the model</DialogTitle>
          <DialogDescription>
            Export a wall schedule, a material takeoff or a framing schedule from your model — in Revit, <span className="whitespace-nowrap">File → Export → Reports → Schedule</span> — and drop the file here, or paste it. Each thing it names comes in as the assembly it means, at the figure the model states, or as a line.
          </DialogDescription>
        </DialogHeader>

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
            '"Wall Schedule"\n"Family and Type"\t"Count"\t"Length"\t"Area"\n"Basic Wall: Exterior - 2x6"\t"12"\t"248\' - 0""\t"2,232 SF"'
          }
        />

        {preview && (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p>
              <span className="font-medium">{preview.title || preview.fileName || "The schedule"}</span>
              <span className="text-muted-foreground">
                {" "}— {preview.rows.length} {preview.rows.length === 1 ? "thing" : "things"} across{" "}
                {preview.rowCount} {preview.rowCount === 1 ? "row" : "rows"}
                {preview.keyHeader !== "" && `, named by ${preview.keyHeader}`}
                {preview.footers > 0 && `, ${preview.footers} total ${preview.footers === 1 ? "row" : "rows"} left out`}
                {preview.unnamed > 0 && `, ${preview.unnamed} unnamed ${preview.unnamed === 1 ? "row" : "rows"} left out`}
              </span>
            </p>

            {preview.rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No column in this file names things. A wall schedule has <em>Family and Type</em>, a
                material takeoff <em>Material: Name</em>, a framing schedule <em>Type</em>.
              </p>
            ) : (
              <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-md border">
                {preview.rows.map((row) => {
                  const value = picks[row.key] ?? "";
                  const pick = parsePick(value);
                  const chosen = pick?.kind === "assembly" ? assemblyById.get(pick.id) : undefined;
                  const at = pick?.kind === "assembly" ? row.canDrive.find((c) => c.assemblyId === pick.id)?.at : undefined;
                  const remembered = row.match?.how === "remembered";
                  return (
                    <li key={row.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" title={row.key}>{row.key}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.count} {row.count === 1 ? "in the schedule" : "in the schedule"}
                          {row.quantities.map((q) => ` · ${q.header} ${q.figure}`).join("")}
                          {remembered && chosen && pick?.kind === "assembly" && pick.id === row.match?.assemblyId && (
                            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px]">remembered</span>
                          )}
                          {row.match?.how === "words" && (
                            <span className="ml-2 text-[11px] italic">looks like {assemblyById.get(row.match.assemblyId)?.name}</span>
                          )}
                        </p>
                      </div>
                      <select
                        className={SELECT}
                        value={value}
                        aria-label={`What ${row.key} is`}
                        onChange={(e) => setPicks((was) => ({ ...was, [row.key]: e.target.value }))}
                      >
                        <option value="">— leave it out</option>
                        {row.canDrive.length > 0 && (
                          <optgroup label="As an assembly">
                            {row.canDrive.map((c) => {
                              const a = assemblyById.get(c.assemblyId);
                              return a ? (
                                <option key={c.assemblyId} value={`asm:${c.assemblyId}`}>
                                  {a.name} — at {c.at}
                                </option>
                              ) : null;
                            })}
                          </optgroup>
                        )}
                        <optgroup label="As a line">
                          {row.quantities.map((q) => (
                            <option key={q.header} value={`line:${q.header}`}>
                              {row.key} — {q.figure}
                            </option>
                          ))}
                          {row.count > 0 && (
                            <option value="line:count">
                              {row.key} — {row.count} ea
                            </option>
                          )}
                        </optgroup>
                      </select>
                      {chosen && at && (
                        <span className="text-xs text-muted-foreground">
                          {chosen.per} of it is {formatMoney(chosen.costCents, symbol)}
                        </span>
                      )}
                      {chosen && !remembered && (
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            className="size-3.5"
                            checked={remember[row.key] ?? false}
                            onChange={(e) => setRemember((was) => ({ ...was, [row.key]: e.target.checked }))}
                          />
                          remember
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {preview.assemblies.length === 0 && preview.rows.length > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="size-3.5" />
                You have no assemblies yet, so everything here comes in as a line. Save an item as an
                assembly once and the next takeoff drops it in priced.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={commit} disabled={pending || !preview || choices.length === 0}>
            {pending
              ? "Working…"
              : choices.length === 0
                ? "Bring it in"
                : `Bring in ${[
                    itemCount > 0 ? `${itemCount} ${itemCount === 1 ? "item" : "items"}` : "",
                    lineCount > 0 ? `${lineCount} ${lineCount === 1 ? "line" : "lines"}` : "",
                  ]
                    .filter(Boolean)
                    .join(" and ")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
