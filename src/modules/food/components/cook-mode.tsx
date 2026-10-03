"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeft, BellRing, Check, ListChecks, Plus, Timer, Undo2, X } from "lucide-react";
import type { FoodLine } from "@/db/schema/food";
import { HelpButton } from "@/components/app/help-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useWakeLock } from "@/lib/use-wake-lock";
import { setHeardHandler, setListenerKeywords, startListening, stopListening } from "@/lib/voice-commands/listener";
import { keywordsFor } from "@/lib/voice-commands/phrases";
import { useListener } from "@/lib/voice-commands/use-listener";
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
import {
  COOK_COMMANDS,
  commandWords,
  cookListening,
  everyCookLine,
  firstRinging,
  isCookCommand,
  listSpeech,
  nextStepTime,
  SAY,
  startedSpeech,
  stepSpeech,
  stoppedSpeech,
  timerLabel,
  usesSpeech,
} from "../core/hands-free";
import { yieldWords } from "../core/recipe";
import { clockFace, durationWords, rangeWords, stepPieces, type StepTime } from "../core/times";
import { stepUses } from "../core/uses";
import { unlockAlarm, useAlarm } from "./alarm";
import { changeCookSession, useCookSession, writeCookSession } from "./cook-store";
import { hushCook, sayCook, startCookVoice, stopCookVoice } from "./cook-voice";
import { FOOD_ACCENT, HandsFreeIntro, HandsFreeStrip, HandsFreeSwitch, hasSeenIntro, markIntroSeen } from "./hands-free";
import { useNow } from "./use-now";

