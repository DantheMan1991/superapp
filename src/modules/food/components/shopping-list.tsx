"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import {
  Beef,
  CalendarDays,
  Carrot,
  Croissant,
  CupSoda,
  Egg,
  Loader2,
  Package,
  Plus,
  ShoppingBasket,
  Snowflake,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { HelpButton } from "@/components/app/help-button";
import { datesBetween } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { alwaysHaveAction, nameLinesAction } from "../actions";
import {
  AISLES,
  AISLE_LABELS,
  addOwn,
  buildList,
  defaultRange,
  leftToBuy,
  marksFor,
  ownFor,
  rangeOk,
  removeOwn,
  setMark,
  spanWords,
  toggleOwn,
  type Aisle,
  type LineName,
  type ListCook,
  type ListFood,
  type ListItem,
  type ListRange,
  type ShoppingState,
} from "../core/list";
import { dayTitle, plannable } from "../core/week";
import { FoodHeader } from "./food-header";
import { FoodNav } from "./food-nav";
import { FOOD_CARD, FOOD_QUIET, FOOD_SIZE, FOOD_SOFT } from "./food-styles";
import { TONE_CLASS, type ThumbTone } from "./food-thumb";
import { FoodTick } from "./food-tick";
import { changeShopping, useShopping } from "./list-store";

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Turkey chili" or "Turkey chili 2 · Chicken rice bowl 1". */
function sourcesWords(item: ListItem): string {
  return item.sources.map((s) => (s.amount ? `${s.label} ${s.amount}` : s.label)).join(" · ");
}

/** Each aisle's icon on a meal's tint, as the design draws the aisle cards. */
const AISLE_LOOK: Record<Aisle, { icon: LucideIcon; tone: ThumbTone }> = {
  produce: { icon: Carrot, tone: "lunch" },
  meat: { icon: Beef, tone: "dinner" },
  dairy: { icon: Egg, tone: "breakfast" },
  bakery: { icon: Croissant, tone: "breakfast" },
  pantry: { icon: Package, tone: "snack" },
  frozen: { icon: Snowflake, tone: "neutral" },
  drinks: { icon: CupSoda, tone: "lunch" },
  other: { icon: ShoppingBasket, tone: "neutral" },
};

/** A card in the list: on a wide screen the cards flow down two columns, and none is split between them. */
const CARD = cn(FOOD_CARD, "mb-4 break-inside-avoid px-4 py-3.5 @2xl:px-5 @4xl:mb-5");
const CARD_TITLE = "font-food-display text-[17px] font-bold tracking-[-0.02em]";
const SMALL_SOFT = cn(FOOD_SOFT, "h-8 px-3 text-[13px]");
const SMALL_QUIET = cn(FOOD_QUIET, "h-8 px-2 text-[13px]");

/**
 * THE SHOPPING LIST (D3, docs/help/food/list.md, ADR 0130; the founder's
 * calls 2026-10-03; in the "Fresh Market" skin, ADR 0132, from his mockup
 * 2026-10-07): what the planned days need, bought once per cooked batch, the
 * same thing added up across recipes and sorted by aisle; staples under "Have
 * these at home?", and left off for good once he always has them; his own
 * items; ticked off in the shop. At the top, how many things are still to
 * buy, by the rule the List tab counts with (`leftToBuy`), and a bar of what
 * is ticked.
 *
 * The list is worked out here from the days' plan, as the server sent it, and
 * the names Claude gave each line; the days, the ticks and his own items are
 * kept on the phone (`list-store.ts`), so ticking works with no signal. A
 * ticked thing stays where it is, struck through and the same height, so the
 * row under a finger never moves (the drive's mis-tap, 2026-10-03); the days
 * are kept from the first tick, so tomorrow's default does not untick today's
 * shop. Lines not named yet are named on opening, and the page fetched again.
 * The header and the tabs are drawn here because the days are the phone's.
 */
