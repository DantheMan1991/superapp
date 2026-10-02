"use client";

import { useSyncExternalStore } from "react";
import { Loader2, Mic, MicOff, RotateCcw, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNativeAppUserAgent } from "@/lib/native-app-core";
import type { ListenerState } from "@/lib/voice-commands/listener";
import { canRetry, downloadPercent, listenerFailureWords } from "@/lib/voice-commands/words";
import { sayHere, sayList, type HandsFreePlace } from "../../core/hands-free";

/**
 * HANDS-FREE'S LINE IN WORKOUT MODE (F6, docs/help/fitness/workout.md): under
 * a set's controls, or the check after an exercise, what the phone is doing
 * (listening, the coach speaking, getting ready), what can be said here, and
 * what it last heard. A failure says what to do, with Try again.
 */

export interface HandsFreeView {
  /** The switch: on means a session listens. */
  on: boolean;
  state: ListenerState;
  /** What it last heard, for a few seconds. */
  heard: string | null;
  /** Start listening, unless the tap that pressed this already started it. */
  onStart: () => void;
  onRetry: () => void;
  onOff: () => void;
}

const subscribeToNothing = () => () => {};

export function HandsFreeHint({ place, view }: { place: HandsFreePlace; view: HandsFreeView | null }) {
  const inApp = useSyncExternalStore(
    subscribeToNothing,
    () => isNativeAppUserAgent(navigator.userAgent),
    () => false,
  );
  if (!view || (!view.on && view.state.status === "off")) return null;
  const { state } = view;
  if (state.status === "failed") {
    return (
      <div role="alert" className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
        <p>{listenerFailureWords(state.failure, inApp)}</p>
        <div className="flex gap-2">
          {canRetry(state.failure) && (
            <Button variant="outline" size="sm" onClick={view.onRetry}>
              <RotateCcw aria-hidden /> Try again
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={view.onOff}>
            Turn off hands-free
          </Button>
        </div>
      </div>
    );
  }
  if (state.status === "off") {
    // The switch is on, but this page has not listened yet: a reload mid-session
    // has had no tap to start the microphone with. Any tap on the page starts
    // it, but a tap on the demo lands in YouTube's frame, so this is a button
    // too (and the way in from a keyboard).
    return (
      <button
        type="button"
        onClick={view.onStart}
        className="flex w-full items-center gap-2 rounded-xl bg-card px-3 py-2 text-left text-sm text-muted-foreground"
      >
        <Mic className="size-4 shrink-0" aria-hidden /> Hands-free is on. Tap here to start listening.
      </button>
    );
  }
  return (
    <div aria-live="polite" className="space-y-1 rounded-xl bg-card px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {state.status === "starting" ? (
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Getting hands-free ready
            {state.total ? ` · ${downloadPercent(state.loaded, state.total)}%` : "…"}
          </span>
        ) : state.status === "held" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-module-accent">
            <Volume2 className="size-4" aria-hidden /> Coach speaking
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
        {view.heard && <span>{view.heard}</span>}
      </div>
      <p className="text-muted-foreground">Say {sayList(sayHere(place))}.</p>
    </div>
  );
}
