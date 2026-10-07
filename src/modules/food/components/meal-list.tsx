"use client";

import Link from "next/link";
import { useState } from "react";
import { ChefHat, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { GRAM_UNITS, MEALS, MEAL_LABELS, amountWords, kcalWords, totals, typedAmount, type Meal } from "../core/eating";
import { plainNumber, yieldWords } from "../core/recipe";
import { eatsHere, planAmountWords, planNumbers, type PlanItem } from "../core/week";
import { FoodThumb, MealTile } from "./food-thumb";
import { macroLine, rescaled, type EntryView } from "./today-model";

const FIELD = "h-12 rounded-xl bg-food-field px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-food-accent";
const SOFT = "flex h-10 items-center justify-center gap-2 rounded-xl bg-food-soft px-4 text-sm font-medium hover:bg-food-tabs-track";
const PRIMARY =
  "flex h-10 items-center justify-center gap-2 rounded-xl bg-food-accent px-4 text-sm font-semibold text-white hover:bg-food-accent-hover active:translate-y-px disabled:opacity-50";

export interface EntryChange {
  amount: number;
  portion: string;
  meal: Meal;
}

/**
 * THE MEALS (the Fresh Market redesign, docs/help/food/overview.md):
 * breakfast, lunch, dinner and snacks. On a wide screen a card each, side by
 * side, with every thing eaten in it; on a phone one card of rows, a row a
 * meal with a few of its pictures, opened with a tap. Tap a thing to change
 * how much, or its meal, or to remove it. A planned meal not yet eaten is a
 * dashed row with Ate it; tap it for Change first and Cook. + logs food for
 * that meal.
 */
export function MealList({
  day,
  rows,
  plans,
  pending,
  onSave,
  onRemove,
  onAte,
}: {
  day: string;
  rows: EntryView[];
  plans: PlanItem[];
  pending: boolean;
  onSave: (entry: EntryView, change: EntryChange) => void;
  onRemove: (entry: EntryView) => void;
  onAte: (plan: PlanItem) => void;
}) {
  const [openMeals, setOpenMeals] = useState<readonly Meal[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [portion, setPortion] = useState("");
  const [meal, setMeal] = useState<Meal>("breakfast");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [openPlan, setOpenPlan] = useState<string | null>(null);

  const logHref = (m: Meal) => `/personal/m/food/log?meal=${m}&day=${day}`;

  function toggleMeal(m: Meal) {
    setOpenMeals((now) => (now.includes(m) ? now.filter((x) => x !== m) : [...now, m]));
  }

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
    if (amount === null || !rescaled(entry, amount, portion)) return;
    setEditing(null);
    onSave(entry, { amount, portion, meal });
  }

  function itemRow(entry: EntryView, first: boolean) {
    const isOpen = editing === entry.id;
    const amount = typedAmount(amountText);
    const preview = isOpen && amount !== null ? rescaled(entry, amount, portion) : null;
    const units =
      entry.source === "recipe" ? [] : [...(entry.portions ?? []).map((p) => p.label), ...GRAM_UNITS.map((u) => u.label)];
    return (
      <li key={entry.id}>
        <button type="button" className="flex w-full items-stretch gap-3 text-left" aria-expanded={isOpen} onClick={() => open(entry)}>
          <FoodThumb
            photoUrl={entry.photoUrl ?? null}
            recipe={entry.source === "recipe"}
            category={entry.category ?? null}
            tone={entry.meal}
            className="my-2 size-12 rounded-lg"
          />
          <span className={cn("flex min-w-0 flex-1 items-center gap-3 py-2", !first && "border-t border-divider")}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {/* A recipe's photo needs the hat beside its name; a recipe with none already shows the hat. */}
                {entry.source === "recipe" && entry.photoUrl && <ChefHat className="size-3.5 shrink-0 text-food-accent" aria-hidden />}
                <span className="line-clamp-2">{entry.name}</span>
              </span>
              <span className="block text-xs text-muted-foreground">
                {[amountWords(entry.amount, entry.portion), macroLine(entry)].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="shrink-0 text-sm font-semibold tabular-nums">
              {entry.calories === null ? "no nutrition" : Math.round(entry.calories).toLocaleString("en-US")}
              {entry.calories !== null && <span className="sr-only"> kcal</span>}
            </span>
          </span>
        </button>
        {isOpen && (
          <div className="mb-2 space-y-3 rounded-2xl bg-food-field/70 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1">
                <span className="block text-[13px] font-medium">How much</span>
                <input
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  className={cn(FIELD, "w-24 bg-card tabular-nums")}
                />
              </label>
              {entry.source === "recipe" ? (
                <span className="pb-3 text-sm">servings</span>
              ) : (
                <span className="relative">
                  <select
                    aria-label="Portion"
                    value={portion}
                    onChange={(e) => setPortion(e.target.value)}
                    className={cn(FIELD, "max-w-[15rem] appearance-none bg-card pr-9")}
                  >
                    {units.map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                </span>
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
                    "h-[34px] rounded-full px-3.5 text-sm",
                    meal === option ? "bg-food-accent font-semibold text-white" : "bg-card ring-1 ring-food-chip-ring hover:bg-food-field",
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
                  : [preview.calories === null ? "no nutrition" : kcalWords(preview.calories), macroLine(preview)].filter(Boolean).join(" · ")}
            </p>
            {entry.source === "recipe" && entry.recipeId && entry.calories === null && (
              <Link href={`/personal/m/food/recipes/${entry.recipeId}/nutrition`} className={cn(SOFT, "w-fit")}>
                Work out its nutrition
              </Link>
            )}
            {confirming === entry.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm">Remove it?</span>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null);
                    setConfirming(null);
                    onRemove(entry);
                  }}
                  disabled={pending}
                  className="flex h-10 items-center rounded-xl bg-destructive px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Remove
                </button>
                <button type="button" onClick={() => setConfirming(null)} className={SOFT}>
                  Keep it
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => save(entry)} disabled={pending || preview === null} className={PRIMARY}>
                  Save
                </button>
                <button type="button" onClick={() => setEditing(null)} className={SOFT}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(entry.id)}
                  className="ml-auto h-10 rounded-xl px-3 text-sm font-medium text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        )}
      </li>
    );
  }

  function plannedRow(plan: PlanItem) {
    const n = eatsHere(plan) ? planNumbers(plan) : null;
    const isOpen = openPlan === plan.id;
    const cookHref =
      plan.kind === "cook" && plan.recipeId ? `/personal/m/food/recipes/${plan.recipeId}/cook?servings=${plainNumber(plan.make ?? 1)}` : null;
    return (
      <div key={plan.id} className="mt-2 rounded-2xl border-[1.5px] border-dashed border-food-planned-edge bg-food-planned p-2.5">
        <div className="flex items-center gap-3">
          <FoodThumb
            photoUrl={plan.photoUrl ?? null}
            recipe={plan.kind !== "food"}
            category={plan.category ?? null}
            tone={plan.meal}
            className="size-12 rounded-lg"
          />
          <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={isOpen} onClick={() => setOpenPlan(isOpen ? null : plan.id)}>
            <span className="block text-[11px] font-semibold tracking-[0.06em] text-food-accent-ink uppercase">Planned</span>
            <span className="flex items-center gap-1.5 text-sm font-medium">
              {plan.kind !== "food" && plan.photoUrl && <ChefHat className="size-3.5 shrink-0 text-food-accent" aria-hidden />}
              <span className="truncate">{plan.name}</span>
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {[planAmountWords(plan), n === null ? "for later" : n.calories === null ? "no nutrition" : kcalWords(n.calories)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
          {n !== null && (
            <button
              type="button"
              onClick={() => onAte(plan)}
              disabled={pending}
              className="h-[34px] shrink-0 rounded-md bg-food-accent px-3 text-sm font-semibold text-white hover:bg-food-accent-hover active:translate-y-px disabled:opacity-50"
            >
              Ate it
            </button>
          )}
        </div>
        {n === null && (
          <p className="mt-2 text-sm text-muted-foreground">
            {`Made for later meals: cook ${yieldWords(plan.make ?? 0, plan.yieldUnit)}, and eat it as its leftovers.`}
          </p>
        )}
        {(isOpen || n === null) && (n !== null || cookHref) && (
          <div className="mt-2 flex flex-wrap gap-2">
            {n !== null && (
              <Link href={`/personal/m/food/log?plan=${plan.id}`} className={cn(SOFT, "bg-card")}>
                Change first
              </Link>
            )}
            {cookHref && (
              <Link href={cookHref} className={cn(SOFT, "bg-card")}>
                <ChefHat className="size-4" aria-hidden /> Cook
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <section aria-labelledby="meals-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="meals-heading" className="font-food-display text-2xl font-bold tracking-[-0.02em]">
          Meals
        </h2>
        <p className="hidden text-[13px] text-muted-foreground @2xl:block">Tap anything to change how much or move it</p>
      </div>
      <div className="divide-y divide-divider rounded-2xl bg-card shadow-food-meal @2xl:grid @2xl:grid-cols-2 @2xl:gap-5 @2xl:divide-y-0 @2xl:rounded-none @2xl:bg-transparent @2xl:shadow-none">
        {MEALS.map((m) => {
          const inMeal = rows.filter((r) => r.meal === m);
          const waiting = plans.filter((p) => p.meal === m && p.eatenId === null);
          const sub = totals(inMeal);
          const mealOpen = openMeals.includes(m);
          const label = MEAL_LABELS[m];
          return (
            <div key={m} className="px-4 py-3 @2xl:rounded-3xl @2xl:bg-card @2xl:p-[18px] @2xl:shadow-food-meal">
              <div className="flex items-center gap-3">
                {/* A phone: the whole row opens the meal. */}
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left @2xl:hidden"
                  aria-expanded={mealOpen}
                  onClick={() => toggleMeal(m)}
                >
                  <MealTile meal={m} className="size-[30px] rounded-md" />
                  <span className="text-[15px] font-semibold">{label}</span>
                  {inMeal.length > 0 ? (
                    <span className="flex -space-x-2" aria-hidden>
                      {inMeal.slice(0, 3).map((entry) => (
                        <FoodThumb
                          key={entry.id}
                          photoUrl={entry.photoUrl ?? null}
                          recipe={entry.source === "recipe"}
                          category={entry.category ?? null}
                          tone={m}
                          className="size-[26px] rounded-full ring-2 ring-card"
                        />
                      ))}
                    </span>
                  ) : waiting.length > 0 ? (
                    <span className="min-w-0 truncate text-[13px] text-food-accent-ink">{`${waiting[0].name}, planned`}</span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-sm tabular-nums">
                    {sub.calories !== null && inMeal.length > 0 && (
                      <>
                        {Math.round(sub.calories).toLocaleString("en-US")}
                        <span className="sr-only"> kcal</span>
                      </>
                    )}
                  </span>
                </button>
                {/* A wide screen: the meal's heading. */}
                <div className="hidden min-w-0 flex-1 items-center gap-3 @2xl:flex">
                  <MealTile meal={m} className="size-[34px] rounded-lg" />
                  <h3 className="text-base font-semibold">{label}</h3>
                  {sub.calories !== null && inMeal.length > 0 ? (
                    <span className="text-[13px] text-muted-foreground tabular-nums">{kcalWords(sub.calories)}</span>
                  ) : waiting.length > 0 && inMeal.length === 0 ? (
                    <span className="text-[13px] text-muted-foreground">Planned</span>
                  ) : null}
                </div>
                <Link
                  href={logHref(m)}
                  aria-label={`Log food for ${label.toLowerCase()}`}
                  className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-food-soft hover:bg-food-tabs-track @2xl:size-8"
                >
                  <Plus className="size-4" aria-hidden />
                </Link>
              </div>
              <div className={cn("pt-2", mealOpen ? "block" : "hidden", "@2xl:block")}>
                {inMeal.length === 0 && waiting.length === 0 ? (
                  <p className="py-2 text-sm text-muted-foreground">Nothing yet</p>
                ) : inMeal.length > 0 ? (
                  <ul>{inMeal.map((entry, i) => itemRow(entry, i === 0))}</ul>
                ) : null}
                {waiting.map((plan) => plannedRow(plan))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
