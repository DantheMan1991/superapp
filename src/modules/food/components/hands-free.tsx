"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { Loader2, Mic, MicOff, RotateCcw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isNativeAppUserAgent } from "@/lib/native-app-core";
import { chosenVoice, chosenVoiceOnTheServer } from "@/lib/speech/voice-choice";
import { RECORDED_VOICES } from "@/lib/speech/voices";
import { LISTENER_DOWNLOAD_WORDS } from "@/lib/voice-commands/assets";
import type { ListenerFailure, ListenerState } from "@/lib/voice-commands/listener";
import { commandWords, cookListening } from "../core/hands-free";

/**
 * HANDS-FREE'S PIECES OF COOK MODE (D1c, docs/help/food/cook.md): the switch,
 * the first-time explanation, and the strip that says what the phone is doing
 * (listening, reading, getting ready) and what it last heard.
 */

const INTRO_KEY = "yosher.food.hands-free.intro";

/**
 * Food's colour, for a box opened over cook mode. A dialog is drawn outside the
 * page (a portal), where the route's `--module-accent` does not reach, so
 * without this its accents fall back to the brand's green.
 */
export const FOOD_ACCENT = { "--module-accent": "var(--accent-food)" } as CSSProperties;

/** The explanation is shown once per phone; after that the switch just turns it on. */
export function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(INTRO_KEY) === "seen";
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(INTRO_KEY, "seen");
  } catch {
    // A private window: shown again next time.
  }
}

const subscribeToNothing = () => () => {};

/** Whether this page is inside the Yosher app, for what the microphone message says. */
function useInApp(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => isNativeAppUserAgent(navigator.userAgent),
    () => false,
  );
}

function useVoiceName(): string {
  const id = useSyncExternalStore(subscribeToNothing, chosenVoice, chosenVoiceOnTheServer);
  return RECORDED_VOICES.find((voice) => voice.id === id)?.name ?? "Arcas";
}

/** The switch, in cook mode's title line. */
export function HandsFreeSwitch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <Button
      variant={on ? "default" : "outline"}
      size="sm"
      aria-pressed={on}
      onClick={onClick}
      className={on ? "bg-module-accent text-white hover:bg-module-accent/85" : undefined}
    >
      {on ? <Mic aria-hidden /> : <MicOff aria-hidden />}
      {on ? "Hands-free on" : "Hands-free"}
    </Button>
  );
}

const SAY_FIRST = ["next step", "go back", "repeat", "start timer", "stop timer", "ingredients"] as const;
const ALSO: Partial<Record<(typeof SAY_FIRST)[number], string>> = {
  "go back": "previous step",
  ingredients: "show ingredients",
};

/** The first time on this phone: what hands-free does, before the microphone is asked for. */
export function HandsFreeIntro({
  open,
  onOpenChange,
  naturalVoice,
  onTurnOn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  naturalVoice: boolean;
  onTurnOn: () => void;
}) {
  const inApp = useInApp();
  const voice = useVoiceName();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" style={FOOD_ACCENT}>
        <DialogHeader>
          <DialogTitle>Hands-free</DialogTitle>
          <DialogDescription>
            The steps read aloud, and your voice to move on, while cook mode is open.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section className="space-y-1">
            <h3 className="font-medium">How it listens</h3>
            <p className="text-muted-foreground">
              A small listener downloads once ({LISTENER_DOWNLOAD_WORDS}) and runs on this phone. It only knows the
              phrases below. Nothing you say leaves the phone.
            </p>
          </section>
          <section className="space-y-2">
            <h3 className="font-medium">What you can say</h3>
            <ul className="flex flex-wrap gap-1.5">
              {SAY_FIRST.map((phrase) => (
                <li key={phrase} className="rounded-full bg-module-accent/10 px-2.5 py-1 text-module-accent">
                  {phrase}
                  {ALSO[phrase] && <span className="text-muted-foreground"> or {ALSO[phrase]}</span>}
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-1">
            <h3 className="font-medium">The voice</h3>
            <p className="text-muted-foreground">
              {naturalVoice
                ? `${voice}, the recorded voice the workout coach uses. Each step is recorded once and kept on this phone.`
                : "The phone's own voice."}
            </p>
          </section>
          <p className="text-muted-foreground">
            {inApp ? "The app asks once for the microphone." : "Your browser asks once for the microphone."}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button onClick={onTurnOn}>
            <Mic aria-hidden /> Turn on hands-free
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function failureWords(failure: ListenerFailure, inApp: boolean): string {
  switch (failure) {
    case "unsupported":
      return "Hands-free needs a newer browser. Chrome, or the Yosher app, has what it needs.";
    case "denied":
      return inApp
        ? "The microphone is blocked for the Yosher app. Allow it in the phone's settings, then try again."
        : "The microphone is blocked for this site. Allow it in the browser's site settings, then try again.";
    case "no-microphone":
      return "No microphone would start. Another app may be using it.";
    case "download":
      return "Hands-free could not be downloaded. Check the connection, then try again.";
    case "engine":
      return "Hands-free would not start on this phone.";
  }
}

/** The model's share of the first download, which is most of it. */
function percent(loaded: number, total: number): number {
  return Math.min(100, Math.round((loaded / total) * 100));
}

/** What the phone is doing, what to say, and what it last heard. */
export function HandsFreeStrip({
  state,
  ringing,
  heard,
  onRetry,
  onOff,
}: {
  state: ListenerState;
  ringing: boolean;
  heard: string | null;
  onRetry: () => void;
  onOff: () => void;
}) {
  const inApp = useInApp();
  if (state.status === "off") return null;
  if (state.status === "failed") {
    return (
      <div role="alert" className="space-y-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm">
        <p>{failureWords(state.failure, inApp)}</p>
        <div className="flex gap-2">
          {state.failure !== "unsupported" && state.failure !== "engine" && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCcw aria-hidden /> Try again
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onOff}>
            Turn off hands-free
          </Button>
        </div>
      </div>
    );
  }
  const phrases = cookListening(ringing).map((command) => `“${commandWords(command)}”`);
  const sayList = `${phrases.slice(0, -1).join(", ")} or ${phrases[phrases.length - 1]}`;
  return (
    <div aria-live="polite" className="space-y-1.5 rounded-2xl bg-module-accent/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {state.status === "starting" ? (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Getting hands-free ready
            {state.total ? ` · ${percent(state.loaded, state.total)}%` : "…"}
          </span>
        ) : state.status === "held" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-module-accent">
            <Volume2 className="size-4" aria-hidden /> Reading
          </span>
        ) : state.status === "paused" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
            <MicOff className="size-4" aria-hidden /> Paused
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium text-module-accent">
            <span className="size-2 animate-pulse rounded-full bg-module-accent" aria-hidden /> Listening
          </span>
        )}
        {heard && <span className="text-foreground">{heard}</span>}
      </div>
      {state.status === "starting" && state.total ? (
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full bg-module-accent" style={{ width: `${percent(state.loaded, state.total)}%` }} />
        </div>
      ) : null}
      <p className="text-muted-foreground">Say {sayList}.</p>
    </div>
  );
}
