"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Ruler, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Panel } from "@/components/app/panel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addOutlineMeasureAction,
  deleteOutlineMeasureAction,
  updateOutlineMeasureAction,
} from "../measure-actions";
import { MEASURE_KINDS, type MeasureKind } from "../vocabulary";

export interface OutlineMeasureRow {
  id: string;
  version: number;
  name: string;
  unit: string;
  kind: MeasureKind;
  guidance: string;
  required: boolean;
}

const KIND_WORD: Record<MeasureKind, string> = {
  length: "a length",
  area: "an area",
  count: "a count",
};

/**
 * WHAT TO MEASURE BEFORE THE QUESTIONS START (X7).
 *
 * A panel of its own rather than a section of `OutlineEditor`, because it
 * is not a step and it does not save with one. The editor is a document
 * that saves whole; this is a short list that saves a row at a time, which
 * is what a list of six things wants to be.
 *
 * ── WHAT BELONGS ON IT ──────────────────────────────────────────────────────
 *
 * A number MORE THAN ONE phase needs. A perimeter is footing, foundation
 * wall, backfill and siding. A number only one phase reads is a question on
 * that phase — putting it here just makes the walk longer before it starts.
 */
export function OutlineMeasures({
  outlineId,
  measures,
  canWrite,
}: {
  outlineId: string;
  measures: OutlineMeasureRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  function run(what: Promise<{ error?: string } | { ok: true }>, done?: () => void) {
    startTransition(async () => {
      try {
        const result = await what;
        if ("error" in result && result.error) {
          toast.error(result.error);
          return;
        }
        done?.();
        router.refresh();
      } catch {
        toast.error("That did not get through. Try again.");
      }
    });
  }

  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-heading text-sm font-medium tracking-heading">
            <Ruler className="size-4 text-muted-foreground" /> Measure first
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            The walk asks for these before its first question, with the drawings one click
            away — and every question after that can use them instead of asking again. Put a
            number here when more than one phase needs it.
          </p>
        </div>
        {canWrite && !adding && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 size-4" /> Add one
          </Button>
        )}
      </div>

      {measures.length === 0 && !adding ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Nothing yet. This walk goes straight to its questions.
        </p>
      ) : (
        <ul className="mt-4 divide-y rounded-md border">
          {measures.map((m) => (
            <MeasureRow
              key={m.id}
              outlineId={outlineId}
              measure={m}
              canWrite={canWrite}
              busy={pending}
              onRun={run}
            />
          ))}
        </ul>
      )}

      {adding && (
        <MeasureForm
          busy={pending}
          onCancel={() => setAdding(false)}
          onSave={(draft) =>
            run(addOutlineMeasureAction({ outlineId, ...draft }), () => setAdding(false))
          }
        />
      )}
    </Panel>
  );
}

function MeasureRow({
  outlineId,
  measure,
  canWrite,
  busy,
  onRun,
}: {
  outlineId: string;
  measure: OutlineMeasureRow;
  canWrite: boolean;
  busy: boolean;
  onRun: (what: Promise<{ error?: string } | { ok: true }>, done?: () => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [armed, setArmed] = useState(false);

  if (editing) {
    return (
      <li className="p-3">
        <MeasureForm
          busy={busy}
          initial={measure}
          onCancel={() => setEditing(false)}
          onSave={(draft) =>
            onRun(
              updateOutlineMeasureAction({
                id: measure.id,
                outlineId,
                version: measure.version,
                ...draft,
              }),
              () => setEditing(false),
            )
          }
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
      <span className="font-medium">{measure.name}</span>
      <span className="text-xs text-muted-foreground">
        {KIND_WORD[measure.kind]}
        {measure.unit ? ` in ${measure.unit}` : ""}
      </span>
      {measure.required && (
        <Badge variant="secondary" className="text-[10px]">
          always asked
        </Badge>
      )}
      {measure.guidance && (
        <span className="w-full text-xs text-muted-foreground">{measure.guidance}</span>
      )}
      {canWrite && (
        <span className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Change
          </Button>
          {armed ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="h-7"
                disabled={busy}
                onClick={() =>
                  onRun(deleteOutlineMeasureAction({ id: measure.id, outlineId }))
                }
              >
                Take it off
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setArmed(false)}
                aria-label="Keep it"
              >
                <X className="size-3.5" />
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={busy}
              onClick={() => setArmed(true)}
              aria-label={`Take ${measure.name} off the list`}
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </span>
      )}
    </li>
  );
}

interface Draft {
  name: string;
  unit: string;
  kind: MeasureKind;
  guidance: string;
  required: boolean;
}

function MeasureForm({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial?: OutlineMeasureRow;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: Draft) => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    name: initial?.name ?? "",
    unit: initial?.unit ?? "",
    kind: initial?.kind ?? "length",
    guidance: initial?.guidance ?? "",
    required: initial?.required ?? false,
  });

  return (
    <form
      className={initial ? "space-y-3" : "mt-4 space-y-3 rounded-md border p-3"}
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.name.trim() === "") return;
        onSave({ ...draft, name: draft.name.trim() });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Label htmlFor="measure-name" className="text-xs">
            What it is
          </Label>
          <Input
            id="measure-name"
            className="mt-1"
            value={draft.name}
            maxLength={120}
            placeholder="Wall perimeter"
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="measure-unit" className="text-xs">
            In what
          </Label>
          <Input
            id="measure-unit"
            className="mt-1"
            value={draft.unit}
            maxLength={20}
            placeholder="lf"
            onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor="measure-kind" className="text-xs">
            How it is taken
          </Label>
          <Select
            value={draft.kind}
            onValueChange={(v) => setDraft((d) => ({ ...d, kind: v as MeasureKind }))}
          >
            <SelectTrigger id="measure-kind" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEASURE_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_WORD[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="measure-guidance" className="text-xs">
          What to include, in your own words
        </Label>
        <Input
          id="measure-guidance"
          className="mt-1"
          value={draft.guidance}
          maxLength={500}
          placeholder="Outside face of the foundation, all the way round."
          onChange={(e) => setDraft((d) => ({ ...d, guidance: e.target.value }))}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs">
          <Checkbox
            checked={draft.required}
            onCheckedChange={(v) => setDraft((d) => ({ ...d, required: v === true }))}
          />
          Always ask for this one
        </label>
        <span className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy || draft.name.trim() === ""}>
            {initial ? "Save" : "Add it"}
          </Button>
        </span>
      </div>
    </form>
  );
}
