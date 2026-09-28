/**
 * THE COACH'S RECORDED LINES, ON THE PHONE (ADR 0115; docs/modules/fitness.md,
 * F2d).
 *
 * The workout asks for a session's lines before they are said
 * (`prefetchLines`), from the phone's own store first and then from the route
 * (`/api/fitness/voice`), and keeps every recording in the phone's Cache
 * Storage, so a program's lines are downloaded about once and a session with
 * no signal still has them. The one voice queue (`voice-queue.ts`) plays a
 * line's recording when it has one (`playClip`), and the device's voice says
 * it when it has not.
 *
 * ── HOW LONG A LINE WAITS FOR ITS RECORDING ─────────────────────────────────
 *
 * One still on its way is waited for, a short while: a step or a count said a
 * second late in the right voice beats one said on time in the robotic one.
 * A line that must be heard now (`high`, the posture tool's) never waits. Past
 * the wait, the device says it, so a slow signal costs the voice, never the
 * line.
 *
 * Deliberately a module, not a hook: the queue that plays these is one per
 * page, and so is this.
 */

import { audioContext } from "@/lib/audio-context";
import { hush, speakLine } from "./say";
import { RECORD_BATCH_MAX, RECORD_LINE_MAX, unpackClips, type RecordedVoice } from "./voices";

interface Source {
  /** Where to ask for recordings. */
  endpoint: string;
  voice: RecordedVoice;
}

interface Clip {
  state: "loading" | "ready" | "none";
  /** The MP3, once it is here. */
  bytes: ArrayBuffer | null;
  /** Decoded the first time it is played, and kept. */
  buffer: AudioBuffer | null;
  /** Lines waiting for it to arrive. */
  waiters: Set<() => void>;
}

let source: Source | null = null;
const clips = new Map<string, Clip>();

/** The route said there is no recorded voice here: the device speaks for the rest of the page. */
let unavailable = false;
/** A request failed, most likely for want of signal: the next wait until then. */
let quietUntil = 0;
const RETRY_AFTER_MS = 30_000;

/** Kept across sessions. The version is the recordings', not the page's. */
const STORE = "yosher-coach-voice-v1";

function keyOf(voice: RecordedVoice, text: string): string {
  return `${voice}\n${text}`;
}

/** Record in this voice from now on, or (null) not at all: leaving the workout. */
export function setClipSource(next: Source | null): void {
  source = next;
}

/** Recorded lines are on for this page. */
export function hasClipSource(): boolean {
  return source !== null && !unavailable;
}

/** Fetch the recordings of these lines that are not on the phone yet. */
export function prefetchLines(texts: readonly string[]): void {
  const active = source;
  if (!active || unavailable || typeof window === "undefined") return;
  const wanted = [...new Set(texts.map((text) => text.trim()))].filter(
    (text) => text !== "" && text.length <= RECORD_LINE_MAX,
  );
  const missing = wanted.filter((text) => !clips.has(keyOf(active.voice, text)));
  if (missing.length === 0) return;
  // Each gets its entry now, so a second ask, or a line played meanwhile,
  // finds it on its way rather than asking again.
  const entries = missing.map((text) => {
    const clip: Clip = { state: "loading", bytes: null, buffer: null, waiters: new Set() };
    clips.set(keyOf(active.voice, text), clip);
    return { text, clip };
  });
  void load(active, entries);
}

function settle(voice: RecordedVoice, text: string, clip: Clip, bytes: ArrayBuffer | null): void {
  clip.bytes = bytes;
  clip.state = bytes ? "ready" : "none";
  // A line with no recording is asked for again the next time it is wanted.
  if (!bytes && clips.get(keyOf(voice, text)) === clip) clips.delete(keyOf(voice, text));
  for (const waiter of [...clip.waiters]) waiter();
  clip.waiters.clear();
}

/**
 * The first few lines asked for, fetched on their own. A batch comes back when
 * its slowest line is recorded (a line took 0.1 to 3 seconds at the vendor on
 * the drive), so the session's first line, which is among them, would
 * otherwise wait for its last.
 */
const FIRST_FEW = 4;

async function load(active: Source, entries: { text: string; clip: Clip }[]): Promise<void> {
  const store = await openStore();
  const kept = await Promise.all(entries.map(({ text }) => fromStore(store, active.voice, text)));
  const toFetch: { text: string; clip: Clip }[] = [];
  entries.forEach((entry, i) => {
    const bytes = kept[i];
    if (bytes) settle(active.voice, entry.text, entry.clip, bytes);
    else toFetch.push(entry);
  });
  const rest: { text: string; clip: Clip }[][] = [];
  for (let i = FIRST_FEW; i < toFetch.length; i += RECORD_BATCH_MAX) rest.push(toFetch.slice(i, i + RECORD_BATCH_MAX));
  // The first few and the rest side by side; any further batches (a phase of
  // more than 44 lines) after, so the vendor's limit of 15 at once holds.
  await Promise.all([
    fetchInto(active, store, toFetch.slice(0, FIRST_FEW)),
    (async () => {
      for (const batch of rest) await fetchInto(active, store, batch);
    })(),
  ]);
}

async function fetchInto(active: Source, store: Cache | null, batch: { text: string; clip: Clip }[]): Promise<void> {
  if (batch.length === 0) return;
  const got = await fetchBatch(
    active,
    batch.map((entry) => entry.text),
  );
  batch.forEach((entry, j) => {
    const recording = got?.[j] ?? null;
    if (recording) void toStore(store, active.voice, entry.text, recording);
    // `unpackClips` copies each out, so its buffer is exactly its bytes.
    settle(active.voice, entry.text, entry.clip, recording ? recording.buffer : null);
  });
}

