"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowLeft, ChefHat, Loader2, Minus, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { HelpButton } from "@/components/app/help-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { planCookAction, planFoodAction } from "../actions";
import {
  GRAM_UNITS,
  MEALS,
  MEAL_LABELS,
  amountWords,
  defaultPortion,
  forGrams,
  forServings,
  gramWords,
  gramsFor,
  kcalWords,
  typedAmount,
  type FoodHit,
  type Meal,
  type Nutrients,
  type RecipeHit,
} from "../core/eating";
import { plainNumber, yieldWords } from "../core/recipe";
import {
  batchFits,
  dayTitle,
  firstLeftovers,
  leftoverChoices,
  leftoverCount,
  leftoverServings,
  mondayOf,
  slotKey,
  slotWords,
  type Slot,
} from "../core/week";
import type { RecentChoice } from "./log-food";
import { newId } from "./new-id";
import { useFoodSearch } from "./use-food-search";

type Choice = { kind: "food"; food: FoodHit } | { kind: "recipe"; recipe: RecipeHit };

const WEEK = "/personal/m/food/week";

function weekOf(day: string, today: string): string {
  return mondayOf(day) === mondayOf(today) ? WEEK : `${WEEK}?week=${mondayOf(day)}`;
}

function unitsOf(food: FoodHit): string[] {
  return [...food.portions.map((p) => p.label), ...GRAM_UNITS.map((u) => u.label)];
}

/** "Makes 6 servings · 520 kcal and 44 g protein a serving". */
function recipeLine(recipe: RecipeHit): string {
  const parts = [recipe.yieldAmount !== null ? `Makes ${yieldWords(recipe.yieldAmount, recipe.yieldUnit)}` : null];
  const n = recipe.perServing;
  if (n?.calories !== undefined || n?.proteinG !== undefined) {
    const each = [n?.calories !== undefined ? kcalWords(n.calories) : null, n?.proteinG !== undefined ? `${gramWords(n.proteinG)} protein` : null]
      .filter(Boolean)
      .join(" and ");
    parts.push(`${each} a serving`);
  } else {
    parts.push("no nutrition yet");
  }
  return parts.filter(Boolean).join(" · ");
}

function NumbersLine({ n }: { n: Nutrients }) {
  return (
    <p className="text-sm text-muted-foreground tabular-nums">
      {[
        n.calories === null ? "no numbers" : kcalWords(n.calories),
        n.proteinG === null ? null : `protein ${gramWords(n.proteinG)}`,
        n.carbsG === null ? null : `carbs ${gramWords(n.carbsG)}`,
        n.fatG === null ? null : `fat ${gramWords(n.fatG)}`,
      ]
        .filter(Boolean)
        .join(" · ")}
    </p>
  );
}

/**
 * PUT ON THE WEEK (D2, docs/help/food/week-add.md; the founder's calls
 * 2026-10-03, as drawn): a day and a meal, then one of your recipes or a food
 * from the list. A recipe is COOKED there: how much to make, how much you eat,
 * and the rest as leftovers on later meals, the next free lunches offered
 * first. Leave some off if someone else eats them. A food is planned by its
 * amount, as Log food has it.
 */
