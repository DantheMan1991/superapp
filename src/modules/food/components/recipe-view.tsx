"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Calculator, CalendarPlus, ChefHat, Minus, Plus } from "lucide-react";
import type { FoodNutrition } from "@/db/schema";
import { cn } from "@/lib/utils";
import { readLine, showLine } from "../core/amounts";
import { clampStep, isStale, realSteps } from "../core/cook";
import { nutritionTiles, type TilesSource } from "../core/nutrition";
import { NUTRITION_KEYS, NUTRITION_LABELS, plainNumber, yieldWords, type RecipeInput } from "../core/recipe";
import { useCookSession, writeCookSession } from "./cook-store";
import { FOOD_CARD, FOOD_PRIMARY, FOOD_QUIET, FOOD_SIZE, FOOD_SOFT } from "./food-styles";
import { FoodThumb, type ThumbTone } from "./food-thumb";
import { FoodTick } from "./food-tick";
import { useNow } from "./use-now";

const CARD = cn(FOOD_CARD, "p-4 @2xl:p-5");
const CARD_TITLE = "font-food-display text-xl font-bold tracking-[-0.02em]";
const GROUP = "text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

/**
 * A RECIPE, TO COOK FROM (docs/help/food/recipe.md; in the "Fresh Market"
 * skin, ADR 0132, from his mockup 2026-10-07): the photo first, the title and
 * its facts (drawn by the page, `intro`), a big Cook, then Add to the week
 * and Log it; the nutrition as four tiles, the recipe's own and (D4) what was
 * worked out from its ingredients for what it does not state; the
 * ingredients with the servings to scale them and a circle to tick each one
 * off; the steps, numbered; the notes. On a wide screen the photo sits beside
 * the title, and the ingredients beside the steps. Ticks and servings are
 * this screen's alone: nothing here is saved.
 */
