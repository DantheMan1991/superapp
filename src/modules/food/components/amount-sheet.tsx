"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEALS, MEAL_LABELS, gramWords, typedAmount, type Meal } from "../core/eating";
import { choiceNumbers, choiceStart, stepFor, stepped, unitsOf, type Choice } from "../core/choice";
import { FoodSheet, FoodSheetDescription, FoodSheetTitle } from "./food-sheet";
import { FoodThumb } from "./food-thumb";

/** How much of a choice to add, as the sheet hands it back. */
export interface AmountPicked {
  amount: number;
  portion: string;
}

/**
 * HOW MUCH, AND ADD IT (the Fresh Market redesign's sheet, ADR 0132): what
 * was chosen, with its picture and its kind; the amount with − and + (a
 * serving at a time for a recipe, half a portion or 10 grams for a food) and
 * the portion; its calories, protein, carbs and fat as they will be logged;
 * and Add, named for the meal. A sheet from the bottom on a phone, a card in
 * the middle on a wide screen. Portalled out of the page, so it carries
 * Food's display face itself.
 *
 * Today's search bar shows the meal chips in the sheet, since Today has none;
 * Log food has them on the page.
 */
export function AmountSheet({
  choice,
  onClose,
  meal,
  onMealChange,
  initial = null,
  planned = false,
  pending,
  onAdd,
}: {
  choice: Choice | null;
  onClose: () => void;
  meal: Meal;
  onMealChange?: (meal: Meal) => void;
  initial?: AmountPicked | null;
  /** Opened from a planned meal (Change first): it is logged as that meal. */
  planned?: boolean;
  pending: boolean;
  onAdd: (picked: AmountPicked) => void;
}) {
  const key = choice ? (choice.kind === "food" ? `f:${choice.food.fdcId}` : `r:${choice.recipe.recipeId}`) : "none";
  return (
    <FoodSheet open={choice !== null} onClose={onClose}>
      {choice && (
        <SheetBody
          key={key}
          choice={choice}
          meal={meal}
          onMealChange={onMealChange}
          initial={initial}
          planned={planned}
          pending={pending}
          onAdd={onAdd}
          onClose={onClose}
        />
      )}
    </FoodSheet>
  );
}