async function fetchBatch(active: Source, lines: string[]): Promise<(Uint8Array<ArrayBuffer> | null)[] | null> {
  if (unavailable || Date.now() < quietUntil) return null;
  try {
    const response = await fetch(active.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice: active.voice, lines }),
    });
    // Not set up here, not signed in, or Workouts not on: none of those
    // changes before the page does.
    if (response.status === 401 || response.status === 404 || response.status === 503) {
      unavailable = true;
      return null;
    }
    if (!response.ok) {
      quietUntil = Date.now() + RETRY_AFTER_MS;
      return null;
    }
    return unpackClips(await response.arrayBuffer(), lines.length);
  } catch {
    quietUntil = Date.now() + RETRY_AFTER_MS;
    return null;
  }
}

/* -- the phone's store ------------------------------------------------------ */

async function openStore(): Promise<Cache | null> {
  try {
    return "caches" in window ? await window.caches.open(STORE) : null;
  } catch {
    // A private window, or storage blocked: fetched each page instead.
    return null;
  }
}

/** Where a line's recording is kept: by a hash, so no program's words are in a URL. */
async function storeKey(voice: RecordedVoice, text: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyOf(voice, text)));
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `/coach-voice/${voice}/${hex}.mp3`;
  } catch {
    return null;
  }
}

async function fromStore(store: Cache | null, voice: RecordedVoice, text: string): Promise<ArrayBuffer | null> {
  if (!store) return null;
  const key = await storeKey(voice, text);
  if (!key) return null;
  try {
    const hit = await store.match(key);
    return hit ? await hit.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function toStore(store: Cache | null, voice: RecordedVoice, text: string, clip: Uint8Array<ArrayBuffer>) {
  if (!store) return;
  const key = await storeKey(voice, text);
  if (!key) return;
  try {
    await store.put(key, new Response(clip, { headers: { "Content-Type": "audio/mpeg" } }));
  } catch {
    // Full: it is fetched again next time.
  }
}

/* -- playing one ------------------------------------------------------------- */

/** A function, so a check after an await reads the state now, not as it was narrowed before. */
function running(context: AudioContext): boolean {
  return context.state === "running";
}

/** A line being said: stopped for good, or cut by a newer line. */
export interface SaidLine {
  /** Stop it now, whatever is saying it: sound off, leaving the workout. */
  stop(): void;
  /**
   * A newer line takes over. A recording, or a line still waiting for one,
   * only stops if told to. A line the device took over is left to the newer
   * line's own call, which cuts it (ADR 0114: stopping the app's voice
   * separately races the newer line).
   */
  cut(): void;
}

/**
 * Say a line in its recording: now if it is here, after up to `waitMs` if it
 * is on its way (in the device's voice if it does not come), and null when
 * there is none to wait for, which is the queue's cue to use the device.
 *
 * `done` is called once, when the line ends or fails, as for `speakLine`;
 * stopping or cutting it does NOT call `done`.
 */
export function playClip(text: string, done: () => void, waitMs: number): SaidLine | null {
  const active = source;
  if (!active || unavailable) return null;
  const words = text.trim();
  const key = keyOf(active.voice, words);
  // Never asked for (a set added on the spot): asked for now, and waited for
  // like any other on its way.
  if (!clips.has(key)) prefetchLines([words]);
  const clip = clips.get(key);
  if (!clip || clip.state === "none") return null;
  if (clip.state === "loading" && waitMs <= 0) return null;

  let stopped = false;
  let byTheDevice = false;
  let stopNow: (() => void) | null = null;
  const inTheDevicesVoice = () => {
    if (stopped) return;
    byTheDevice = true;
    stopNow = speakLine(words, done);
  };

  const start = async () => {
    if (stopped) return;
    const context = audioContext();
    // A context made by the tap that started the session may still be
    // starting up: a moment to finish. One that has had no tap (a reload
    // mid-session) never will, and the moment runs out.
    if (context && !running(context)) {
      await Promise.race([context.resume().catch(() => {}), new Promise((resolve) => window.setTimeout(resolve, 400))]);
      if (stopped) return;
    }
    // Still no audio (no tap yet, or a call took it): the device's voice,
    // which may speak where this cannot.
    if (clip.state !== "ready" || !clip.bytes || !context || !running(context)) {
      inTheDevicesVoice();
      return;
    }
    let buffer = clip.buffer;
    if (!buffer) {
      try {
        buffer = await context.decodeAudioData(clip.bytes.slice(0));
        clip.buffer = buffer;
      } catch {
        inTheDevicesVoice();
        return;
      }
    }
    if (stopped) return;
    // A line the device was saying when this one cut in is still going: the
    // device's voice is not cut by a recording starting, only by its own
    // engine. Seconds from any other call to it, so no race.
    hush();
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      window.clearTimeout(timer);
      done();
    };
    // A context that stops reporting must not hold the next line forever.
    const timer = window.setTimeout(end, buffer.duration * 1000 + 1_500);
    node.onended = end;
    node.start();
    stopNow = () => {
      over = true;
      window.clearTimeout(timer);
      node.onended = null;
      try {
        node.stop();
      } catch {
        // Already over.
      }
    };
  };

  if (clip.state === "ready") {
    void start();
  } else {
    let went = false;
    const go = () => {
      if (went) return;
      went = true;
      window.clearTimeout(timer);
      clip.waiters.delete(go);
      void start();
    };
    const timer = window.setTimeout(go, waitMs);
    clip.waiters.add(go);
  }
  return {
    stop() {
      stopped = true;
      stopNow?.();
    },
    cut() {
      stopped = true;
      if (!byTheDevice) stopNow?.();
    },
  };
}
