"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ChefHat, Plus, Target } from "lucide-react";
import { toast } from "sonner";
import type { FoodPortion } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { changeEatenAction, deleteEatenAction, setTargetsAction } from "../actions";
import {
  GRAM_UNITS,
  MEALS,
  MEAL_LABELS,
  NUTRIENT_KEYS,
  amountWords,
  gramWords,
  gramsFor,
  kcalWords,
  totals,
  towards,
  typedAmount,
  typedWhole,
  type Meal,
  type Nutrients,
  type TargetsInput,
} from "../core/eating";

/** One thing on the day, as Today shows and changes it. */
export interface EntryView extends Nutrients {
  id: string;
  meal: Meal;
  source: "food" | "recipe" | "photo";
  name: string;
  amount: number;
  portion: string;
  grams: number | null;
  portions: FoodPortion[] | null;
}

function entriesKey(entries: readonly EntryView[]): string {
  return entries.map((e) => `${e.id}:${e.meal}:${e.amount}:${e.portion}:${e.calories ?? ""}`).join("|");
}

function targetsKey(targets: TargetsInput): string {
  return `${targets.calories ?? ""}:${targets.proteinG ?? ""}`;
}

/** An entry's numbers for a new amount, scaled from the ones it was logged with; null when the portion is not one it has. */
function rescaled(entry: EntryView, amount: number, portion: string): (Nutrients & { grams: number | null }) | null {
  let scale: number;
  let grams = entry.grams;
  if (entry.source === "recipe") {
    scale = amount / entry.amount;
  } else {
    grams = gramsFor(amount, portion, entry.portions ?? []);
    if (grams === null || entry.grams === null || entry.grams <= 0) return null;
    scale = grams / entry.grams;
  }
  const out = { grams } as Nutrients & { grams: number | null };
  for (const key of NUTRIENT_KEYS) out[key] = entry[key] === null ? null : (entry[key] as number) * scale;
  return out;
}

