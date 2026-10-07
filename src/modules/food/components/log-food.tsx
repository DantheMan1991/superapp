"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Camera, ChefHat, ChevronDown, Loader2, Plus, Search, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { DictateButton } from "@/components/app/dictate-button";
import { HelpButton } from "@/components/app/help-button";
import { cn } from "@/lib/utils";
import { deleteEatenAction, logFoodAction, logPlateAction, logRecipeAction, readPlateAction } from "../actions";
import {
  GRAM_UNITS,
  MEALS,
  MEAL_LABELS,
  amountWords,
  forGrams,
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
import { choiceNumbers, choiceWords, firstPortionWords, recentToChoice, unitsOf, type Choice, type RecentChoice } from "../core/choice";
import { PLATE_PHOTO_BASE64_LIMIT, PLATE_PHOTO_EDGE } from "../core/plate";
import { AmountSheet, type AmountPicked } from "./amount-sheet";
import { FoodThumb } from "./food-thumb";
import { newId } from "./new-id";
import { hasPlatePhoto, takePlatePhoto } from "./plate-handoff";
import { shrinkToFit } from "./shrink-photo";
import { useFoodSearch } from "./use-food-search";

export type { RecentChoice };

interface PlateRow {
  id: string;
  seen: string;
  match: FoodHit | null;
  amountText: string;
  portion: string;
}

type Plate = { status: "reading" } | { status: "review"; rows: PlateRow[] } | null;

type PlateRead = { rows: PlateRow[] } | { error: string };

/** A photo of the plate made small on the phone and read by Claude: what it found, to be checked, or why not. */
async function readPlatePhoto(file: File): Promise<PlateRead> {
  let jpeg: string | null = null;
  try {
    jpeg = (await shrinkToFit(file, PLATE_PHOTO_EDGE, PLATE_PHOTO_BASE64_LIMIT))?.jpeg ?? null;
  } catch {
    jpeg = null;
  }
  if (!jpeg) return { error: "That photo could not be used. Try another one, a JPEG or PNG." };
  const outcome = await readPlateAction({ jpeg });
  if ("error" in outcome) return { error: outcome.error };
  return {
    rows: outcome.items.map((item) => ({
      id: item.id,
      seen: item.seen,
      match: item.match,
      amountText: String(item.grams),
      portion: "g",
    })),
  };
}

const FIELD = "h-11 rounded-xl bg-food-field px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-food-accent";
const SOFT = "flex h-10 items-center justify-center gap-2 rounded-xl bg-food-soft px-4 text-sm font-medium hover:bg-food-tabs-track";

/** The four numbers he counts, shown alike (his call): calories, protein, carbs, fat. */
function Numbers({ n, className }: { n: Nutrients; className?: string }) {
  const cells = [
    { label: "kcal", value: n.calories === null ? "–" : Math.round(n.calories).toLocaleString("en-US"), main: true },
    { label: "protein", value: n.proteinG === null ? "–" : gramWords(n.proteinG) },
    { label: "carbs", value: n.carbsG === null ? "–" : gramWords(n.carbsG) },
    { label: "fat", value: n.fatG === null ? "–" : gramWords(n.fatG) },
  ];
  return (
    <dl className={cn("grid grid-cols-4 gap-2 text-center", className)}>
      {cells.map((cell) => (
        <div key={cell.label} className={cn("flex flex-col-reverse rounded-lg px-1 py-1.5", cell.main ? "bg-food-tint" : "bg-food-field")}>
          <dt className="text-[11px] text-muted-foreground">{cell.label}</dt>
          <dd className="text-sm font-bold tabular-nums">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * LOG FOOD (D4a, docs/help/food/log.md; redrawn in the "Fresh Market" design,
 * ADR 0132): find a food on USDA's list or one of your recipes, say how much
 * in the sheet, and add it to a meal; tap + on something logged lately to add
 * it again at once; or take a photo of the plate, check what was found, and
 * add it all. You stay here to add the next thing; Done goes back to the day.
 *
 * The search is a GET the box can drop (`/api/food/search`): each keystroke
 * cancels the request before it, so an old answer never lands over a newer
 * one. The numbers shown are worked out here from the list's per-100 g
 * figures, the same arithmetic the server keeps (`core/eating.ts`). A photo
 * taken from Today's camera arrives through `plate-handoff.ts` and is read
 * at once.
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
  speech = false,
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
  /** Whether the server can turn speech into words (the microphone). */
  speech?: boolean;
}) {
  const router = useRouter();
  const [meal, setMeal] = useState<Meal>(initialMeal);
  const { q, results, searching, search } = useFoodSearch();
  const [choice, setChoice] = useState<Choice | null>(initial);
  const [start, setStart] = useState<AmountPicked | null>(initialAmount);
  const [planId, setPlanId] = useState(fromPlan);
  const [added, setAdded] = useState<{ id: string; words: string; meal: Meal }[]>([]);
  // A photo handed over from Today's camera is being read from the first frame.
  const [plate, setPlate] = useState<Plate>(() => (hasPlatePhoto() ? { status: "reading" } : null));
  const [replacing, setReplacing] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const searchBox = useRef<HTMLInputElement | null>(null);
  const camera = useRef<HTMLInputElement | null>(null);

  function choose(next: Choice, amount: AmountPicked | null = null) {
    if (replacing && plate?.status === "review" && next.kind === "food") {
      // Choosing the food for an item on the plate: its grams stay.
      setPlate({ status: "review", rows: plate.rows.map((row) => (row.id === replacing ? { ...row, match: next.food } : row)) });
      setReplacing(null);
      search("");
      return;
    }
    setChoice(next);
    setStart(amount);
  }

  /** Log a choice at an amount, into the meal chosen above: from the sheet, or at once from + on something recent. */
  function log(next: Choice, picked: AmountPicked) {
    const id = newId();
    const words = choiceWords(next, picked.amount, picked.portion);
    const into = meal;
    startTransition(async () => {
      const plan = planId ? { planId } : {};
      const outcome =
        next.kind === "food"
          ? await logFoodAction({ id, day, meal: into, fdcId: next.food.fdcId, amount: picked.amount, portion: picked.portion, ...plan })
          : await logRecipeAction({ id, day, meal: into, recipeId: next.recipe.recipeId, servings: picked.amount, ...plan });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setPlanId(null);
      setAdded((now) => [{ id, words, meal: into }, ...now]);
      setChoice(null);
      search("");
    });
  }

  function undo(id: string) {
    startTransition(async () => {
      const outcome = await deleteEatenAction({ id });
      if ("error" in outcome) toast.error(outcome.error);
      else setAdded((now) => now.filter((a) => a.id !== id));
    });
  }

  /** What was found on the plate, to check; or nothing, and why. */
  function showPlate(read: PlateRead) {
    if ("error" in read) {
      setPlate(null);
      toast.error(read.error);
      return;
    }
    setPlate({ status: "review", rows: read.rows });
  }

  function readPhoto(file: File) {
    setChoice(null);
    setPlate({ status: "reading" });
    void readPlatePhoto(file).then(showPlate);
  }

  // Today's camera hands its photo over in memory (`plate-handoff.ts`): taken once, on arrival, and shown
  // as being read from the first frame. Its answer lands in a callback, the way an effect is meant to
  // hear from outside; with no clean-up, so React's practice remount in development cannot drop it.
  useEffect(() => {
    const file = takePlatePhoto();
    if (file) void readPlatePhoto(file).then(showPlate);
  }, []);

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

  const browsing = plate === null && q.trim() === "";
  const showResults = q.trim() !== "";

  function recipeRow(recipe: RecipeHit) {
    return (
      <li key={recipe.recipeId}>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-food-field"
          onClick={() => choose({ kind: "recipe", recipe })}
        >
          <FoodThumb photoUrl={recipe.photoUrl ?? null} recipe tone={meal} className="size-11 rounded-lg" />
          <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-medium">
            {recipe.photoUrl && <ChefHat className="size-3.5 shrink-0 text-food-accent" aria-hidden />}
            <span className="truncate">{recipe.title}</span>
          </span>
        </button>
      </li>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href={backHref} className="-ml-1 flex items-center gap-1.5 rounded-lg px-1 py-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Food
        </Link>
        <Link href={backHref} className="flex h-[34px] items-center rounded-full bg-card px-4 text-sm font-semibold ring-1 ring-border hover:bg-food-field">
          Done
        </Link>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-food-display text-[28px] leading-tight font-bold tracking-[-0.02em]">Log food</h1>
          <HelpButton />
        </div>
        <p className="text-sm text-muted-foreground">{`${dayLabel} · goes into`}</p>
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
      </div>

      {added.length > 0 && (
        <ul className="space-y-1 rounded-2xl bg-food-success-tint px-4 py-2.5 text-food-success-ink" aria-label="Added just now">
          {added.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0">{`Added to ${MEAL_LABELS[a.meal].toLowerCase()}: ${a.words}`}</span>
              <button
                type="button"
                onClick={() => undo(a.id)}
                disabled={pending}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-card px-3 text-sm font-medium text-foreground hover:bg-food-field disabled:opacity-50"
              >
                <Undo2 className="size-3.5" aria-hidden /> Undo
              </button>
            </li>
          ))}
        </ul>
      )}

      {replacing && (
        <p className="text-sm">
          {`Choose the food for: ${plateRows.find((r) => r.id === replacing)?.seen ?? ""}. `}
          <button type="button" className="font-medium text-food-accent-ink underline" onClick={() => setReplacing(null)}>
            Cancel
          </button>
        </p>
      )}

      {(plate === null || replacing) && (
        <div className="relative rounded-xl bg-card ring-1 ring-food-chip-ring focus-within:shadow-food-focus focus-within:ring-2 focus-within:ring-food-accent">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-food-accent" aria-hidden />
          <input
            ref={searchBox}
            autoFocus
            value={q}
            onChange={(e) => search(e.target.value)}
            placeholder="Search foods or your recipes"
            aria-label="Search foods or your recipes"
            className="h-[50px] w-full rounded-xl bg-transparent pr-12 pl-12 text-base outline-none placeholder:text-muted-foreground"
          />
          <span className="absolute top-1/2 right-1.5 -translate-y-1/2">
            {q !== "" ? (
              <button
                type="button"
                aria-label="Clear the search"
                className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => {
                  search("");
                  searchBox.current?.focus();
                }}
              >
                <X className="size-4" aria-hidden />
              </button>
            ) : (
              <DictateButton
                serverConfigured={speech}
                endpoint="/api/food/transcribe"
                look="icon"
                onText={(said) => {
                  search(said);
                  searchBox.current?.focus();
                }}
                className="size-9 rounded-lg text-muted-foreground hover:text-foreground aria-pressed:bg-food-tint aria-pressed:text-food-accent-ink"
              />
            )}
          </span>
        </div>
      )}

      {browsing && (
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
              if (file) readPhoto(file);
            }}
          />
          <button
            type="button"
            onClick={() => camera.current?.click()}
            className="flex w-full items-center gap-3 rounded-xl bg-food-tint p-3 text-left hover:brightness-[0.98]"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-food-accent text-white" aria-hidden>
              <Camera className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold">Photo of the plate</span>
              <span className="block text-[13px] text-muted-foreground">Snap it, check what was found, add it all</span>
            </span>
          </button>

          {recent.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Recent · one tap adds it</h2>
              <ul>
                {recent.map((item) => {
                  const pick = recentToChoice(item);
                  if (!pick) return null;
                  const portion = item.recipe ? "serving" : item.portion;
                  const n = choiceNumbers(pick, item.amount, portion);
                  const name = item.recipe?.title ?? item.food?.name ?? "";
                  const amount = amountWords(item.amount, portion);
                  return (
                    <li key={item.key} className="flex items-center gap-3 py-1.5">
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        onClick={() => choose(pick, { amount: item.amount, portion })}
                      >
                        <FoodThumb
                          photoUrl={item.recipe?.photoUrl ?? null}
                          recipe={item.recipe !== null}
                          category={item.food?.category ?? null}
                          tone={meal}
                          className="size-11 rounded-lg"
                        />
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 text-[15px] font-medium">
                            {item.recipe?.photoUrl && <ChefHat className="size-3.5 shrink-0 text-food-accent" aria-hidden />}
                            <span className="truncate">{name}</span>
                          </span>
                          <span className="block truncate text-[13px] text-muted-foreground">
                            {[amount, n?.calories == null ? null : kcalWords(n.calories)].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Add ${name}, ${amount}, to ${MEAL_LABELS[meal].toLowerCase()}`}
                        disabled={pending}
                        onClick={() => log(pick, { amount: item.amount, portion })}
                        className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-food-tint text-food-accent-ink hover:bg-food-accent hover:text-white disabled:opacity-50"
                      >
                        <Plus className="size-4" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
          {recipes.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Your recipes</h2>
              <ul className="-mx-2">{recipes.map(recipeRow)}</ul>
            </section>
          )}
        </>
      )}

      {showResults && (!choice || replacing !== null) && (
        <div className="space-y-3" aria-live="polite">
          {searching && !results && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
            </p>
          )}
          {results && !replacing && results.recipes.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Your recipes</h2>
              <ul className="-mx-2">{results.recipes.map(recipeRow)}</ul>
            </section>
          )}
          {results && results.foods.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Foods</h2>
              <ul className="-mx-2">
                {results.foods.map((food) => (
                  <li key={food.fdcId}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-food-field"
                      onClick={() => choose({ kind: "food", food })}
                    >
                      <FoodThumb category={food.category} tone={meal} className="size-11 rounded-lg" />
                      <span className="min-w-0">
                        <span className="block text-[15px] font-medium">{food.name}</span>
                        <span className="block text-[13px] text-muted-foreground">{`${food.category} · ${firstPortionWords(food)}`}</span>
                      </span>
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

      {plate?.status === "reading" && (
        <p className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3 shadow-food-card">
          <Loader2 className="size-4 animate-spin text-food-accent" aria-hidden /> Reading the photo. It takes up to half a minute.
        </p>
      )}

      {plate?.status === "review" && !replacing && (
        <section className="space-y-3 rounded-3xl bg-card p-4 shadow-food-card">
          <h2 className="font-food-display text-xl font-bold tracking-[-0.02em]">On the plate</h2>
          <ul className="space-y-3">
            {plate.rows.map((row, i) => {
              const n = plateNumbers[i];
              const units = row.match ? unitsOf(row.match) : GRAM_UNITS.map((u) => u.label);
              return (
                <li key={row.id} className="space-y-2 border-t border-divider pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-start gap-3">
                    <FoodThumb category={row.match?.category ?? null} tone={meal} className="size-11 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">{`Seen: ${row.seen}`}</p>
                      <p className={cn("text-[15px] font-medium", !row.match && "text-destructive")}>
                        {row.match ? row.match.name : "No match on the list. Choose a food."}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${row.seen}`}
                      onClick={() => setPlate({ status: "review", rows: plate.rows.filter((r) => r.id !== row.id) })}
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      inputMode="decimal"
                      aria-label={`How much ${row.seen}`}
                      value={row.amountText}
                      onChange={(e) => editRow(row.id, { amountText: e.target.value })}
                      className={cn(FIELD, "w-20 shrink-0 tabular-nums")}
                    />
                    {/* A food's portions can be long ("1 medium slice (yield after cooking)"): the box shrinks, not the row. */}
                    <span className="relative min-w-0 max-w-[14rem] flex-1">
                      <select
                        aria-label={`Portion of ${row.seen}`}
                        value={row.portion}
                        onChange={(e) => editRow(row.id, { portion: e.target.value })}
                        className={cn(FIELD, "w-full appearance-none truncate pr-9")}
                      >
                        {units.map((label) => (
                          <option key={label} value={label}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    </span>
                    <button
                      type="button"
                      className={cn(SOFT, "shrink-0 whitespace-nowrap")}
                      onClick={() => {
                        setReplacing(row.id);
                        search(row.seen);
                      }}
                    >
                      {row.match ? "Change food" : "Choose a food"}
                    </button>
                  </div>
                  {n && <Numbers n={n} />}
                </li>
              );
            })}
          </ul>
          {plate.rows.length > 0 && plateReady && (
            <div className="space-y-1 border-t border-divider pt-3">
              <p className="text-sm font-semibold">All of it</p>
              <Numbers n={totals(plateNumbers as Nutrients[])} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">The amounts are estimates from the photo: check each one. The photo is not kept.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addPlate}
              disabled={pending || !plateReady}
              className="h-11 rounded-xl bg-food-accent px-5 text-[15px] font-semibold text-white hover:bg-food-accent-hover active:translate-y-px disabled:opacity-50"
            >
              {pending ? "Adding…" : `Add all to ${MEAL_LABELS[meal].toLowerCase()}`}
            </button>
            <button type="button" onClick={() => setPlate(null)} disabled={pending} className={cn(SOFT, "h-11")}>
              Discard
            </button>
          </div>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Foods and their nutrition from USDA FoodData Central (FNDDS 2021-2023), per 100 g, for the amount you choose.
      </p>

      <AmountSheet
        choice={replacing ? null : choice}
        onClose={() => setChoice(null)}
        meal={meal}
        initial={start}
        planned={planId !== null}
        pending={pending}
        onAdd={(picked) => choice && log(choice, picked)}
      />
    </div>
  );
}
