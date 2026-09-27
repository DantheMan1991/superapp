import { saveSessionAction } from "../../actions";
import {
  finishSession,
  lastActivity,
  localDayOf,
  sessionDocSchema,
  type SessionDoc,
} from "../../core/session";

/**
 * WORKOUT SESSIONS KEPT ON THE PHONE (docs/modules/fitness.md, F2a).
 *
 * A session lives here while it is going, and after, until the server has
 * it: every set changes the document here first, and `sendPending` sends
 * whatever the server has not acknowledged. A basement gym with no signal
 * loses nothing, and neither does a phone that reloads the page mid-set.
 *
 * A LIST, NOT ONE PER PROGRAM. Yesterday's session, finished in a field and
 * never sent, must not be overwritten by today's; each waits here, by its own
 * id, until the server says it has it.
 *
 * The same idiom as the tell box's queue (src/lib/tell-sources/queue.ts): the
 * snapshot `useSyncExternalStore` reads is cached by its raw string, so it is
 * the same object until the storage really changes; and storage that throws
 * (a private window, a full disk) degrades to memory for the page's life.
 */

export interface StoredSession {
  doc: SessionDoc;
  /** The highest revision the server has acknowledged; 0 before the first. */
  sentRevision: number;
  /** The server's last refusal, if it answered with one rather than not at all. */
  refused: string | null;
}

const KEY = "yosher.fitness.sessions.v1";

/** Far more than any honest backlog; a runaway bug is capped from the oldest SENT end. */
const CAP = 30;

const EMPTY: StoredSession[] = [];
let cache: { raw: string | null; parsed: StoredSession[] } = { raw: null, parsed: EMPTY };
let memory: StoredSession[] | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): StoredSession[] {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return EMPTY;
    const out: StoredSession[] = [];
    for (const entry of value) {
      const doc = sessionDocSchema.safeParse((entry as { doc?: unknown })?.doc);
      if (!doc.success) continue;
      const sent = Number((entry as { sentRevision?: unknown }).sentRevision);
      const refused = (entry as { refused?: unknown }).refused;
      out.push({
        doc: doc.data,
        sentRevision: Number.isFinite(sent) ? sent : 0,
        refused: typeof refused === "string" ? refused : null,
      });
    }
    return out;
  } catch {
    return EMPTY;
  }
}

export function readSessions(): StoredSession[] {
  if (memory) return memory;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return cache.parsed;
  }
  if (raw !== cache.raw) cache = { raw, parsed: parse(raw) };
  return cache.parsed;
}

function writeSessions(sessions: StoredSession[]): void {
  const kept = sessions.length > CAP ? trim(sessions) : sessions;
  const raw = JSON.stringify(kept);
  try {
    if (kept.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, raw);
    memory = null;
    cache = { raw: kept.length === 0 ? null : raw, parsed: kept };
  } catch {
    memory = kept;
  }
  for (const listener of listeners) listener();
}

/** Over the cap: drop the oldest that are already sent; never one the server lacks. */
function trim(sessions: StoredSession[]): StoredSession[] {
  const out = [...sessions];
  while (out.length > CAP) {
    const i = out.findIndex((s) => s.sentRevision >= s.doc.revision);
    if (i === -1) break;
    out.splice(i, 1);
  }
  return out;
}

export function subscribeSessions(onChange: () => void): () => void {
  listeners.add(onChange);
  const fromAnotherTab = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY) onChange();
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

/** Nothing is kept on the server side of a render. */
export function sessionsOnTheServer(): StoredSession[] {
  return EMPTY;
}

/** Keep a document: a new session, or the next revision of one. */
export function putSession(doc: SessionDoc): void {
  const sessions = readSessions();
  const i = sessions.findIndex((s) => s.doc.id === doc.id);
  if (i === -1) {
    writeSessions([...sessions, { doc, sentRevision: 0, refused: null }]);
    return;
  }
  // An older revision never replaces a newer one (two tabs, one phone).
  if (sessions[i].doc.revision > doc.revision) return;
  const next = [...sessions];
  next[i] = { ...sessions[i], doc };
  writeSessions(next);
}

/** The session going on for a program: the newest one it has not finished. */
export function openSessionFor(sessions: StoredSession[], programId: string): SessionDoc | null {
  let open: SessionDoc | null = null;
  for (const { doc } of sessions) {
    if (doc.programId !== programId || doc.finishedAt) continue;
    if (!open || doc.startedAt > open.startedAt) open = doc;
  }
  return open;
}

export function isPending(session: StoredSession): boolean {
  return session.doc.revision > session.sentRevision;
}

function acknowledge(id: string, revision: number): void {
  const sessions = readSessions();
  const next: StoredSession[] = [];
  for (const session of sessions) {
    if (session.doc.id !== id) {
      next.push(session);
      continue;
    }
    const sentRevision = Math.max(session.sentRevision, revision);
    // Finished and on the server: nothing left to keep it here for.
    if (session.doc.finishedAt && sentRevision >= session.doc.revision) continue;
    next.push({ ...session, sentRevision, refused: null });
  }
  writeSessions(next);
}

function refuse(id: string, message: string): void {
  writeSessions(readSessions().map((s) => (s.doc.id === id ? { ...s, refused: message } : s)));
}

/**
 * CLOSE A SESSION LEFT OPEN ON AN EARLIER DAY: the person put the phone down
 * and never pressed Finish. It ends when its last set did, so the minutes it
 * reports are the workout's, not the night's.
 */
export function closeStaleSessions(now: Date): void {
  const today = localDayOf(now);
  for (const { doc } of readSessions()) {
    if (doc.finishedAt || doc.localDay >= today) continue;
    putSession(finishSession(doc, { feelAfter: doc.feelAfter, now: new Date(lastActivity(doc)) }));
  }
}

/** Was that a missing network, or an answer? The tell box's rule (queue.ts). */
function looksLikeNoSignal(err: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return ["fetch", "network", "load failed", "connection"].some((word) => message.includes(word));
}

let inFlight: Promise<SendResult> | null = null;

export type SendResult = "sent" | "offline" | "refused";

/**
 * SEND EVERY SESSION THE SERVER DOES NOT HAVE YET, oldest first. One run at a
 * time: a second caller waits for the first and gets its answer. "offline"
 * stops the run (the rest would fail the same way); a refusal is kept on the
 * session and the run goes on to the next.
 */
export function sendPending(): Promise<SendResult> {
  if (inFlight) return inFlight;
  inFlight = (async (): Promise<SendResult> => {
    let result: SendResult = "sent";
    const pending = readSessions()
      .filter(isPending)
      .sort((a, b) => (a.doc.startedAt < b.doc.startedAt ? -1 : 1));
    for (const { doc } of pending) {
      // The newest revision of it, which may have moved on since the list was read.
      const latest = readSessions().find((s) => s.doc.id === doc.id);
      if (!latest || !isPending(latest)) continue;
      try {
        const outcome = await saveSessionAction(latest.doc);
        if ("error" in outcome) {
          refuse(doc.id, outcome.error);
          result = "refused";
        } else {
          acknowledge(doc.id, outcome.revision);
        }
      } catch (err) {
        if (looksLikeNoSignal(err)) return "offline";
        refuse(doc.id, "The session could not be sent. It is kept on this phone.");
        result = "refused";
      }
    }
    return result;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** A session id nothing else will pick. */
export function newId(): string {
  return crypto.randomUUID();
}
