"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Camera, ChefHat, Loader2, Plus, Search, X } from "lucide-react";
import { DictateButton } from "@/components/app/dictate-button";
import { cn } from "@/lib/utils";
import { MEAL_LABELS, amountWords, type Meal } from "../core/eating";
import { firstPortionWords, recentToChoice, type Choice, type RecentChoice } from "../core/choice";
import { AmountSheet, type AmountPicked } from "./amount-sheet";
import { FoodThumb } from "./food-thumb";
import { handPlatePhoto } from "./plate-handoff";
import { useFoodSearch } from "./use-food-search";

/** Log food's address for a day and a meal. */
export function logFoodHref(day: string, meal: Meal): string {
  return `/personal/m/food/log?meal=${meal}&day=${day}`;
}

/**
 * THE CAMERA, from Today (the redesign): the phone's camera, or a file on a
 * computer; the photo goes to Log food, which reads it and asks the person to
 * check what was found (`plate-handoff.ts`).
 */
export function usePlateCamera(day: string, meal: Meal) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        handPlatePhoto(file);
        router.push(logFoodHref(day, meal));
      }}
    />
  );
  return { element, open: () => input.current?.click() };
}

/**
 * TODAY'S SEARCH BAR (the Fresh Market redesign, NEW on Today; a wide screen,
 * the phone has the floating bar): what was eaten, searched as it is typed by
 * Log food's own rules, the results under the box; choosing one opens the
 * amount sheet. The meal it goes into is the one the time of day suggests,
 * changed in the sheet. The microphone writes what is said into the box; the
 * camera takes a photo of the plate to Log food. "Again?" offers the last
 * four things logged: + logs one at once at its last amount, and the chip
 * itself opens the sheet.
 */
