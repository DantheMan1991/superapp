"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, ChefHat, ChevronLeft, ChevronRight, Copy, Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import type { FoodPortion } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { addLeftoversAction, changePlanAction, movePlanAction, removePlanAction, repeatWeekAction } from "../actions";
import { GRAM_UNITS, MEALS, MEAL_LABELS, gramWords, gramsFor, kcalWords, towards, typedAmount, type Meal, type TargetsInput } from "../core/eating";
import { plainNumber, yieldWords } from "../core/recipe";
import {
  batchLeft,
  canPlan,
  dayTitle,
  daysToPlan,
  eatsHere,
  isAfter,
  leftoverChoices,
  leftoverServings,
  mondayOf,
  planAmountWords,
  planNumbers,
  planTotals,
  slotKey,
  slotWords,
  weekAverage,
  weekDays,
  weekInReach,
  weekWords,
  type PlanItem,
  type Slot,
} from "../core/week";
import { newId } from "./new-id";

const WEEK = "/personal/m/food/week";

function weekHref(monday: string, today: string): string {
  return monday === mondayOf(today) ? WEEK : `${WEEK}?week=${monday}`;
}

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

function Tile({ label, value, target, unit }: { label: string; value: number | null; target: number | null; unit: "kcal" | "g" }) {
  const along = target === null || value === null ? null : towards(value, target, unit);
  return (
    <div className="space-y-1">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-xl font-medium tabular-nums">{value === null ? "–" : unit === "kcal" ? kcalWords(value) : gramWords(value)}</div>
      {along && (
        <div className="space-y-0.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-module-accent" style={{ width: `${Math.round(along.share * 100)}%` }} />
          </div>
          <div className="text-xs text-muted-foreground tabular-nums">{along.words}</div>
        </div>
      )}
    </div>
  );
}

