import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import { keywordsFor } from "@/lib/voice-commands/phrases";
import { WORKOUT_COMMANDS, WORKOUT_LISTENING, type WorkoutCommand } from "../../core/hands-free";

/**
 * HANDS-FREE IN WORKOUT MODE, ON THE PHONE (Workouts F6; the listener is
 * `@/lib/voice-commands`, ADR 0124).
 *
 * Two things live here. The switch: turned on once, on the screen before a
 * workout, and remembered by the phone (the founder's call), so every
 * workout after starts listening at its Start tap. And the way a phrase heard
 * reaches the control on the screen: the pacer, the hold timer, the count or
 * the check each take the commands they can carry out (`useWorkoutCommands`)
 * and answer in the coach's voice, because only they know their own state
 * (running, paused, how many breaths).
 *
 * Deliberately a module, not context: one workout per page, and a control
 * deep in the set must be reached without threading props through it.
 */

const KEY = "yosher.fitness.hands-free";
let on: boolean | null = null;
const switchListeners = new Set<() => void>();

export function isHandsFreeOn(): boolean {
  if (on === null) {
    try {
      on = window.localStorage.getItem(KEY) === "on";
    } catch {
      on = false;
    }
  }
  return on;
}

export function handsFreeOnTheServer(): boolean {
  return false;
}

export function setHandsFreeOn(value: boolean): void {
  on = value;
  try {
    if (value) window.localStorage.setItem(KEY, "on");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Kept for this page.
  }
  for (const listener of switchListeners) listener();
}

function subscribeSwitch(listener: () => void): () => void {
  switchListeners.add(listener);
  return () => {
    switchListeners.delete(listener);
  };
}

export function useHandsFreeOn(): boolean {
  return useSyncExternalStore(subscribeSwitch, isHandsFreeOn, handsFreeOnTheServer);
}

/** What the listener hears for: every workout phrase, all session long. */
export const WORKOUT_KEYWORDS = keywordsFor(WORKOUT_COMMANDS, WORKOUT_LISTENING);

/* -- a phrase heard, to the control on the screen ----------------------------- */

type Handler = (command: WorkoutCommand) => boolean;
const handlers = new Set<Handler>();

/** Hand a command to the controls on the screen; false when none took it. */
export function sendWorkoutCommand(command: WorkoutCommand): boolean {
  for (const handler of [...handlers]) {
    if (handler(command)) return true;
  }
  return false;
}

/**
 * A control takes the commands it can carry out: `handle` reads the control's
 * state as it is now, does what the button would, and returns false for a
 * command that is not its own.
 */
export function useWorkoutCommands(handle: (command: WorkoutCommand) => boolean): void {
  const onCommand = useEffectEvent(handle);
  useEffect(() => {
    const handler: Handler = (command) => onCommand(command);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  }, []);
}
