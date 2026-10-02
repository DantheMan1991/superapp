import { isVoiceBusy, subscribeVoiceBusy } from "@/lib/speech/voice-queue";
import { CAPTURE_PROCESSOR, CAPTURE_WORKLET_SOURCE } from "./capture-worklet";
import type { Keyword } from "./phrases";
import type { FromListener, ToListener } from "./protocol";

/**
 * THE LISTENER (docs/modules/voice-commands.md; ADR 0124): hands-free's ears,
 * one per page, shared by every tool that listens. Food's cook mode first
 * (D1c), Workouts next (F6).
 *
 * The microphone's sound goes from a worklet on the audio thread to a worker
 * that runs an open-source keyword spotter (`listener.worker.ts`), and only
 * the label of a phrase heard comes back here. Nothing is recorded, sent or
 * kept: the phone hears a handful of phrases and nothing else.
 *
 * ── IT NEVER HEARS ITSELF ────────────────────────────────────────────────────
 *
 * While the page's one voice talks (`voice-queue.ts`), and for `TAIL_MS`
 * after, the worker drops the sound, and a phrase heard just before is
 * ignored: a step that says "repeat with the rest of the dough" must not
 * repeat itself. Anything else on the page that speaks holds it the same
 * way (`holdListener`): a workout's demo playing with its author's sound. Echo cancellation is OFF for the same reason it is not
 * needed (half duplex), and because on Android it puts the phone in call mode,
 * which turns the voice and the timer's alarm down.
 *
 * ── ONLY WHILE IT IS ON THE SCREEN ───────────────────────────────────────────
 *
 * The microphone is let go when the page is hidden (another app, a locked
 * screen) and taken again when it comes back, which asks nothing once it has
 * been allowed. Leaving the screen stops everything (`stopListening`).
 *
 * Deliberately a module, not a hook, like the voice queue: one microphone per
 * page, which a screen and its pieces must all reach.
 */

export type ListenerFailure =
  /** No worklet, worker, WebAssembly or microphone API in this browser. */
  | "unsupported"
  /** The microphone was refused, by the person or the phone's settings. */
  | "denied"
  /** No microphone, or one that would not start (another app holding it). */
  | "no-microphone"
  /** The listener's files did not arrive. */
  | "download"
  /** They arrived and would not run here. */
  | "engine";

export type ListenerState =
  | { status: "off" }
  /** Asking for the microphone, then loading: the model's bytes so far, once they flow. */
  | { status: "starting"; loaded: number; total: number | null }
  | { status: "listening" }
  /** The phone is talking, so it is not listening. */
  | { status: "held" }
  /** The page is hidden: the microphone let go until it comes back. */
  | { status: "paused" }
  | { status: "failed"; failure: ListenerFailure };

const OFF: ListenerState = { status: "off" };

/**
 * After the voice stops, how long before listening again: the line's own
 * echo in the room, and the time the speaker takes to play what it was given.
 */
const TAIL_MS = 600;

/**
 * How long the page must stay on the screen before the microphone is taken
 * back. Found on the F6 drive: a page behind another window was shown for
 * about 10 ms every 2 s, and took and dropped the microphone each time.
 */
const RESUME_AFTER_MS = 300;

/** One channel; the browser's own clean-up of noise and level, but no echo cancelling (above). */
const MICROPHONE: MediaTrackConstraints = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: true,
  autoGainControl: true,
};

/** The model's own rate. A context at it means the browser resamples, once, well. */
const MODEL_RATE = 16_000;

interface Session {
  context: AudioContext;
  worker: Worker | null;
  node: AudioWorkletNode | null;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  ready: boolean;
  /** The keywords the screen wants now, and the last list sent, to send a list once. */
  keywords: Keyword[];
  sent: string | null;
  hold: boolean;
  tail: number | null;
  paused: boolean;
  loaded: number;
  total: number | null;
  stopFollowingVoice: () => void;
  stopFollowingPage: () => void;
}

let state: ListenerState = OFF;
let session: Session | null = null;
let onHeard: ((label: string) => void) | null = null;
const listeners = new Set<() => void>();