export function RecipeView({
  recipeId,
  recipe,
  photo,
  tone,
  intro,
  worked = null,
}: {
  recipeId: string;
  recipe: RecipeInput;
  photo: { url: string; width: number; height: number } | null;
  /** The tint behind the chef's hat when there is no photo, the same as on its card. */
  tone: ThumbTone;
  /** The title, its times and where it came from. */
  intro: ReactNode;
  /** Its nutrition worked out from the ingredients (D4), per serving, and whether that still fits the recipe. */
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
  const href = `/personal/m/food/recipes/${recipeId}`;

  return (
    <div className="space-y-4 @3xl:space-y-6">
      <div className="grid gap-4 @3xl:grid-cols-[1.1fr_1fr] @3xl:items-start @3xl:gap-7">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private photo streamed through its own route
          <img
            src={photo.url}
            alt=""
            width={photo.width}
            height={photo.height}
            className="aspect-[16/10] w-full rounded-2xl object-cover @3xl:aspect-[4/3] @3xl:rounded-3xl"
          />
        ) : (
          <FoodThumb recipe tone={tone} className="h-28 w-full rounded-2xl @3xl:aspect-[4/3] @3xl:h-auto @3xl:rounded-3xl [&_svg]:size-12 @3xl:[&_svg]:size-16" />
        )}
        <div className="space-y-4 @3xl:space-y-5">
          {intro}
          <div className="space-y-2.5">
            {(recipe.steps.length > 0 || recipe.ingredients.length > 0) && (
              <CookButton recipeId={recipeId} recipe={recipe} servings={base !== null ? servings : null} />
            )}
            <div className="flex gap-2">
              <Link href={`/personal/m/food/week/add?recipe=${recipeId}`} className={cn(FOOD_SOFT, FOOD_SIZE.sm, "flex-1 @3xl:flex-none")}>
                <CalendarPlus className="size-4" aria-hidden /> Add to the week
              </Link>
              <Link href={`/personal/m/food/log?recipe=${recipeId}`} className={cn(FOOD_SOFT, FOOD_SIZE.sm, "flex-1 @3xl:flex-none")}>
                <Plus className="size-4" aria-hidden /> Log it
              </Link>
            </div>
          </div>
          <Nutrition own={recipe.nutrition} worked={worked} workHref={`${href}/nutrition`} />
        </div>
      </div>

      <div className="grid gap-4 @3xl:grid-cols-[1fr_1.25fr] @3xl:items-start @3xl:gap-5">
        <section className={CARD} aria-labelledby="recipe-ingredients">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <h2 id="recipe-ingredients" className={CARD_TITLE}>
              Ingredients
            </h2>
            {base !== null && servings !== null && (
              <div className="flex h-11 items-center rounded-2xl bg-food-field" role="group" aria-label="Servings">
                <button
                  type="button"
                  aria-label="Fewer"
                  disabled={servings - step < step - 1e-9}
                  onClick={() => setServings((n) => (n === null ? n : Math.max(step, n - step)))}
                  className="flex h-full w-10 items-center justify-center rounded-l-2xl hover:bg-food-soft disabled:opacity-30"
                >
                  <Minus className="size-4" aria-hidden />
                </button>
                <span className="min-w-[88px] px-1 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
                  {yieldWords(servings, recipe.yieldUnit)}
                </span>
                <button
                  type="button"
                  aria-label="More"
                  disabled={servings + step > 999}
                  onClick={() => setServings((n) => (n === null ? n : n + step))}
                  className="flex h-full w-10 items-center justify-center rounded-r-2xl hover:bg-food-soft disabled:opacity-30"
                >
                  <Plus className="size-4" aria-hidden />
                </button>
              </div>
            )}
          </div>
          {/* Always there, so pressing + or − never moves the rows under a finger; Reset joins it once scaled. */}
          {base !== null && (
            <p className="mt-2 text-xs text-muted-foreground">
              Made for {yieldWords(base, recipe.yieldUnit)}.
              {scaled && (
                <>
                  {" "}
                  <button type="button" className="font-semibold text-foreground underline-offset-2 hover:underline" onClick={() => setServings(base)}>
                    Reset
                  </button>
                </>
              )}
            </p>
          )}
          {recipe.ingredients.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No ingredients written down.</p>
          ) : (
            <ul className="mt-2">
              {recipe.ingredients.map((line, i) => {
                if (line.heading) {
                  return (
                    <li key={i} className={cn(GROUP, "pt-3 pb-1")}>
                      {line.text}
                    </li>
                  );
                }
                const read = readLine(line.text);
                const on = ticked.has(i);
                return (
                  <li key={i} className="border-t border-divider first:border-t-0">
                    <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(i)} className="flex w-full items-center gap-3 py-[7px] text-left">
                      <FoodTick on={on} />
                      <span className={cn("min-w-0 flex-1 text-sm @2xl:text-[15px]", on && "text-muted-foreground line-through")}>
                        {showLine(read, factor).map((part, j) =>
                          part.amount ? (
                            <span key={j} className="font-semibold">
                              {part.text}
                            </span>
                          ) : (
                            <span key={j}>{part.text}</span>
                          ),
                        )}
                        {scaled && !read.scales && /\d/.test(line.text) && (
                          <span className="ml-1.5 inline-block rounded-full bg-food-soft px-[7px] text-[11px] font-semibold text-muted-foreground">
                            as written
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {scaled && base !== null && recipe.steps.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Amounts in the steps are as written, for {yieldWords(base, recipe.yieldUnit)}.</p>
          )}
        </section>

        <div className="space-y-4 @3xl:space-y-5">
          <section className={CARD} aria-labelledby="recipe-steps">
            <h2 id="recipe-steps" className={CARD_TITLE}>
              Steps
            </h2>
            {recipe.steps.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No steps written down.</p>
            ) : (
              <ol>
                {recipe.steps.map((line, i) =>
                  line.heading ? (
                    <li key={i} className={cn(GROUP, "pt-4")}>
                      {line.text}
                    </li>
                  ) : (
                    <li key={i} className="mt-3 flex items-start gap-3">
                      <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-food-tint text-sm font-bold text-food-accent-ink">
                        {stepNumbers[i]}
                      </span>
                      <p className="min-w-0 flex-1 pt-1 text-sm whitespace-pre-line @2xl:text-[15px]">{line.text}</p>
                    </li>
                  ),
                )}
              </ol>
            )}
          </section>

          {recipe.notes && (
            <section className={CARD} aria-labelledby="recipe-notes">
              <h2 id="recipe-notes" className="font-food-display text-lg font-bold tracking-[-0.02em]">
                Notes
              </h2>
              <p className="mt-1.5 text-sm whitespace-pre-line">{recipe.notes}</p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const SOURCE_WORDS: Record<Exclude<TilesSource, "none">, string> = {
  own: "Per serving, as the recipe states it.",
  worked: "Per serving, worked out from the ingredients and USDA's list.",
  mixed: "Per serving. The dashed ones are worked out from the ingredients, as the recipe does not state them.",
  partial: "Per serving, as the recipe states it.",
};

/**
 * The nutrition card: the four main numbers as tiles, calories on Food's
 * tint, the rest of what the recipe states under them, and what to do about
 * what it does not state: Work it out from the ingredients, or (once worked
 * out) Check it again, with a note when the ingredients changed since.
 */
function Nutrition({
  own,
  worked,
  workHref,
}: {
  own: FoodNutrition | null;
  worked: { perServing: FoodNutrition; fits: boolean } | null;
  workHref: string;
}) {
  const { tiles, source } = nutritionTiles(own, worked?.perServing);
  const more = NUTRITION_KEYS.slice(4).filter((key) => own?.[key] !== undefined);
  const amountOf = (key: (typeof NUTRITION_KEYS)[number]) => `${plainNumber(own?.[key] ?? 0)} ${NUTRITION_LABELS[key].unit}`;
  const workIt = (
    <Link href={workHref} className={cn(FOOD_SOFT, FOOD_SIZE.sm, "mt-3")}>
      <Calculator className="size-4" aria-hidden /> Work it out from the ingredients
    </Link>
  );

  return (
    <section className={CARD} aria-labelledby="recipe-nutrition">
      <h2 id="recipe-nutrition" className="font-food-display text-lg font-bold tracking-[-0.02em]">
        Nutrition
      </h2>
      {source === "none" ? (
        <>
          <p className="mt-1 text-sm text-muted-foreground">This recipe states none, so it counts as no numbers on Today and the week.</p>
          {workIt}
        </>
      ) : (
        <>
          <p className="mt-0.5 text-xs text-muted-foreground">{SOURCE_WORDS[source]}</p>
          <dl className="mt-2.5 grid grid-cols-4 gap-2 text-center">
            {tiles.map((tile) => (
              <div
                key={tile.key}
                className={cn(
                  "flex flex-col-reverse rounded-xl border px-0.5 py-2",
                  tile.key === "calories" ? "bg-food-tint" : "bg-food-field",
                  source === "mixed" && tile.from === "worked" ? "border-dashed border-food-planned-edge" : "border-transparent",
                )}
              >
                <dt className="text-[11px] text-muted-foreground">{tile.label}</dt>
                <dd className={cn("text-[17px] font-bold tabular-nums", tile.value === null && "text-muted-foreground")}>{tile.value ?? "?"}</dd>
              </div>
            ))}
          </dl>
          {more.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">{more.map((key) => `${NUTRITION_LABELS[key].label} ${amountOf(key)}`).join(" · ")}</p>
          )}
          {(source === "worked" || source === "mixed") && (
            <>
              {worked && !worked.fits && (
                <p className="mt-2 text-xs font-medium text-food-accent-ink">
                  Worked out from an earlier version of the ingredients. Check it again to bring it up to date.
                </p>
              )}
              <Link href={workHref} className={cn(FOOD_SOFT, FOOD_SIZE.sm, "mt-3")}>
                Check it again
              </Link>
            </>
          )}
          {source === "partial" && (
            <>
              <p className="mt-2 text-xs text-muted-foreground">It does not state them all, so the rest count as no numbers on Today and the week.</p>
              {workIt}
            </>
          )}
        </>
      )}
    </section>
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
      <div className="space-y-2">
        <Link href={servings !== null ? `${href}?servings=${plainNumber(servings)}` : href} className={cn(FOOD_PRIMARY, FOOD_SIZE.lg, "w-full")}>
          <ChefHat className="size-5" aria-hidden /> Cook
        </Link>
        <p className="text-xs text-muted-foreground">The screen stays on, one step at a time, with timers from the steps.</p>
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
    <div className="space-y-1">
      <Link href={href} className={cn(FOOD_PRIMARY, FOOD_SIZE.lg, "w-full")}>
        <ChefHat className="size-5" aria-hidden /> Back to cooking
      </Link>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {where}
          {timers > 0 ? ` · ${timers === 1 ? "1 timer" : `${timers} timers`} running` : ""}
          {under.servings && recipe.yieldAmount ? ` · ${yieldWords(under.servings, recipe.yieldUnit)}` : ""}
        </p>
        <button type="button" className={cn(FOOD_QUIET, FOOD_SIZE.sm)} onClick={() => writeCookSession(recipeId, null)}>
          Start over
        </button>
      </div>
    </div>
  );
}
