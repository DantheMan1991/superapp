"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, BellRing, Check, ListChecks, Plus, Timer, Undo2, X } from "lucide-react";
import type { FoodLine } from "@/db/schema/food";
import { HelpButton } from "@/components/app/help-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWakeLock } from "@/lib/use-wake-lock";
import { logCookAction, undoCookAction } from "../actions";
import { readLine, showLine } from "../core/amounts";
import {
  addMinute,
  clampStep,
  isRinging,
  isStale,
  loggedWords,
  realSteps,
  startTimer,
  stopTimer,
  toggleTick,
  type CookSession,
} from "../core/cook";
import { yieldWords } from "../core/recipe";
import { clockFace, durationWords, rangeWords, stepPieces, type StepTime } from "../core/times";
import { stepUses } from "../core/uses";
import { unlockAlarm, useAlarm } from "./alarm";
import { changeCookSession, useCookSession, writeCookSession } from "./cook-store";
import { useNow } from "./use-now";

/**
 * COOK MODE (docs/help/food/cook.md, D1b): the screen stays on; the
 * ingredients to gather first, at the servings chosen on the recipe; then one
 * step at a time in big type, with each time in a step a button that starts a
 * timer, the lines the step uses under it, timers that keep running between
 * steps and ring until stopped; and at the end, "Log that you made it".
 *
 * Everything here lives on the phone (`cook-store.ts`) until the log, which
 * is the one thing sent: leaving and coming back picks up where it was.
 */