export function PlanAdd({
  today,
  days,
  initialDay,
  initialMeal,
  recent,
  recipes,
  initial,
  taken,
}: {
  today: string;
  days: string[];
  initialDay: string;
  initialMeal: Meal;
  recent: RecentChoice[];
  recipes: RecipeHit[];
  initial: Choice | null;
  /** The meals with something planned already ("2026-10-07:lunch"): not offered first for leftovers. */
  taken: string[];
}) {
  const router = useRouter();
  const [day, setDay] = useState(initialDay);
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const { q, results, searching, search } = useFoodSearch();
  const [choice, setChoice] = useState<Choice | null>(initial);
  const [makeText, setMakeText] = useState(initial?.kind === "recipe" ? plainNumber(initial.recipe.yieldAmount ?? 1) : "1");
  const [eatText, setEatText] = useState("1");
  const [amountText, setAmountText] = useState("1");
  const [portion, setPortion] = useState("serving");
  /** The leftovers the person picked, or null for the ones offered first. */
  const [picked, setPicked] = useState<string[] | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: Choice, amount?: number, unit?: string) {
    setChoice(next);
    setPicked(null);
    if (next.kind === "food") {
      const start = defaultPortion(next.food.portions);
      setAmountText(String(amount ?? start.amount));
      setPortion(unit && unitsOf(next.food).includes(unit) ? unit : start.portion);
    } else {
      setMakeText(plainNumber(next.recipe.yieldAmount ?? 1));
      setEatText(amount !== undefined ? plainNumber(amount) : "1");
    }
  }

  const make = typedAmount(makeText);
  const eat = eatText.trim() === "0" ? 0 : typedAmount(eatText);
  const cookSlot: Slot = { day, meal };
  const choices = choice?.kind === "recipe" ? leftoverChoices(cookSlot, today) : [];
  const each = leftoverServings(eat ?? 0);
  const room = make !== null && eat !== null ? leftoverCount(make, eat) : 0;
  const picks = picked ?? firstLeftovers(choices, room, new Set(taken)).map(slotKey);
  const leftovers = choices.filter((slot) => picks.includes(slotKey(slot)));
  const amount = typedAmount(amountText);
  const grams = choice?.kind === "food" && amount !== null ? gramsFor(amount, portion, choice.food.portions) : null;

  let problem: string | null = null;
  let numbers: Nutrients | null = null;
  if (choice?.kind === "recipe") {
    if (make === null || eat === null) problem = "Type how many to cook and how many you eat (0 is fine).";
    else if (eat > make) problem = "You can't eat more than the batch makes.";
    else if (!batchFits(make, eat, leftovers.map(() => each))) problem = "That is more leftovers than the batch makes.";
    else if (eat > 0) numbers = forServings(choice.recipe.perServing, eat);
  } else if (choice?.kind === "food") {
    if (amount === null) problem = "Type how much, a number above 0.";
    else if (grams === null) problem = "That amount is not one this food can be planned in.";
    else numbers = forGrams(choice.food.per100g, grams);
  }

  function put() {
    if (!choice || problem !== null) return;
    const name = choice.kind === "food" ? choice.food.name : choice.recipe.title;
    startTransition(async () => {
      const outcome =
        choice.kind === "recipe"
          ? await planCookAction({
              id: newId(),
              day,
              meal,
              recipeId: choice.recipe.recipeId,
              make: make as number,
              eat: eat as number,
              leftovers: leftovers.map((slot) => ({ id: newId(), day: slot.day, meal: slot.meal, servings: each })),
            })
          : await planFoodAction({ id: newId(), day, meal, fdcId: choice.food.fdcId, amount: amount as number, portion });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      toast.success(`${name} is on the week.`);
      router.push(weekOf(day, today));
    });
  }

  const showResults = q.trim() !== "" && !choice;

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={weekOf(initialDay, today)}>
          <ArrowLeft aria-hidden /> Week
        </Link>
      </Button>
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-medium tracking-heading">Put on the week</h1>
        <HelpButton />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="plan-day" className="sr-only">
            Day
          </Label>
          <select
            id="plan-day"
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setPicked(null);
            }}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {d === today ? "Today" : dayTitle(d)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Meal">
          {MEALS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={meal === option}
              onClick={() => {
                setMeal(option);
                setPicked(null);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm",
                meal === option ? "border-module-accent bg-module-accent text-white" : "border-border bg-card hover:bg-muted",
              )}
            >
              {MEAL_LABELS[option]}
            </button>
          ))}
        </div>
      </div>

      {!choice && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder="Search your recipes or foods"
            aria-label="Search your recipes or foods"
            className="h-11 pr-10 pl-9 text-base"
          />
          {q !== "" && (
            <button
              type="button"
              aria-label="Clear the search"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => search("")}
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </div>
      )}

      {!choice && q.trim() === "" && (
        <>
          {recipes.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-medium text-muted-foreground">Your recipes</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
                {recipes.map((recipe) => (
                  <li key={recipe.recipeId}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left hover:bg-muted"
                      onClick={() => choose({ kind: "recipe", recipe })}
                    >
                      <ChefHat className="size-3.5 shrink-0 text-module-accent" aria-hidden />
                      <span className="truncate">{recipe.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {recent.some((item) => item.food) && (
            <section className="space-y-1">
              <h2 className="text-sm font-medium text-muted-foreground">Foods you had lately</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
                {recent
                  .filter((item) => item.food)
                  .map((item) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted"
                        onClick={() => item.food && choose({ kind: "food", food: item.food }, item.amount, item.portion)}
                      >
                        <span className="truncate">{item.food?.name}</span>
                        <span className="shrink-0 text-sm text-muted-foreground">{amountWords(item.amount, item.portion)}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </>
      )}

      {showResults && (
        <div className="space-y-3" aria-live="polite">
          {searching && !results && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
            </p>
          )}
          {results && results.recipes.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-medium text-muted-foreground">Your recipes</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
                {results.recipes.map((recipe) => (
                  <li key={recipe.recipeId}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left hover:bg-muted"
                      onClick={() => choose({ kind: "recipe", recipe })}
                    >
                      <ChefHat className="size-3.5 shrink-0 text-module-accent" aria-hidden />
                      <span className="truncate">{recipe.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results && results.foods.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-medium text-muted-foreground">Foods</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
                {results.foods.map((food) => (
                  <li key={food.fdcId}>
                    <button type="button" className="w-full px-4 py-2.5 text-left hover:bg-muted" onClick={() => choose({ kind: "food", food })}>
                      <span className="block">{food.name}</span>
                      <span className="block text-sm text-muted-foreground">{food.category}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results && results.foods.length === 0 && results.recipes.length === 0 && (
            <p className="text-sm text-muted-foreground">{`Nothing found for “${results.q}”. Try fewer words, or other ones.`}</p>
          )}
        </div>
      )}

      {choice && (
        <section className="space-y-4 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <div>
            <h2 className="flex items-center gap-1.5 font-medium">
              {choice.kind === "recipe" && <ChefHat className="size-4 shrink-0 text-module-accent" aria-hidden />}
              {choice.kind === "food" ? choice.food.name : choice.recipe.title}
            </h2>
            <p className="text-sm text-muted-foreground">{choice.kind === "food" ? choice.food.category : recipeLine(choice.recipe)}</p>
          </div>

          {choice.kind === "recipe" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Stepper
                  id="plan-make"
                  label="Cook"
                  text={makeText}
                  unit={yieldWords(make ?? 2, choice.recipe.yieldUnit).replace(/^\S+ /, "")}
                  min={1}
                  onText={(text) => {
                    setMakeText(text);
                    setPicked(null);
                  }}
                />
                <Stepper
                  id="plan-eat"
                  label="You eat"
                  text={eatText}
                  unit={yieldWords(eat === 1 ? 1 : 2, choice.recipe.yieldUnit).replace(/^\S+ /, "")}
                  min={0}
                  onText={(text) => {
                    setEatText(text);
                    setPicked(null);
                  }}
                />
              </div>
              {room > 0 && choices.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-sm font-medium">{`The other ${plainNumber(room * each)}, as leftovers`}</div>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Leftovers">
                    {choices.map((slot) => {
                      const key = slotKey(slot);
                      const on = picks.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={on}
                          disabled={!on && leftovers.length >= room}
                          onClick={() => setPicked(on ? picks.filter((k) => k !== key) : [...picks, key])}
                          className={cn(
                            "rounded-full border px-3 py-1 text-sm disabled:opacity-50",
                            on ? "border-module-accent bg-module-accent text-white" : "border-border bg-card hover:bg-muted",
                          )}
                        >
                          {slotWords(slot, today)}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {`Each is ${yieldWords(each, choice.recipe.yieldUnit)}. Leave some off if someone else eats them. Cook opens the recipe at ${plainNumber(make ?? 0)}.`}
                  </p>
                </div>
              )}
              {eat === 0 && <p className="text-sm text-muted-foreground">Nothing is eaten at this meal: the batch is made for later ones.</p>}
            </>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label htmlFor="plan-amount">How much</Label>
                <Input id="plan-amount" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="w-24" />
              </div>
              <select
                aria-label="Portion"
                value={portion}
                onChange={(e) => setPortion(e.target.value)}
                className="h-9 max-w-[16rem] rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
              >
                {unitsOf(choice.food).map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {problem ? <p className="text-sm text-destructive">{problem}</p> : numbers && <NumbersLine n={numbers} />}

          <div className="flex flex-wrap gap-2">
            <Button onClick={put} disabled={pending || problem !== null}>
              {pending ? "Putting it on…" : "Put on the week"}
            </Button>
            <Button variant="ghost" onClick={() => setChoice(null)} disabled={pending}>
              Back
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

/** A number of servings, typed or stepped one at a time. */
function Stepper({
  id,
  label,
  text,
  unit,
  min,
  onText,
}: {
  id: string;
  label: string;
  text: string;
  unit: string;
  min: number;
  onText: (text: string) => void;
}) {
  const value = text.trim() === "0" ? 0 : typedAmount(text);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${label}: fewer`}
          disabled={value === null || value - 1 < min}
          onClick={() => value !== null && onText(plainNumber(Math.max(min, value - 1)))}
        >
          <Minus aria-hidden />
        </Button>
        <Input id={id} inputMode="decimal" value={text} onChange={(e) => onText(e.target.value)} className="w-16 text-center" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${label}: more`}
          disabled={value !== null && value + 1 > 999}
          onClick={() => onText(plainNumber((value ?? 0) + 1))}
        >
          <Plus aria-hidden />
        </Button>
      </div>
      <div className="text-xs text-muted-foreground">{unit}</div>
    </div>
  );
}