/**
 * THE WEEK (D2, docs/help/food/week.md, ADR 0129; the founder's calls
 * 2026-10-03): seven days, Monday first, each with its meals and what is
 * planned in them; the days' calories and protein against the targets; a
 * recipe cooked once and its leftovers on later meals; each planned meal
 * changed, moved or taken off with a tap; and a past week repeated.
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
}: {
  monday: string;
  today: string;
  items: PlanItem[];
  targets: TargetsInput;
  weeks: { monday: string; count: number }[];
}) {
  const [rows, setRows] = useState(items);
  const [seen, setSeen] = useState(planKey(items));
  if (planKey(items) !== seen) {
    setSeen(planKey(items));
    setRows(items);
  }
  const [open, setOpen] = useState<string | null>(null);
  const [repeating, setRepeating] = useState(false);
  const [pending, startTransition] = useTransition();

  const days = weekDays(monday);
  const changeable = canPlan(addDays(monday, 6), today);
  const average = weekAverage(days.map((day) => planTotals(rows.filter((r) => r.day === day))));
  const before = addDays(monday, -7);
  const after = addDays(monday, 7);
  const repeatChoices = weeks.filter((w) => w.monday < monday && weekInReach(w.monday, today));

  /** Run an action with the change shown at once, and put back if it is refused. */
  function attempt(change: (now: PlanItem[]) => PlanItem[], action: () => Promise<{ ok: true } | { error: string }>) {
    const was = rows;
    setRows(change);
    setOpen(null);
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

  return (
    <div className="space-y-4">
      <nav className="flex items-center justify-between gap-2" aria-label="Week">
        {weekInReach(before, today) ? (
          <Button asChild variant="ghost" size="icon" aria-label="The week before">
            <Link href={weekHref(before, today)}>
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="size-9" />
        )}
        <span className="text-center font-medium">{weekWords(monday, today)}</span>
        {weekInReach(after, today) ? (
          <Button asChild variant="ghost" size="icon" aria-label="The week after">
            <Link href={weekHref(after, today)}>
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <span className="size-9" />
        )}
      </nav>

      <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
        <div className="grid grid-cols-2 gap-3">
          <Tile label="Calories a day, planned" value={average.calories} target={targets.calories} unit="kcal" />
          <Tile label="Protein a day, planned" value={average.proteinG} target={targets.proteinG} unit="g" />
        </div>
        <p className="text-sm text-muted-foreground">
          {average.days === 0
            ? "Nothing is planned this week yet."
            : `The average of the ${average.days} ${average.days === 1 ? "day" : "days"} with something planned.`}
          {targets.calories === null && targets.proteinG === null && " Set your targets on Today to see the week against them."}
        </p>
        {changeable && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setRepeating((now) => !now)} aria-expanded={repeating}>
              <Copy aria-hidden /> Repeat a week
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/personal/m/food/list">
                <ShoppingCart aria-hidden /> Shopping list
              </Link>
            </Button>
          </div>
        )}
        {changeable && repeating && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-sm">
              Each meal goes on the same day of the week shown. Days already gone are left out, and it adds to what
              is planned.
            </p>
            {repeatChoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No earlier week has anything planned.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {repeatChoices.map((w) => (
                  <li key={w.monday}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted"
                      disabled={pending}
                      onClick={() => repeat(w.monday)}
                    >
                      <span>{weekWords(w.monday, today)}</span>
                      <span className="text-sm text-muted-foreground">{`${w.count} ${w.count === 1 ? "meal" : "meals"}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <Button size="sm" variant="ghost" onClick={() => setRepeating(false)}>
              Cancel
            </Button>
          </div>
        )}
        {!changeable && <p className="text-sm text-muted-foreground">A week gone by is shown as it was. Repeat it from this week or the next.</p>}
      </section>

      <div className="@container">
        <div className="grid gap-3 @2xl:grid-cols-2 @6xl:grid-cols-7">
          {days.map((day) => {
            const inDay = rows.filter((r) => r.day === day);
            const line = dayLine(inDay);
            const gone = day < today;
            const unknown = planTotals(inDay).unknown;
            if (gone && inDay.length === 0) {
              return (
                <section
                  key={day}
                  aria-label={dayTitle(day)}
                  className="flex items-baseline justify-between gap-2 rounded-2xl bg-muted/40 px-3 py-2 shadow-elevation-1"
                >
                  <h2 className="font-medium">{dayTitle(day)}</h2>
                  <span className="text-xs text-muted-foreground">Nothing planned</span>
                </section>
              );
            }
            return (
              <section
                key={day}
                aria-label={dayTitle(day)}
                className={cn("space-y-2 rounded-2xl px-3 py-3 shadow-elevation-1", gone ? "bg-muted/40" : "bg-card")}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <h2 className="font-medium">
                    {dayTitle(day)}
                    {day === today && <span className="ml-2 text-xs font-normal text-module-accent">Today</span>}
                  </h2>
                  {line && <span className="text-xs text-muted-foreground tabular-nums">{line}</span>}
                </div>
                {MEALS.map((meal) => {
                  const inMeal = inDay.filter((r) => r.meal === meal);
                  const canAdd = !gone && canPlan(day, today);
                  return (
                    <div key={meal} className="border-t border-border pt-1.5">
                      <div className="flex min-h-7 items-center justify-between gap-1">
                        <span className="text-xs text-muted-foreground">{MEAL_LABELS[meal]}</span>
                        {canAdd && (
                          <Button
                            asChild
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            aria-label={`Put something on ${dayTitle(day)}, ${MEAL_LABELS[meal].toLowerCase()}`}
                          >
                            <Link href={addHref(day, meal)}>
                              <Plus aria-hidden />
                            </Link>
                          </Button>
                        )}
                      </div>
                      {inMeal.map((item) => (
                        <PlanEntry
                          key={item.id}
                          item={item}
                          today={today}
                          open={open === item.id}
                          pending={pending}
                          onToggle={() => setOpen((now) => (now === item.id ? null : item.id))}
                          onRemove={() => remove(item)}
                          onMove={(to) => move(item, to)}
                          onChange={(patch) => change(item, patch)}
                          onLeftovers={(slots) => planLeftovers(item, slots)}
                        />
                      ))}
                    </div>
                  );
                })}
                {unknown > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {`${unknown} ${unknown === 1 ? "meal has" : "meals have"} no numbers: ${unknown === 1 ? "its recipe has" : "their recipes have"} none yet. Tap ${unknown === 1 ? "it" : "one"} and choose Work out its nutrition.`}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One planned meal: what it is, and, opened, how much, where, its leftovers, and taking it off. */
function PlanEntry({
  item,
  today,
  open,
  pending,
  onToggle,
  onRemove,
  onMove,
  onChange,
  onLeftovers,
}: {
  item: PlanItem;
  today: string;
  open: boolean;
  pending: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onMove: (to: Slot) => void;
  onChange: (patch: { make?: number; servings?: number; amount?: number; portion?: string }) => void;
  onLeftovers: (slots: Slot[]) => void;
}) {
  const changeable = canPlan(item.day, today);
  const numbers = eatsHere(item) ? planNumbers(item) : null;
  const eaten = item.eatenId !== null;
  const right = eaten ? null : numbers === null ? "for later" : numbers.calories === null ? "no numbers" : kcalWords(numbers.calories);

  return (
    <div className="py-1">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left disabled:cursor-default"
        aria-expanded={changeable ? open : undefined}
        disabled={!changeable}
        onClick={onToggle}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm">
            {item.kind !== "food" && <ChefHat className="size-3.5 shrink-0 text-module-accent" aria-hidden />}
            <span className="line-clamp-2">{item.name}</span>
          </span>
          <span className="block text-xs text-muted-foreground">{planAmountWords(item)}</span>
          {item.kind === "cook" && item.leftovers.length > 0 && (
            <span className="block text-xs text-muted-foreground">
              {`${item.leftovers.length} more: ${item.leftovers.map((l) => slotWords(l, today)).join(", ")}`}
            </span>
          )}
          {item.kind === "leftover" && item.cookSlot && (
            <span className="block text-xs text-muted-foreground">{`From ${nearWords(slotWords(item.cookSlot, today))}`}</span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums">
          {eaten ? (
            <>
              <Check className="size-3.5 text-module-accent" aria-hidden /> Eaten
            </>
          ) : (
            right
          )}
        </span>
      </button>
      {open && changeable && (
        <PlanEditor item={item} today={today} pending={pending} onRemove={onRemove} onMove={onMove} onChange={onChange} onLeftovers={onLeftovers} onClose={onToggle} />
      )}
    </div>
  );
}

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

  return (
    <div className="mt-1.5 space-y-3 rounded-xl bg-muted/50 p-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        {item.kind === "cook" && (
          <div className="space-y-1">
            <Label htmlFor={`make-${item.id}`}>Cook</Label>
            <Input id={`make-${item.id}`} inputMode="decimal" value={makeText} onChange={(e) => setMakeText(e.target.value)} className="w-20" />
          </div>
        )}
        {item.kind !== "food" ? (
          <div className="space-y-1">
            <Label htmlFor={`eat-${item.id}`}>{item.kind === "cook" ? "You eat" : "Servings"}</Label>
            <Input id={`eat-${item.id}`} inputMode="decimal" value={eatText} onChange={(e) => setEatText(e.target.value)} className="w-20" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor={`amount-${item.id}`}>How much</Label>
              <Input id={`amount-${item.id}`} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} className="w-20" />
            </div>
            <select
              aria-label="Portion"
              value={portion}
              onChange={(e) => setPortion(e.target.value)}
              className="h-9 max-w-[12rem] rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
            >
              {units.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </>
        )}
        {item.kind !== "food" && <span className="pb-2">{yieldWords(2, item.yieldUnit).replace(/^2 /, "")}</span>}
        {save && (
          <Button size="sm" onClick={save} disabled={pending}>
            Save
          </Button>
        )}
      </div>
      {amountProblem && <p className="text-destructive">{amountProblem}</p>}

      <div className="space-y-1.5 border-t border-border pt-3">
        <div className="font-medium">Move to</div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Day"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
          >
            {(item.day < today ? [item.day, ...daysToPlan(today)] : daysToPlan(today)).map((d) => (
              <option key={d} value={d}>
                {d === today ? "Today" : dayTitle(d)}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Meal">
            {MEALS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={meal === m}
                onClick={() => setMeal(m)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs",
                  meal === m ? "border-module-accent bg-module-accent text-white" : "border-border bg-card",
                )}
              >
                {MEAL_LABELS[m]}
              </button>
            ))}
          </div>
          {moved && (
            <Button size="sm" variant="outline" onClick={() => onMove(target)} disabled={pending || !orderOk}>
              Move
            </Button>
          )}
        </div>
        {moved && !orderOk && (
          <p className="text-destructive">
            {item.kind === "cook" ? "Its leftovers would come before it is cooked. Move them first." : "Leftovers come after the meal they are cooked at."}
          </p>
        )}
      </div>

      {item.kind === "cook" && room > 0 && choices.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <div className="font-medium">{`Plan leftovers: ${room} more of ${yieldWords(each, item.yieldUnit)}`}</div>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Leftovers">
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
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs disabled:opacity-50",
                    on ? "border-module-accent bg-module-accent text-white" : "border-border bg-card",
                  )}
                >
                  {slotWords(slot, today)}
                </button>
              );
            })}
          </div>
          {picked.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => onLeftovers(choices.filter((slot) => picked.includes(slotKey(slot))))}
            >
              {`Put ${picked.length} on the week`}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {item.kind === "cook" && item.recipeId && (
          <Button asChild size="sm" variant="outline">
            <Link href={`/personal/m/food/recipes/${item.recipeId}/cook?servings=${plainNumber(item.make ?? 1)}`}>
              <ChefHat aria-hidden /> Cook
            </Link>
          </Button>
        )}
        {item.recipeId && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/personal/m/food/recipes/${item.recipeId}`}>Recipe</Link>
          </Button>
        )}
        {item.recipeId && item.perServing?.calories === undefined && (
          <Button asChild size="sm" variant="ghost">
            <Link href={`/personal/m/food/recipes/${item.recipeId}/nutrition`}>Work out its nutrition</Link>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
        {confirming ? (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <span>
              {item.kind === "cook" && item.leftovers.length > 0
                ? `Take it off? Its ${item.leftovers.length} ${item.leftovers.length === 1 ? "leftover goes" : "leftovers go"} too.`
                : "Take it off?"}
            </span>
            <Button size="sm" variant="destructive" onClick={onRemove} disabled={pending}>
              Take off
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>
            Take off
          </Button>
        )}
      </div>
    </div>
  );
}
