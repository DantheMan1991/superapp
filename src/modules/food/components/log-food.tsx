"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowLeft, Camera, ChefHat, Loader2, Search, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { HelpButton } from "@/components/app/help-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { deleteEatenAction, logFoodAction, logPlateAction, logRecipeAction, readPlateAction } from "../actions";
import {
  GRAM_UNITS,
  MEALS,
  MEAL_LABELS,
  NO_NUTRIENTS,
  amountWords,
  defaultPortion,
  forGrams,
  forServings,
  gramWords,
  gramsFor,
  kcalWords,
  totals,
  typedAmount,
  type FoodHit,
  type Meal,
  type Nutrients,
  type RecipeHit,
} from "../core/eating";
import { PLATE_PHOTO_BASE64_LIMIT, PLATE_PHOTO_EDGE } from "../core/plate";
import { newId } from "./new-id";
import { shrinkToFit } from "./shrink-photo";
import { useFoodSearch } from "./use-food-search";

export interface RecentChoice {
  key: string;
  amount: number;
  portion: string;
  food: FoodHit | null;
  recipe: RecipeHit | null;
}

type Choice = { kind: "food"; food: FoodHit } | { kind: "recipe"; recipe: RecipeHit };

interface PlateRow {
  id: string;
  seen: string;
  match: FoodHit | null;
  amountText: string;
  portion: string;
}

