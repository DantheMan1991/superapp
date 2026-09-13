import { SPOKEN_AT_MAX_AGE_MS } from "./spoken-at";

/**
 * SENTENCES WAITING FOR SIGNAL (tell.md, slice D2).
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 *
 * A field has no bars. Today the box loses the sentence entirely: the server
 * action's fetch rejects, nothing catches it, and the words somebody said into
 * a phone with cold hands are gone. **The feature fails exactly where its whole
 * justification lives.**
 *
 * So the sentence is kept, with the moment it was spoken, and read again when
 * there is signal.
 *
 * ── WHAT IS QUEUED IS THE SENTENCE, NEVER A RECORD ───────────────────────────
 *
 * [ADR 0039](../../../docs/decisions/0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md)'s
 * first rule is that the model never writes, and nothing here bends it. A
 * queued item replays through the SAME path a fresh sentence takes — propose,
 * cards, confirm — and an `unattended` verb still records itself only because
 * `readyToRecordUnasked` says so, on the proposal it gets back. Queueing a
 * *decision* would be inventing a second way to write to the herd.
 *
 * ── AND THE TIME IT WAS SAID TRAVELS WITH IT ─────────────────────────────────
 *
 * Without `spokenAt`, every queued sentence is stamped at the moment it
 * uploads, and a 07:00 clock-in becomes 10:00. That rule is
 * [ADR 0055](../../../docs/decisions/0055-a-queued-sentence-is-old-not-wrong.md)
 * and the server is what enforces it; this side's job is only to remember
 * honestly and to refuse to pretend about anything older than it will believe.
 *
 * Pure decisions first, storage after. Not `server-only`: none of this has a
 * server side, and all of it is tested without a browser.
 */

export interface QueuedSentence {
  id: string;
  /** What was said, in their words. */
  said: string;
  /** ISO. The moment the words were spoken, not the moment they were sent. */
  spokenAt: string;
}

/**
 * Twenty is far more than a barn produces and far less than a bug does.
 *
 * The cap exists for the runaway case, not the real one: if something is
 * queueing every attempt, the oldest are the ones nobody is waiting on.
 */
export const QUEUE_CAP = 20;

/* -- the pure decisions ---------------------------------------------------- */

/** Newest last, capped from the front. */
export function queueWith(
  existing: readonly QueuedSentence[],
  item: QueuedSentence,
  cap = QUEUE_CAP,
): QueuedSentence[] {
  const next = [...existing.filter((q) => q.id !== item.id), item];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function queueWithout(
  existing: readonly QueuedSentence[],
  id: string,
): QueuedSentence[] {
  return existing.filter((q) => q.id !== id);
}

export function waitedMs(item: QueuedSentence, now: Date): number {
  const at = new Date(item.spokenAt).getTime();
  if (Number.isNaN(at)) return 0;
  return Math.max(0, now.getTime() - at);
}

/**
 * **PAST THE POINT WHERE SENDING IT WOULD BE A LIE.**
 *
 * The server believes a claimed time up to `SPOKEN_AT_MAX_AGE_MS` and uses its
 * own clock beyond that ([ADR 0055](../../../docs/decisions/0055-a-queued-sentence-is-old-not-wrong.md)).
 * So a sentence older than that WOULD still record — dated now, which is the
 * wrong answer said confidently.
 *
 * Better to stop and say so. Somebody who has been out of signal for two days
 * can retype the one thing that mattered; nobody can un-record a clock-in
 * stamped two days late.
 */
export function tooOldToReplay(item: QueuedSentence, now: Date): boolean {
  return waitedMs(item, now) > SPOKEN_AT_MAX_AGE_MS;
}

export function splitByAge(
  queue: readonly QueuedSentence[],
  now: Date,
): { ready: QueuedSentence[]; stale: QueuedSentence[] } {
  const ready: QueuedSentence[] = [];
  const stale: QueuedSentence[] = [];
  for (const item of queue) (tooOldToReplay(item, now) ? stale : ready).push(item);
  return { ready, stale };
}

/**
 * Was that a missing network, or an answer we did not like?
 *
 * **THE DISTINCTION IS LOAD-BEARING AND CANNOT BE MADE EXACTLY.** A server
 * action that reaches the server returns `{ error }` — a refusal, a sentence
 * too long, a pack saying no — and queueing one of those would replay a
 * sentence that is going to fail identically forever. Only a request that never
 * arrived is worth keeping, and that arrives here as a rejected promise.
 *
 * `navigator.onLine` is the reliable half: false means there is certainly no
 * network. True means very little, so the thrown error is read as well, and
 * the browsers disagree about its shape — a `TypeError` in Chrome, "Load
 * failed" in Safari, "NetworkError" in Firefox.
 *
 * Getting it wrong is survivable IN ONE DIRECTION ONLY, which is why the
 * default is not to queue: a false positive replays once, gets the same real
 * error, and is dropped with it shown. A false negative loses the sentence,
 * which is the thing this exists to prevent — so anything that smells of the
 * network is kept.
 */
export function looksLikeNoSignal(err: unknown, online: boolean): boolean {
  if (!online) return true;
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("load failed") ||
    message.includes("connection")
  );
}

/* -- where it is kept ------------------------------------------------------ */

const KEY = "yosher.tell.queue";

/**
 * **THE SNAPSHOT HAS TO BE REFERENTIALLY STABLE.**
 *
 * `useSyncExternalStore` calls `getSnapshot` on every render and compares by
 * identity; parsing JSON afresh each time returns a new array every call and
 * spins forever. So the raw string is the cache key and the parsed value is
 * held beside it.
 */
let cache: { raw: string | null; parsed: QueuedSentence[] } = { raw: null, parsed: [] };
const EMPTY: QueuedSentence[] = [];
const listeners = new Set<() => void>();

function parse(raw: string | null): QueuedSentence[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    return value.filter(
      (v): v is QueuedSentence =>
        typeof v === "object" &&
        v !== null &&
        typeof (v as QueuedSentence).id === "string" &&
        typeof (v as QueuedSentence).said === "string" &&
        typeof (v as QueuedSentence).spokenAt === "string",
    );
  } catch {
    // Somebody else's key, a half-written value, a browser that cleared it
    // mid-write. An unreadable queue is an empty one, never a crash on a page
    // whose whole job is to still work when things are going badly.
    return EMPTY;
  }
}

export function readQueue(): QueuedSentence[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  if (raw !== cache.raw) cache = { raw, parsed: parse(raw) };
  return cache.parsed;
}

export function writeQueue(queue: readonly QueuedSentence[]): void {
  const raw = JSON.stringify(queue);
  try {
    if (queue.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, raw);
  } catch {
    // Out of space, or storage blocked. The in-memory cache below still holds
    // it for this page's life, which is the case that matters: somebody
    // standing in a field is not about to reload.
  }
  cache = { raw: queue.length === 0 ? null : raw, parsed: [...queue] };
  for (const listener of listeners) listener();
}

/** No queue on the server, and no reason to pretend otherwise. */
export function queueOnTheServer(): QueuedSentence[] {
  return EMPTY;
}

export function subscribeQueue(onChange: () => void): () => void {
  listeners.add(onChange);
  const fromAnotherTab = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) {
      cache = { raw: null, parsed: EMPTY };
      onChange();
    }
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

/** A queued sentence needs an id nothing else will pick. */
export function newQueueId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `q-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
