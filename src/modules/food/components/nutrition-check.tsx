"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Loader2, RefreshCw, Search, X } from "lucide-react";
import { toast } from "sonner";
import { HelpButton } from "@/components/app/help-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { saveWorkedAction, workOutAction } from "../actions";
import { gramWords, kcalWords, typedAmount, type FoodHit } from "../core/eating";
import { gramsOf, keepChecked, lineNumbers, perServingOf, workedWhole, type DraftLine, type IngredientFood } from "../core/nutrition";
import { plainNumber, yieldWords } from "../core/recipe";

const SOURCE_WORDS: Record<DraftLine["source"], string> = {
  line: "from the line",
  list: "USDA's weight",
  estimate: "estimated",
  typed: "typed",
  none: "no weight",
};

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * WORKING OUT A RECIPE'S NUTRITION (D4, docs/help/food/recipe-nutrition.md,
 * ADR 0131; the founder's calls 2026-10-03, as drawn): each ingredient line
 * matched to a food on USDA's ingredient list and weighed, every line for the
 * person to check (change the food, the grams, or leave it out), the totals
 * worked out as they go, and Save. The server works the numbers out again
 * from the list for what they checked; nothing typed here is trusted as a
 * number of calories. A serving is the whole divided by what the recipe makes,
 * read from the recipe and changed in its editor, never here.
 *
 * Opened with what was saved before, when it still fits the recipe; else the
 * lines are matched on opening, by Claude, in a few seconds.
 */
