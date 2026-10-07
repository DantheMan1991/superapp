"use client";

import Link from "next/link";
import { Fragment, useState, useTransition } from "react";
import { Check, ChefHat, ChevronDown, Copy, Minus, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import type { FoodPortion } from "@/db/schema";
import { addDays } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { addLeftoversAction, changePlanAction, movePlanAction, removePlanAction, repeatWeekAction } from "../actions";
import { GRAM_UNITS, MEALS, MEAL_LABELS, gramWords, gramsFor, kcalWords, typedAmount, type Meal, type TargetsInput } from "../core/eating";
import { stepped } from "../core/choice";
import { plainNumber, yieldWords } from "../core/recipe";
import { ringShare } from "../core/today";
import {
  batchLeft,
  canPlan,
  dayTitle,
  daysToPlan,
  eatsHere,
  isAfter,
  leftoverChoices,
  leftoverServings,
  openingDay,
  planAmountWords,
  planNumbers,
  planTotals,
  shortDay,
  slotKey,
  slotWords,
  weekAverage,
  weekDays,
  weekInReach,
  weekWords,
  type PlanItem,
  type Slot,
} from "../core/week";
import { useLeftToBuy, type ListBadgeInput } from "./food-nav";
import { FoodSheet, FoodSheetDescription, FoodSheetTitle } from "./food-sheet";
import { FOOD_CARD, FOOD_FIELD, FOOD_PRIMARY, FOOD_QUIET, FOOD_SIZE, FOOD_SOFT, foodChip } from "./food-styles";
import { FoodThumb, MealTile } from "./food-thumb";
import { newId } from "./new-id";

const WEEK = "/personal/m/food/week";

function addHref(day: string, meal: Meal): string {
  return `${WEEK}/add?day=${day}&meal=${meal}`;
}

function planKey(items: readonly PlanItem[]): string {
  return items
    .map((i) => [i.id, i.day, i.meal, i.servings, i.make, i.amount, i.portion, i.eatenId, i.name, i.leftovers.map((l) => l.id).join(",")].join(":"))
    .join("|");
}

/** "today's dinner" and "tomorrow's lunch" inside a sentence; a weekday keeps its capital ("Mon dinner"). */
function nearWords(words: string): string {
  return /^(Today|Tomorrow)'s /.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words;
}

/** The words for a day of the plan added up: "1,800 kcal · 164 g protein". */
function dayLine(items: readonly PlanItem[]): string | null {
  const day = planTotals(items);
  if (day.count === 0) return null;
  return [day.calories === null ? null : kcalWords(day.calories), day.proteinG === null ? null : `${gramWords(day.proteinG)} protein`]
    .filter(Boolean)
    .join(" · ");
}

function whole(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** What a planned meal shows on its right: eaten, for later, no numbers, or its calories. */
function statusOf(item: PlanItem): { words: string; tone: "eaten" | "quiet" | "missing" | "number" } {
  if (item.eatenId !== null) return { words: "Eaten", tone: "eaten" };
  const numbers = eatsHere(item) ? planNumbers(item) : null;
  if (numbers === null) return { words: "for later", tone: "quiet" };
  if (numbers.calories === null) return { words: "no numbers", tone: "missing" };
  return { words: whole(numbers.calories), tone: "number" };
}

function Status({ item, small = false }: { item: PlanItem; small?: boolean }) {
  const status = statusOf(item);
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 tabular-nums",
        small ? "text-xs" : "text-sm",
        status.tone === "eaten" && "font-semibold text-food-success-ink",
        status.tone === "quiet" && "text-muted-foreground",
        status.tone === "missing" && "font-semibold text-food-accent-ink",
        status.tone === "number" && "font-semibold",
      )}
    >
      {status.tone === "eaten" && <Check className="size-3.5" aria-hidden />}
      {status.words}
      {status.tone === "number" && <span className="sr-only"> kcal</span>}
    </span>
  );
}

/** What a planned meal is, under its name: what is cooked or eaten, and where its leftovers are or came from. */
function planLines(item: PlanItem, today: string): string[] {
  const lines = [planAmountWords(item)];
  if (item.kind === "cook" && item.leftovers.length > 0) {
    lines.push(`${item.leftovers.length} more: ${item.leftovers.map((l) => slotWords(l, today)).join(", ")}`);
  }
  if (item.kind === "leftover" && item.cookSlot) lines.push(`From ${nearWords(slotWords(item.cookSlot, today))}`);
  return lines;
}