function SheetBody({
  choice,
  meal,
  onMealChange,
  initial,
  planned,
  pending,
  onAdd,
  onClose,
}: {
  choice: Choice;
  meal: Meal;
  onMealChange?: (meal: Meal) => void;
  initial: AmountPicked | null;
  planned: boolean;
  pending: boolean;
  onAdd: (picked: AmountPicked) => void;
  onClose: () => void;
}) {
  const start = initial ?? choiceStart(choice);
  const [amountText, setAmountText] = useState(String(start.amount));
  const [portion, setPortion] = useState(
    choice.kind === "food" && !unitsOf(choice.food).includes(start.portion) ? choiceStart(choice).portion : start.portion,
  );
  const amount = typedAmount(amountText);
  const numbers = choiceNumbers(choice, amount, portion);
  const step = stepFor(choice, portion);
  const name = choice.kind === "food" ? choice.food.name : choice.recipe.title;
  const noNutrition = choice.kind === "recipe" && choice.recipe.perServing === null;

  function move(direction: 1 | -1) {
    setAmountText(String(stepped(amount ?? start.amount, step, direction)));
  }

  const tiles = [
    { label: "kcal", value: numbers?.calories == null ? "–" : Math.round(numbers.calories).toLocaleString("en-US"), main: true },
    { label: "protein", value: numbers?.proteinG == null ? "–" : gramWords(numbers.proteinG) },
    { label: "carbs", value: numbers?.carbsG == null ? "–" : gramWords(numbers.carbsG) },
    { label: "fat", value: numbers?.fatG == null ? "–" : gramWords(numbers.fatG) },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FoodThumb
          photoUrl={choice.kind === "recipe" ? (choice.recipe.photoUrl ?? null) : null}
          recipe={choice.kind === "recipe"}
          category={choice.kind === "food" ? choice.food.category : null}
          tone={meal}
          className="size-[52px] rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <FoodSheetTitle className="line-clamp-2 text-base font-semibold">{name}</FoodSheetTitle>
          <FoodSheetDescription className="truncate text-[13px] text-muted-foreground">
            {choice.kind === "food" ? choice.food.category : "Your recipe"}
          </FoodSheetDescription>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          Back
        </button>
      </div>

      {onMealChange && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Meal">
          {MEALS.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={meal === option}
              onClick={() => onMealChange(option)}
              className={cn(
                "h-[34px] rounded-full px-3.5 text-sm",
                meal === option ? "bg-food-accent font-semibold text-white" : "bg-card ring-1 ring-food-chip-ring hover:bg-food-field",
              )}
            >
              {MEAL_LABELS[option]}
            </button>
          ))}
        </div>
      )}
      {planned && <p className="text-sm text-muted-foreground">Planned for this meal. Change how much, then add it.</p>}

      <div className="flex gap-2">
        <div className="flex h-12 min-w-0 flex-1 items-center rounded-xl bg-food-field px-1">
          <button
            type="button"
            aria-label="Less"
            onClick={() => move(-1)}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-food-soft"
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <input
            aria-label="How much"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            className="w-full min-w-0 bg-transparent text-center text-xl font-bold tabular-nums outline-none"
          />
          <button
            type="button"
            aria-label="More"
            onClick={() => move(1)}
            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-food-soft"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
        {choice.kind === "food" ? (
          <div className="relative min-w-0 flex-1">
            <select
              aria-label="Portion"
              value={portion}
              onChange={(e) => setPortion(e.target.value)}
              className="h-12 w-full appearance-none truncate rounded-xl bg-food-field pr-9 pl-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-food-accent"
            >
              {unitsOf(choice.food).map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </div>
        ) : (
          <span className="flex h-12 flex-1 items-center rounded-xl bg-food-field px-4 text-base">
            {amount === 1 ? "serving" : "servings"}
          </span>
        )}
      </div>

      {amount === null ? (
        <p className="text-sm text-destructive">Type how much, a number above 0.</p>
      ) : noNutrition && choice.kind === "recipe" ? (
        <p className="text-sm text-muted-foreground">
          This recipe has no nutrition yet, so it is logged without numbers.{" "}
          <Link
            href={`/personal/m/food/recipes/${choice.recipe.recipeId}/nutrition`}
            className="font-medium text-food-accent-ink underline underline-offset-2"
          >
            Work it out from its ingredients
          </Link>{" "}
          first to count it.
        </p>
      ) : numbers === null ? (
        <p className="text-sm text-destructive">That amount is not one this food can be logged in.</p>
      ) : (
        <dl className="grid grid-cols-4 gap-2 text-center" aria-live="polite">
          {tiles.map((tile) => (
            // The label first for a screen reader, the figure on top for the eye.
            <div key={tile.label} className={cn("flex flex-col-reverse rounded-lg px-1 py-2", tile.main ? "bg-food-tint" : "bg-food-field")}>
              <dt className="text-[11px] text-muted-foreground">{tile.label}</dt>
              <dd className="text-[17px] font-bold tabular-nums">{tile.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <button
        type="button"
        disabled={pending || amount === null || numbers === null}
        onClick={() => amount !== null && onAdd({ amount, portion: choice.kind === "recipe" ? "serving" : portion })}
        className="h-[54px] w-full rounded-xl bg-food-accent text-base font-semibold text-white transition-colors hover:bg-food-accent-hover active:translate-y-px disabled:opacity-50"
      >
        {pending ? "Adding…" : `Add to ${MEAL_LABELS[meal].toLowerCase()}`}
      </button>
    </div>
  );
}