/**
 * COOK MODE (docs/help/food/cook.md, D1b): the screen stays on; the
 * ingredients to gather first, at the servings chosen on the recipe; then one
 * step at a time in big type, with each time in a step a button that starts a
 * timer, the lines the step uses under it, timers that keep running between
 * steps and ring until stopped; and at the end, "Log that you made it".
 *
 * HANDS-FREE (D1c, ADR 0124): switched on, each screen is read aloud as it
 * comes up, in the workout coach's recorded voice (`cook-voice.ts`), and the
 * phone listens, on the phone itself (`@/lib/voice-commands`), for "next
 * step", "go back", "repeat", "start timer", "stop timer" and "ingredients".
 * A phrase does what its button would.
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
  naturalVoice,
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
  /** The platform has a recorded voice to read in (ADR 0115); otherwise the device's own reads. */
  naturalVoice: boolean;
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
  const [introOpen, setIntroOpen] = useState(false);
  /** What hands-free last heard and did, shown for a few seconds. */
  const [heardNote, setHeardNote] = useState<{ id: number; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const recipeHref = `/personal/m/food/recipes/${recipeId}`;
  const making = yieldAmount && servings ? yieldWords(servings, yieldUnit) : null;
  const listener = useListener();
  const handsFree = listener.status !== "off" && listener.status !== "failed";
  /**
   * Listening, or about to (held while the voice speaks, paused while the page
   * is hidden). The voice waits for this: hands-free is not on until it can
   * hear, and the wait lets the screen's own recording arrive.
   */
  const ready = listener.status === "listening" || listener.status === "held" || listener.status === "paused";
  const isRingingNow = ringing.length > 0;

  useWakeLock(true);
  useAlarm(isRingingNow);

  /** Every change goes through the store, which brings the time and new ids. */
  function update(change: (session: CookSession, now: number, newId: () => string) => CookSession) {
    changeCookSession(recipeId, servings, change);
  }

  function begin(time: StepTime) {
    unlockAlarm();
    update((s, now, newId) => startTimer(s, { label: timerLabel(at + 1, time), lo: time.lo, hi: time.hi }, now, newId()));
  }

  function next() {
    unlockAlarm();
    update((s) => (at + 1 < all.length ? { ...s, screen: "step", step: at + 1 } : { ...s, screen: "done" }));
  }

  function startCooking() {
    unlockAlarm();
    update((s) => ({ ...s, screen: all.length > 0 ? "step" : "done", step: 0 }));
  }

  /* -- hands-free (D1c) ------------------------------------------------------ */

  /** What the voice says for the screen as it is. */
  function screenSpeech(): string[] {
    if (screen === "step" && step) return stepSpeech(all, at);
    return [screen === "done" ? SAY.done : SAY.gather];
  }

  function turnOn() {
    unlockAlarm();
    startCookVoice(naturalVoice, screenSpeech(), everyCookLine(all, ingredients, factor));
    startListening(keywordsFor(COOK_COMMANDS, cookListening(isRingingNow)));
  }

  function turnOff() {
    stopListening();
    stopCookVoice();
    setHeardNote(null);
  }

  function toggleHandsFree() {
    if (handsFree) turnOff();
    else if (hasSeenIntro()) turnOn();
    else setIntroOpen(true);
  }

  function note(text: string) {
    setHeardNote((before) => ({ id: (before?.id ?? 0) + 1, text }));
  }

  /** A phrase heard: what its button would do, and a word back. */
  const heard = useEffectEvent((label: string) => {
    if (!isCookCommand(label)) return;
    const said = `Heard “${commandWords(label)}”`;
    if (label !== "ingredients") setListOpen(false);
    if (label === "next") {
      note(`${said}.`);
      if (screen === "gather") startCooking();
      else if (screen === "step") next();
      else sayCook([SAY.atEnd]);
    } else if (label === "back") {
      note(`${said}.`);
      if (screen === "gather") sayCook([SAY.atStart]);
      else back();
    } else if (label === "repeat") {
      note(`${said}.`);
      sayCook(screenSpeech());
    } else if (label === "start-timer") {
      const time = screen === "step" && step ? nextStepTime(step.text, at + 1, timers) : null;
      if (screen !== "step") {
        note(`${said}: no timer on this screen.`);
        sayCook([SAY.noTimeHere]);
      } else if (time === null) {
        note(`${said}: no time in this step.`);
        sayCook([SAY.noTime]);
      } else if (time === "running") {
        note(`${said}: already running.`);
        sayCook([SAY.running]);
      } else {
        begin(time);
        note(`${said}: ${rangeWords(time.lo, time.hi)} started.`);
        sayCook([startedSpeech(time)]);
      }
    } else if (label === "stop-timer") {
      const timer = firstRinging(timers, now);
      if (!timer) return;
      update((s) => stopTimer(s, timer.id));
      note(`${said}: ${timer.label} stopped.`);
      sayCook([stoppedSpeech(timer, ringing.length > 1)]);
    } else {
      note(`${said}.`);
      if (screen === "step" && step) {
        setListOpen(true);
        sayCook(usesSpeech(step.text, ingredients, factor));
      } else {
        if (screen === "done") setListOpen(true);
        sayCook(listSpeech(ingredients, factor));
      }
    }
  });

  const readScreen = useEffectEvent(() => sayCook(screenSpeech()));

  // Phrases come to this screen while it is open; leaving it lets go of the
  // microphone and stops the voice.
  useEffect(() => {
    setHeardHandler((label) => heard(label));
    return () => {
      setHeardHandler(null);
      stopListening();
      stopCookVoice();
    };
  }, []);

  // Each screen is read as it comes up, from a phrase or from a tap, once the
  // listener is ready (the first time, after its download).
  useEffect(() => {
    if (ready) readScreen();
  }, [ready, screen, at]);

  // A timer ringing: listen for "stop timer" instead of "start timer", and stop
  // talking, so the person can be heard over the step.
  useEffect(() => {
    if (!handsFree) return;
    setListenerKeywords(keywordsFor(COOK_COMMANDS, cookListening(isRingingNow)));
    if (isRingingNow) hushCook();
  }, [handsFree, isRingingNow]);

  // What it heard fades after a few seconds.
  useEffect(() => {
    if (!heardNote) return;
    const timer = window.setTimeout(() => setHeardNote((current) => (current?.id === heardNote.id ? null : current)), 6000);
    return () => window.clearTimeout(timer);
  }, [heardNote]);

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
        {/* The name wraps rather than cuts off: at a phone's width "· 12 wedges" would go first. */}
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 pt-1 text-sm text-muted-foreground">
            {title}
            {making ? ` · ${making}` : ""}
          </p>
          <HandsFreeSwitch on={handsFree} onClick={toggleHandsFree} />
        </div>
      </div>

      <HandsFreeStrip
        state={listener}
        ringing={isRingingNow}
        heard={heardNote?.text ?? null}
        onRetry={() => {
          stopListening();
          turnOn();
        }}
        onOff={turnOff}
      />

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
          {/* What you ATE is a serving, not the batch (D4a): it goes on the day's log. */}
          <Button asChild variant="outline" className="h-12 w-full text-base">
            <Link href={`/personal/m/food/log?recipe=${recipeId}`}>Log what you ate</Link>
          </Button>
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
          <Button className="h-14 flex-1 text-base" onClick={startCooking}>
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
        <DialogContent className="max-h-[85dvh] overflow-y-auto" style={FOOD_ACCENT}>
          <DialogHeader>
            <DialogTitle>Ingredients</DialogTitle>
            <DialogDescription>{making ? `For ${making}.` : "As the recipe gives them."}</DialogDescription>
          </DialogHeader>
          {checklist}
        </DialogContent>
      </Dialog>

      <HandsFreeIntro
        open={introOpen}
        onOpenChange={setIntroOpen}
        naturalVoice={naturalVoice}
        onTurnOn={() => {
          markIntroSeen();
          setIntroOpen(false);
          turnOn();
        }}
      />
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
