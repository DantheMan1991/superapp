"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ListPlus, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { setHabitDayAction } from "../actions";
import { amountWords, typedAmount } from "../core/habits";

function marksKey(marks: Record<string, number | null>): string {
  return Object.keys(marks)
    .sort()
    .map((id) => `${id}:${marks[id] ?? ""}`)
    .join("|");
}

/**
 * YOUR OWN HABITS on Today (H1; the founder's call): each a chip. A tap marks
 * it done today and a second tap undoes it; a counted habit ("Sauna, min")
 * asks for its amount first, and its chip then says it ("Sauna · 20 min").
 *
 * A tap shows at once, and is put back if the server refuses it. Drawn from
 * the props alone, a chip stayed as it was for the seconds between the action
 * answering and the re-rendered page arriving, which invites a second tap (the
 * same gap as the sleep card's, 2026-10-02). The server's marks take over the
 * moment they differ from the ones last seen.
 */
export function HabitChips({
  today,
  habits,
  done,
}: {
  today: string;
  habits: { id: string; name: string; unit: string | null }[];
  /** Today's marks: habit id to its amount (null when it is not counted). */
  done: Record<string, number | null>;
}) {
  const [marks, setMarks] = useState(done);
  const [seen, setSeen] = useState(marksKey(done));
  if (marksKey(done) !== seen) {
    setSeen(marksKey(done));
    setMarks(done);
  }
  const [asking, setAsking] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();

  function mark(habitId: string, isDone: boolean, value: number | null) {
    const before = marks;
    const next = { ...marks };
    if (isDone) next[habitId] = value;
    else delete next[habitId];
    setMarks(next);
    setAsking(null);
    startTransition(async () => {
      const outcome = await setHabitDayAction({ habitId, day: today, done: isDone, amount: value });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setMarks(before);
      }
    });
  }

  function tap(habit: { id: string; unit: string | null }) {
    if (habit.id in marks) mark(habit.id, false, null);
    else if (habit.unit) {
      setAmount("");
      setAsking(habit.id);
    } else mark(habit.id, true, null);
  }

  const asked = habits.find((h) => h.id === asking) ?? null;
  const typed = typedAmount(amount);

  return (
    <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Your habits</h2>
        <Button asChild variant="ghost" size="sm">
          <Link href="/personal/m/health/habits">
            <Settings2 aria-hidden /> {habits.length === 0 ? "Add" : "Change"}
          </Link>
        </Button>
      </div>
      {habits.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add your own, such as a sauna, stretching or a supplement, to mark them done here each day.{" "}
          <Link className="whitespace-nowrap text-module-accent underline" href="/personal/m/health/habits">
            <ListPlus className="inline size-3.5" aria-hidden /> Add a habit
          </Link>
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {habits.map((habit) => {
              const isDone = habit.id in marks;
              const value = marks[habit.id];
              return (
                <li key={habit.id}>
                  <button
                    type="button"
                    aria-pressed={isDone}
                    disabled={pending}
                    onClick={() => tap(habit)}
                    className={cn(
                      "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                      isDone
                        ? "border-module-accent bg-module-accent text-white"
                        : "border-border bg-background hover:bg-muted",
                    )}
                  >
                    {isDone && <Check className="size-4" aria-hidden />}
                    {habit.name}
                    {isDone && value !== null && value !== undefined && ` · ${amountWords(value, habit.unit)}`}
                  </button>
                </li>
              );
            })}
          </ul>
          {asked && (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (typed !== null) mark(asked.id, true, typed);
              }}
            >
              <label className="space-y-1 text-sm">
                <span className="block">{`${asked.name}: how much, in ${asked.unit}?`}</span>
                <Input
                  autoFocus
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-28"
                  aria-label={`How much ${asked.name}, in ${asked.unit}`}
                />
              </label>
              <Button type="submit" disabled={pending || typed === null}>
                Done
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAsking(null)}>
                Cancel
              </Button>
            </form>
          )}
          <p className="text-xs text-muted-foreground">Tap one to mark it done today. Tap it again to undo.</p>
        </>
      )}
    </section>
  );
}