export function ShoppingList({
  tenantId,
  today,
  cooks,
  foods,
  names,
  always,
  unnamed,
}: {
  tenantId: string;
  today: string;
  cooks: ListCook[];
  foods: ListFood[];
  names: Record<string, LineName[]>;
  always: string[];
  unnamed: number;
}) {
  const router = useRouter();
  const state = useShopping(tenantId);
  const range: ListRange = state.range && rangeOk(state.range, today) ? state.range : defaultRange(today);
  const [picking, setPicking] = useState(false);
  const [ownText, setOwnText] = useState("");
  const [showAlways, setShowAlways] = useState(false);
  const [pending, startTransition] = useTransition();

  // Always have: shown at once, put back if the server refuses; the server's copy wins when it differs.
  const [kept, setKept] = useState(always);
  const [seenKept, setSeenKept] = useState(always.join("|"));
  if (always.join("|") !== seenKept) {
    setSeenKept(always.join("|"));
    setKept(always);
  }

  // Lines not named yet are named on opening; a try that names nothing is a failure to show.
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<number | null>(null);
  useEffect(() => {
    if (unnamed === 0) return;
    let gone = false;
    nameLinesAction().then((outcome) => {
      if (gone) return;
      if ("error" in outcome || outcome.named === 0) setFailed(attempt);
      else router.refresh();
    });
    return () => {
      gone = true;
    };
  }, [unnamed, attempt, router]);
  const sorting = unnamed > 0 && failed !== attempt;

  const list = buildList({ cooks, foods, names, always: kept, from: range.from, to: range.to });
  const marks = marksFor(state, range.from);
  const own = ownFor(state, range.from);

  const markOf = (item: ListItem) => marks[item.key];
  const got = (item: ListItem) => markOf(item)?.kind === "got" && markOf(item)?.amount === item.amount;
  const had = (item: ListItem) => markOf(item)?.kind === "have";
  const toBuy = list.items.filter((item) => item.sorted && !item.staple && !had(item));
  const unsortedItems = list.items.filter((item) => !item.sorted && !had(item));
  const askStaples = list.items.filter((item) => item.sorted && item.staple && !had(item));
  const atHome = list.items.filter(had);
  const ticked = list.items.filter(got).length + own.filter((item) => item.got !== null).length;
  const left = leftToBuy(list, marks, own);
  const planned = list.cooks + list.foods > 0;
  const span = spanWords(range.from, range.to);

  // Every write keeps the days it was made on, so the list holds still until its last day has gone.
  const write = (change: (s: ShoppingState, newId: () => string) => ShoppingState) =>
    changeShopping(tenantId, (s, newId) => change({ ...s, range }, newId));
  const tick = (item: ListItem, on: boolean) =>
    write((s) => setMark(s, range.from, item.key, on ? { kind: "got", amount: item.amount } : null));
  const haveIt = (item: ListItem) => write((s) => setMark(s, range.from, item.key, { kind: "have", amount: item.amount }));
  const setRange = (next: ListRange) => changeShopping(tenantId, (s) => ({ ...s, range: next }));

  function alwaysHave(item: string, on: boolean) {
    const before = kept;
    const key = item.toLowerCase();
    setKept((now) => (on ? [...now.filter((k) => k !== key), key].sort() : now.filter((k) => k !== key)));
    startTransition(async () => {
      const outcome = await alwaysHaveAction({ item: key, always: on });
      if ("error" in outcome) {
        toast.error(outcome.error);
        setKept(before);
      }
    });
  }

  function addOwnItem() {
    const name = ownText.trim();
    if (!name) return;
    write((s, newId) => addOwn(s, newId(), name));
    setOwnText("");
  }

  // The first day can be any day of this week or the next before the last; the last, today or later.
  const reach = plannable(today);
  const fromDays = datesBetween(range.from < reach.from ? range.from : reach.from, range.to);
  const toDays = datesBetween(range.from > today ? range.from : today, reach.to);
  const dayLabel = (d: string) => (d === today ? "Today" : dayTitle(d));
  const select = "h-10 rounded-xl bg-food-field px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-food-accent";

  const row = (item: ListItem, on: boolean, extra?: ReactNode) => {
    const mark = markOf(item);
    const changed = !on && mark?.kind === "got" && mark.amount !== item.amount;
    return (
      <li key={item.key} className="flex flex-col border-t border-divider first:border-t-0 @2xl:flex-row @2xl:items-center @2xl:gap-3">
        <button type="button" role="checkbox" aria-checked={on} onClick={() => tick(item, !on)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left">
          <FoodTick on={on} />
          <span className={cn("min-w-0 flex-1", on && "text-muted-foreground line-through")}>
            <span className="block text-sm @2xl:text-[15px]">
              <span className="font-semibold">{item.name}</span>
              {item.amount && `, ${item.amount}`}
            </span>
            <span className="block text-xs text-muted-foreground">{sourcesWords(item)}</span>
            {changed && (
              <span className="block text-xs font-medium text-food-accent-ink">{`You ticked ${mark.amount || "it"} earlier; the week now needs more.`}</span>
            )}
          </span>
        </button>
        {extra}
      </li>
    );
  };

  const aisleCard = (key: string, label: string, look: { icon: LucideIcon; tone: ThumbTone }, items: ListItem[]) => {
    const Icon = look.icon;
    return (
      <section key={key} className={CARD}>
        <h2 className={cn(CARD_TITLE, "flex items-center gap-2.5")}>
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_CLASS[look.tone])} aria-hidden>
            <Icon className="size-4" />
          </span>
          {label}
        </h2>
        <ul className="mt-1.5">{items.map((item) => row(item, got(item)))}</ul>
      </section>
    );
  };

  return (
    <>
      <FoodHeader phoneEyebrow={`Food · ${span}`} title="Shopping list" sub={span} subOnPhone={false} actions={<HelpButton />} />
      <FoodNav list={{ tenantId, today, cooks, foods, names, always: kept }} />

      <section className={cn(FOOD_CARD, "grid grid-cols-[1fr_auto] gap-x-3 gap-y-2.5 p-4 @2xl:p-[22px]")} aria-label="To buy">
        <div className="col-span-2 min-w-0 @2xl:col-span-1">
          <p className="font-food-display text-[28px] leading-none font-bold tracking-[-0.02em] @2xl:text-[34px]">
            {left > 0 ? `${left} to buy` : ticked > 0 ? "Nothing left to buy" : "Nothing to buy"}
          </p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {planned
              ? `For ${[list.cooks > 0 ? count(list.cooks, "recipe to cook", "recipes to cook") : null, list.foods > 0 ? count(list.foods, "food", "foods") : null]
                  .filter(Boolean)
                  .join(" and ")}.`
              : "Nothing is planned for these days."}
            {!planned && list.items.length === 0 && own.length === 0 && " Put meals on the week, and what they need comes here."}
          </p>
          {/* A line of its own, there before the first tick too: ticking never changes how many lines the card takes. */}
          {left + ticked > 0 && (
            <p className="text-sm text-muted-foreground">{ticked > 0 ? `${count(ticked, "thing", "things")} ticked.` : "Nothing ticked yet."}</p>
          )}
        </div>
        {left + ticked > 0 && (
          <div
            className="col-span-2 h-2.5 overflow-hidden rounded-full bg-food-tabs-track"
            role="progressbar"
            aria-label="Ticked"
            aria-valuemin={0}
            aria-valuemax={left + ticked}
            aria-valuenow={ticked}
          >
            <div className="h-full rounded-full bg-food-accent transition-[width]" style={{ width: `${(ticked / (left + ticked)) * 100}%` }} />
          </div>
        )}
        <div className="col-span-2 flex flex-wrap gap-2 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-1 @2xl:self-end">
          <button type="button" onClick={() => setPicking((now) => !now)} aria-expanded={picking} className={cn(FOOD_SOFT, FOOD_SIZE.sm)}>
            <CalendarDays className="size-4" aria-hidden /> Change days
          </button>
          {!planned && list.items.length === 0 && own.length === 0 && (
            <Link href="/personal/m/food/week" className={cn(FOOD_SOFT, FOOD_SIZE.sm)}>
              Go to the week
            </Link>
          )}
        </div>
        {picking && (
          <div className="col-span-2 flex flex-wrap items-center gap-2 border-t border-divider pt-3 text-sm">
            <label className="flex items-center gap-2">
              From
              <select value={range.from} onChange={(e) => setRange({ from: e.target.value, to: range.to })} className={select}>
                {fromDays.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              to
              <select value={range.to} onChange={(e) => setRange({ from: range.from, to: e.target.value })} className={select}>
                {toDays.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <p className="basis-full text-xs text-muted-foreground">
              A new first day is a new trip: it starts with nothing ticked. A batch is bought for the day it is cooked.
            </p>
          </div>
        )}
      </section>

      {sorting && (
        <p className={cn(FOOD_CARD, "flex items-center gap-2 px-4 py-3 text-sm")} aria-live="polite">
          <Loader2 className="size-4 animate-spin text-food-accent" aria-hidden />
          {`Sorting ${count(unnamed, "ingredient", "ingredients")} into aisles. It takes a few seconds.`}
        </p>
      )}
      {unnamed > 0 && !sorting && (
        <div className={cn(FOOD_CARD, "flex flex-wrap items-center gap-2 px-4 py-3 text-sm")}>
          <span className="text-destructive">The list could not be sorted into aisles this time.</span>
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={cn(FOOD_SOFT, FOOD_SIZE.sm)}>
            Try again
          </button>
        </div>
      )}

      <div className="@4xl:columns-2 @4xl:gap-5">
        {AISLES.map((aisle) => {
          const items = toBuy.filter((item) => item.aisle === aisle);
          return items.length > 0 ? aisleCard(aisle, AISLE_LABELS[aisle], AISLE_LOOK[aisle], items) : null;
        })}

        {unsortedItems.length > 0 && aisleCard("unsorted", "Not sorted yet", AISLE_LOOK.other, unsortedItems)}

        {(askStaples.length > 0 || atHome.length > 0) && (
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Have these at home?</h2>
            <ul className="mt-1.5 empty:hidden">
              {askStaples.map((item) =>
                row(
                  item,
                  got(item),
                  // Hidden once ticked, not taken out, so a tick never changes the row's height.
                  <div className={cn("flex shrink-0 gap-1.5 pb-2.5 pl-[42px] @2xl:pb-0 @2xl:pl-0", got(item) && "invisible")}>
                    <button type="button" className={SMALL_SOFT} onClick={() => haveIt(item)}>
                      Have it
                    </button>
                    <button type="button" className={SMALL_QUIET} onClick={() => alwaysHave(item.key, true)} disabled={pending}>
                      Always have
                    </button>
                  </div>,
                ),
              )}
            </ul>
            {atHome.length > 0 && (
              <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-xs text-muted-foreground", askStaples.length > 0 && "border-t border-divider")}>
                <span>{`At home: ${atHome.map((item) => item.name.toLowerCase()).join(", ")}.`}</span>
                {atHome.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className="font-semibold text-food-accent-ink underline-offset-2 hover:underline"
                    onClick={() => write((s) => setMark(s, range.from, item.key, null))}
                  >
                    {`Need ${item.name.toLowerCase()}`}
                  </button>
                ))}
              </p>
            )}
          </section>
        )}

        <section className={CARD}>
          <h2 className={CARD_TITLE}>Your items</h2>
          <form
            className="mt-2.5 flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              addOwnItem();
            }}
          >
            <input
              value={ownText}
              onChange={(e) => setOwnText(e.target.value)}
              placeholder="Coffee beans"
              aria-label="Add an item"
              maxLength={120}
              className="h-11 min-w-0 flex-1 rounded-xl bg-food-field px-3.5 text-[15px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-food-accent"
            />
            <button type="submit" disabled={ownText.trim() === ""} className={cn(FOOD_SOFT, FOOD_SIZE.md)}>
              <Plus className="size-4" aria-hidden /> Add
            </button>
          </form>
          {own.length > 0 && (
            <ul className="mt-1.5">
              {own.map((item) => (
                <li key={item.id} className="flex items-center gap-2 border-t border-divider first:border-t-0">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={item.got !== null}
                    onClick={() => write((s) => toggleOwn(s, range.from, item.id))}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left"
                  >
                    <FoodTick on={item.got !== null} />
                    <span className={cn("min-w-0 text-sm break-words @2xl:text-[15px]", item.got !== null && "text-muted-foreground line-through")}>
                      {item.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Take ${item.name} off the list`}
                    onClick={() => write((s) => removeOwn(s, item.id))}
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-food-field hover:text-foreground"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {kept.length > 0 && (
          <section className="mb-4 break-inside-avoid space-y-2 px-1 text-xs text-muted-foreground @4xl:mb-5">
            <p>
              {list.leftOff.length > 0
                ? `Left off, as you always have them: ${list.leftOff.join(", ")}.`
                : `You always have ${count(kept.length, "thing", "things")}: left off every list.`}{" "}
              <button
                type="button"
                className="font-semibold text-foreground underline-offset-2 hover:underline"
                onClick={() => setShowAlways((now) => !now)}
                aria-expanded={showAlways}
              >
                Change
              </button>
            </p>
            {showAlways && (
              <ul className={cn(FOOD_CARD, "px-4 py-1 text-sm @2xl:rounded-2xl")}>
                {kept.map((item) => (
                  <li key={item} className="flex items-center justify-between gap-2 border-t border-divider py-1.5 text-foreground first:border-t-0">
                    <span>{item}</span>
                    <button type="button" className={SMALL_QUIET} onClick={() => alwaysHave(item, false)} disabled={pending}>
                      Put back
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </>
  );
}
