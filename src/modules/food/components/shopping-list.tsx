"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { datesBetween } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import { alwaysHaveAction, nameLinesAction } from "../actions";
import {
  AISLES,
  AISLE_LABELS,
  addOwn,
  buildList,
  defaultRange,
  marksFor,
  ownFor,
  rangeOk,
  removeOwn,
  setMark,
  spanWords,
  toggleOwn,
  type LineName,
  type ListCook,
  type ListFood,
  type ListItem,
  type ListRange,
  type ShoppingState,
} from "../core/list";
import { dayTitle, plannable } from "../core/week";
import { changeShopping, useShopping } from "./list-store";

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Turkey chili" or "Turkey chili 2 · Chicken rice bowl 1". */
function sourcesWords(item: ListItem): string {
  return item.sources.map((s) => (s.amount ? `${s.label} ${s.amount}` : s.label)).join(" · ");
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
        on ? "border-module-accent bg-module-accent text-white" : "border-input bg-card",
      )}
      aria-hidden
    >
      {on && <Check className="size-3.5" />}
    </span>
  );
}

/**
 * THE SHOPPING LIST (D3, docs/help/food/list.md, ADR 0130; the founder's
 * calls 2026-10-03): what the planned days need, bought once per cooked batch,
 * the same thing added up across recipes and sorted by aisle; staples under
 * "Have these at home?", and left off for good once he always has them; his
 * own items; ticked off in the shop.
 *
 * The list is worked out here from the days' plan, as the server sent it, and
 * the names Claude gave each line; the days, the ticks and his own items are
 * kept on the phone (`list-store.ts`), so ticking works with no signal. A
 * ticked thing stays where it is, struck through, so the row under a finger
 * never moves (the drive's mis-tap, 2026-10-03); the days are kept from the
 * first tick, so tomorrow's default does not untick today's shop. Lines not
 * named yet are named on opening, and the page fetched again.
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
  const nothing = list.items.length === 0 && own.length === 0;

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

  const row = (item: ListItem, on: boolean, extra?: ReactNode) => {
    const mark = markOf(item);
    const changed = !on && mark?.kind === "got" && mark.amount !== item.amount;
    return (
      <li key={item.key} className="py-1">
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          onClick={() => tick(item, !on)}
          className="flex w-full items-start gap-3 py-1.5 text-left"
        >
          <Tick on={on} />
          <span className={cn("min-w-0", on && "text-muted-foreground line-through")}>
            <span className="block">
              {item.name}
              {item.amount && <span className="font-medium">{`, ${item.amount}`}</span>}
            </span>
            {!on && <span className="block text-xs text-muted-foreground no-underline">{sourcesWords(item)}</span>}
            {changed && <span className="block text-xs text-module-accent">{`You ticked ${mark.amount || "it"} earlier; the week now needs more.`}</span>}
          </span>
        </button>
        {extra}
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-medium">{`Shopping for ${spanWords(range.from, range.to)}`}</h2>
            <p className="text-sm text-muted-foreground">
              {list.cooks + list.foods === 0
                ? "Nothing is planned for these days."
                : `For ${[list.cooks > 0 ? count(list.cooks, "recipe to cook", "recipes to cook") : null, list.foods > 0 ? count(list.foods, "food", "foods") : null]
                    .filter(Boolean)
                    .join(" and ")}.`}
              {ticked > 0 && ` ${count(ticked, "thing", "things")} ticked.`}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setPicking((now) => !now)} aria-expanded={picking}>
            Change days
          </Button>
        </div>
        {picking && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
            <label className="flex items-center gap-2">
              From
              <select
                value={range.from}
                onChange={(e) => setRange({ from: e.target.value, to: range.to })}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
              >
                {fromDays.map((d) => (
                  <option key={d} value={d}>
                    {dayLabel(d)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              to
              <select
                value={range.to}
                onChange={(e) => setRange({ from: range.from, to: e.target.value })}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs"
              >
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
        <p className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm shadow-elevation-1" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {`Sorting ${count(unnamed, "ingredient", "ingredients")} into aisles. It takes a few seconds.`}
        </p>
      )}
      {unnamed > 0 && !sorting && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-card px-4 py-3 text-sm shadow-elevation-1">
          <span className="text-destructive">The list could not be sorted into aisles this time.</span>
          <Button size="sm" variant="outline" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </Button>
        </div>
      )}

      {nothing && (
        <section className="space-y-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <p>Nothing to buy for these days yet.</p>
          <p className="text-sm text-muted-foreground">Put meals on the week, and what they need comes here.</p>
          <Button asChild size="sm" variant="outline">
            <Link href="/personal/m/food/week">Go to the week</Link>
          </Button>
        </section>
      )}

      {AISLES.map((aisle) => {
        const items = toBuy.filter((item) => item.aisle === aisle);
        if (items.length === 0) return null;
        return (
          <section key={aisle} className="rounded-2xl bg-card px-4 py-2 shadow-elevation-1" aria-label={AISLE_LABELS[aisle]}>
            <h2 className="pt-1 text-sm font-medium text-muted-foreground">{AISLE_LABELS[aisle]}</h2>
            <ul className="divide-y divide-border">{items.map((item) => row(item, got(item)))}</ul>
          </section>
        );
      })}

      {unsortedItems.length > 0 && (
        <section className="rounded-2xl bg-card px-4 py-2 shadow-elevation-1" aria-label="Not sorted yet">
          <h2 className="pt-1 text-sm font-medium text-muted-foreground">Not sorted yet</h2>
          <ul className="divide-y divide-border">{unsortedItems.map((item) => row(item, got(item)))}</ul>
        </section>
      )}

      {(askStaples.length > 0 || atHome.length > 0) && (
        <section className="rounded-2xl bg-muted/50 px-4 py-2" aria-label="Have these at home?">
          <h2 className="pt-1 text-sm font-medium">Have these at home?</h2>
          <ul className="divide-y divide-border empty:hidden">
            {askStaples.map((item) =>
              row(
                item,
                got(item),
                got(item) ? undefined : (
                  <div className="flex flex-wrap gap-2 pb-1 pl-8">
                    <Button size="sm" variant="outline" onClick={() => haveIt(item)}>
                      Have it
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => alwaysHave(item.key, true)} disabled={pending}>
                      Always have
                    </Button>
                  </div>
                ),
              ),
            )}
          </ul>
          {atHome.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 border-t border-border py-2 text-sm text-muted-foreground">
              <span>{`At home: ${atHome.map((item) => item.name.toLowerCase()).join(", ")}.`}</span>
              {atHome.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="text-module-accent underline underline-offset-2"
                  onClick={() => write((s) => setMark(s, range.from, item.key, null))}
                >
                  {`Need ${item.name.toLowerCase()}`}
                </button>
              ))}
            </p>
          )}
        </section>
      )}

      <section className="rounded-2xl bg-card px-4 py-2 shadow-elevation-1" aria-label="Your items">
        <h2 className="pt-1 text-sm font-medium text-muted-foreground">Your items</h2>
        {own.length > 0 && (
          <ul className="divide-y divide-border">
            {own.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-2 py-1">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={item.got !== null}
                  onClick={() => write((s) => toggleOwn(s, range.from, item.id))}
                  className="flex min-w-0 flex-1 items-start gap-3 py-1.5 text-left"
                >
                  <Tick on={item.got !== null} />
                  <span className={cn("min-w-0 break-words", item.got !== null && "text-muted-foreground line-through")}>{item.name}</span>
                </button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Take ${item.name} off the list`}
                  onClick={() => write((s) => removeOwn(s, item.id))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-center gap-2 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            addOwnItem();
          }}
        >
          <Input
            value={ownText}
            onChange={(e) => setOwnText(e.target.value)}
            placeholder="Coffee beans"
            aria-label="Add an item"
            maxLength={120}
            className="h-10"
          />
          <Button type="submit" size="sm" variant="outline" disabled={ownText.trim() === ""}>
            <Plus aria-hidden /> Add
          </Button>
        </form>
      </section>

      {kept.length > 0 && (
        <section className="space-y-2 px-1 text-sm text-muted-foreground">
          <p>
            {list.leftOff.length > 0
              ? `Left off, as you always have them: ${list.leftOff.join(", ")}.`
              : `You always have ${count(kept.length, "thing", "things")}: left off every list.`}{" "}
            <button
              type="button"
              className="text-module-accent underline underline-offset-2"
              onClick={() => setShowAlways((now) => !now)}
              aria-expanded={showAlways}
            >
              Change
            </button>
          </p>
          {showAlways && (
            <ul className="divide-y divide-border rounded-2xl bg-card px-4 py-1 shadow-elevation-1">
              {kept.map((item) => (
                <li key={item} className="flex items-center justify-between gap-2 py-1.5 text-foreground">
                  <span>{item}</span>
                  <Button size="sm" variant="ghost" onClick={() => alwaysHave(item, false)} disabled={pending}>
                    Put back
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