/**
 * THE WEEK (D2, docs/help/food/week.md, ADR 0129; redrawn in the "Fresh
 * Market" skin, ADR 0132, his calls 2026-10-07): the week's calories and
 * protein a day against the targets with a bar for each day, then the days.
 * On a phone one day at a time, picked from a strip of the seven, opening on
 * today; on a wide screen a board, the days across and the meals down. A
 * planned meal opens in a sheet: how much, where, its leftovers, cook it,
 * take it off. A past week is repeated from here.
 *
 * This week and the next can be changed; an earlier week is shown as it was,
 * to repeat. Every change shows at once and is put back if the server refuses
 * it, and the server's copy takes over the moment it differs from the one
 * last seen (an action answers before its page streams in, health.md).
 */
export function WeekPlan({
  monday,
  today,
  items,
  targets,
  weeks,
  list = null,
  addHref: putOnHref,
}: {
  monday: string;
  today: string;
  items: PlanItem[];
  targets: TargetsInput;
  weeks: { monday: string; count: number }[];
  /** The shopping list's inputs, for the count on its button. */
  list?: ListBadgeInput | null;
  /** Put on the week, on the next meal to plan (the page's own, as its header has it). */
  addHref: string;
}) {
  const [rows, setRows] = useState(items);
  const [seen, setSeen] = useState(planKey(items));
  if (planKey(items) !== seen) {
    setSeen(planKey(items));
    setRows(items);
  }
  const [editing, setEditing] = useState<string | null>(null);
  const [day, setDay] = useState(() => openingDay(monday, today));
  const [repeating, setRepeating] = useState(false);
  const [pending, startTransition] = useTransition();
  const left = useLeftToBuy(list);

  const days = weekDays(monday);
  const changeable = canPlan(addDays(monday, 6), today);
  const totals = days.map((d) => planTotals(rows.filter((r) => r.day === d)));
  const average = weekAverage(totals);
  const repeatChoices = weeks.filter((w) => w.monday < monday && weekInReach(w.monday, today));
  const open = editing === null ? null : (rows.find((r) => r.id === editing) ?? null);

  /** Run an action with the change shown at once, and put back if it is refused. */
  function attempt(change: (now: PlanItem[]) => PlanItem[], action: () => Promise<{ ok: true } | { error: string }>) {
    const was = rows;
    setRows(change);
    setEditing(null);
    startTransition(async () => {
      const outcome = await action();
      if ("error" in outcome) {
        toast.error(outcome.error);
        setRows(was);
      }
    });
  }

  function remove(item: PlanItem) {
    attempt(
      (now) =>
        now
          .filter((r) => r.id !== item.id && r.cookId !== item.id)
          .map((r) => (r.kind === "cook" ? { ...r, leftovers: r.leftovers.filter((l) => l.id !== item.id) } : r)),
      () => removePlanAction({ id: item.id }),
    );
  }

  function move(item: PlanItem, to: Slot) {
    attempt(
      (now) =>
        now.map((r) => {
          if (r.id === item.id) return { ...r, ...to };
          if (r.kind === "cook" && r.id === item.cookId) {
            return { ...r, leftovers: r.leftovers.map((l) => (l.id === item.id ? { ...l, ...to } : l)) };
          }
          if (r.kind === "leftover" && r.cookId === item.id) return { ...r, cookSlot: to };
          return r;
        }),
      () => movePlanAction({ id: item.id, day: to.day, meal: to.meal }),
    );
  }

  function change(item: PlanItem, patch: { make?: number; servings?: number; amount?: number; portion?: string }) {
    const grams =
      item.kind === "food" && patch.amount !== undefined
        ? gramsFor(patch.amount, patch.portion ?? item.portion ?? "g", item.portions ?? [])
        : item.grams;
    attempt(
      (now) =>
        now.map((r) => {
          if (r.id === item.id) return { ...r, ...patch, grams };
          if (r.kind === "cook" && r.id === item.cookId && patch.servings !== undefined) {
            return { ...r, leftovers: r.leftovers.map((l) => (l.id === item.id ? { ...l, servings: patch.servings as number } : l)) };
          }
          return r;
        }),
      () => changePlanAction({ id: item.id, ...patch }),
    );
  }

  function planLeftovers(cook: PlanItem, slots: Slot[]) {
    const servings = leftoverServings(cook.servings ?? 0);
    const leftovers = slots.map((slot) => ({ id: newId(), ...slot, servings }));
    attempt(
      (now) => [
        ...now.map((r) => (r.id === cook.id ? { ...r, leftovers: [...r.leftovers, ...leftovers] } : r)),
        ...leftovers
          .filter((l) => days.includes(l.day))
          .map(
            (l): PlanItem => ({
              ...cook,
              id: l.id,
              day: l.day,
              meal: l.meal,
              kind: "leftover",
              cookId: cook.id,
              servings: l.servings,
              make: null,
              eatenId: null,
              cookSlot: { day: cook.day, meal: cook.meal },
              leftovers: [],
            }),
          ),
      ],
      () => addLeftoversAction({ cookId: cook.id, leftovers }),
    );
  }

  function repeat(from: string) {
    startTransition(async () => {
      const outcome = await repeatWeekAction({ from, to: monday });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      setRepeating(false);
      toast.success(
        outcome.added === 0
          ? "Nothing was put on: that week's days have already gone by here."
          : `Put ${outcome.added} ${outcome.added === 1 ? "meal" : "meals"} on the week.`,
      );
    });
  }

  const unknownWeek = totals.reduce((sum, t) => sum + t.unknown, 0);

  return (
    <div className="space-y-5 @2xl:space-y-6">
      <section aria-label="The week's numbers" className={cn(FOOD_CARD, "p-4 @2xl:p-6")}>
        <div className="grid gap-5 @3xl:grid-cols-[1.2fr_1fr] @3xl:items-center @3xl:gap-8">
          <div className="space-y-3">
            <Average label="Calories a day" value={average.calories} target={targets.calories} unit="kcal" bar="bg-food-accent" />
            <Average label="Protein a day" value={average.proteinG} target={targets.proteinG} unit="g" bar="bg-food-protein" />
            <p className="text-xs text-muted-foreground">
              {average.days === 0
                ? "Nothing is planned this week yet."
                : `The average of the ${average.days} ${average.days === 1 ? "day" : "days"} with something planned.`}
              {targets.calories === null && targets.proteinG === null && " Set your targets on Today to see the week against them."}
            </p>
          </div>
          <DayBars days={days} totals={totals} today={today} target={targets.calories} />
        </div>

        {changeable ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={putOnHref} className={cn(FOOD_PRIMARY, FOOD_SIZE.md, "w-full @2xl:hidden")}>
              <Plus className="size-4" aria-hidden /> Put on the week
            </Link>
            <Link href="/personal/m/food/list" className={cn(FOOD_SOFT, FOOD_SIZE.sm, "flex-1 @2xl:flex-none")}>
              <ShoppingCart className="size-4" aria-hidden /> Shopping list
              {left !== null && left > 0 && (
                <span className="rounded-full bg-food-tint px-[7px] py-px text-[11px] font-semibold text-food-accent-ink tabular-nums">
                  {left}
                  <span className="sr-only"> to buy</span>
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setRepeating((now) => !now)}
              aria-expanded={repeating}
              className={cn(FOOD_SOFT, FOOD_SIZE.sm, "flex-1 @2xl:flex-none")}
            >
              <Copy className="size-4" aria-hidden /> Repeat a week
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">A week gone by is shown as it was. Repeat it from this week or the next.</p>
        )}

        {changeable && repeating && (
          <div className="mt-4 space-y-3 border-t border-divider pt-4">
            <p className="text-sm">
              Each meal goes on the same day of the week shown. Days already gone are left out, and it adds to what is planned.
            </p>
            {repeatChoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No earlier week has anything planned.</p>
            ) : (
              <ul className="divide-y divide-divider overflow-hidden rounded-2xl bg-food-field">
                {repeatChoices.map((w) => (
                  <li key={w.monday}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-food-soft disabled:opacity-50"
                      disabled={pending}
                      onClick={() => repeat(w.monday)}
                    >
                      <span className="text-sm font-medium">{weekWords(w.monday, today)}</span>
                      <span className="text-sm text-muted-foreground">{`${w.count} ${w.count === 1 ? "meal" : "meals"}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" onClick={() => setRepeating(false)} className={cn(FOOD_QUIET, FOOD_SIZE.sm, "-ml-3")}>
              Cancel
            </button>
          </div>
        )}
      </section>

      {/* A phone, or a narrow window: one day at a time. */}
      <div className="space-y-4 @4xl:hidden">
        <div className="flex gap-1.5" role="group" aria-label="Days">
          {days.map((d) => {
            const count = rows.filter((r) => r.day === d).length;
            const on = d === day;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={`${dayTitle(d)}${d === today ? ", today" : ""}, ${count} planned`}
                onClick={() => setDay(d)}
                className={cn(
                  "flex h-[58px] min-w-0 flex-1 flex-col items-center justify-center rounded-2xl",
                  on ? "bg-food-accent text-white" : "bg-card ring-1 ring-food-chip-ring hover:bg-food-field",
                  d < today && !on && "opacity-70",
                )}
              >
                <span className={cn("text-[11px]", on ? "text-white" : d === today ? "font-semibold text-food-accent-ink" : "text-muted-foreground")}>
                  {shortDay(d)}
                </span>
                <span className="text-[17px] leading-tight font-bold">{Number(d.slice(8))}</span>
                <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
                  {Array.from({ length: Math.min(count, 4) }, (_, i) => (
                    <span key={i} className={cn("size-1 rounded-full", on ? "bg-white" : "bg-food-accent")} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <DayCard
          day={day}
          today={today}
          items={rows.filter((r) => r.day === day)}
          onOpen={setEditing}
        />
      </div>

      {/* A wide screen: the board, the days across and the meals down. */}
      <section aria-label="The week" className={cn(FOOD_CARD, "hidden p-4 @4xl:block")}>
        <div className="grid grid-cols-[88px_repeat(7,minmax(0,1fr))] gap-2">
          <div />
          {days.map((d) => (
            <div key={d} className={cn("rounded-2xl py-2 text-center", d === today && "bg-food-tint")}>
              <p className={cn("text-xs", d === today ? "font-bold text-food-accent-ink" : "text-muted-foreground")}>
                {shortDay(d)}
                {d === today && " · Today"}
              </p>
              <p className="font-food-display text-xl font-bold">{Number(d.slice(8))}</p>
            </div>
          ))}
          {MEALS.map((meal) => (
            <Fragment key={meal}>
              <div className="flex flex-col gap-1.5 pt-1.5">
                <MealTile meal={meal} className="size-8 rounded-lg" />
                <span className="text-xs font-semibold">{MEAL_LABELS[meal]}</span>
              </div>
              {days.map((d) => {
                const inCell = rows.filter((r) => r.day === d && r.meal === meal);
                const canAdd = d >= today && canPlan(d, today);
                return (
                  <div key={d} className={cn("min-h-24 space-y-1.5 rounded-2xl p-1", d < today && "opacity-60", d === today && "bg-food-planned")}>
                    {inCell.map((item) => (
                      <BoardCard key={item.id} item={item} changeable={canPlan(item.day, today)} onOpen={() => setEditing(item.id)} />
                    ))}
                    {canAdd && (
                      <Link
                        href={addHref(d, meal)}
                        aria-label={`Put something on ${dayTitle(d)}, ${MEAL_LABELS[meal].toLowerCase()}`}
                        className={cn(
                          "flex items-center justify-center rounded-xl border-[1.5px] border-dashed border-food-planned-edge bg-food-planned text-food-accent-ink hover:bg-food-tint",
                          inCell.length > 0 ? "h-7" : "h-10",
                        )}
                      >
                        <Plus className="size-4" aria-hidden />
                      </Link>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
          <div />
          {days.map((d, i) => (
            <p key={d} className="pt-1 text-center text-xs text-muted-foreground tabular-nums">
              {totals[i].count === 0 ? (
                "Nothing planned"
              ) : (
                <>
                  {totals[i].calories !== null && (
                    <>
                      <b className="font-semibold text-foreground">{whole(totals[i].calories as number)}</b> kcal
                    </>
                  )}
                  {totals[i].proteinG !== null && (
                    <>
                      <br />
                      {`${gramWords(totals[i].proteinG as number)} protein`}
                    </>
                  )}
                </>
              )}
            </p>
          ))}
        </div>
        {unknownWeek > 0 && <p className="mt-3 text-xs text-muted-foreground">{noNumbersWords(unknownWeek, "Click")}</p>}
      </section>

      <FoodSheet open={open !== null} onClose={() => setEditing(null)}>
        {open && (
          <PlanEditor
            key={open.id}
            item={open}
            today={today}
            pending={pending}
            onRemove={() => remove(open)}
            onMove={(to) => move(open, to)}
            onChange={(patch) => change(open, patch)}
            onLeftovers={(slots) => planLeftovers(open, slots)}
            onClose={() => setEditing(null)}
          />
        )}
      </FoodSheet>
    </div>
  );
}

function noNumbersWords(n: number, verb: "Tap" | "Click"): string {
  return `${n} ${n === 1 ? "meal has" : "meals have"} no numbers: ${n === 1 ? "its recipe has" : "their recipes have"} none yet. ${verb} ${n === 1 ? "it" : "one"} and choose Work out its nutrition.`;
}

/** A week's average a day, against its target when there is one. */
function Average({
  label,
  value,
  target,
  unit,
  bar,
}: {
  label: string;
  value: number | null;
  target: number | null;
  unit: "kcal" | "g";
  bar: string;
}) {
  const shown = value === null ? null : unit === "kcal" ? whole(value) : gramWords(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px]">
          <b className="font-semibold">{label}</b>, planned
        </span>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {shown === null ? (
            "–"
          ) : (
            <>
              <b className="text-base font-bold text-foreground">{shown}</b>
              {target === null ? (unit === "kcal" ? " kcal" : "") : ` of ${unit === "kcal" ? `${whole(target)} kcal` : gramWords(target)}`}
            </>
          )}
        </span>
      </div>
      {target !== null && value !== null && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-food-tabs-track" aria-hidden>
          <div
            className={cn("h-full rounded-full transition-[width] duration-[600ms] motion-reduce:transition-none", bar)}
            style={{ width: `${Math.round(ringShare(value, target) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** A bar for each day's planned calories, against the target (or the fullest day without one). */
function DayBars({ days, totals, today, target }: { days: string[]; totals: { calories: number | null; count: number }[]; today: string; target: number | null }) {
  const values = totals.map((t) => t.calories ?? 0);
  const top = target ?? Math.max(1, ...values);
  return (
    <div>
      <p className="mb-1.5 text-xs text-muted-foreground">{target === null ? "Each day's calories, planned" : `Each day against ${whole(target)} kcal`}</p>
      <div
        className="flex items-end gap-1 border-b border-dashed border-food-chip-ring"
        role="img"
        aria-label={days.map((d, i) => `${shortDay(d)} ${totals[i].count === 0 ? "nothing planned" : `${whole(values[i])} kcal`}`).join(", ")}
      >
        {days.map((d, i) => (
          <div key={d} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-11 w-full items-end justify-center">
              <div
                className={cn(
                  "w-3.5 rounded-md @2xl:w-[18px]",
                  d === today ? "bg-food-accent" : d < today ? "bg-food-ring-track" : "bg-food-planned-edge",
                )}
                style={{ height: `${Math.max(4, Math.min(1, values[i] / top) * 44)}px` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {days.map((d) => (
          <span key={d} className={cn("flex-1 text-center text-xs", d === today ? "font-bold text-food-accent-ink" : "text-muted-foreground")}>
            {shortDay(d).charAt(0)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** One day, its meals and what is planned in them (a phone, one day at a time). */
function DayCard({ day, today, items, onOpen }: { day: string; today: string; items: PlanItem[]; onOpen: (id: string) => void }) {
  const line = dayLine(items);
  const unknown = planTotals(items).unknown;
  const canAdd = day >= today && canPlan(day, today);
  return (
    <section aria-label={dayTitle(day)} className={cn(FOOD_CARD, "p-4", day < today && "bg-card/80")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h2 className="font-food-display text-[19px] font-bold tracking-[-0.02em]">
          {dayTitle(day)}
          {day === today && (
            <span className="ml-2 rounded-full bg-food-tint px-[7px] py-px align-[3px] font-sans text-[11px] font-semibold text-food-accent-ink">Today</span>
          )}
        </h2>
        {line && <span className="text-xs text-muted-foreground tabular-nums">{line}</span>}
      </div>
      {items.length === 0 && !canAdd ? (
        <p className="mt-2 text-sm text-muted-foreground">Nothing planned</p>
      ) : (
        MEALS.map((meal) => {
          const inMeal = items.filter((r) => r.meal === meal);
          return (
            <div key={meal} className="mt-3 border-t border-divider pt-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <MealTile meal={meal} className="size-[30px] rounded-md" />
                  <span className="text-[15px] font-semibold">{MEAL_LABELS[meal]}</span>
                </div>
                {canAdd && (
                  <Link
                    href={addHref(day, meal)}
                    aria-label={`Put something on ${dayTitle(day)}, ${MEAL_LABELS[meal].toLowerCase()}`}
                    className="flex size-[30px] items-center justify-center rounded-full bg-food-soft hover:bg-food-tabs-track"
                  >
                    <Plus className="size-4" aria-hidden />
                  </Link>
                )}
              </div>
              {inMeal.length === 0 ? (
                <p className="pt-1.5 pl-10 text-xs text-muted-foreground">Nothing planned</p>
              ) : (
                inMeal.map((item) => <DayRow key={item.id} item={item} today={today} onOpen={() => onOpen(item.id)} />)
              )}
            </div>
          );
        })
      )}
      {unknown > 0 && <p className="mt-3 text-xs text-muted-foreground">{noNumbersWords(unknown, "Tap")}</p>}
    </section>
  );
}

function DayRow({ item, today, onOpen }: { item: PlanItem; today: string; onOpen: () => void }) {
  const changeable = canPlan(item.day, today);
  const body = (
    <>
      <FoodThumb photoUrl={item.photoUrl ?? null} recipe={item.kind !== "food"} category={item.category ?? null} tone={item.meal} className="size-11 rounded-lg" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {item.kind !== "food" && item.photoUrl && <ChefHat className="size-3.5 shrink-0 text-food-accent" aria-hidden />}
          <span className="line-clamp-2">{item.name}</span>
        </span>
        {planLines(item, today).map((line) => (
          <span key={line} className="block text-xs text-muted-foreground">
            {line}
          </span>
        ))}
      </span>
      <Status item={item} />
    </>
  );
  return changeable ? (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 py-2 text-left">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-3 py-2">{body}</div>
  );
}

/** A planned meal on the board: its picture, its calories, its name and what it is. */
function BoardCard({ item, changeable, onOpen }: { item: PlanItem; changeable: boolean; onOpen: () => void }) {
  const what = item.kind === "leftover" ? "Leftovers" : planAmountWords(item).replace(/ servings?/g, "");
  const body = (
    <>
      <span className="flex items-start justify-between gap-1">
        <FoodThumb photoUrl={item.photoUrl ?? null} recipe={item.kind !== "food"} category={item.category ?? null} tone={item.meal} className="size-[30px] rounded-md" />
        <Status item={item} small />
      </span>
      <span className="mt-1.5 line-clamp-2 block text-xs leading-tight font-semibold">{item.name}</span>
      <span className="block text-[11px] text-muted-foreground">{what}</span>
    </>
  );
  const card = "block w-full rounded-xl bg-card p-2 text-left shadow-food-meal";
  return changeable ? (
    <button type="button" onClick={onOpen} className={cn(card, "hover:shadow-food-card")}>
      {body}
    </button>
  ) : (
    <div className={card}>{body}</div>
  );
}

/** A number with − and + either side, in the field's fill. */
function Stepper({ id, label, value, onType, onStep }: { id: string; label: string; value: string; onType: (text: string) => void; onStep: (direction: 1 | -1) => void }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[13px] font-medium">
        {label}
      </label>
      <div className="flex h-12 items-center rounded-xl bg-food-field px-1">
        <button type="button" aria-label={`Less, ${label.toLowerCase()}`} onClick={() => onStep(-1)} className="flex size-10 items-center justify-center rounded-lg hover:bg-food-soft">
          <Minus className="size-4" aria-hidden />
        </button>
        <input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => onType(e.target.value)}
          className="w-12 min-w-0 bg-transparent text-center text-lg font-bold tabular-nums outline-none"
        />
        <button type="button" aria-label={`More, ${label.toLowerCase()}`} onClick={() => onStep(1)} className="flex size-10 items-center justify-center rounded-lg hover:bg-food-soft">
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** A planned meal, opened: how much, where, its leftovers, cook it, take it off. */
function PlanEditor({
  item,
  today,
  pending,
  onRemove,
  onMove,
  onChange,
  onLeftovers,
  onClose,
}: {
  item: PlanItem;
  today: string;
  pending: boolean;
  onRemove: () => void;
  onMove: (to: Slot) => void;
  onChange: (patch: { make?: number; servings?: number; amount?: number; portion?: string }) => void;
  onLeftovers: (slots: Slot[]) => void;
  onClose: () => void;
}) {
  const [makeText, setMakeText] = useState(String(item.make ?? ""));
  const [eatText, setEatText] = useState(String(item.servings ?? ""));
  const [amountText, setAmountText] = useState(String(item.amount ?? ""));
  const [portion, setPortion] = useState(item.portion ?? "g");
  const [day, setDay] = useState(item.day);
  const [meal, setMeal] = useState<Meal>(item.meal);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);

  const make = typedAmount(makeText);
  const eat = eatText.trim() === "0" ? 0 : typedAmount(eatText);
  const amount = typedAmount(amountText);
  const leftoverTotal = item.leftovers.reduce((sum, l) => sum + l.servings, 0);
  const units = [...(item.portions ?? []).map((p: FoodPortion) => p.label), ...GRAM_UNITS.map((u) => u.label)];
  const target: Slot = { day, meal };
  const moved = day !== item.day || meal !== item.meal;
  const orderOk =
    item.kind === "leftover"
      ? item.cookSlot === null || isAfter(target, item.cookSlot)
      : item.kind === "cook"
        ? item.leftovers.every((l) => isAfter(l, target))
        : true;

  // Leftovers still to plan: what the batch has after the person's own and those on the week.
  const each = leftoverServings(item.servings ?? 0);
  const room = item.kind === "cook" ? Math.floor(batchLeft(item.make ?? 0, item.servings ?? 0, item.leftovers.map((l) => l.servings)) / each + 1e-9) : 0;
  const have = new Set(item.leftovers.map(slotKey));
  const choices = item.kind === "cook" ? leftoverChoices(item, today).filter((slot) => !have.has(slotKey(slot))) : [];

  let amountProblem: string | null = null;
  let save: (() => void) | null = null;
  if (item.kind === "cook") {
    if (make === null || eat === null) amountProblem = "Type how many, a number (0 is fine for what you eat).";
    else if (eat > make) amountProblem = "You can't eat more than the batch makes.";
    else if (eat + leftoverTotal > make + 1e-9) amountProblem = `Its leftovers take ${plainNumber(leftoverTotal)}: cook more, or take some off.`;
    else if (make !== item.make || eat !== item.servings) save = () => onChange({ make, servings: eat });
  } else if (item.kind === "leftover") {
    if (eat === null || eat <= 0) amountProblem = "Type how many servings, a number above 0.";
    else if (eat !== item.servings) save = () => onChange({ servings: eat });
  } else {
    if (amount === null) amountProblem = "Type how much, a number above 0.";
    else if (gramsFor(amount, portion, item.portions ?? []) === null) amountProblem = "That amount is not one this food can be planned in.";
    else if (amount !== item.amount || portion !== item.portion) save = () => onChange({ amount, portion });
  }

  /** What you eat steps by one and may reach nothing (a batch made ahead); the rest never reach nothing. */
  const stepEat = (direction: 1 | -1, allowNone: boolean) => {
    const now = eat ?? 0;
    if (direction === 1) return String(now <= 0 ? 1 : stepped(now, 1, 1));
    if (allowNone && now <= 1) return "0";
    return String(stepped(now, 1, -1));
  };
  const unit = item.kind !== "food" ? yieldWords(2, item.yieldUnit).replace(/^2 /, "") : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <FoodThumb photoUrl={item.photoUrl ?? null} recipe={item.kind !== "food"} category={item.category ?? null} tone={item.meal} className="size-[52px] rounded-xl" />
        <div className="min-w-0 flex-1">
          <FoodSheetTitle className="line-clamp-2 text-base font-semibold">{item.name}</FoodSheetTitle>
          <FoodSheetDescription className="text-[13px] text-muted-foreground">
            {`${slotWords(item, today)} · ${planLines(item, today).join(" · ")}`}
          </FoodSheetDescription>
        </div>
        <button type="button" onClick={onClose} className={cn(FOOD_QUIET, FOOD_SIZE.sm, "-mr-2")}>
          Close
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {item.kind === "cook" && (
          <Stepper
            id={`make-${item.id}`}
            label="Cook"
            value={makeText}
            onType={setMakeText}
            onStep={(direction) => setMakeText(String(stepped(make ?? 1, 1, direction)))}
          />
        )}
        {item.kind !== "food" ? (
          <Stepper
            id={`eat-${item.id}`}
            label={item.kind === "cook" ? "You eat" : "Servings"}
            value={eatText}
            onType={setEatText}
            onStep={(direction) => setEatText(stepEat(direction, item.kind === "cook"))}
          />
        ) : (
          <>
            <Stepper
              id={`amount-${item.id}`}
              label="How much"
              value={amountText}
              onType={setAmountText}
              onStep={(direction) => setAmountText(String(stepped(amount ?? 1, portion === "g" ? 10 : 0.5, direction)))}
            />
            <span className="relative min-w-0 flex-1">
              <select
                aria-label="Portion"
                value={portion}
                onChange={(e) => setPortion(e.target.value)}
                className={cn(FOOD_FIELD, "w-full max-w-[15rem] appearance-none truncate pr-9")}
              >
                {units.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            </span>
          </>
        )}
        {unit && <span className="pb-3 text-sm text-muted-foreground">{unit}</span>}
        {save && (
          <button type="button" onClick={save} disabled={pending} className={cn(FOOD_PRIMARY, FOOD_SIZE.md, "h-12")}>
            Save
          </button>
        )}
      </div>
      {amountProblem && <p className="text-sm text-destructive">{amountProblem}</p>}

      <div className="space-y-2 border-t border-divider pt-4">
        <p className="text-[13px] font-medium">Move to</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="relative">
            <select
              aria-label="Day"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="h-[34px] appearance-none rounded-full bg-card pr-8 pl-3.5 text-sm ring-1 ring-food-chip-ring outline-none focus-visible:ring-2 focus-visible:ring-food-accent"
            >
              {(item.day < today ? [item.day, ...daysToPlan(today)] : daysToPlan(today)).map((d) => (
                <option key={d} value={d}>
                  {d === today ? "Today" : dayTitle(d)}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          </span>
          <span className="flex flex-wrap gap-1.5" role="group" aria-label="Meal">
            {MEALS.map((m) => (
              <button key={m} type="button" aria-pressed={meal === m} onClick={() => setMeal(m)} className={foodChip(meal === m)}>
                {MEAL_LABELS[m]}
              </button>
            ))}
          </span>
          {moved && (
            <button type="button" onClick={() => onMove(target)} disabled={pending || !orderOk} className={cn(FOOD_SOFT, FOOD_SIZE.sm)}>
              Move
            </button>
          )}
        </div>
        {moved && !orderOk && (
          <p className="text-sm text-destructive">
            {item.kind === "cook" ? "Its leftovers would come before it is cooked. Move them first." : "Leftovers come after the meal they are cooked at."}
          </p>
        )}
      </div>

      {item.kind === "cook" && room > 0 && choices.length > 0 && (
        <div className="space-y-2 border-t border-divider pt-4">
          <p className="text-[13px] font-medium">{`Plan leftovers: ${room} more of ${yieldWords(each, item.yieldUnit)}`}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Leftovers">
            {choices.map((slot) => {
              const key = slotKey(slot);
              const on = picked.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && picked.length >= room}
                  onClick={() => setPicked((now) => (on ? now.filter((k) => k !== key) : [...now, key]))}
                  className={cn(foodChip(on), "disabled:opacity-50")}
                >
                  {slotWords(slot, today)}
                </button>
              );
            })}
          </div>
          {picked.length > 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => onLeftovers(choices.filter((slot) => picked.includes(slotKey(slot))))}
              className={cn(FOOD_SOFT, FOOD_SIZE.sm)}
            >
              {`Put ${picked.length} on the week`}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-4">
        {item.kind === "cook" && item.recipeId && (
          <Link href={`/personal/m/food/recipes/${item.recipeId}/cook?servings=${plainNumber(item.make ?? 1)}`} className={cn(FOOD_PRIMARY, FOOD_SIZE.sm)}>
            <ChefHat className="size-4" aria-hidden /> Cook
          </Link>
        )}
        {item.recipeId && (
          <Link href={`/personal/m/food/recipes/${item.recipeId}`} className={cn(FOOD_SOFT, FOOD_SIZE.sm)}>
            Recipe
          </Link>
        )}
        {item.recipeId && item.perServing?.calories === undefined && (
          <Link href={`/personal/m/food/recipes/${item.recipeId}/nutrition`} className={cn(FOOD_SOFT, FOOD_SIZE.sm)}>
            Work out its nutrition
          </Link>
        )}
        {confirming ? (
          <span className="flex basis-full flex-wrap items-center gap-2 pt-1">
            <span className="text-sm">
              {item.kind === "cook" && item.leftovers.length > 0
                ? `Take it off? Its ${item.leftovers.length} ${item.leftovers.length === 1 ? "leftover goes" : "leftovers go"} too.`
                : "Take it off?"}
            </span>
            <button
              type="button"
              onClick={onRemove}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-xl bg-destructive px-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              Take off
            </button>
            <button type="button" onClick={() => setConfirming(false)} className={cn(FOOD_SOFT, FOOD_SIZE.sm)}>
              Keep it
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={cn(FOOD_QUIET, FOOD_SIZE.sm, "ml-auto")}>
            Take off
          </button>
        )}
      </div>
    </div>
  );
}
