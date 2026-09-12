"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { isNativeAppUserAgent } from "@/lib/native-app-core";
import {
  isSupportedAudioType,
  pickSpeechRoute,
  SPEECH_MAX_SECONDS,
  whyNoSpeech,
  type SpeechCapabilities,
  type SpeechRoute,
} from "@/lib/speech/types";

/**
 * Say it instead of typing it. Hands the words to whatever is above — this
 * only ever produces TEXT, and the tell box then reads it exactly as if it had
 * been typed. Nothing dictated is recorded anywhere until a person presses
 * the box's own button, which is the rule ADR 0039 has always had.
 *
 * ── THE DEVICE BRANCH IS NOT DEAD CODE ───────────────────────────────────────
 *
 * `window.Capacitor.Plugins.SpeechRecognition` does not exist in any app build
 * that has shipped yet, so `deviceEngine` probes false today and everybody
 * takes the server route. It is here now because **the web decides what the
 * app shows** (ADR 0032), which cuts both ways: when the plugin lands in a
 * store release, every phone gets on-device speech with no web deploy — and
 * every phone that has NOT updated keeps working, because the probe is a
 * runtime question about this handset rather than an assumption from its user
 * agent. Shipping the web half first is what makes the app half a pure
 * `mobile/` change.
 *
 * ── TAP TO START, TAP TO STOP ────────────────────────────────────────────────
 *
 * Not press-and-hold. This is used outdoors in gloves, where a finger sliding
 * off the button mid-sentence would silently truncate what somebody said. It
 * stops itself at `SPEECH_MAX_SECONDS` so a button left running is a bounded
 * mistake, and the countdown appears in the last ten seconds so the stop is
 * never a surprise.
 */

/** The narrow bit of the app shell's plugin this file is allowed to know. */
interface DevicePlugin {
  start(opts?: {
    maxResults?: number;
    partialResults?: boolean;
  }): Promise<{ matches?: string[] }>;
  requestPermissions?(): Promise<unknown>;
}

function devicePlugin(): DevicePlugin | null {
  if (typeof window === "undefined") return null;
  const plugins = (
    window as unknown as {
      Capacitor?: { Plugins?: Record<string, unknown> };
    }
  ).Capacitor?.Plugins;
  const found = plugins?.SpeechRecognition as DevicePlugin | undefined;
  return found && typeof found.start === "function" ? found : null;
}

/** Nothing to subscribe to: these facts do not change while the page is open. */
const subscribeToNothing = () => () => {};

/** Every question here is about THIS browser on THIS handset. Pure, and cheap. */
function probeCapabilities(serverConfigured: boolean): SpeechCapabilities {
  return {
    nativeApp: isNativeAppUserAgent(
      typeof navigator === "undefined" ? null : navigator.userAgent,
    ),
    deviceEngine: devicePlugin() !== null,
    canRecord:
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined",
    serverConfigured,
  };
}

/**
 * Stop when they stop talking.
 *
 * ── WHY THIS IS ADAPTIVE AND NOT A FIXED THRESHOLD ───────────────────────────
 *
 * A fixed "below 0.01 is silence" works at a desk and fails in the place this
 * product is for. A tractor idling forty feet away sits well above any
 * threshold quiet enough to be useful indoors, so the recorder would never
 * stop itself and the feature would be exactly as many taps as before — for
 * the people who need it most.
 *
 * So the first `CALIBRATE_MS` are spent measuring THIS room, and everything
 * after is relative to that floor. Speech has to clear the floor by a wide
 * margin, and silence is a return towards it — which is a stable question in a
 * loud barn and a quiet office alike.
 *
 * The listener never stops anything on its own before somebody has actually
 * spoken: `NOTHING_SAID_MS` of never clearing the bar is its own ending, so a
 * button pressed by mistake gives up rather than recording the room for thirty
 * seconds.
 */
const CALIBRATE_MS = 400;
const SILENCE_MS = 1_200;
const NOTHING_SAID_MS = 5_000;
const TICK_MS = 100;

function listenForSilence(stream: MediaStream, done: () => void): () => void {
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  // No Web Audio (an old WebView): the recorder still works, it just has to be
  // stopped by hand. Degrading is right; refusing to record would not be.
  if (!AudioCtx) return () => {};

  const context = new AudioCtx();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);

  const startedAt = Date.now();
  let floorTotal = 0;
  let floorTicks = 0;
  let floor = 0;
  let spokeAt: number | null = null;
  let quietSince: number | null = null;
  let stopped = false;

  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (const sample of buffer) sum += sample * sample;
    const rms = Math.sqrt(sum / buffer.length);
    const age = Date.now() - startedAt;

    if (age < CALIBRATE_MS) {
      floorTotal += rms;
      floorTicks += 1;
      floor = floorTotal / Math.max(1, floorTicks);
      return;
    }

    const speaking = rms > Math.max(floor * 3, 0.012);
    const quiet = rms < Math.max(floor * 1.8, 0.008);

    if (speaking) {
      spokeAt = Date.now();
      quietSince = null;
      return;
    }

    if (spokeAt === null) {
      // Nothing has been said at all yet.
      if (age > NOTHING_SAID_MS) finish();
      return;
    }

    if (quiet) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince > SILENCE_MS) finish();
    } else {
      quietSince = null;
    }
  }, TICK_MS);

  function finish() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    void context.close();
    done();
  }

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    void context.close();
  };
}

