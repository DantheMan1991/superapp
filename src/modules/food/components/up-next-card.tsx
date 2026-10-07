"use client";

import Link from "next/link";
import { Check, ChefHat, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEAL_LABELS, gramWords, kcalWords } from "../core/eating";
import { plainNumber } from "../core/recipe";
import { mealName } from "../core/today";
import { planAmountWords, planNumbers, type PlanItem } from "../core/week";
import { FoodThumb } from "./food-thumb";

const SOFT = "flex h-11 items-center justify-center gap-2 rounded-xl bg-food-soft px-4 text-[15px] font-medium hover:bg-food-tabs-track";

/**
 * UP NEXT (the Fresh Market redesign): the next planned meal today that is
 * not eaten yet (`upNext`), with its recipe's photo, what it is and what it
 * comes to, and Ate it, Change first and Cook. After Ate it the buttons give
 * way to "Logged to dinner. Nice work." and Undo, until the page is next
 * opened, when the card moves on to the meal after. A phone shows Ate it
 * beside the name, and Logged once it is; Change first and Cook are on the
 * meal's row below.
 */
export function UpNextCard({
  plan,
  logged,
  pending,
  onAte,
  onUndo,
}: {
  plan: PlanItem;
  /** Eaten just now from this card. */
  logged: boolean;
  pending: boolean;
  onAte: () => void;
  onUndo: () => void;
}) {
  const n = planNumbers(plan);
  const meal = mealName(plan.meal);
  const meta = [
    planAmountWords(plan),
    n.calories === null ? "no nutrition" : kcalWords(n.calories),
    n.proteinG === null ? null : `${gramWords(n.proteinG)} protein`,
  ]
    .filter(Boolean)
    .join(" · ");
  const cookHref =
    plan.kind === "cook" && plan.recipeId ? `/personal/m/food/recipes/${plan.recipeId}/cook?servings=${plainNumber(plan.make ?? 1)}` : null;

  return (
    <section aria-label="Up next" className="overflow-hidden rounded-2xl bg-card shadow-food-card @2xl:rounded-3xl">
      <div className="relative h-[150px] @2xl:h-[196px]">
        {plan.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private photo streamed through its own route
          <img src={plan.photoUrl} alt="" className="size-full object-cover" />
        ) : (
          <FoodThumb recipe={plan.kind !== "food"} category={plan.category ?? null} tone={plan.meal} className="size-full [&_svg]:size-14" />
        )}
        <span className="absolute top-3 left-3 rounded-full bg-card px-3 py-1 text-xs font-semibold shadow-food-tab">
          {logged ? `${meal} · logged` : `Up next · ${meal}, planned`}
        </span>
      </div>
      <div className="space-y-3 px-5 pt-[18px] pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-food-display text-[19px] leading-tight font-bold tracking-[-0.02em] @2xl:text-[22px]">
              {plan.kind !== "food" && <ChefHat className="size-5 shrink-0 text-food-accent" aria-hidden />}
              <span className="line-clamp-2">{plan.name}</span>
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">{meta}</p>
          </div>
          {/* A phone: Ate it beside the name, Logged once it is. */}
          <div className="shrink-0 @2xl:hidden">
            {logged ? (
              <span className="flex h-11 items-center gap-1.5 rounded-xl bg-food-success-tint px-3.5 text-[15px] font-semibold text-food-success-ink">
                <CircleCheck className="size-4" aria-hidden /> Logged
              </span>
            ) : (
              <button
                type="button"
                onClick={onAte}
                disabled={pending}
                className="flex h-11 items-center gap-2 rounded-xl bg-food-accent px-4 text-[15px] font-semibold text-white hover:bg-food-accent-hover active:translate-y-px disabled:opacity-50"
              >
                <Check className="size-4" aria-hidden /> Ate it
              </button>
            )}
          </div>
        </div>

        <div className="hidden @2xl:block">
          {logged ? (
            <div className="flex h-11 items-center justify-between gap-3 rounded-xl bg-food-success-tint pr-1.5 pl-3.5 text-food-success-ink">
              <span className="flex items-center gap-2 text-sm font-medium">
                <CircleCheck className="size-4 shrink-0" aria-hidden /> {`Logged to ${MEAL_LABELS[plan.meal].toLowerCase()}. Nice work.`}
              </span>
              <button
                type="button"
                onClick={onUndo}
                disabled={pending}
                className="h-8 rounded-lg bg-card px-3 text-sm font-medium text-foreground hover:bg-food-field disabled:opacity-50"
              >
                Undo
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onAte}
                disabled={pending}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-food-accent text-[15px] font-semibold text-white hover:bg-food-accent-hover active:translate-y-px disabled:opacity-50"
              >
                <Check className="size-4" aria-hidden /> Ate it
              </button>
              <Link href={`/personal/m/food/log?plan=${plan.id}`} className={SOFT}>
                Change first
              </Link>
              {cookHref && (
                <Link href={cookHref} className={cn(SOFT)}>
                  <ChefHat className="size-4" aria-hidden /> Cook
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
