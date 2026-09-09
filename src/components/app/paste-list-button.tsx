"use client";

import { Fragment, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { proposePasteAction, savePasteAction } from "@/lib/paste-targets/actions";
import {
  checkRow,
  PASTE_ACCEPT_ATTR,
  PASTE_MAX_CHARS,
  type ReviewRow,
} from "@/lib/paste-targets/shape";
import type { PasteField, PasteValue } from "@/lib/paste-targets/types";
import { cn } from "@/lib/utils";

const NONE = "__none__";

interface Row extends ReviewRow {
  keep: boolean;
}

/**
 * Paste a list, review every row, then add them — for any paste target.
 *
 * THE REVIEW STEP IS THE FEATURE, not a courtesy (ADR 0036). Nothing here
 * writes until somebody has looked at every row and pressed the button: the
 * reading returns a proposal, and the save takes only the rows that are still
 * ticked, as edited. A duplicate comes back unticked and says why; a cell the
 * model could not place comes back empty with what the list said beside it.
 *
 * ONE COMPONENT FOR EVERY TARGET, drawn from the target's fields: the columns,
 * the inputs, the choices and the "what is wrong" line are all data the
 * target declared. This file knows nothing about vendors or animals.
 */
export function PasteListButton({
  slug,
  label,
  noun,
  example,
}: {
  slug: string;
  /** The dialog's noun. "vendors". */
  label: string;
  noun: { one: string; many: string };
  /** What to show in the empty box, in the target's own terms. */
  example?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState<PasteField[] | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [reading, startReading] = useTransition();
  const [saving, startSaving] = useTransition();

  const kept = rows.filter((r) => r.keep);
  const problems = fields
    ? rows.map((r) => (r.keep ? checkRow(r.values, fields) : null))
    : [];
  const ready = kept.length > 0 && problems.every((p) => p === null);
  const count = (n: number) => `${n} ${n === 1 ? noun.one : noun.many}`;

  function reset() {
    setText("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    setFields(null);
    setRows([]);
  }

  function read() {
    if (text.trim() === "" && !file) return;
    const form = new FormData();
    form.set("slug", slug);
    form.set("text", text);
    if (file) form.set("file", file);
    startReading(async () => {
      const result = await proposePasteAction(form);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setFields(result.fields);
      setRows(result.rows.map((r) => ({ ...r, keep: r.duplicateOf === null })));
      if (result.rows.length === 0) {
        // An explicit message, not an empty table: "nothing found" and "it
        // broke" must not look the same.
        toast.info("Nothing to add from that.");
      }
    });
  }

  function save() {
    if (!fields || !ready) return;
    startSaving(async () => {
      const result = await savePasteAction({ slug, rows: kept.map((r) => r.values) });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added ${count(result.saved)}`);
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  function setKeep(i: number, keep: boolean) {
    setRows(rows.map((r, j) => (j === i ? { ...r, keep } : r)));
  }

  /** Typing into a cell settles it: the hint for that cell goes. */
  function setValue(i: number, key: string, value: PasteValue) {
    setRows(
      rows.map((r, j) => {
        if (j !== i) return r;
        const hints = { ...r.hints };
        delete hints[key];
        return { ...r, values: { ...r.values, [key]: value }, hints };
      }),
    );
  }

  const notesFor = (row: Row, problem: string | null): Array<{ warn: boolean; text: string }> => {
    const notes: Array<{ warn: boolean; text: string }> = [];
    if (row.duplicateOf) {
      notes.push({
        warn: false,
        text: `Already here as “${row.duplicateOf}”. Unticked — tick it to add another.`,
      });
    }
    for (const f of fields ?? []) {
      const said = row.hints[f.key];
      if (said) {
        notes.push({
          warn: true,
          text: `The list said “${said}” for ${f.label.toLowerCase()} — ${
            f.kind === "choice" ? "pick one" : "fill it in"
          }, or leave it blank.`,
        });
      }
    }
    if (problem) notes.push({ warn: true, text: problem });
    return notes;
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="mr-2 size-4" />
        Paste a list
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogContent
          className={cn(
            "max-h-[85vh] overflow-y-auto",
            fields ? "sm:max-w-5xl" : "sm:max-w-2xl",
          )}
        >
          <DialogHeader>
            <DialogTitle>Paste a list of {label}</DialogTitle>
            <DialogDescription>
              {fields
                ? rows.length === 0
                  ? "Nothing to add from that."
                  : `${count(rows.length)} found. Untick what you don't want, fix what's wrong, then add them.`
                : "Paste a list, columns from a spreadsheet, or add a photo of one. You'll see every row it found and can change anything before it saves."}
            </DialogDescription>
          </DialogHeader>

          {!fields ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="paste-text">The list</Label>
                <Textarea
                  id="paste-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  maxLength={PASTE_MAX_CHARS}
                  placeholder={
                    example ?? "One per line, or the columns straight from a spreadsheet."
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {text.length.toLocaleString()} / {PASTE_MAX_CHARS.toLocaleString()}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="paste-file">Or a photo of it</Label>
                <Input
                  id="paste-file"
                  ref={fileRef}
                  type="file"
                  accept={PASTE_ACCEPT_ATTR}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-xs text-muted-foreground">
                  A photo or a PDF, up to 4 MB. Only what you paste or attach is sent.
                </p>
              </div>
            </div>
          ) : rows.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Nothing to add from that.
            </p>
          ) : (
            <>
              {/* Wide screens: one row per line, every field a column. */}
              <div className="hidden overflow-x-auto rounded-md border sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      {fields.map((f) => (
                        <TableHead key={f.key} className="whitespace-nowrap">
                          {f.label}
                          {f.required && <span aria-hidden> *</span>}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row, i) => {
                      const notes = notesFor(row, problems[i]);
                      return (
                        <Fragment key={i}>
                          <TableRow className={cn(!row.keep && "opacity-60")}>
                            <TableCell className="align-top">
                              <Checkbox
                                checked={row.keep}
                                onCheckedChange={(c) => setKeep(i, c === true)}
                                aria-label={`Keep row ${i + 1}`}
                              />
                            </TableCell>
                            {fields.map((f) => (
                              <TableCell key={f.key} className="p-1.5 align-top">
                                <Cell
                                  id={`paste-${i}-${f.key}`}
                                  field={f}
                                  value={row.values[f.key] ?? null}
                                  onChange={(v) => setValue(i, f.key, v)}
                                />
                              </TableCell>
                            ))}
                          </TableRow>
                          {notes.length > 0 && (
                            <TableRow className={cn(!row.keep && "opacity-60")}>
                              <TableCell />
                              <TableCell colSpan={fields.length} className="pt-0 text-xs">
                                <Notes notes={notes} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* A phone: one card per row, every field named. */}
              <ul className="space-y-3 sm:hidden">
                {rows.map((row, i) => {
                  const notes = notesFor(row, problems[i]);
                  return (
                    <li
                      key={i}
                      className={cn("space-y-2 rounded-md border p-3", !row.keep && "opacity-60")}
                    >
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox
                          checked={row.keep}
                          onCheckedChange={(c) => setKeep(i, c === true)}
                          aria-label={`Keep row ${i + 1}`}
                        />
                        Row {i + 1}
                      </label>
                      <div className="grid gap-2">
                        {fields.map((f) => (
                          <div key={f.key} className="space-y-1">
                            <Label htmlFor={`paste-m-${i}-${f.key}`} className="text-xs">
                              {f.label}
                              {f.required && <span aria-hidden> *</span>}
                            </Label>
                            <Cell
                              id={`paste-m-${i}-${f.key}`}
                              field={f}
                              value={row.values[f.key] ?? null}
                              onChange={(v) => setValue(i, f.key, v)}
                              wide
                            />
                          </div>
                        ))}
                      </div>
                      {notes.length > 0 && (
                        <div className="text-xs">
                          <Notes notes={notes} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <DialogFooter>
            {fields ? (
              <>
                <Button variant="ghost" onClick={reset} disabled={saving}>
                  Start over
                </Button>
                <Button onClick={save} disabled={saving || !ready}>
                  {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {saving ? "Adding…" : `Add ${count(kept.length)}`}
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={reading}>
                  Cancel
                </Button>
                <Button onClick={read} disabled={reading || (text.trim() === "" && !file)}>
                  {reading && <Loader2 className="mr-2 size-4 animate-spin" />}
                  {reading ? "Reading…" : "Read it"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** One cell, drawn from its field's kind. */
function Cell({
  id,
  field,
  value,
  onChange,
  wide = false,
}: {
  id: string;
  field: PasteField;
  value: PasteValue;
  onChange: (value: PasteValue) => void;
  wide?: boolean;
}) {
  switch (field.kind) {
    case "choice":
      return (
        <Select
          value={typeof value === "string" && value !== "" ? value : NONE}
          onValueChange={(v) => onChange(v === NONE ? null : v)}
        >
          <SelectTrigger id={id} className={cn("h-8", wide ? "w-full" : "min-w-36")} title={field.hint}>
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Not set</SelectItem>
            {(field.choices ?? []).map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          step="any"
          inputMode="decimal"
          className={cn("h-8", wide ? "w-full" : "min-w-24")}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          title={field.hint}
        />
      );
    case "date":
      return (
        <Input
          id={id}
          type="date"
          className={cn("h-8", wide ? "w-full" : "w-40")}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value || null)}
          title={field.hint}
        />
      );
    default:
      return (
        <Input
          id={id}
          className={cn("h-8", wide ? "w-full" : "min-w-36")}
          value={value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
          placeholder={field.label}
          title={field.hint}
        />
      );
  }
}

function Notes({ notes }: { notes: Array<{ warn: boolean; text: string }> }) {
  return (
    <ul className="space-y-0.5">
      {notes.map((n, i) => (
        <li key={i} className={n.warn ? "text-amber-600" : "text-muted-foreground"}>
          {n.text}
        </li>
      ))}
    </ul>
  );
}