/** The four numbers he counts, shown alike (his call): calories, protein, carbs, fat. */
function Numbers({ n, className }: { n: Nutrients; className?: string }) {
  const cells = [
    { label: "Calories", value: n.calories === null ? "–" : kcalWords(n.calories) },
    { label: "Protein", value: n.proteinG === null ? "–" : gramWords(n.proteinG) },
    { label: "Carbs", value: n.carbsG === null ? "–" : gramWords(n.carbsG) },
    { label: "Fat", value: n.fatG === null ? "–" : gramWords(n.fatG) },
  ];
  return (
    <dl className={cn("grid grid-cols-4 gap-2 text-center", className)}>
      {cells.map((cell) => (
        <div key={cell.label} className="rounded-lg bg-muted/60 px-1 py-1.5">
          <dt className="text-xs text-muted-foreground">{cell.label}</dt>
          <dd className="text-sm font-medium tabular-nums">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function unitsOf(food: FoodHit): string[] {
  return [...food.portions.map((p) => p.label), ...GRAM_UNITS.map((u) => u.label)];
}

/** A food's first portion and what it comes to, for a result line: "1 banana · 122 kcal". */
function firstPortionWords(food: FoodHit): string {
  const start = defaultPortion(food.portions);
  const grams = gramsFor(start.amount, start.portion, food.portions) ?? 100;
  return `${amountWords(start.amount, start.portion)} · ${kcalWords((food.per100g.calories * grams) / 100)}`;
}

/**
 * LOG FOOD (D4a, docs/help/food/log.md; the founder's calls 2026-10-03): find
 * a food on USDA's list or one of your recipes, say how much, and add it to a
 * meal; or take a photo of the plate, check what was found, and add it all.
 * You stay here to add the next thing; Done goes back to the day.
 *
 * The search is a GET the box can drop (`/api/food/search`): each keystroke
 * cancels the request before it, so an old answer never lands over a newer
 * one. The numbers shown are worked out here from the list's per-100 g
 * figures, the same arithmetic the server keeps (`core/eating.ts`).
 */
export function LogFood({
  day,
  dayLabel,
  backHref,
  initialMeal,
  recent,
  recipes,
  initial,
  initialAmount = null,
  planId: fromPlan = null,
}: {
  day: string;
  dayLabel: string;
  backHref: string;
  initialMeal: Meal;
  recent: RecentChoice[];
  recipes: RecipeHit[];
  initial: Choice | null;
  /** How much, when it opens from a planned meal (Change first on Today, D2). */
  initialAmount?: { amount: number; portion: string } | null;
  /** The planned meal it opens from: the first Add logs it as that meal, once. */
  planId?: string | null;
}) {
  const router = useRouter();
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const { q, results, searching, search } = useFoodSearch();
  const [choice, setChoice] = useState<Choice | null>(initial);
  const [amountText, setAmountText] = useState(
    initialAmount ? String(initialAmount.amount) : initial?.kind === "food" ? String(defaultPortion(initial.food.portions).amount) : "1",
  );
  const [portion, setPortion] = useState(
    initialAmount ? initialAmount.portion : initial?.kind === "food" ? defaultPortion(initial.food.portions).portion : "serving",
  );
  const [planId, setPlanId] = useState(fromPlan);
  const [added, setAdded] = useState<{ id: string; words: string; meal: Meal }[]>([]);
  const [plate, setPlate] = useState<{ status: "reading" } | { status: "review"; rows: PlateRow[] } | null>(null);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchBox = useRef<HTMLInputElement | null>(null);
  const camera = useRef<HTMLInputElement | null>(null);

  function choose(next: Choice, amount?: number, unit?: string) {
    if (replacing && plate?.status === "review" && next.kind === "food") {
      // Choosing the food for an item on the plate: its grams stay.
      setPlate({ status: "review", rows: plate.rows.map((row) => (row.id === replacing ? { ...row, match: next.food } : row)) });
      setReplacing(null);
      search("");
      return;
    }
    setChoice(next);
    if (next.kind === "food") {
      const start = defaultPortion(next.food.portions);
      setAmountText(String(amount ?? start.amount));
      setPortion(unit && unitsOf(next.food).includes(unit) ? unit : start.portion);
    } else {
      setAmountText(String(amount ?? 1));
      setPortion("serving");
    }
  }

  const amount = typedAmount(amountText);
  const chosenGrams = choice?.kind === "food" && amount !== null ? gramsFor(amount, portion, choice.food.portions) : null;
  const chosenNumbers: Nutrients | null =
    choice === null || amount === null
      ? null
      : choice.kind === "food"
        ? chosenGrams === null
          ? null
          : forGrams(choice.food.per100g, chosenGrams)
        : forServings(choice.recipe.perServing, amount);

  function add() {
    if (!choice || amount === null || chosenNumbers === null) return;
    const id = newId();
    const words =
      choice.kind === "food"
        ? `${choice.food.name}, ${amountWords(amount, portion)}`
        : `${choice.recipe.title}, ${amountWords(amount, "serving")}`;
    startTransition(async () => {
      const plan = planId ? { planId } : {};
      const outcome =
        choice.kind === "food"
          ? await logFoodAction({ id, day, meal, fdcId: choice.food.fdcId, amount, portion, ...plan })
          : await logRecipeAction({ id, day, meal, recipeId: choice.recipe.recipeId, servings: amount, ...plan });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setPlanId(null);
      setAdded((now) => [{ id, words, meal }, ...now]);
      setChoice(null);
      search("");
      searchBox.current?.focus();
    });
  }

  function undo(id: string) {
    startTransition(async () => {
      const outcome = await deleteEatenAction({ id });
      if ("error" in outcome) toast.error(outcome.error);
      else setAdded((now) => now.filter((a) => a.id !== id));
    });
  }

  async function readPhoto(file: File) {
    setChoice(null);
    setPlate({ status: "reading" });
    let jpeg: string | null = null;
    try {
      jpeg = (await shrinkToFit(file, PLATE_PHOTO_EDGE, PLATE_PHOTO_BASE64_LIMIT))?.jpeg ?? null;
    } catch {
      jpeg = null;
    }
    if (!jpeg) {
      setPlate(null);
      toast.error("That photo could not be used. Try another one, a JPEG or PNG.");
      return;
    }
    const outcome = await readPlateAction({ jpeg });
    if ("error" in outcome) {
      setPlate(null);
      toast.error(outcome.error);
      return;
    }
    setPlate({
      status: "review",
      rows: outcome.items.map((item) => ({
        id: item.id,
        seen: item.seen,
        match: item.match,
        amountText: String(item.grams),
        portion: "g",
      })),
    });
  }

  const plateRows = plate?.status === "review" ? plate.rows : [];
  const plateNumbers = plateRows.map((row) => {
    const a = typedAmount(row.amountText);
    const grams = row.match && a !== null ? gramsFor(a, row.portion, row.match.portions) : null;
    return row.match && grams !== null ? forGrams(row.match.per100g, grams) : null;
  });
  const plateReady = plateRows.length > 0 && plateNumbers.every((n) => n !== null);

  function editRow(id: string, change: Partial<PlateRow>) {
    if (plate?.status !== "review") return;
    setPlate({ status: "review", rows: plate.rows.map((row) => (row.id === id ? { ...row, ...change } : row)) });
  }

  function addPlate() {
    if (plate?.status !== "review" || !plateReady) return;
    const items = plate.rows.map((row) => ({
      id: row.id,
      fdcId: (row.match as FoodHit).fdcId,
      amount: typedAmount(row.amountText) as number,
      portion: row.portion,
    }));
    startTransition(async () => {
      const outcome = await logPlateAction({ day, meal, items });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      toast.success(`Logged ${items.length} ${items.length === 1 ? "food" : "foods"} to ${MEAL_LABELS[meal].toLowerCase()}.`);
      router.push(backHref);
    });
  }

  const showResults = q.trim() !== "" && (!choice || replacing !== null);

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={backHref}>
            <ArrowLeft aria-hidden /> Food
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={backHref}>Done</Link>
        </Button>
      </div>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-heading text-2xl font-medium tracking-heading">Log food</h1>
          <HelpButton />
        </div>
        <p className="text-muted-foreground">{dayLabel}</p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Meal">
        {MEALS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={meal === option}
            onClick={() => setMeal(option)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm",
              meal === option ? "border-module-accent bg-module-accent text-white" : "border-border bg-card hover:bg-muted",
            )}
          >
            {MEAL_LABELS[option]}
          </button>
        ))}
      </div>

      {added.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-card px-4 py-3 shadow-elevation-1" aria-label="Added just now">
          {added.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span>{`Added to ${MEAL_LABELS[a.meal].toLowerCase()}: ${a.words}`}</span>
              <Button size="sm" variant="ghost" onClick={() => undo(a.id)} disabled={pending}>
                <Undo2 aria-hidden /> Undo
              </Button>
            </li>
          ))}
        </ul>
      )}

      {replacing && (
        <p className="text-sm">
          {`Choose the food for: ${plateRows.find((r) => r.id === replacing)?.seen ?? ""}. `}
          <button type="button" className="text-module-accent underline" onClick={() => setReplacing(null)}>
            Cancel
          </button>
        </p>
      )}

      {(plate === null || replacing) && (!choice || replacing) && (
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchBox}
            autoFocus
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder="Search foods or your recipes"
            aria-label="Search foods or your recipes"
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

      {plate === null && !choice && q.trim() === "" && (
        <>
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void readPhoto(file);
            }}
          />
          <Button variant="outline" className="h-12 w-full text-base" onClick={() => camera.current?.click()}>
            <Camera aria-hidden /> Photo of the plate
          </Button>
          {recent.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card shadow-elevation-1">
                {recent.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-muted"
                      onClick={() =>
                        item.recipe
                          ? choose({ kind: "recipe", recipe: item.recipe }, item.amount)
                          : item.food && choose({ kind: "food", food: item.food }, item.amount, item.portion)
                      }
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        {item.recipe && <ChefHat className="size-3.5 shrink-0 text-module-accent" aria-hidden />}
                        <span className="truncate">{item.recipe?.title ?? item.food?.name}</span>
                      </span>
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {amountWords(item.amount, item.recipe ? "serving" : item.portion)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
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
        </>
      )}

      {showResults && (
        <div className="space-y-3" aria-live="polite">
          {searching && !results && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
            </p>
          )}
          {results && !replacing && results.recipes.length > 0 && (
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
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 text-left hover:bg-muted"
                      onClick={() => choose({ kind: "food", food })}
                    >
                      <span className="block">{food.name}</span>
                      <span className="block text-sm text-muted-foreground">{`${food.category} · ${firstPortionWords(food)}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {results && results.foods.length === 0 && (replacing || results.recipes.length === 0) && (
            <p className="text-sm text-muted-foreground">{`Nothing found for “${results.q}”. Try fewer words, or other ones.`}</p>
          )}
        </div>
      )}

      {choice && !replacing && (
        <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <div>
            <h2 className="flex items-center gap-1.5 font-medium">
              {choice.kind === "recipe" && <ChefHat className="size-4 shrink-0 text-module-accent" aria-hidden />}
              {choice.kind === "food" ? choice.food.name : choice.recipe.title}
            </h2>
            <p className="text-sm text-muted-foreground">{choice.kind === "food" ? choice.food.category : "Your recipe"}</p>
            {planId && <p className="text-sm text-muted-foreground">Planned for this meal. Change how much, then add it.</p>}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="log-amount">How much</Label>
              <Input
                id="log-amount"
                inputMode="decimal"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="w-24"
              />
            </div>
            {choice.kind === "food" ? (
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
            ) : (
              <span className="pb-2 text-sm">{amount === 1 ? "serving" : "servings"}</span>
            )}
          </div>
          {amount === null ? (
            <p className="text-sm text-destructive">Type how much, a number above 0.</p>
          ) : choice.kind === "recipe" && choice.recipe.perServing === null ? (
            <p className="text-sm text-muted-foreground">
              This recipe states no nutrition, so it is logged without numbers. Add them in the recipe&apos;s editor first to
              count it.
            </p>
          ) : (
            <Numbers n={chosenNumbers ?? NO_NUTRIENTS} />
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={add} disabled={pending || amount === null || chosenNumbers === null}>
              {pending ? "Adding…" : `Add to ${MEAL_LABELS[meal].toLowerCase()}`}
            </Button>
            <Button variant="ghost" onClick={() => setChoice(null)} disabled={pending}>
              Back
            </Button>
          </div>
        </section>
      )}

      {plate?.status === "reading" && (
        <p className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Reading the photo. It takes up to half a minute.
        </p>
      )}

      {plate?.status === "review" && !replacing && (
        <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <h2 className="font-medium">On the plate</h2>
          <ul className="space-y-3">
            {plate.rows.map((row, i) => {
              const n = plateNumbers[i];
              const units = row.match ? unitsOf(row.match) : GRAM_UNITS.map((u) => u.label);
              return (
                <li key={row.id} className="space-y-2 border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{`Seen: ${row.seen}`}</p>
                      <p className={cn(!row.match && "text-destructive")}>
                        {row.match ? row.match.name : "No match on the list. Choose a food."}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${row.seen}`}
                      onClick={() =>
                        setPlate({ status: "review", rows: plate.rows.filter((r) => r.id !== row.id) })
                      }
                    >
                      <X aria-hidden />
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      inputMode="decimal"
                      aria-label={`How much ${row.seen}`}
                      value={row.amountText}
                      onChange={(e) => editRow(row.id, { amountText: e.target.value })}
                      className="w-20"
                    />
                    <select
                      aria-label={`Portion of ${row.seen}`}
                      value={row.portion}
                      onChange={(e) => editRow(row.id, { portion: e.target.value })}
                      className="h-9 max-w-[12rem] rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
                    >
                      {units.map((label) => (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setReplacing(row.id);
                        search(row.seen);
                      }}
                    >
                      {row.match ? "Change food" : "Choose a food"}
                    </Button>
                  </div>
                  {n && <Numbers n={n} />}
                </li>
              );
            })}
          </ul>
          {plate.rows.length > 0 && plateReady && (
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-sm font-medium">All of it</p>
              <Numbers n={totals(plateNumbers as Nutrients[])} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            The amounts are estimates from the photo: check each one. The photo is not kept.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={addPlate} disabled={pending || !plateReady}>
              {pending ? "Adding…" : `Add all to ${MEAL_LABELS[meal].toLowerCase()}`}
            </Button>
            <Button variant="ghost" onClick={() => setPlate(null)} disabled={pending}>
              Discard
            </Button>
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Foods and their nutrition from USDA FoodData Central (FNDDS 2021-2023), per 100 g, for the amount you choose.
      </p>
    </div>
  );
}
