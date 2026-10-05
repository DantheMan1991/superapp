"use client";

import Link from "next/link";
import { useState } from "react";
import { Calculator, ChefHat, Minus, Plus } from "lucide-react";
import type { FoodNutrition } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { readLine, showLine } from "../core/amounts";
import { clampStep, isStale, realSteps } from "../core/cook";
import { useCookSession, writeCookSession } from "./cook-store";
import { useNow } from "./use-now";
import { NUTRITION_KEYS, NUTRITION_LABELS, plainNumber, yieldWords, type RecipeInput } from "../core/recipe";
import { gramWords, kcalWords } from "../core/eating";
import { MAIN_KEYS, statesAll } from "../core/nutrition";

/**
 * A RECIPE, TO COOK FROM (docs/help/food/recipe.md): the photo, the servings
 * with − and +, the ingredients scaled to them with a box to tick each one
 * off, the steps, and the nutrition: the recipe's own, and (D4) what was
 * worked out from its ingredients for what it does not state, with Work it
 * out or Check it again. Ticks and servings are this screen's alone: nothing
 * here is saved.
 */
export function RecipeView({
  recipeId,
  recipe,
  photo,
  worked = null,
}: {
  recipeId: string;
  recipe: RecipeInput;
  photo: { url: string; width: number; height: number } | null;
  /** Its nutrition worked out from the ingredients (D4), and whether that still fits the recipe. */
  worked?: { perServing: FoodNutrition; fits: boolean } | null;
}) {
  const base = recipe.yieldAmount;
  const [servings, setServings] = useState<number | null>(base);
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set());
  const factor = base && servings ? servings / base : 1;
  const step = base !== null && base < 1 ? base : 1;
  const scaled = factor !== 1;

  function toggle(i: number) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // Steps are numbered across their groups; a heading takes no number.
  const stepNumbers = recipe.steps.reduce<number[]>((out, line, i) => {
    const before = i > 0 ? out[i - 1] : 0;
    out.push(line.heading ? before : before + 1);
    return out;
  }, []);
  const nutrition = recipe.nutrition;
  const main = NUTRITION_KEYS.slice(0, 4).filter((key) => nutrition?.[key] !== undefined);
  const more = NUTRITION_KEYS.slice(4).filter((key) => nutrition?.[key] !== undefined);
  const amountOf = (key: (typeof NUTRITION_KEYS)[number]) =>
    `${plainNumber(nutrition?.[key] ?? 0)}${NUTRITION_LABELS[key].unit === "kcal" ? " kcal" : ` ${NUTRITION_LABELS[key].unit}`}`;
  // What the worked-out numbers add: the main ones the recipe does not state itself (its own come first).
  const states = statesAll(nutrition);
  const workedKeys = MAIN_KEYS.filter((key) => nutrition?.[key] === undefined && worked?.perServing[key] !== undefined);
  const workedOf = (key: (typeof MAIN_KEYS)[number]) => {
    const value = worked?.perServing[key] ?? 0;
    // Rounded as the check screen and Today show them: an estimate is not exact to a tenth of a gram.
    return key === "calories" ? kcalWords(value) : `${gramWords(value)} ${NUTRITION_LABELS[key].label.toLowerCase()}`;
  };
  const workHref = `/personal/m/food/recipes/${recipeId}/nutrition`;

  return (
    <div className="space-y-6">
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element -- a private photo streamed through its own route
        <img
          src={photo.url}
          alt=""
          width={photo.width}
          height={photo.height}
          className="max-h-[28rem] w-full rounded-2xl object-cover"
        />
      )}

      {(recipe.steps.length > 0 || recipe.ingredients.length > 0) && (
        <CookButton recipeId={recipeId} recipe={recipe} servings={base !== null ? servings : null} />
      )}

      <section className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading font-medium tracking-heading">Ingredients</h2>
          {base !== null && servings !== null && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Fewer"
                disabled={servings - step < step - 1e-9}
                onClick={() => setServings((n) => (n === null ? n : Math.max(step, n - step)))}
              >
                <Minus aria-hidden />
              </Button>
              <span className="min-w-28 text-center font-medium" aria-live="polite">
                {yieldWords(servings, recipe.yieldUnit)}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="More"
                disabled={servings + step > 999}
                onClick={() => setServings((n) => (n === null ? n : n + step))}
              >
                <Plus aria-hidden />
              </Button>
            </div>
          )}
        </div>
        {scaled && base !== null && (
          <p className="text-sm text-muted-foreground">
            Made for {yieldWords(base, recipe.yieldUnit)}.{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => setServings(base)}>
              Reset
            </button>
          </p>
        )}
        {recipe.ingredients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No ingredients written down.</p>
        ) : (
          <ul className="space-y-1.5">
            {recipe.ingredients.map((line, i) => {
              if (line.heading) {
                return (
                  <li key={i} className="pt-2 text-sm font-medium">
                    {line.text}
                  </li>
                );
              }
              const read = readLine(line.text);
              return (
                <li key={i}>
                  <label className="flex items-start gap-3">
                    <Checkbox checked={ticked.has(i)} onCheckedChange={() => toggle(i)} className="mt-0.5" />
                    <span className={ticked.has(i) ? "text-muted-foreground line-through" : undefined}>
                      {showLine(read, factor).map((part, j) =>
                        part.amount ? (
                          <span key={j} className="font-medium text-module-accent">
                            {part.text}
                          </span>
                        ) : (
                          <span key={j}>{part.text}</span>
                        ),
                      )}
                      {scaled && !read.scales && /\d/.test(line.text) && (
                        <span className="ml-2 text-xs text-muted-foreground">as written</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {scaled && base !== null && recipe.steps.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Amounts in the steps are as written, for {yieldWords(base, recipe.yieldUnit)}.
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
        <h2 className="font-heading font-medium tracking-heading">Steps</h2>
        {recipe.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">No steps written down.</p>
        ) : (
          <ol className="space-y-3">
            {recipe.steps.map((line, i) => {
              if (line.heading) {
                return (
                  <li key={i} className="pt-1 text-sm font-medium">
                    {line.text}
                  </li>
                );
              }
              return (
                <li key={i} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                    {stepNumbers[i]}
                  </span>
                  <span className="whitespace-pre-line">{line.text}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {(nutrition || !states) && (
        <section className="space-y-1 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
          <h2 className="font-heading font-medium tracking-heading">Nutrition</h2>
          {nutrition && (
            <>
              <p className="text-sm text-muted-foreground">Per serving, as the recipe states it.</p>
              {main.length > 0 && (
                <p className="font-medium">
                  {main.map((key) => (key === "calories" ? amountOf(key) : `${amountOf(key)} ${NUTRITION_LABELS[key].label.toLowerCase()}`)).join(" · ")}
                </p>
              )}
              {more.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {more.map((key) => `${amountOf(key)} ${NUTRITION_LABELS[key].label.toLowerCase()}`).join(" · ")}
                </p>
              )}
            </>
          )}
          {!states &&
            (worked && workedKeys.length > 0 ? (
              <div className="space-y-2 pt-1">
                <p className="text-sm text-muted-foreground">
                  {nutrition
                    ? "Worked out from the ingredients, for what the recipe does not state:"
                    : "Per serving, worked out from the ingredients and USDA's list."}
                </p>
                <p className="font-medium">{workedKeys.map(workedOf).join(" · ")}</p>
                {!worked.fits && (
                  <p className="text-sm text-module-accent">
                    Worked out from an earlier version of the ingredients. Check it again to bring it up to date.
                  </p>
                )}
                <Button asChild size="sm" variant="outline">
                  <Link href={workHref}>Check it again</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <p className="text-sm text-muted-foreground">
                  {nutrition
                    ? "It does not state them all, so the rest count as no numbers on Today and the week."
                    : "This recipe states none, so it counts as no numbers on Today and the week."}
                </p>
                <Button asChild size="sm">
                  <Link href={workHref}>
                    <Calculator aria-hidden /> Work it out from the ingredients
                  </Link>
                </Button>
              </div>
            ))}
        </section>
      )}

      {recipe.notes && (
        <section className="space-y-2 rounded-2xl bg-card p-4 shadow-elevation-1 sm:p-5">
          <h2 className="font-heading font-medium tracking-heading">Notes</h2>
          <p className="whitespace-pre-line text-sm">{recipe.notes}</p>
        </section>
      )}
    </div>
  );
}

/**
 * Cook, at the servings chosen here (D1b); or, with a cook already under way
 * on this phone, Back to cooking, where it was left, at its own servings,
 * with Start over beside it. Read from the phone's store, so it is right on
 * this phone and says nothing about another.
 */
function CookButton({
  recipeId,
  recipe,
  servings,
}: {
  recipeId: string;
  recipe: RecipeInput;
  servings: number | null;
}) {
  const stored = useCookSession(recipeId);
  const now = useNow();
  const under = stored && now > 0 && !isStale(stored, now) ? stored : null;
  const href = `/personal/m/food/recipes/${recipeId}/cook`;
  if (!under) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <Link href={servings !== null ? `${href}?servings=${plainNumber(servings)}` : href}>
            <ChefHat aria-hidden /> Cook
          </Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          The screen stays on, one step at a time, with timers from the steps.
        </p>
      </div>
    );
  }
  const steps = realSteps(recipe.steps).length;
  const where =
    under.screen === "gather"
      ? "Gathering the ingredients"
      : under.screen === "done"
        ? "Finished"
        : `Step ${clampStep(under.step, steps) + 1} of ${steps}`;
  const timers = under.timers.length;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button asChild size="lg">
        <Link href={href}>
          <ChefHat aria-hidden /> Back to cooking
        </Link>
      </Button>
      <p className="text-sm text-muted-foreground">
        {where}
        {timers > 0 ? ` · ${timers === 1 ? "1 timer" : `${timers} timers`} running` : ""}
        {under.servings && recipe.yieldAmount ? ` · ${yieldWords(under.servings, recipe.yieldUnit)}` : ""}
      </p>
      <Button variant="ghost" size="sm" onClick={() => writeCookSession(recipeId, null)}>
        Start over
      </Button>
    </div>
  );
}