export function CookMode({
  recipeId,
  title,
  yieldAmount,
  yieldUnit,
  ingredients,
  steps,
  urlServings,
  today,
}: {
  recipeId: string;
  title: string;
  yieldAmount: number | null;
  yieldUnit: string | null;
  ingredients: FoodLine[];
  steps: FoodLine[];
  urlServings: number | null;
  /** The space's own day, to say "made today". */
  today: string;
}) {
  const router = useRouter();
  const stored = useCookSession(recipeId);
  const now = useNow();
  const session = stored && !(now > 0 && isStale(stored, now)) ? stored : null;
  // A cook under way keeps its own servings; the link's start a new one.
  const servings = session?.servings ?? urlServings ?? yieldAmount;
  const factor = yieldAmount && servings ? servings / yieldAmount : 1;
  const all = realSteps(steps);
  const screen = session?.screen ?? "gather";
  const at = clampStep(session?.step ?? 0, all.length);
  const step = all[at] ?? null;
  const ticked = new Set(session?.ticked ?? []);
  const timers = session?.timers ?? [];
  const ringing = now > 0 ? timers.filter((t) => isRinging(t, now)) : [];
  const running = timers.filter((t) => !ringing.includes(t));
  const [listOpen, setListOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const recipeHref = `/personal/m/food/recipes/${recipeId}`;
  const making = yieldAmount && servings ? yieldWords(servings, yieldUnit) : null;

  useWakeLock(true);
  useAlarm(ringing.length > 0);

  /** Every change goes through the store, which brings the time and new ids. */
  function update(change: (session: CookSession, now: number, newId: () => string) => CookSession) {
    changeCookSession(recipeId, servings, change);
  }

  function begin(time: StepTime) {
    unlockAlarm();
    update((s, now, newId) =>
      startTimer(s, { label: `Step ${at + 1} · ${rangeWords(time.lo, time.hi)}`, lo: time.lo, hi: time.hi }, now, newId()),
    );
  }

  function next() {
    unlockAlarm();
    update((s) => (at + 1 < all.length ? { ...s, screen: "step", step: at + 1 } : { ...s, screen: "done" }));
  }

  function back() {
    update((s) =>
      screen === "done"
        ? { ...s, screen: all.length > 0 ? "step" : "gather", step: Math.max(0, all.length - 1) }
        : at === 0
          ? { ...s, screen: "gather" }
          : { ...s, step: at - 1 },
    );
  }

  function logIt() {
    if (!session) return;
    startTransition(async () => {
      const outcome = await logCookAction({
        cookId: session.cookId,
        recipeId,
        servings: yieldAmount ? servings : null,
      });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      update((s) => ({ ...s, logged: { madeOn: outcome.madeOn } }));
    });
  }

  function undo() {
    if (!session) return;
    startTransition(async () => {
      const outcome = await undoCookAction({ cookId: session.cookId, recipeId });
      if ("error" in outcome) {
        toast.error(outcome.error);
        return;
      }
      update((s) => ({ ...s, logged: null }));
    });
  }

  function finish() {
    // Timers still running stay, with the finish screen, for the next time
    // cook mode opens; with none left, the cook is over.
    if (timers.length === 0) writeCookSession(recipeId, null);
    router.push(recipeHref);
  }

  const checklist = (
    <Checklist
      ingredients={ingredients}
      factor={factor}
      ticked={ticked}
      onToggle={(i) => update((s) => toggleTick(s, i))}
    />
  );

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-5rem)] w-full max-w-2xl flex-col gap-5">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href={recipeHref}>
              <ArrowLeft aria-hidden /> Recipe
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            {screen === "step" && (
              <span className="text-sm text-muted-foreground">
                Step {at + 1} of {all.length}
              </span>
            )}
            {screen !== "gather" && ingredients.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setListOpen(true)}>
                <ListChecks aria-hidden /> Ingredients
              </Button>
            )}
            <HelpButton />
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          {title}
          {making ? ` · ${making}` : ""}
        </p>
      </div>

      {ringing.map((timer) => (
        <div
          key={timer.id}
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3"
        >
          <div>
            <p className="flex items-center gap-2 font-medium text-destructive">
              <BellRing className="size-5" aria-hidden /> {timer.label}: time&apos;s up
            </p>
            <p className="text-sm text-muted-foreground">
              {timer.hi ? `Check it now. It can take up to ${durationWords(timer.hi)}.` : "Done."}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => update((s, now) => addMinute(s, timer.id, now))}>
              <Plus aria-hidden /> 1 min
            </Button>
            <Button size="sm" onClick={() => update((s) => stopTimer(s, timer.id))}>
              Stop
            </Button>
          </div>
        </div>
      ))}

      {screen === "gather" && (
        <section className="space-y-2">
          <h1 className="font-heading text-2xl font-medium tracking-heading">Gather the ingredients</h1>
          {ingredients.length > 0 ? (
            <>
              <p className="text-sm text-muted-foreground">Tick each one as you set it out.</p>
              <div className="rounded-2xl bg-card px-4 shadow-elevation-1">{checklist}</div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No ingredients written down.</p>
          )}
          {all.length === 0 && <p className="text-sm text-muted-foreground">No steps written down.</p>}
        </section>
      )}

      {screen === "step" && step && (
        <section className="space-y-4">
          {step.heading && <p className="text-sm font-medium text-muted-foreground">{step.heading}</p>}
          <p className="whitespace-pre-line text-[1.7rem] leading-snug">
            {stepPieces(step.text).map((piece, i) =>
              piece.kind === "text" ? (
                <span key={i}>{piece.text}</span>
              ) : (
                <button
                  key={i}
                  type="button"
                  onClick={() => begin(piece)}
                  aria-label={`Start a ${rangeWords(piece.lo, piece.hi)} timer`}
                  className="inline-flex items-baseline gap-1 rounded-full border border-module-accent/50 bg-module-accent/10 px-2 text-module-accent hover:bg-module-accent/20"
                >
                  <Timer className="size-[0.75em] self-center" aria-hidden />
                  {piece.text}
                </button>
              ),
            )}
          </p>
          <StepUses step={step.text} ingredients={ingredients} factor={factor} />
        </section>
      )}

      {screen === "done" && (
        <section className="space-y-4">
          <h1 className="font-heading text-3xl font-medium tracking-heading">Done. Enjoy it.</h1>
          {session?.logged ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
              <p className="flex items-center gap-2">
                <Check className="size-5 text-module-accent" aria-hidden />
                {loggedWords(session.logged.madeOn, today, making)}
              </p>
              <Button variant="ghost" size="sm" onClick={undo} disabled={pending}>
                <Undo2 aria-hidden /> Undo
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              <Button className="h-12 w-full text-base" onClick={logIt} disabled={pending || !session}>
                {pending ? "Logging…" : "Log that you made it"}
              </Button>
              <p className="text-sm text-muted-foreground">
                The recipe shows how many times you have made it, and when last.
              </p>
            </div>
          )}
        </section>
      )}

      {running.length > 0 && (
        <section aria-label="Timers" className="rounded-2xl bg-card px-4 py-3 shadow-elevation-1">
          <p className="text-xs text-muted-foreground">Timers keep running between steps.</p>
          <ul>
            {running.map((timer) => (
              <li key={timer.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="text-sm">{timer.label}</span>
                <span className="flex items-center gap-1">
                  <span className="min-w-16 text-right text-lg font-medium tabular-nums">
                    {clockFace(timer.endsAt - now)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`One more minute on ${timer.label}`}
                    onClick={() => update((s, now) => addMinute(s, timer.id, now))}
                  >
                    <Plus aria-hidden /> 1
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Stop ${timer.label}`}
                    onClick={() => update((s) => stopTimer(s, timer.id))}
                  >
                    <X aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 mt-auto flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border">
        {screen === "gather" ? (
          <Button
            className="h-14 flex-1 text-base"
            onClick={() => {
              unlockAlarm();
              update((s) => ({ ...s, screen: all.length > 0 ? "step" : "done", step: 0 }));
            }}
          >
            {all.length > 0 ? "Start cooking" : "Done cooking"}
          </Button>
        ) : screen === "step" ? (
          <>
            <Button variant="outline" className="h-14 flex-1 text-base" onClick={back}>
              Back
            </Button>
            <Button className="h-14 flex-1 text-base" onClick={next}>
              {at + 1 < all.length ? "Next" : "Done cooking"}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" className="h-14 flex-1 text-base" onClick={back}>
              Back
            </Button>
            <Button variant="outline" className="h-14 flex-1 text-base" onClick={finish}>
              Back to the recipe
            </Button>
          </>
        )}
      </div>

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ingredients</DialogTitle>
            <DialogDescription>{making ? `For ${making}.` : "As the recipe gives them."}</DialogDescription>
          </DialogHeader>
          {checklist}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A line at the servings being cooked, its amount marked. */
function ScaledLine({ text, factor }: { text: string; factor: number }) {
  return (
    <>
      {showLine(readLine(text), factor).map((part, i) =>
        part.amount ? (
          <span key={i} className="font-medium text-module-accent">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Checklist({
  ingredients,
  factor,
  ticked,
  onToggle,
}: {
  ingredients: FoodLine[];
  factor: number;
  ticked: ReadonlySet<number>;
  onToggle: (index: number) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {ingredients.map((line, i) =>
        line.heading ? (
          <li key={i} className="pt-3 pb-1 text-sm font-medium">
            {line.text}
          </li>
        ) : (
          <li key={i}>
            <label className="flex items-start gap-3 py-3 text-lg">
              <Checkbox className="mt-1.5" checked={ticked.has(i)} onCheckedChange={() => onToggle(i)} />
              <span className={ticked.has(i) ? "text-muted-foreground line-through" : undefined}>
                <ScaledLine text={line.text} factor={factor} />
              </span>
            </label>
          </li>
        ),
      )}
    </ul>
  );
}

/** "Uses:" under a step: the lines it names, at the servings being cooked (the founder's call). */
function StepUses({ step, ingredients, factor }: { step: string; ingredients: FoodLine[]; factor: number }) {
  const used = stepUses(step, ingredients);
  if (used.length === 0) return null;
  return (
    <p className="text-base text-muted-foreground">
      <span className="font-medium text-foreground">Uses: </span>
      {used.map((index, i) => (
        <span key={index}>
          {i > 0 && " · "}
          <ScaledLine text={ingredients[index].text} factor={factor} />
        </span>
      ))}
    </p>
  );
}
