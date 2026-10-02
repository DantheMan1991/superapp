import { useSyncExternalStore } from "react";
import { cookSessionSchema, freshSession, isStale, type CookSession } from "../core/cook";

/**
 * COOK MODE'S STORE, ON THE PHONE (D1b): one session per recipe in the
 * browser's own storage, so a reload, a locked screen, another app or another
 * tab in between loses no step, no tick and no timer. Read through
 * `useSyncExternalStore` with a cached snapshot (the tell box's queue idiom),
 * so the screen re-renders on every write and render never touches storage.
 * Storage that refuses (a private window) falls back to memory for the visit.
 */

const PREFIX = "yosher-food-cook:";
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
let cache: { recipeId: string; raw: string | null; value: CookSession | null } | null = null;

function rawOf(recipeId: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + recipeId);
  } catch {
    return memory.get(recipeId) ?? null;
  }
}

export function readCookSession(recipeId: string): CookSession | null {
  const raw = rawOf(recipeId);
  if (cache && cache.recipeId === recipeId && cache.raw === raw) return cache.value;
  let value: CookSession | null = null;
  if (raw) {
    try {
      const parsed = cookSessionSchema.safeParse(JSON.parse(raw));
      value = parsed.success ? parsed.data : null;
    } catch {
      value = null;
    }
  }
  cache = { recipeId, raw, value };
  return value;
}

export function writeCookSession(recipeId: string, session: CookSession | null): void {
  const raw = session ? JSON.stringify(session) : null;
  try {
    if (raw) window.localStorage.setItem(PREFIX + recipeId, raw);
    else window.localStorage.removeItem(PREFIX + recipeId);
  } catch {
    if (raw) memory.set(recipeId, raw);
    else memory.delete(recipeId);
  }
  for (const listener of listeners) listener();
}

/**
 * Change a recipe's session: the one stored, or a fresh one on the first
 * touch (or after twelve hours). The time and new ids come from here, never
 * from a component, so render stays pure (the React compiler's rule) and a
 * change is always made against what is stored now.
 */
export function changeCookSession(
  recipeId: string,
  servings: number | null,
  change: (session: CookSession, now: number, newId: () => string) => CookSession,
): void {
  const now = Date.now();
  const current = readCookSession(recipeId);
  const base = current && !isStale(current, now) ? current : freshSession(crypto.randomUUID(), now, servings);
  writeCookSession(recipeId, change({ ...base, servings }, now, () => crypto.randomUUID()));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab cooking the same recipe writes the same key.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useCookSession(recipeId: string): CookSession | null {
  return useSyncExternalStore(
    subscribe,
    () => readCookSession(recipeId),
    () => null,
  );
}
