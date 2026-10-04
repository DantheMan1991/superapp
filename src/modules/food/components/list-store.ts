import { useSyncExternalStore } from "react";
import { EMPTY_SHOPPING, shoppingStateSchema, type ShoppingState } from "../core/list";

/**
 * THE SHOPPING LIST'S STORE, ON THE PHONE (D3; the founder's default: the list
 * works with no signal in the shop): the days the list covers, the ticks of
 * this trip and the person's own items, in the browser's own storage for this
 * space. Read through `useSyncExternalStore` with a cached snapshot (the cook
 * store's idiom, after the tell box's), so the screen re-renders on every
 * write and render never touches storage. Storage that refuses (a private
 * window) falls back to memory for the visit.
 */

const PREFIX = "yosher-food-list:";
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
let cache: { tenantId: string; raw: string | null; value: ShoppingState } | null = null;

function rawOf(tenantId: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + tenantId);
  } catch {
    return memory.get(tenantId) ?? null;
  }
}

export function readShopping(tenantId: string): ShoppingState {
  const raw = rawOf(tenantId);
  if (cache && cache.tenantId === tenantId && cache.raw === raw) return cache.value;
  let value: ShoppingState = EMPTY_SHOPPING;
  if (raw) {
    try {
      const parsed = shoppingStateSchema.safeParse(JSON.parse(raw));
      value = parsed.success ? parsed.data : EMPTY_SHOPPING;
    } catch {
      value = EMPTY_SHOPPING;
    }
  }
  cache = { tenantId, raw, value };
  return value;
}

/**
 * Change the list's state against what is stored now. New ids come from here,
 * never from a component, so render stays pure (the React compiler's rule).
 */
export function changeShopping(tenantId: string, change: (state: ShoppingState, newId: () => string) => ShoppingState): void {
  const next = change(readShopping(tenantId), () => crypto.randomUUID());
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(PREFIX + tenantId, raw);
  } catch {
    memory.set(tenantId, raw);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // The list open in another tab writes the same key.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useShopping(tenantId: string): ShoppingState {
  return useSyncExternalStore(
    subscribe,
    () => readShopping(tenantId),
    () => EMPTY_SHOPPING,
  );
}
