"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createHabitAction, deleteHabitAction, updateHabitAction } from "../actions";
import { HABIT_NAME_MAX, HABIT_UNIT_MAX, HABITS_MAX } from "../core/habits";

type Habit = { id: string; name: string; unit: string | null };

function habitsKey(habits: Habit[]): string {
  return habits.map((h) => `${h.id}:${h.name}:${h.unit ?? ""}`).join("|");
}

/** A unit as the server keeps it: trimmed, and none when empty (`habitInputSchema`). */
function keptUnit(unit: string): string | null {
  return unit.trim() === "" ? null : unit.trim();
}

/**
 * YOUR HABITS (H1, docs/help/health/habits.md): the list Today marks from. A
 * habit is a name, and a unit when it is counted ("min" for a sauna, "g" for
 * creatine). Deleting one deletes the days it was done, after a second tap.
 *
 * What was added, changed or deleted shows at once: the page an action
 * re-renders streams in seconds after the action answers (the sleep card's
 * gap, 2026-10-02). The server's list takes over the moment it differs from
 * the one last seen.
 */
export function HabitManager({ habits }: { habits: Habit[] }) {
  const [list, setList] = useState(habits);
  const [seen, setSeen] = useState(habitsKey(habits));
  if (habitsKey(habits) !== seen) {
    setSeen(habitsKey(habits));
    setList(habits);
  }
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const full = list.length >= HABITS_MAX;

  function add() {
    const added = { name: name.trim(), unit: keptUnit(unit) };
    startTransition(async () => {
      const outcome = await createHabitAction({ name, unit });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setList((now) => [...now, { id: outcome.id, ...added }]);
      setName("");
      setUnit("");
    });
  }

  function saveEdit(id: string) {
    const changed = { name: editName.trim(), unit: keptUnit(editUnit) };
    startTransition(async () => {
      const outcome = await updateHabitAction({ id, name: editName, unit: editUnit });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setList((now) => now.map((h) => (h.id === id ? { ...h, ...changed } : h)));
      setEditing(null);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const outcome = await deleteHabitAction({ id });
      if ("error" in outcome) toast.error(outcome.error);
      else setList((now) => now.filter((h) => h.id !== id));
      setConfirming(null);
    });
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add();
        }}
      >
        <h2 className="font-medium">Add a habit</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1 space-y-1">
            <Label htmlFor="habit-name">Name</Label>
            <Input
              id="habit-name"
              value={name}
              maxLength={HABIT_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sauna, stretching, magnesium"
            />
          </div>
          <div className="w-32 space-y-1">
            <Label htmlFor="habit-unit">Counted in</Label>
            <Input
              id="habit-unit"
              value={unit}
              maxLength={HABIT_UNIT_MAX}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="min, g"
            />
          </div>
          <Button type="submit" disabled={pending || full || name.trim() === ""}>
            <Plus aria-hidden /> Add
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {full
            ? `You have ${HABITS_MAX}, the most Health keeps. Delete one to add another.`
            : "Leave “Counted in” empty for a habit that is done or not. Give it a unit, such as min or g, to say how much each day."}
        </p>
      </form>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No habits yet. Add one above, and it appears on Today to mark each day.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
          {list.map((habit) => (
            <li key={habit.id} className="px-4 py-3">
              {editing === habit.id ? (
                <form
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (editName.trim()) saveEdit(habit.id);
                  }}
                >
                  <div className="min-w-48 flex-1 space-y-1">
                    <Label htmlFor={`name-${habit.id}`}>Name</Label>
                    <Input
                      id={`name-${habit.id}`}
                      value={editName}
                      maxLength={HABIT_NAME_MAX}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="w-32 space-y-1">
                    <Label htmlFor={`unit-${habit.id}`}>Counted in</Label>
                    <Input
                      id={`unit-${habit.id}`}
                      value={editUnit}
                      maxLength={HABIT_UNIT_MAX}
                      onChange={(e) => setEditUnit(e.target.value)}
                    />
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
                    <span className="font-medium">{habit.name}</span>
                    <span className="text-sm text-muted-foreground">{habit.unit ? ` · counted in ${habit.unit}` : " · done or not"}</span>
                  </div>
                  <div className="flex gap-1">
                    {confirming === habit.id ? (
                      <>
                        <span className="self-center text-sm">Delete it and its days?</span>
                        <Button variant="destructive" size="sm" onClick={() => remove(habit.id)} disabled={pending}>
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
                            setEditing(habit.id);
                            setEditName(habit.name);
                            setEditUnit(habit.unit ?? "");
                          }}
                        >
                          <Pencil aria-hidden /> Change
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${habit.name}`}
                          onClick={() => setConfirming(habit.id)}
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
