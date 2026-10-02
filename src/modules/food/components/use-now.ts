import { useSyncExternalStore } from "react";

/**
 * THE TIME, TWICE A SECOND, for cook mode's countdowns (D1b). An external
 * store rather than state set in an effect: the clock is read only in its own
 * interval, never in render, and the interval runs only while something on
 * the screen is listening. The server's answer is 0, which cook mode never
 * shows: it has no timer to count until the phone has written one.
 */

const listeners = new Set<() => void>();
let now = typeof window === "undefined" ? 0 : Date.now();
let interval: number | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (interval === null) {
    now = Date.now();
    interval = window.setInterval(() => {
      now = Date.now();
      for (const each of listeners) each();
    }, 500);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval !== null) {
      window.clearInterval(interval);
      interval = null;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
}
