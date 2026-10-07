import type { FoodPortion } from "@/db/schema";
import { NUTRIENT_KEYS, forGrams, forServings, gramWords, gramsFor, type Meal, type Nutrients, type TargetsInput } from "../core/eating";
import type { AmountPicked } from "./amount-sheet";
import type { Choice } from "../core/choice";
import { planNumbers, type PlanItem } from "../core/week";

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
  /** A recipe's, for working its nutrition out when it has none (D4). */
  recipeId?: string | null;
  /** A food's USDA category, for its icon (the redesign). */
  category?: string | null;
  /** A recipe's photo. */
  photoUrl?: string | null;
}

/** What the server's copy is, to tell when it changed (Today adopts it then). */
export function entriesKey(entries: readonly EntryView[]): string {
  return entries.map((e) => `${e.id}:${e.meal}:${e.amount}:${e.portion}:${e.calories ?? ""}`).join("|");
}

export function plansKey(plans: readonly PlanItem[]): string {
  return plans.map((p) => `${p.id}:${p.meal}:${p.eatenId ?? ""}:${p.servings ?? ""}:${p.make ?? ""}:${p.amount ?? ""}`).join("|");
}

export function targetsKey(targets: TargetsInput): string {
  return `${targets.calories ?? ""}:${targets.proteinG ?? ""}`;
}

/** An entry's numbers for a new amount, scaled from the ones it was logged with; null when the portion is not one it has. */
export function rescaled(entry: EntryView, amount: number, portion: string): (Nutrients & { grams: number | null }) | null {
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

/** "24 g protein · 9 g carbs · 1 g fat", the design's order of words. */
export function macroLine(n: Pick<Nutrients, "proteinG" | "carbsG" | "fatG">): string {
  return [
    n.proteinG === null ? null : `${gramWords(n.proteinG)} protein`,
    n.carbsG === null ? null : `${gramWords(n.carbsG)} carbs`,
    n.fatG === null ? null : `${gramWords(n.fatG)} fat`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What a choice logs as, shown at once before the server's copy arrives: the numbers the server will keep. */
export function entryFromChoice(id: string, choice: Choice, picked: AmountPicked, meal: Meal): EntryView {
  if (choice.kind === "recipe") {
    return {
      id,
      meal,
      source: "recipe",
      name: choice.recipe.title,
      amount: picked.amount,
      portion: "serving",
      grams: null,
      portions: null,
      recipeId: choice.recipe.recipeId,
      photoUrl: choice.recipe.photoUrl ?? null,
      ...forServings(choice.recipe.perServing, picked.amount),
    };
  }
  const grams = gramsFor(picked.amount, picked.portion, choice.food.portions);
  return {
    id,
    meal,
    source: "food",
    name: choice.food.name,
    amount: picked.amount,
    portion: picked.portion,
    grams,
    portions: choice.food.portions,
    category: choice.food.category,
    ...forGrams(choice.food.per100g, grams ?? 0),
  };
}

/** A planned meal logged as planned ("Ate it"), shown at once. */
export function entryFromPlan(id: string, plan: PlanItem): EntryView {
  return {
    id,
    meal: plan.meal,
    source: plan.kind === "food" ? "food" : "recipe",
    name: plan.name,
    amount: (plan.kind === "food" ? plan.amount : plan.servings) ?? 1,
    portion: plan.kind === "food" ? (plan.portion ?? "g") : "serving",
    grams: plan.kind === "food" ? plan.grams : null,
    portions: plan.kind === "food" ? plan.portions : null,
    recipeId: plan.kind === "food" ? null : plan.recipeId,
    category: plan.category ?? null,
    photoUrl: plan.photoUrl ?? null,
    ...planNumbers(plan),
  };
}