/** Whatever this browser will actually give `MediaRecorder`, or null. */
function pickRecordingType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type) && isSupportedAudioType(type)) {
      return type;
    }
  }
  // Safari once reported nothing supported and then recorded mp4 anyway.
  // Letting the browser choose is better than refusing to try.
  return "";
}

export function DictateButton({
  onText,
  disabled,
  serverConfigured,
}: {
  onText: (text: string) => void;
  disabled?: boolean;
  serverConfigured: boolean;
}) {
  // WHAT THIS BROWSER CAN DO IS NOT A PIECE OF STATE, it is a fact this
  // machine already knows — so it is read through `useSyncExternalStore` with
  // a null server snapshot rather than probed in an effect and pushed into
  // state. The server cannot answer any of these questions, and a
  // `setState` in an effect would render once with the wrong answer, then
  // again with the right one (and `react-hooks/set-state-in-effect` is right
  // to refuse it).
  const route = useSyncExternalStore(
    subscribeToNothing,
    // A string, so React's identity check is a value check and this is stable.
    () => pickSpeechRoute(probeCapabilities(serverConfigured)),
    () => null as SpeechRoute | null,
  );

  const [listening, setListening] = useState(false);
  const [working, setWorking] = useState(false);
  const [left, setLeft] = useState(SPEECH_MAX_SECONDS);

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stopAt = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const hush = useRef<(() => void) | null>(null);

  function clearTimers() {
    if (stopAt.current) clearTimeout(stopAt.current);
    if (ticker.current) clearInterval(ticker.current);
    hush.current?.();
    stopAt.current = null;
    ticker.current = null;
    hush.current = null;
  }

  useEffect(() => clearTimers, []);

  async function send(blob: Blob) {
    setWorking(true);
    try {
      const response = await fetch("/api/tell/transcribe", {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      const body = (await response.json()) as
        | { ok: true; text: string }
        | { ok: false; error: string };
      if (!body.ok) {
        toast.error(body.error);
        return;
      }
      if (body.text.trim() === "") {
        toast.error("Nothing came through. Try saying it again.");
        return;
      }
      onText(body.text);
    } catch {
      toast.error("Yosher could not listen just now. Type it instead.");
    } finally {
      setWorking(false);
    }
  }

  async function startServer() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      // Denied, dismissed, or no microphone. One message: the browser has
      // already shown its own, and guessing which of the three happened would
      // be telling somebody something we do not know.
      toast.error("Yosher needs the microphone. Allow it, or type instead.");
      return;
    }

    const mimeType = pickRecordingType();
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunks.current = [];
    recorder.current = rec;

    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.current.push(e.data);
    };
    rec.onstop = () => {
      clearTimers();
      setListening(false);
      // ALWAYS release the microphone. A tab holding it keeps the browser's
      // recording indicator lit, which reads as "this app is listening to me"
      // long after it has stopped.
      for (const track of stream.getTracks()) track.stop();
      const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
      chunks.current = [];
      if (blob.size > 0) void send(blob);
    };

    rec.start();
    setListening(true);
    setLeft(SPEECH_MAX_SECONDS);
    // The reason there is usually no Stop to press. The button stays, because
    // a room this cannot read is a room somebody still has to finish in.
    hush.current = listenForSilence(stream, () => {
      if (rec.state !== "inactive") rec.stop();
    });
    stopAt.current = setTimeout(() => rec.state !== "inactive" && rec.stop(), SPEECH_MAX_SECONDS * 1000);
    ticker.current = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000);
  }

  async function startDevice(plugin: DevicePlugin) {
    setListening(true);
    try {
      await plugin.requestPermissions?.();
      const result = await plugin.start({ maxResults: 1, partialResults: false });
      const said = result?.matches?.[0]?.trim() ?? "";
      if (said === "") {
        toast.error("Nothing came through. Try saying it again.");
        return;
      }
      onText(said);
    } catch {
      toast.error("Yosher needs the microphone. Allow it, or type instead.");
    } finally {
      setListening(false);
    }
  }

  function toggle() {
    if (listening) {
      if (recorder.current && recorder.current.state !== "inactive") {
        recorder.current.stop();
      }
      return;
    }
    if (route === "device") {
      const plugin = devicePlugin();
      if (plugin) return void startDevice(plugin);
    }
    void startServer();
  }

  // Nothing rendered until the probe has run, so the button never appears and
  // then vanishes.
  if (route === null) return null;

  if (route === "none") {
    return (
      <p className="text-xs text-muted-foreground">
        {whyNoSpeech(probeCapabilities(serverConfigured))}
      </p>
    );
  }

  return (
    <Button
      type="button"
      variant={listening ? "default" : "outline"}
      size="sm"
      onClick={toggle}
      disabled={disabled || working}
      aria-pressed={listening}
      aria-label={listening ? "Listening — press to finish now" : "Say it instead of typing"}
    >
      {working ? (
        <>
          <Loader2 className="mr-2 size-4 animate-spin" /> Writing it down…
        </>
      ) : listening ? (
        // It normally stops itself, so the label says what is happening rather
        // than demanding an action: pressing it is a way to finish early, not
        // the way to finish.
        <>
          <Square className="mr-2 size-4 fill-current" />
          {left <= 10 ? `Listening (${left}s)` : "Listening…"}
        </>
      ) : (
        <>
          <Mic className="mr-2 size-4" /> Say it
        </>
      )}
    </Button>
  );
}