export function NutritionCheck({
  recipeId,
  title,
  yieldAmount,
  yieldUnit,
  past,
  initial,
  kept,
}: {
  recipeId: string;
  title: string;
  yieldAmount: number | null;
  yieldUnit: string | null;
  /** Times the recipe was logged without its numbers: what Save can fill in. */
  past: number;
  /** What was saved before and still fits; null to match on opening. */
  initial: DraftLine[] | null;
  /** What was saved before the recipe's lines changed: kept, on opening, for the lines it still has. */
  kept: DraftLine[];
}) {
  const router = useRouter();
  const [lines, setLines] = useState<DraftLine[] | null>(initial);
  const [attempt, setAttempt] = useState(initial ? -1 : 0);
  const [failed, setFailed] = useState<{ attempt: number; message: string } | null>(null);
  const [fillPast, setFillPast] = useState(true);
  const [changing, setChanging] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  // Read once, on opening: a page given new props must not match the lines again.
  const keptOnOpening = useRef(kept);

  // Match the lines on opening, keeping what was checked before for the lines
  // the recipe still has; and again, from the start, on Match again (a new attempt).
  useEffect(() => {
    if (attempt < 0) return;
    let gone = false;
    workOutAction({ recipeId }).then((outcome) => {
      if (gone) return;
      if ("error" in outcome) setFailed({ attempt, message: outcome.error });
      else setLines(attempt === 0 ? keepChecked(outcome.lines, keptOnOpening.current) : outcome.lines);
    });
    return () => {
      gone = true;
    };
  }, [attempt, recipeId]);
  const matching = attempt >= 0 && lines === null && failed?.attempt !== attempt;

  const whole = lines ? workedWhole(lines) : null;
  const perServing = whole ? perServingOf(whole, yieldAmount) : null;
  const countedLines = lines?.filter((line) => lineNumbers(line) !== null).length ?? 0;
  const says = yieldAmount !== null && yieldAmount > 0;
  const main = (n: typeof perServing) =>
    n
      ? [
          n.calories !== undefined ? kcalWords(n.calories) : null,
          n.proteinG !== undefined ? `protein ${gramWords(n.proteinG)}` : null,
          n.carbsG !== undefined ? `carbs ${gramWords(n.carbsG)}` : null,
          n.fatG !== undefined ? `fat ${gramWords(n.fatG)}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "nothing counted yet"
      : "nothing counted yet";

  function change(i: number, patch: Partial<DraftLine>) {
    setLines((now) => (now ? now.map((line, j) => (j === i ? { ...line, ...patch } : line)) : now));
  }

  function chooseFood(i: number, hit: FoodHit) {
    if (!lines) return;
    const food: IngredientFood = { fdcId: hit.fdcId, name: hit.name, per100g: hit.per100g, portions: hit.portions };
    const line = lines[i];
    // A weight the person typed stays; any other is found again for the new food.
    const weighed = line.source === "typed" ? { grams: line.grams, source: line.source } : gramsOf(line.line, food, line.estimate);
    change(i, { food, grams: weighed.grams, source: weighed.source, counted: weighed.grams !== null });
    setChanging(null);
  }

  function matchAgain() {
    setLines(null);
    setFailed(null);
    setAttempt((n) => (n < 0 ? 1 : n + 1));
  }

  function save() {
    if (!lines) return;
    startTransition(async () => {
      const outcome = await saveWorkedAction({
        recipeId,
        lines: lines.map((line) => ({
          line: line.line,
          fdcId: line.food?.fdcId ?? null,
          grams: line.grams,
          source: line.source,
          counted: line.counted,
        })),
        fillPast: past > 0 && fillPast,
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      toast.success(
        outcome.filled > 0 ? `Nutrition saved. Filled in ${count(outcome.filled, "past log", "past logs")}.` : "Nutrition saved.",
      );
      router.push(`/personal/m/food/recipes/${recipeId}`);
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={`/personal/m/food/recipes/${recipeId}`}>
          <ArrowLeft aria-hidden /> {title}
        </Link>
      </Button>
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-heading text-2xl font-medium tracking-heading">Working out the nutrition</h1>
          <HelpButton />
        </div>
        <p className="text-muted-foreground">
          Each line is matched to a USDA food and weighed. Change a match or a weight, or leave a line out, then save.
        </p>
      </div>

      {matching && (
        <p className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1" aria-live="polite">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Matching the ingredients to USDA&apos;s list. It takes a few seconds.
        </p>
      )}
      {failed?.attempt === attempt && lines === null && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <span className="text-destructive">{failed.message}</span>
          <Button size="sm" variant="outline" onClick={matchAgain}>
            Try again
          </Button>
        </div>
      )}

      {lines && (
        <>
          <section className="rounded-2xl bg-card px-4 py-2 shadow-elevation-1" aria-label="Ingredients">
            <ul className="divide-y divide-border">
              {lines.map((line, i) => {
                const numbers = lineNumbers(line);
                return (
                  <li key={`${i}:${line.line}`} className="space-y-2 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className={cn(!line.counted && "text-muted-foreground")}>{line.line}</p>
                        <p className={cn("text-sm", line.food ? "text-muted-foreground" : "text-destructive")}>
                          {line.food ? line.food.name : "No match on USDA's list. Choose a food."}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm tabular-nums">
                        {!line.counted ? "not counted" : numbers?.calories != null ? kcalWords(numbers.calories) : "–"}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <Input
                          inputMode="decimal"
                          aria-label={`Grams of ${line.line}`}
                          value={line.grams === null ? "" : plainNumber(Math.round(line.grams * 10) / 10)}
                          onChange={(e) => {
                            const grams = typedAmount(e.target.value);
                            change(i, { grams, source: "typed", counted: grams !== null && line.food !== null ? true : line.counted });
                          }}
                          placeholder="grams"
                          className="h-8 w-20"
                        />
                        <span className="text-sm">g</span>
                        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                          {SOURCE_WORDS[line.source]}
                        </span>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => setChanging(changing === i ? null : i)} aria-expanded={changing === i}>
                        {line.food ? "Change food" : "Choose a food"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => change(i, { counted: !line.counted })}
                        disabled={!line.counted && (line.food === null || line.grams === null)}
                      >
                        {line.counted ? "Leave out" : "Count it"}
                      </Button>
                    </div>
                    {changing === i && <IngredientSearch start={line.line} onChoose={(hit) => chooseFood(i, hit)} onClose={() => setChanging(null)} />}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="space-y-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1" aria-label="Per serving">
            {says ? (
              <div className="space-y-1">
                <p className="font-medium tabular-nums">{`Per serving: ${main(perServing)}`}</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {`The whole recipe, which makes ${yieldWords(yieldAmount ?? 1, yieldUnit)}: ${kcalWords(whole?.calories ?? 0)}, from ${count(countedLines, "line", "lines")} of ${lines.length}.`}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-medium tabular-nums">{`The whole recipe: ${main(whole)}`}</p>
                <p className="text-sm text-muted-foreground">
                  {`From ${count(countedLines, "line", "lines")} of ${lines.length}. The recipe does not say what it makes, so all of it counts as one serving. Say what it makes in its editor to count it by the serving.`}
                </p>
              </div>
            )}
            {past > 0 && (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" checked={fillPast} onChange={(e) => setFillPast(e.target.checked)} className="mt-0.5 size-4" />
                <span>{`Also count it for the ${count(past, "time", "times")} you logged it with no numbers. Numbers already logged stay as they are.`}</span>
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={pending || countedLines === 0}>
                {pending ? "Saving…" : "Save as worked out"}
              </Button>
              <Button variant="ghost" onClick={matchAgain} disabled={pending}>
                <RefreshCw aria-hidden /> Match again
              </Button>
            </div>
          </section>
          <p className="text-xs text-muted-foreground">
            Foods and their nutrition from USDA FoodData Central (SR Legacy), per 100 g, for the grams you check. Claude found
            the foods and estimated the weights marked estimated; it says nothing about what they contain.
          </p>
        </>
      )}
    </div>
  );
}

/** USDA's ingredient list searched as the person types, to change the food a line was matched to. */
function IngredientSearch({ start, onChoose, onClose }: { start: string; onChoose: (hit: FoodHit) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ q: string; foods: FoodHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  function search(text: string) {
    setQ(text);
    if (timer.current !== null) window.clearTimeout(timer.current);
    inFlight.current?.abort();
    if (text.trim() === "") {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(async () => {
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const response = await fetch(`/api/food/ingredients?q=${encodeURIComponent(text)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { foods: FoodHit[] };
        setResults({ q: text, foods: body.foods });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toast.error("The search did not work this time. Try again.");
      }
      setSearching(false);
    }, 200);
  }

  return (
    <div className="space-y-2 rounded-xl bg-muted/50 p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          autoFocus
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder={start.replace(/^[\d\s½⅓⅔¼¾⅛/.-]+/, "").slice(0, 40) || "Search USDA's ingredients"}
          aria-label="Search USDA's ingredients"
          className="h-10 pr-10 pl-9"
        />
        <button
          type="button"
          aria-label="Close the search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {searching && !results && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Searching…
        </p>
      )}
      {results && results.foods.length === 0 && (
        <p className="text-sm text-muted-foreground">{`Nothing found for “${results.q}”. Try fewer words, or other ones.`}</p>
      )}
      {results && results.foods.length > 0 && (
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl bg-card">
          {results.foods.map((food) => (
            <li key={food.fdcId}>
              <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => onChoose(food)}>
                <span className="block text-sm">{food.name}</span>
                <span className="block text-xs text-muted-foreground">{`${food.category} · ${kcalWords(food.per100g.calories)} per 100 g`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