function set(next: ListenerState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function listenerState(): ListenerState {
  return state;
}

export function listenerStateOnTheServer(): ListenerState {
  return OFF;
}

export function subscribeListener(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Where a phrase heard goes: the screen listening now, or nowhere (null) once it has gone. */
export function setHeardHandler(handler: ((label: string) => void) | null): void {
  onHeard = handler;
}

/** Other things on the page making speech, by name: the listener holds while any is. */
const holds = new Set<string>();

/**
 * Something on the page other than the one voice is speaking (a workout's
 * demo playing with the author's sound, F6): hold the listener as for the
 * voice, the tail included, so it never takes their words for a phrase.
 */
export function holdListener(reason: string, on: boolean): void {
  if (on) holds.add(reason);
  else holds.delete(reason);
  if (session) followVoice(session);
}

/** The page is speaking: its one voice, or anything held for. */
function speaking(): boolean {
  return isVoiceBusy() || holds.size > 0;
}

/** Whether this browser has everything the listener needs. */
export function canListen(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined" &&
    typeof AudioWorkletNode !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function post(s: Session, message: ToListener, transfer: Transferable[] = []): void {
  s.worker?.postMessage(message, transfer);
}

/** What the screen shows, from the session's facts. */
function show(s: Session): void {
  if (session !== s) return;
  if (!s.ready) set({ status: "starting", loaded: s.loaded, total: s.total });
  else if (s.paused) set({ status: "paused" });
  else set(s.hold ? { status: "held" } : { status: "listening" });
}

/**
 * Start listening for these keywords: from a tap, the one moment a phone lets
 * a page start its audio. The first time asks for the microphone, then
 * downloads the listener (about 15 MB, once); after that it starts in a
 * moment. Already listening: just the keywords change.
 */
export function startListening(keywords: Keyword[]): void {
  if (session) {
    setListenerKeywords(keywords);
    return;
  }
  if (!canListen()) {
    set({ status: "failed", failure: "unsupported" });
    return;
  }
  let context: AudioContext;
  try {
    context = makeContext(MODEL_RATE);
  } catch {
    set({ status: "failed", failure: "unsupported" });
    return;
  }
  void context.resume().catch(() => {});
  const s: Session = {
    context,
    worker: null,
    node: null,
    stream: null,
    source: null,
    ready: false,
    keywords,
    sent: null,
    hold: speaking(),
    tail: null,
    paused: false,
    loaded: 0,
    total: null,
    stopFollowingVoice: () => {},
    stopFollowingPage: () => {},
  };
  session = s;
  s.stopFollowingVoice = subscribeVoiceBusy(() => followVoice(s));
  const onVisibility = () => {
    if (document.hidden) pause(s);
    else void resume(s);
  };
  document.addEventListener("visibilitychange", onVisibility);
  s.stopFollowingPage = () => document.removeEventListener("visibilitychange", onVisibility);
  show(s);
  void begin(s);
}

/** Listen for these from now on: a timer started ringing, or stopped. The same list twice is sent once. */
export function setListenerKeywords(keywords: Keyword[]): void {
  const s = session;
  if (!s) return;
  s.keywords = keywords;
  if (!s.worker) return;
  const json = JSON.stringify(keywords);
  if (json === s.sent) return;
  s.sent = json;
  post(s, { type: "keywords", keywords });
}

/** Stop listening: the microphone let go, the listener's memory freed. */
export function stopListening(): void {
  const s = session;
  session = null;
  if (s) teardown(s);
  set(OFF);
}

function makeContext(rate: number | null): AudioContext {
  return rate === null ? new AudioContext({ latencyHint: "interactive" }) : new AudioContext({ sampleRate: rate, latencyHint: "interactive" });
}

async function begin(s: Session): Promise<void> {
  // The microphone first: a person who says no downloads nothing.
  const stream = await askForMicrophone(s);
  if (!stream || session !== s) return;
  if (!(await buildCapture(s))) return;
  s.worker = new Worker(new URL("./listener.worker.ts", import.meta.url), { type: "module", name: "listener" });
  s.worker.onmessage = (event: MessageEvent<FromListener>) => fromWorker(s, event.data);
  s.worker.onerror = () => end(s, "download");
  s.sent = JSON.stringify(s.keywords);
  post(s, { type: "start", keywords: s.keywords });
  sendPort(s);
  if (s.hold) post(s, { type: "hold", on: true });
  if (s.paused) {
    // Hidden while the microphone was asked for: taken again when it comes back.
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  connect(s, stream);
}

/** The microphone, or null with the reason shown. */
async function askForMicrophone(s: Session): Promise<MediaStream | null> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: MICROPHONE });
  } catch (error) {
    end(s, microphoneFailure(error));
    return null;
  }
  if (session !== s) {
    for (const track of stream.getTracks()) track.stop();
    return null;
  }
  return stream;
}

function microphoneFailure(error: unknown): ListenerFailure {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "TypeError") return "unsupported";
  return "no-microphone";
}

/**
 * The worklet that carries the sound to the worker. Built for the context at
 * the model's rate; a browser that cannot feed such a context from a
 * microphone (it says so on `createMediaStreamSource`) gets one at its own
 * rate in `connect`, and the engine resamples instead.
 */