export function QuickLog({
  day,
  meal,
  recent,
  speech,
  pending,
  onLog,
  className,
}: {
  day: string;
  meal: Meal;
  recent: RecentChoice[];
  speech: boolean;
  pending: boolean;
  onLog: (choice: Choice, picked: AmountPicked, meal: Meal) => void;
  className?: string;
}) {
  const { q, results, searching, search } = useFoodSearch();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [initial, setInitial] = useState<AmountPicked | null>(null);
  const [sheetMeal, setSheetMeal] = useState<Meal>(meal);
  const camera = usePlateCamera(day, meal);
  const box = useRef<HTMLInputElement | null>(null);
  // The results drop down while the bar has the focus, and fold away when it goes elsewhere on the page.
  const [focused, setFocused] = useState(false);

  function choose(next: Choice, start: AmountPicked | null = null) {
    setChoice(next);
    setInitial(start);
    setSheetMeal(meal);
  }

  function add(picked: AmountPicked) {
    if (!choice) return;
    onLog(choice, picked, sheetMeal);
    setChoice(null);
    search("");
  }

  const chips = recent.slice(0, 4);
  const showResults = q.trim() !== "" && focused;

  return (
    <section
      aria-label="Log what you ate"
      className={cn("rounded-3xl bg-card p-2.5 shadow-food-bar", className)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {camera.element}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-food-accent" aria-hidden />
          <input
            ref={box}
            value={q}
            onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && search("")}
            placeholder="What did you eat? Try “banana” or “chicken rice bowl”"
            aria-label="Search foods or your recipes"
            className="h-[52px] w-full rounded-xl bg-food-field pr-28 pl-12 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-food-accent"
          />
          {q !== "" ? (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => {
                search("");
                box.current?.focus();
              }}
              className="absolute top-1/2 right-3 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : (
            <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-xs font-medium text-subtle-foreground">
              {`into ${MEAL_LABELS[meal]}`}
            </span>
          )}

          {showResults && (
            <div
              className="absolute inset-x-0 top-full z-20 mt-2 max-h-[26rem] overflow-y-auto rounded-2xl bg-card p-2 shadow-elevation-3"
              aria-live="polite"
              // The box keeps the focus while a result is pressed, so the list cannot fold away under the pointer.
              onMouseDown={(e) => e.preventDefault()}
            >
              {searching && !results && (
                <p className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
                </p>
              )}
              {results && results.recipes.length > 0 && (
                <>
                  <p className="px-3 pt-1 pb-1 text-xs font-semibold text-muted-foreground">Your recipes</p>
                  <ul>
                    {results.recipes.map((recipe) => (
                      <li key={recipe.recipeId}>
                        <button
                          type="button"
                          onClick={() => choose({ kind: "recipe", recipe })}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-food-field"
                        >
                          <FoodThumb photoUrl={recipe.photoUrl ?? null} recipe tone={meal} className="size-10 rounded-lg" />
                          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                            {recipe.photoUrl && <ChefHat className="size-3.5 shrink-0 text-food-accent" aria-hidden />}
                            <span className="truncate">{recipe.title}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {results && results.foods.length > 0 && (
                <>
                  <p className="px-3 pt-2 pb-1 text-xs font-semibold text-muted-foreground">Foods</p>
                  <ul>
                    {results.foods.map((food) => (
                      <li key={food.fdcId}>
                        <button
                          type="button"
                          onClick={() => choose({ kind: "food", food })}
                          className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-food-field"
                        >
                          <FoodThumb category={food.category} tone={meal} className="size-10 rounded-lg" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{food.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">{`${food.category} · ${firstPortionWords(food)}`}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {results && results.foods.length === 0 && results.recipes.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">{`Nothing found for “${results.q}”. Try fewer words, or other ones.`}</p>
              )}
            </div>
          )}
        </div>
        <DictateButton
          serverConfigured={speech}
          endpoint="/api/food/transcribe"
          look="icon"
          onText={(said) => {
            search(said);
            box.current?.focus();
          }}
          className="size-[52px] rounded-xl bg-food-field text-foreground hover:bg-food-soft aria-pressed:bg-food-tint aria-pressed:text-food-accent-ink"
        />
        <button
          type="button"
          onClick={camera.open}
          className="flex h-[52px] shrink-0 items-center gap-2 rounded-xl bg-food-accent px-5 text-[15px] font-semibold text-white hover:bg-food-accent-hover active:translate-y-px"
        >
          <Camera className="size-5" aria-hidden /> Photo of the plate
        </button>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-1.5 pt-2.5 pb-1">
          <span className="text-xs font-semibold text-subtle-foreground">Again?</span>
          {chips.map((item) => {
            const pick = recentToChoice(item);
            if (!pick) return null;
            const name = item.recipe?.title ?? item.food?.name ?? "";
            const amount = amountWords(item.amount, item.recipe ? "serving" : item.portion);
            const start = { amount: item.amount, portion: item.recipe ? "serving" : item.portion };
            return (
              // USDA's names run long ("Yogurt, Greek, nonfat milk, plain"): a chip truncates its name so four fit on a line.
              <span key={item.key} className="flex h-[34px] max-w-[13rem] items-center gap-1.5 rounded-full bg-card pr-1.5 pl-1 ring-1 ring-food-chip-ring">
                <button
                  type="button"
                  title={`${name} · ${amount}`}
                  onClick={() => choose(pick, start)}
                  className="flex min-w-0 items-center gap-1.5 rounded-full"
                >
                  <FoodThumb
                    photoUrl={item.recipe?.photoUrl ?? null}
                    recipe={item.recipe !== null}
                    category={item.food?.category ?? null}
                    tone={meal}
                    className="size-[26px] rounded-full"
                  />
                  <span className="truncate text-[13px]">{`${name} · ${amount}`}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Add ${name}, ${amount}, to ${MEAL_LABELS[meal].toLowerCase()}`}
                  disabled={pending}
                  onClick={() => onLog(pick, start, meal)}
                  className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-food-tint text-food-accent-ink hover:bg-food-accent hover:text-white disabled:opacity-50"
                >
                  <Plus className="size-3.5" aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <AmountSheet
        choice={choice}
        onClose={() => setChoice(null)}
        meal={sheetMeal}
        onMealChange={setSheetMeal}
        initial={initial}
        pending={pending}
        onAdd={add}
      />
    </section>
  );
}
