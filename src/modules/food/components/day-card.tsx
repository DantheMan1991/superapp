"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { gramWords, typedWhole, type DayTotals, type TargetsInput } from "../core/eating";
import { caloriesLeft, energySplit, ringShare } from "../core/today";

const RING_MOTION =
  "transition-[stroke-dashoffset] duration-[900ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] animate-[food-ring-in_900ms_cubic-bezier(0.2,0.8,0.2,1)_backwards] motion-reduce:animate-none motion-reduce:transition-none";

/** One ring: its track and, with a target, how far round the day is. */
function Ring({ size, r, width, share, track, value }: { size: number; r: number; width: number; share: number | null; track: string; value: string }) {
  const c = 2 * Math.PI * r;
  const offset = share === null ? c : c * (1 - share);
  return (
    <>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={width} className={track} />
      {share !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={c}
          className={cn(value, RING_MOTION)}
          style={{ strokeDashoffset: offset, "--food-ring-from": c } as CSSProperties}
        />
      )}
    </>
  );
}

/**
 * THE DOUBLE RING (the design's): calories round the outside in Food's colour,
 * protein inside in its red, each against its target and full when it is
 * met; the middle says what is left of the calories, or how far over.
 */
function Rings({
  big,
  calories,
  protein,
  children,
}: {
  big: boolean;
  calories: number | null;
  protein: number | null;
  children: ReactNode;
}) {
  const size = big ? 196 : 124;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="-rotate-90" aria-hidden>
        <Ring size={size} r={big ? 86 : 54} width={big ? 16 : 11} share={calories} track="stroke-food-ring-track" value="stroke-food-accent" />
        <Ring size={size} r={big ? 64 : 39} width={big ? 10 : 7} share={protein} track="stroke-food-protein-track" value="stroke-food-protein" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

function whole(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * THE DAY'S NUMBERS (the Fresh Market redesign, docs/help/food/overview.md):
 * the rings against the targets, calories and protein against them, where
 * the day's calories came from, a line saying where the day stands, and the
 * targets, changed here. With no targets, the four numbers large and Set
 * targets. A phone gets the small ring and the four numbers beside it.
 */
export function DayCard({
  day,
  goal,
  cheer,
  isToday,
  pending,
  onSaveGoal,
  className,
}: {
  day: DayTotals;
  goal: TargetsInput;
  cheer: string | null;
  isToday: boolean;
  pending: boolean;
  onSaveGoal: (next: TargetsInput) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [caloriesText, setCaloriesText] = useState("");
  const [proteinText, setProteinText] = useState("");

  const kcal = day.calories ?? 0;
  const protein = day.proteinG ?? 0;
  const hasTargets = goal.calories !== null || goal.proteinG !== null;
  const calorieShare = goal.calories === null ? null : ringShare(kcal, goal.calories);
  const proteinShare = goal.proteinG === null ? null : ringShare(protein, goal.proteinG);
  const split = energySplit(day);

  function open() {
    setEditing(true);
    setCaloriesText(goal.calories === null ? "" : String(goal.calories));
    setProteinText(goal.proteinG === null ? "" : String(goal.proteinG));
  }

  const caloriesTyped = typedWhole(caloriesText);
  const proteinTyped = typedWhole(proteinText);
  const caloriesOk = caloriesText.trim() === "" || (caloriesTyped !== null && caloriesTyped >= 500 && caloriesTyped <= 10_000);
  const proteinOk = proteinText.trim() === "" || (proteinTyped !== null && proteinTyped >= 10 && proteinTyped <= 500);

  function save() {
    if (!caloriesOk || !proteinOk) return;
    onSaveGoal({
      calories: caloriesText.trim() === "" ? null : caloriesTyped,
      proteinG: proteinText.trim() === "" ? null : proteinTyped,
    });
    setEditing(false);
  }

  const middle = (big: boolean) => {
    const figure = big ? "text-4xl" : "text-2xl";
    if (goal.calories !== null) {
      const left = caloriesLeft(kcal, goal.calories);
      return (
        <>
          <span className={cn("font-food-display leading-none font-extrabold tracking-[-0.03em] tabular-nums", figure)}>
            {left.over ? `+${whole(left.amount)}` : whole(left.amount)}
          </span>
          <span className="mt-1 text-xs text-muted-foreground">{left.over ? "kcal over" : "kcal left"}</span>
        </>
      );
    }
    const target = goal.proteinG ?? 0;
    const short = Math.max(0, target - protein);
    return (
      <>
        <span className={cn("font-food-display leading-none font-extrabold tracking-[-0.03em] tabular-nums", figure)}>{gramWords(short)}</span>
        <span className="mt-1 text-xs text-muted-foreground">protein left</span>
      </>
    );
  };

  const caloriesWords =
    goal.calories === null ? (
      <>
        <b className="text-[17px] font-bold">{whole(kcal)}</b> kcal
      </>
    ) : (
      <>
        <b className="text-[17px] font-bold">{whole(kcal)}</b> of {whole(goal.calories)} kcal
      </>
    );
  const proteinWords =
    goal.proteinG === null ? (
      <b className="text-[17px] font-bold">{gramWords(protein)}</b>
    ) : (
      <>
        <b className="text-[17px] font-bold">{gramWords(protein)}</b> of {gramWords(goal.proteinG)}
      </>
    );

  const fourNumbers = [
    { label: "Calories", value: `${whole(kcal)} kcal` },
    { label: "Protein", value: gramWords(protein) },
    { label: "Carbs", value: gramWords(day.carbsG ?? 0) },
    { label: "Fat", value: gramWords(day.fatG ?? 0) },
  ];

  return (
    <section aria-label={isToday ? "Today's numbers" : "The day's numbers"} className={cn("space-y-5 rounded-2xl bg-card p-4 shadow-food-card @2xl:rounded-3xl @2xl:p-6", className)}>
      {hasTargets ? (
        <>
          {/* A phone: the small ring and the four numbers beside it. */}
          <div className="flex items-center gap-4 @2xl:hidden">
            <Rings big={false} calories={calorieShare} protein={proteinShare}>
              {middle(false)}
            </Rings>
            <dl className="min-w-0 flex-1 space-y-2 text-[13px] tabular-nums">
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-food-accent" aria-hidden /> Calories
                </dt>
                <dd className="font-semibold">{whole(kcal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-food-protein" aria-hidden /> Protein
                </dt>
                <dd className="font-semibold">
                  {goal.proteinG === null ? gramWords(protein) : `${Math.round(protein)} / ${gramWords(goal.proteinG)}`}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-2 pl-4">
                <dt>Carbs</dt>
                <dd className="text-muted-foreground">{gramWords(day.carbsG ?? 0)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2 pl-4">
                <dt>Fat</dt>
                <dd className="text-muted-foreground">{gramWords(day.fatG ?? 0)}</dd>
              </div>
            </dl>
          </div>

          {/* A wide screen: the big ring, the two targets, and where the calories came from. */}
          <div className="hidden items-center gap-6 @2xl:flex">
            <Rings big calories={calorieShare} protein={proteinShare}>
              {middle(true)}
            </Rings>
            <div className="min-w-0 flex-1 space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className="size-2 rounded-full bg-food-accent" aria-hidden /> Calories
                </span>
                <span className="text-[13px] text-muted-foreground tabular-nums [&_b]:text-foreground">{caloriesWords}</span>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  <span className="size-2 rounded-full bg-food-protein" aria-hidden /> Protein
                </span>
                <span className="text-[13px] text-muted-foreground tabular-nums [&_b]:text-foreground">{proteinWords}</span>
              </div>
              <div className="space-y-2 border-t border-divider pt-3">
                <p className="text-xs text-muted-foreground">
                  {isToday ? "Where today's calories came from" : "Where the day's calories came from"}
                </p>
                {split ? (
                  <div className="flex h-3 gap-[3px]" aria-hidden>
                    {(
                      [
                        ["protein", split.protein, "bg-food-protein"],
                        ["carbs", split.carbs, "bg-food-carbs"],
                        ["fat", split.fat, "bg-food-fat"],
                      ] as const
                    )
                      .filter(([, share]) => share > 0)
                      .map(([key, share, colour]) => (
                        <span
                          key={key}
                          className={cn(
                            "basis-0 rounded-full transition-[flex-grow] duration-[600ms] animate-[food-grow-in_600ms_ease-out_backwards] motion-reduce:animate-none motion-reduce:transition-none",
                            colour,
                          )}
                          style={{ flexGrow: share }}
                        />
                      ))}
                  </div>
                ) : (
                  <div className="h-3 rounded-full bg-food-ring-track" aria-hidden />
                )}
                <p className="text-xs text-muted-foreground tabular-nums [&_b]:font-semibold [&_b]:text-foreground">
                  <b>{gramWords(protein)}</b> protein · <b>{gramWords(day.carbsG ?? 0)}</b> carbs · <b>{gramWords(day.fatG ?? 0)}</b> fat
                </p>
              </div>
            </div>
          </div>
        </>
      ) : (
        <dl className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
          {fourNumbers.map((cell) => (
            <div key={cell.label} className="flex flex-col-reverse">
              <dt className="text-[13px] text-muted-foreground">{cell.label}</dt>
              <dd className="font-food-display text-2xl font-bold tracking-[-0.02em] tabular-nums @2xl:text-[28px]">{cell.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {day.unknown > 0 && (
        <p className="text-sm text-muted-foreground">
          {`${day.unknown} ${day.unknown === 1 ? "thing has" : "things have"} no nutrition: its recipe has none yet. Tap it to work the recipe's nutrition out from its ingredients, and it counts here too.`}
        </p>
      )}

      {editing ? (
        <div className="space-y-3 border-t border-divider pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1">
              <span className="block text-[13px] font-medium">Calories a day</span>
              <input
                inputMode="numeric"
                value={caloriesText}
                onChange={(e) => setCaloriesText(e.target.value)}
                placeholder="2,200"
                className="h-12 w-32 rounded-xl bg-food-field px-4 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-food-accent"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-[13px] font-medium">Protein a day, g</span>
              <input
                inputMode="numeric"
                value={proteinText}
                onChange={(e) => setProteinText(e.target.value)}
                placeholder="150"
                className="h-12 w-32 rounded-xl bg-food-field px-4 text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-food-accent"
              />
            </label>
          </div>
          {(!caloriesOk || !proteinOk) && (
            <p className="text-sm text-destructive">{!caloriesOk ? "Calories between 500 and 10,000." : "Protein between 10 and 500 g."}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Leave a box empty for no target. A day is on its calorie target within a tenth of it, either way, and on its protein
            target at or above it.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={pending || !caloriesOk || !proteinOk}
              className="h-11 rounded-xl bg-food-accent px-5 text-[15px] font-semibold text-white hover:bg-food-accent-hover active:translate-y-px disabled:opacity-50"
            >
              Save targets
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-11 rounded-xl bg-food-soft px-5 text-[15px] font-medium hover:bg-food-tabs-track"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        // On a phone the line takes the width and the button goes under it, rather than squeezing it to three lines.
        <div className="flex flex-col items-start gap-2 @2xl:flex-row @2xl:items-center @2xl:justify-between @2xl:gap-4">
          {cheer && <p className="min-w-0 text-sm font-medium">{cheer}</p>}
          <button
            type="button"
            onClick={open}
            className="-ml-1 flex shrink-0 items-center gap-1.5 rounded-lg px-1 py-1 text-[13px] font-medium text-muted-foreground hover:text-foreground @2xl:ml-auto"
          >
            <Target className="size-4" aria-hidden /> {hasTargets ? "Change targets" : "Set targets"}
          </button>
        </div>
      )}
    </section>
  );
}
