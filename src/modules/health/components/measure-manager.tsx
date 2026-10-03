"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMeasureAction, deleteMeasureAction, updateMeasureAction } from "../actions";
import { betterWords, MEASURE_NAME_MAX, MEASURE_SUGGESTIONS, MEASURES_MAX, type Better } from "../core/body";

type Measure = { id: string; name: string; better: Better | null };

function measuresKey(measures: Measure[]): string {
  return measures.map((m) => `${m.id}:${m.name}:${m.better ?? ""}`).join("|");
}

const BETTER_OPTIONS: { value: "" | Better; label: string }[] = [
  { value: "smaller", label: "Smaller is better" },
  { value: "bigger", label: "Bigger is better" },
  { value: "", label: "Neither way is better" },
];

function BetterSelect({ id, value, onChange }: { id: string; value: Better | null; onChange: (value: Better | null) => void }) {
  return (
    <select
      id={id}
      className="h-9 rounded-md border bg-background px-2 text-sm"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : (e.target.value as Better))}
    >
      {BETTER_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * YOUR TAPE MEASURES (H2, docs/help/health/measures.md; the founder's call:
 * the waist, and the others he picks). The common ones are a tap to add; any
 * other is named. Which way is better colours the measure on Body and in
 * Progress. Deleting one deletes every day it was taken, after a second tap.
 *
 * What was added, changed or deleted shows at once, and the server's list
 * takes over the moment it differs from the one last seen (as Your habits).
 */
export function MeasureManager({ measures }: { measures: Measure[] }) {
  const [list, setList] = useState(measures);
  const [seen, setSeen] = useState(measuresKey(measures));
  if (measuresKey(measures) !== seen) {
    setSeen(measuresKey(measures));
    setList(measures);
  }
  const [name, setName] = useState("");
  const [better, setBetter] = useState<Better | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBetter, setEditBetter] = useState<Better | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const full = list.length >= MEASURES_MAX;
  const offered = MEASURE_SUGGESTIONS.filter((s) => !list.some((m) => m.name.toLowerCase() === s.name.toLowerCase()));

  function add(input: { name: string; better: Better | null }, clear: boolean) {
    startTransition(async () => {
      const outcome = await createMeasureAction(input);
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setList((now) => [...now, { id: outcome.id, name: input.name.trim(), better: input.better }]);
      if (clear) {
        setName("");
        setBetter(null);
      }
    });
  }

  function saveEdit(id: string) {
    const changed = { name: editName.trim(), better: editBetter };
    startTransition(async () => {
      const outcome = await updateMeasureAction({ id, ...changed });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setList((now) => now.map((m) => (m.id === id ? { ...m, ...changed } : m)));
      setEditing(null);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const outcome = await deleteMeasureAction({ id });
      if ("error" in outcome) toast.error(outcome.error);
      else setList((now) => now.filter((m) => m.id !== id));
      setConfirming(null);
    });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
        <h2 className="font-medium">Add a tape measure</h2>
        {offered.length > 0 && !full && (
          <ul className="flex flex-wrap gap-2" aria-label="Common ones">
            {offered.map((s) => (
              <li key={s.name}>
                <Button variant="outline" size="sm" disabled={pending} onClick={() => add(s, false)}>
                  <Plus aria-hidden /> {s.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) add({ name, better }, true);
          }}
        >
          <div className="min-w-40 flex-1 space-y-1">
            <Label htmlFor="measure-name">Another, by name</Label>
            <Input
              id="measure-name"
              value={name}
              maxLength={MEASURE_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="Left arm, shoulders"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="measure-better">Which way</Label>
            <BetterSelect id="measure-better" value={better} onChange={setBetter} />
          </div>
          <Button type="submit" disabled={pending || full || name.trim() === ""}>
            <Plus aria-hidden /> Add
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {full
            ? `You have ${MEASURES_MAX}, the most Health keeps. Delete one to add another.`
            : "Which way is better colors the measure on Body and in Progress. The waist starts as smaller is better; the rest are your call."}
        </p>
      </section>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tape measures yet. Add one above, and Measure asks for it.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
          {list.map((measure) => (
            <li key={measure.id} className="px-4 py-3">
              {editing === measure.id ? (
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editName.trim()) saveEdit(measure.id);
                  }}
                >
                  <div className="min-w-40 flex-1 space-y-1">
                    <Label htmlFor={`name-${measure.id}`}>Name</Label>
                    <Input
                      id={`name-${measure.id}`}
                      value={editName}
                      maxLength={MEASURE_NAME_MAX}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`better-${measure.id}`}>Which way</Label>
                    <BetterSelect id={`better-${measure.id}`} value={editBetter} onChange={setEditBetter} />
                  </div>
                  <Button type="submit" disabled={pending || editName.trim() === ""}>
                    Save
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium">{measure.name}</span>
                    <span className="text-sm text-muted-foreground">{` · ${betterWords(measure.better).toLowerCase()}`}</span>
                  </div>
                  <div className="flex gap-1">
                    {confirming === measure.id ? (
                      <>
                        <span className="self-center text-sm">Delete it and its days?</span>
                        <Button variant="destructive" size="sm" onClick={() => remove(measure.id)} disabled={pending}>
                          Delete
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
                          Keep it
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditing(measure.id);
                            setEditName(measure.name);
                            setEditBetter(measure.better);
                          }}
                        >
                          <Pencil aria-hidden /> Change
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${measure.name}`}
                          onClick={() => setConfirming(measure.id)}
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