function macroLine(n: Nutrients): string {
  return [
    n.proteinG === null ? null : `protein ${gramWords(n.proteinG)}`,
    n.carbsG === null ? null : `carbs ${gramWords(n.carbsG)}`,
    n.fatG === null ? null : `fat ${gramWords(n.fatG)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * WHAT WAS EATEN ON A DAY (D4a, docs/help/food/overview.md; the founder's
 * calls): the day's calories, protein, carbs and fat shown alike, how far
 * along the calorie and protein targets, and each meal with what is in it.
 * Tap a thing to change how much, or its meal, or to remove it.
 *
 * Every change shows at once and is put back if the server refuses it: an
 * action answers before the page it re-rendered streams in, and a list drawn
 * from the props alone showed the old state in between (Health's drive,
 * 2026-10-02). The server's copy takes over the moment it differs from the
 * one last seen.
 */
export function EatenDay({
  day,
  entries,
  targets,
}: {
  day: string;
  entries: EntryView[];
  targets: TargetsInput;
}) {
  const [rows, setRows] = useState(entries);
  const [seenRows, setSeenRows] = useState(entriesKey(entries));
  if (entriesKey(entries) !== seenRows) {
    setSeenRows(entriesKey(entries));
    setRows(entries);
  }
  const [goal, setGoal] = useState(targets);
  const [seenGoal, setSeenGoal] = useState(targetsKey(targets));
  if (targetsKey(targets) !== seenGoal) {
    setSeenGoal(targetsKey(targets));
    setGoal(targets);
  }

  const [editing, setEditing] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [portion, setPortion] = useState("");
  const [meal, setMeal] = useState<Meal>("breakfast");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [settingGoal, setSettingGoal] = useState(false);
  const [caloriesText, setCaloriesText] = useState("");
  const [proteinText, setProteinText] = useState("");
  const [pending, startTransition] = useTransition();

  const day_ = totals(rows);
  const logHref = (m: Meal) => `/personal/m/food/log?meal=${m}&day=${day}`;

  function open(entry: EntryView) {
    if (editing === entry.id) {
      setEditing(null);
      return;
    }
    setEditing(entry.id);
    setConfirming(null);
    setAmountText(String(entry.amount));
    setPortion(entry.portion);
    setMeal(entry.meal);
  }

  function save(entry: EntryView) {
    const amount = typedAmount(amountText);
    if (amount === null) return;
    const numbers = rescaled(entry, amount, portion);
    if (!numbers) return;
    const before = rows;
    setRows((now) => now.map((r) => (r.id === entry.id ? { ...r, ...numbers, amount, portion, meal } : r)));
    setEditing(null);
    startTransition(async () => {
      const outcome = await changeEatenAction({
        id: entry.id,
        meal,
        amount,
        ...(entry.source === "recipe" ? {} : { portion }),
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setRows(before);
      }
    });
  }

  function remove(entry: EntryView) {
    const before = rows;
    setRows((now) => now.filter((r) => r.id !== entry.id));
    setEditing(null);
    setConfirming(null);
    startTransition(async () => {
      const outcome = await deleteEatenAction({ id: entry.id });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setRows(before);
      }
    });
  }

  function openGoal() {
    setSettingGoal(true);
    setCaloriesText(goal.calories === null ? "" : String(goal.calories));
    setProteinText(goal.proteinG === null ? "" : String(goal.proteinG));
  }

  const caloriesTyped = typedWhole(caloriesText);
  const proteinTyped = typedWhole(proteinText);
  const caloriesOk = caloriesText.trim() === "" || (caloriesTyped !== null && caloriesTyped >= 500 && caloriesTyped <= 10_000);
  const proteinOk = proteinText.trim() === "" || (proteinTyped !== null && proteinTyped >= 10 && proteinTyped <= 500);

  function saveGoal() {
    if (!caloriesOk || !proteinOk) return;
    const next = {
      calories: caloriesText.trim() === "" ? null : caloriesTyped,
      proteinG: proteinText.trim() === "" ? null : proteinTyped,
    };
    const before = goal;
    setGoal(next);
    setSettingGoal(false);
    startTransition(async () => {
      const outcome = await setTargetsAction(next);
      if ("error" in outcome) {
        toast.error(outcome.error);
        setGoal(before);
      }
    });
  }

  const tiles: { key: string; label: string; value: string; target?: { share: number; words: string } }[] = [
    {
      key: "calories",
      label: "Calories",
      value: day_.calories === null ? "0 kcal" : kcalWords(day_.calories),
      target: goal.calories === null ? undefined : towards(day_.calories, goal.calories, "kcal"),
    },
    {
      key: "protein",
      label: "Protein",
      value: gramWords(day_.proteinG ?? 0),
      target: goal.proteinG === null ? undefined : towards(day_.proteinG, goal.proteinG, "g"),
    },
    { key: "carbs", label: "Carbs", value: gramWords(day_.carbsG ?? 0) },
    { key: "fat", label: "Fat", value: gramWords(day_.fatG ?? 0) },
  ];

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.key} className="space-y-1">
              <div className="text-sm text-muted-foreground">{tile.label}</div>
              <div className="text-xl font-medium tabular-nums">{tile.value}</div>
              {tile.target && (
                <div className="space-y-0.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <div className="h-full rounded-full bg-module-accent" style={{ width: `${Math.round(tile.target.share * 100)}%` }} />
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">{tile.target.words}</div>
                </div>
              )}
            </div>
          ))}
        </div>
        {day_.unknown > 0 && (
          <p className="text-sm text-muted-foreground">
            {`${day_.unknown} ${day_.unknown === 1 ? "thing has" : "things have"} no nutrition: its recipe states none. Add it in the recipe's editor, and log it again.`}
          </p>
        )}
        {settingGoal ? (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="target-calories">Calories a day</Label>
                <Input
                  id="target-calories"
                  inputMode="numeric"
                  value={caloriesText}
                  onChange={(e) => setCaloriesText(e.target.value)}
                  placeholder="2,200"
                  className="w-28"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="target-protein">Protein a day, g</Label>
                <Input
                  id="target-protein"
                  inputMode="numeric"
                  value={proteinText}
                  onChange={(e) => setProteinText(e.target.value)}
                  placeholder="150"
                  className="w-28"
                />
              </div>
            </div>
            {(!caloriesOk || !proteinOk) && (
              <p className="text-sm text-destructive">
                {!caloriesOk ? "Calories between 500 and 10,000." : "Protein between 10 and 500 g."}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Leave a box empty for no target. A day is on its calorie target within a tenth of it, either way, and on
              its protein target at or above it.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveGoal} disabled={pending || !caloriesOk || !proteinOk}>
                Save targets
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSettingGoal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="-ml-2" onClick={openGoal}>
            <Target aria-hidden /> {goal.calories === null && goal.proteinG === null ? "Set targets" : "Change targets"}
          </Button>
        )}
      </section>

      {MEALS.map((m) => {
        const inMeal = rows.filter((r) => r.meal === m);
        const sub = totals(inMeal);
        return (
          <section key={m} className="space-y-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-medium">
                {MEAL_LABELS[m]}
                {sub.calories !== null && <span className="ml-2 text-sm font-normal text-muted-foreground">{kcalWords(sub.calories)}</span>}
              </h2>
              <Button asChild size="sm" variant="ghost" aria-label={`Log food for ${MEAL_LABELS[m].toLowerCase()}`}>
                <Link href={logHref(m)}>
                  <Plus aria-hidden /> Add
                </Link>
              </Button>
            </div>
            {inMeal.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet</p>
            ) : (
              <ul className="divide-y divide-border">
                {inMeal.map((entry) => {
                  const open_ = editing === entry.id;
                  const amount = typedAmount(amountText);
                  const preview = open_ && amount !== null ? rescaled(entry, amount, portion) : null;
                  const units =
                    entry.source === "recipe"
                      ? []
                      : [...(entry.portions ?? []).map((p) => p.label), ...GRAM_UNITS.map((u) => u.label)];
                  return (
                    <li key={entry.id} className="py-2">
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 text-left"
                        aria-expanded={open_}
                        onClick={() => open(entry)}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            {entry.source === "recipe" && <ChefHat className="size-3.5 shrink-0 text-module-accent" aria-hidden />}
                            <span className="line-clamp-2">{entry.name}</span>
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            {[amountWords(entry.amount, entry.portion), macroLine(entry)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums">
                          {entry.calories === null ? "no nutrition" : kcalWords(entry.calories)}
                        </span>
                      </button>
                      {open_ && (
                        <div className="mt-2 space-y-3 rounded-xl bg-muted/50 p-3">
                          <div className="flex flex-wrap items-end gap-2">
                            <div className="space-y-1">
                              <Label htmlFor={`amount-${entry.id}`}>How much</Label>
                              <Input
                                id={`amount-${entry.id}`}
                                inputMode="decimal"
                                value={amountText}
                                onChange={(e) => setAmountText(e.target.value)}
                                className="w-24"
                              />
                            </div>
                            {entry.source === "recipe" ? (
                              <span className="pb-2 text-sm">servings</span>
                            ) : (
                              <select
                                aria-label="Portion"
                                value={portion}
                                onChange={(e) => setPortion(e.target.value)}
                                className="h-9 max-w-[14rem] rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
                              >
                                {units.map((label) => (
                                  <option key={label} value={label}>
                                    {label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Meal">
                            {MEALS.map((option) => (
                              <button
                                key={option}
                                type="button"
                                aria-pressed={meal === option}
                                onClick={() => setMeal(option)}
                                className={cn(
                                  "rounded-full border px-3 py-1 text-sm",
                                  meal === option ? "border-module-accent bg-module-accent text-white" : "border-border bg-card",
                                )}
                              >
                                {MEAL_LABELS[option]}
                              </button>
                            ))}
                          </div>
                          <p className="text-sm text-muted-foreground" aria-live="polite">
                            {amount === null
                              ? "Type how much, a number above 0."
                              : preview === null
                                ? "That amount is not one this food can be logged in."
                                : [preview.calories === null ? "no nutrition" : kcalWords(preview.calories), macroLine(preview)]
                                    .filter(Boolean)
                                    .join(" · ")}
                          </p>
                          {confirming === entry.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm">Remove it?</span>
                              <Button size="sm" variant="destructive" onClick={() => remove(entry)} disabled={pending}>
                                Remove
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                                Keep it
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <Button size="sm" onClick={() => save(entry)} disabled={pending || preview === null}>
                                Save
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                                Cancel
                              </Button>
                              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirming(entry.id)}>
                                Remove
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
