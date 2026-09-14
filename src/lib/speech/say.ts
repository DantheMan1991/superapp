/**
 * SAYING IT BACK — the other direction (tell.md, slice D1).
 *
 * ── WHY ──────────────────────────────────────────────────────────────────────
 *
 * The whole justification for this feature is somebody outdoors with their
 * hands full. [ADR 0050](../../../docs/decisions/0050-a-safe-verb-records-itself.md)
 * got the count down to one tap for a clock-in — and then put the ANSWER on a
 * screen they still have to take out and look at. A confirmation you have to
 * look at is a second interaction wearing a toast's clothes.
 *
 * So: say it back. Press, speak, hear `Clocked in at 7:42`, put the phone away.
 *
 * ── THE RULE THAT KEEPS IT FROM BEING ANNOYING ───────────────────────────────
 *
 * **IT ONLY SPEAKS WHEN IT WAS SPOKEN TO.** Somebody who TYPED a sentence is
 * looking at the screen; talking at them is noise, and noise is what gets a
 * feature switched off. The box tracks how the words arrived and says nothing
 * when they were typed. The mute below is for the other case — dictating at a
 * desk with people in the room.
 *
 * ── AND IT SPEAKS THE FAILURES ───────────────────────────────────────────────
 *
 * The temptation is to speak only the happy answer. That is exactly backwards:
 * a person not looking at the screen can see a success they did not need and
 * MISS a refusal they did. A silent failure to somebody walking away is the one
 * outcome this must never produce.
 *
 * ── DELIBERATELY NOT `server-only` ───────────────────────────────────────────
 *
 * The same split `speech/types.ts` keeps: the shaping is pure and tested, the
 * two functions that touch `window` are guarded and do nothing where there is
 * no speech engine. Degrading to silence is right; refusing to record because a
 * WebView cannot talk would not be.
 */

/* -- the pure half --------------------------------------------------------- */

/**
 * A line written for the EYE, punctuated for the EAR.
 *
 * Every summary in this product is built for a toast, where an em dash is a
 * clean separator: `3 head — died — from Pen 2`. A speech engine reads that as
 * one breathless run-on, or pauses in the wrong place, or says the character
 * out loud. A comma is what a voice does with a pause.
 *
 * Kept deliberately small. This is punctuation, not rewriting — the words a
 * pack chose are the words a person hears, because a second voice paraphrasing
 * the first is how a confirmation stops being a confirmation.
 */
