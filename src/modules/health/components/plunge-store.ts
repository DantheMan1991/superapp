import { useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * THE PLUNGE TIMER, ON THE PHONE (H1): the plunge under way, kept in the
 * browser's own storage, so a locked screen, a reload or another app in
 * between loses no time in the water. A timer is its start (and, once Done is
 * tapped, its end), not a count. The time and new ids come from here, never
 * from a component, so render stays pure (the React compiler's rule); the
 * pattern is Food's cook store's.
 */

const KEY = "yosher.health.plunge";

const plungeSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.number(),
  /** Set when Done is tapped: the time in the water stops here. */
  doneAt: z.number().nullable(),
  waterF: z.number().nullable(),
});

export type RunningPlunge = z.infer<typeof plungeSchema>;

/** A timer older than this is a timer left running: it starts afresh. */
const STALE_MS = 6 * 60 * 60 * 1000;

let memory: string | null = null;
let cache: { raw: string | null; value: RunningPlunge | null } | null = null;
const listeners = new Set<() => void>();

function rawNow(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memory;
  }
}

function write(value: RunningPlunge | null): void {
  const raw = value ? JSON.stringify(value) : null;
  try {
    if (raw) window.localStorage.setItem(KEY, raw);
    else window.localStorage.removeItem(KEY);
  } catch {
    memory = raw;
  }
  for (const listener of listeners) listener();
}

export function readPlunge(): RunningPlunge | null {
  const raw = rawNow();
  if (cache && cache.raw === raw) return cache.value;
  let value: RunningPlunge | null = null;
  if (raw) {
    try {
      const parsed = plungeSchema.safeParse(JSON.parse(raw));
      value = parsed.success && Date.now() - parsed.data.startedAt < STALE_MS ? parsed.data : null;
    } catch {
      value = null;
    }
  }
  cache = { raw, value };
  return value;
}

/** Start the timer now, in water this cold. */
export function startPlunge(waterF: number | null): void {
  write({ id: crypto.randomUUID(), startedAt: Date.now(), doneAt: null, waterF });
}

/** Done: out of the water now. */
export function finishPlunge(): void {
  const current = readPlunge();
  if (current && current.doneAt === null) write({ ...current, doneAt: Date.now() });
}

/** Saved or discarded: no plunge under way. */
export function clearPlunge(): void {
  write(null);
}

/** A plunge typed in after: a new id, and now as when it was logged. */
export function typedPlungeIdentity(): { id: string; startedAt: string } {
  return { id: crypto.randomUUID(), startedAt: new Date().toISOString() };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useRunningPlunge(): RunningPlunge | null {
  return useSyncExternalStore(subscribe, readPlunge, () => null);
}

/* -- the time, four times a second, while something is listening ------------ */

const clockListeners = new Set<() => void>();
let clock = 0;
let interval: number | null = null;

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (interval === null) {
    clock = Date.now();
    interval = window.setInterval(() => {
      clock = Date.now();
      for (const each of clockListeners) each();
    }, 250);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0 && interval !== null) {
      window.clearInterval(interval);
      interval = null;
    }
  };
}

/** The time now, ticking; 0 on the server, which never shows a timer. */
export function useClock(): number {
  return useSyncExternalStore(subscribeClock, () => clock, () => 0);
}