async function buildCapture(s: Session): Promise<boolean> {
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await s.context.audioWorklet.addModule(url);
  } catch {
    end(s, "unsupported");
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
  if (session !== s) return false;
  s.node = new AudioWorkletNode(s.context, CAPTURE_PROCESSOR, {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    channelCountMode: "explicit",
  });
  return true;
}

/** A fresh port between the worklet and the worker. */
function sendPort(s: Session): void {
  if (!s.node || !s.worker) return;
  const channel = new MessageChannel();
  s.node.port.postMessage({ audio: channel.port1 }, [channel.port1]);
  post(s, { type: "audio", port: channel.port2 }, [channel.port2]);
}

function connect(s: Session, stream: MediaStream): void {
  s.stream = stream;
  try {
    s.source = s.context.createMediaStreamSource(stream);
  } catch {
    void atOwnRate(s, stream);
    return;
  }
  if (s.node) s.source.connect(s.node);
}

async function atOwnRate(s: Session, stream: MediaStream): Promise<void> {
  void s.context.close().catch(() => {});
  try {
    s.context = makeContext(null);
  } catch {
    end(s, "unsupported");
    return;
  }
  void s.context.resume().catch(() => {});
  if (!(await buildCapture(s))) return;
  sendPort(s);
  try {
    s.source = s.context.createMediaStreamSource(stream);
  } catch {
    end(s, "no-microphone");
    return;
  }
  if (s.node) s.source.connect(s.node);
}

function letGoOfMicrophone(s: Session): void {
  try {
    s.source?.disconnect();
  } catch {
    // Already gone.
  }
  s.source = null;
  for (const track of s.stream?.getTracks() ?? []) track.stop();
  s.stream = null;
}

function pause(s: Session): void {
  if (session !== s) return;
  s.paused = true;
  letGoOfMicrophone(s);
  show(s);
}

async function resume(s: Session): Promise<void> {
  if (session !== s || !s.paused) return;
  await new Promise((settle) => window.setTimeout(settle, RESUME_AFTER_MS));
  // Hidden again already, or let go: it stays paused.
  if (session !== s || !s.paused || document.hidden) return;
  s.paused = false;
  void s.context.resume().catch(() => {});
  if (!s.stream && s.node) {
    const stream = await askForMicrophone(s);
    if (!stream || session !== s) return;
    if (document.hidden) {
      // Hidden again while it was asked for.
      for (const track of stream.getTracks()) track.stop();
      s.paused = true;
      return;
    }
    connect(s, stream);
    // The gap is not one stream: held and let go, the engine starts afresh.
    if (!s.hold) {
      post(s, { type: "hold", on: true });
      post(s, { type: "hold", on: false });
    }
  }
  show(s);
}

function followVoice(s: Session): void {
  if (session !== s) return;
  if (speaking()) {
    if (s.tail !== null) {
      window.clearTimeout(s.tail);
      s.tail = null;
    }
    if (!s.hold) {
      s.hold = true;
      post(s, { type: "hold", on: true });
    }
  } else if (s.hold && s.tail === null) {
    s.tail = window.setTimeout(() => {
      s.tail = null;
      if (session !== s || speaking()) return;
      s.hold = false;
      post(s, { type: "hold", on: false });
      show(s);
    }, TAIL_MS);
  }
  show(s);
}

function fromWorker(s: Session, message: FromListener): void {
  if (session !== s) return;
  if (message.type === "progress") {
    s.loaded = message.loaded;
    s.total = message.total;
    show(s);
  } else if (message.type === "ready") {
    s.ready = true;
    // The keywords may have changed while it loaded.
    setListenerKeywords(s.keywords);
    show(s);
  } else if (message.type === "heard") {
    if (s.hold || s.paused || !s.ready) return;
    onHeard?.(message.label);
  } else if (message.stage === "audio") {
    // One block it could not read: it goes on listening.
    console.warn(`voice commands: ${message.message}`);
  } else {
    console.warn(`voice commands: ${message.stage}: ${message.message}`);
    end(s, message.stage === "spotter" ? "engine" : "download");
  }
}

function end(s: Session, failure: ListenerFailure): void {
  if (session !== s) return;
  session = null;
  teardown(s);
  set({ status: "failed", failure });
}

function teardown(s: Session): void {
  s.stopFollowingVoice();
  s.stopFollowingPage();
  if (s.tail !== null) window.clearTimeout(s.tail);
  letGoOfMicrophone(s);
  try {
    s.node?.disconnect();
  } catch {
    // Never connected.
  }
  void s.context.close().catch(() => {});
  s.worker?.terminate();
}