export function forSpeech(text: string): string {
  return text
    // A spaced dash of any flavour, and the middle dot the packs use between
    // facts, are all "pause here".
    .replace(/\s+[—–·-]\s+/g, ", ")
    // A summary that already ended in punctuation must not gain a comma.
    .replace(/,\s*([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * How many of the summaries to actually say.
 *
 * One thing said, one thing heard. Two or three is still a sentence somebody
 * can hold in their head while walking, and hearing all of them is the POINT —
 * the round in one breath is the box's best trick and a count would throw the
 * answer away.
 *
 * Past three it becomes a monologue at somebody holding a bucket, and a count
 * is the kinder answer. The number is a judgement, not a measurement; it is
 * here rather than inline so it can be argued with in one place.
 */
export const SPEAK_EACH_UP_TO = 3;

/** What to say once something has been recorded. Empty means say nothing. */
export function spokenConfirmation(summaries: readonly string[]): string {
  const said = summaries.map((s) => s.trim()).filter((s) => s !== "");
  if (said.length === 0) return "";
  if (said.length <= SPEAK_EACH_UP_TO) return said.map(forSpeech).join(". ");
  return `Recorded ${said.length} things`;
}

/* -- the half that touches the browser ------------------------------------- */

import { readNativeBridge } from "@/lib/native-bridge";

/**
 * **THE SHELL'S OWN VOICE, WHEN THERE IS ONE.**
 *
 * A WebView's `window.speechSynthesis` exists, accepts an utterance and makes
 * no sound. #548 fixed three real browser faults and the phone still said
 * nothing, which is the answer: it is not a browser fault. Same fork the
 * microphone took in [ADR 0049](../../../docs/decisions/0049-speech-is-a-fork-in-the-road-not-a-provider.md)
 * — the handset's own engine inside the app, the browser's outside it.
 *
 * Null everywhere else, including in an app build from before the shell could
 * talk, which is what keeps this safe to ship ahead of a rebuild.
 */
function nativeVoice() {
  if (typeof window === "undefined") return null;
  return readNativeBridge(window)?.speak ?? null;
}

/**
 * ── WHY THIS HALF IS LONGER THAN IT LOOKS LIKE IT SHOULD BE ──────────────────
 *
 * The founder, 2026-09-13: *"I get voice feedback on the computer, but the phone
 * app does not."* Everything below is the difference between those two, and none
 * of it is exotic — it is the same three things that break Web Speech in an
 * Android WebView, all of which a desktop browser hides:
 *
 *  1. **Voices arrive late.** `getVoices()` answers `[]` on first call and fills
 *     in when `voiceschanged` fires. Speak before that and the engine drops the
 *     utterance SILENTLY — no error, no sound. A desktop browser has voices warm
 *     long before anybody presses anything, which is exactly why it works there.
 *  2. **`cancel()` then `speak()` in the same turn is a race.** The new
 *     utterance goes out with the old one. Desktop tolerates it; WebView does
 *     not.
 *  3. **The queue gets stuck `paused`** and then speaks nothing and says
 *     nothing, until something calls `resume()`.
 *
 * And one of my own: `warmUpSpeech` ran on EVERY press of the microphone, so a
 * barn morning queued a dozen silent utterances behind each other. On an engine
 * where a whitespace utterance never fires `end`, that is a queue that never
 * drains.
 *
 * **NONE OF THIS HAS BEEN WATCHED WORKING ON A PHONE.** It is a fix believed in,
 * not a fix verified, which is why the last part of this file exists: when the
 * engine proves it cannot speak, the app stops claiming it can and says so once.
 * A feature that fails silently is one nobody can report.
 */

/** Per device, per browser. A convenience, never state anything depends on. */
const HUSH_KEY = "yosher.tell.hush";

/** Proven unable to speak: an utterance errored, or never started. */
let silent = false;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** There is an engine, and it has not yet proved itself useless. */
export function canSpeak(): boolean {
  if (silent) return false;
  // The shell's voice counts even where the WebView has none of its own, which
  // is the whole point of it.
  if (nativeVoice()) return true;
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * The engine took an utterance and made no sound.
 *
 * Said once. From here the speaker button goes away — a control that does
 * nothing is worse than an absent one — and the box says why, because the
 * alternative is somebody wondering whether they pressed it wrong.
 */
function provedSilent(): void {
  if (silent) return;
  silent = true;
  changed();
}

export function isSilentDevice(): boolean {
  return silent;
}

/**
 * Whether this device has asked it to stay quiet.
 *
 * Reads can throw outright — a private window, site data blocked, a thumbnail
 * capture — so every access is wrapped and the failure means "not hushed",
 * which is what somebody who never touched the toggle expects.
 */
export function isHushed(): boolean {
  try {
    return window.localStorage.getItem(HUSH_KEY) === "1";
  } catch {
    return false;
  }
}

export function setHushed(hushed: boolean): void {
  try {
    if (hushed) window.localStorage.setItem(HUSH_KEY, "1");
    else window.localStorage.removeItem(HUSH_KEY);
  } catch {
    // A device that cannot remember the preference still honours it for the
    // rest of this page's life, because the listeners are told either way.
  }
  if (hushed) hush();
  changed();
}

/* -- reading a browser fact the way React wants it read -------------------- */

/**
 * **`useSyncExternalStore`, NOT AN EFFECT.** These live in the browser and have
 * no server answer, so `useEffect(() => setX(read()))` is two paints and a lint
 * error. This is the shape React added for it: a snapshot, a server snapshot,
 * and a way to be told it changed.
 *
 * Both facts share one subscription now. Whether there is a voice at all USED to
 * be constant for a page's life; it is not, because the engine can prove itself
 * silent at the first thing it is asked to say.
 */
export function subscribeVoice(onChange: () => void): () => void {
  listeners.add(onChange);
  const fromAnotherTab = (e: StorageEvent) => {
    if (e.key === null || e.key === HUSH_KEY) onChange();
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

/** On the server there is no voice, so nothing is hushed and nothing speaks. */
export function noVoiceOnTheServer(): boolean {
  return false;
}

/* -- the engine ------------------------------------------------------------ */

let warmed = false;

/**
 * **THE GESTURE TRICK, AND IT IS NOT OPTIONAL ON iOS.**
 *
 * Mobile Safari starts speech only inside a user gesture, and everything this
 * says comes AFTER an await — the model call, the server action — by which point
 * the gesture is gone and `speak()` is silently ignored.
 *
 * **ONCE PER PAGE, NOT ONCE PER PRESS.** It used to run on every press of the
 * microphone, which on a busy morning queues a dozen silent utterances behind
 * each other; on an engine where a whitespace utterance never reports finishing,
 * that queue never drains and nothing after it is ever heard. One is all the
 * unlocking ever needed.
 */
export function warmUpSpeech(): void {
  if (warmed || !canSpeak()) return;
  warmed = true;
  try {
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    window.speechSynthesis.speak(warm);
  } catch {
    // An engine that refuses to warm up may still speak later; if it does not,
    // the screen still says everything the voice would have.
  }
}

/** Stop talking, now — whichever of the two is doing the talking. */
export function hush(): void {
  const native = nativeVoice();
  if (native) void native.hush().catch(() => {});
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* nothing to cancel */
  }
}

/** What the page is written in, so the engine picks a voice for it. */
function preferredLang(): string {
  try {
    return document.documentElement.lang || navigator.language || "en-US";
  } catch {
    return "en-US";
  }
}

function voicesNow(): SpeechSynthesisVoice[] {
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}

/**
 * Wait for the voice list, but never forever.
 *
 * Some engines never fire `voiceschanged` at all, and going ahead with no voice
 * named is better than a promise nobody keeps — the engine usually has a default
 * even when it will not enumerate one.
 */
function whenVoicesReady(run: () => void): void {
  if (voicesNow().length > 0) {
    run();
    return;
  }
  let ran = false;
  const go = () => {
    if (ran) return;
    ran = true;
    try {
      window.speechSynthesis.removeEventListener("voiceschanged", go);
    } catch {
      /* nothing was listening */
    }
    run();
  };
  try {
    window.speechSynthesis.addEventListener("voiceschanged", go);
  } catch {
    /* an engine too old to be listened to */
  }
  window.setTimeout(go, 1_000);
}

/** How long an utterance may sit having neither started nor failed. */
const NEVER_STARTED_MS = 3_000;

function utter(words: string): void {
  const synth = window.speechSynthesis;
  try {
    synth.cancel();
    // A queue stuck `paused` speaks nothing and reports nothing until this is
    // called. Harmless when it is not stuck.
    synth.resume();
  } catch {
    /* nothing to cancel or resume */
  }

  /*
   * A TICK BETWEEN CANCEL AND SPEAK. Doing both in one turn is a documented
   * Android WebView race in which the new utterance is discarded with the old
   * one — and cancelling first is not optional, because two answers said
   * quickly must not queue up: the second is the one that is true.
   */
  window.setTimeout(() => {
    try {
      const utterance = new SpeechSynthesisUtterance(words);
      // Slightly under the default. A confirmation is heard once, outdoors,
      // possibly over an engine, and a rushed one has to be read on the screen
      // anyway — which is the interaction this exists to remove.
      utterance.rate = 0.95;

      /*
       * **THE VOICE FIRST, THEN THE LANGUAGE TO MATCH IT.**
       *
       * Measured in an embedded Chromium on 2026-09-13: the page declares
       * `lang="en"` and every installed voice is `en-US`, so an exact match
       * finds NOTHING and only the two-letter fallback picks one. Setting
       * `lang` from the page and the voice from the fallback would then hand
       * the engine a pair that disagree — so the chosen voice names the
       * language, and the page is only the starting point for choosing.
       */
      const wanted = preferredLang();
      const voice =
        voicesNow().find((v) => v.lang === wanted) ??
        voicesNow().find((v) => v.lang?.startsWith(wanted.slice(0, 2))) ??
        voicesNow().find((v) => v.default);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || wanted;

      let started = false;
      utterance.onstart = () => {
        started = true;
      };
      utterance.onerror = () => provedSilent();
      synth.speak(utterance);

      // Neither started nor errored: the engine took it and threw it away,
      // which is how a WebView with nothing behind it behaves. The ONLY way to
      // notice that, since nothing is reported.
      window.setTimeout(() => {
        if (!started) provedSilent();
      }, NEVER_STARTED_MS);
    } catch {
      provedSilent();
    }
  }, 0);
}

/**
 * Say it, unless this device asked for quiet.
 *
 * **CANCELS FIRST, ALWAYS.** Two answers said quickly must not queue up behind
 * each other — the second one is the one that is true, and hearing the first
 * finish is how somebody walks away believing the wrong thing.
 */
export function sayIt(text: string): void {
  const words = text.trim();
  if (words === "" || !canSpeak() || isHushed()) return;

  /*
   * THE SHELL FIRST, AND WITHOUT A RACE. Where the app can talk, the WebView's
   * own engine must not also try: two voices saying the same sentence a beat
   * apart is worse than one that works.
   */
  const native = nativeVoice();
  if (native) {
    void native.speak({ text: words }).catch(() => provedSilent());
    return;
  }

  try {
    whenVoicesReady(() => utter(words));
  } catch {
    provedSilent();
  }
}
