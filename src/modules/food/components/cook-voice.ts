import { unlockAudio } from "@/lib/audio-context";
import { prefetchLines, setClipSource } from "@/lib/speech/clips";
import { warmUpSpeech } from "@/lib/speech/say";
import { chosenVoice } from "@/lib/speech/voice-choice";
import { isVoiceBusy, silence, speak, subscribeVoiceBusy } from "@/lib/speech/voice-queue";

/**
 * COOK MODE'S VOICE (D1c, docs/modules/food.md): a recipe read aloud through
 * the page's one voice (`voice-queue.ts`, ADR 0114), in the recorded voice the
 * phone chose for the workout coach (ADR 0115), fetched ahead from
 * `/api/food/voice` and kept on the phone. Where the platform has no recorded
 * voice, the device's own says it.
 *
 * WHAT IS SAID IS A SCRIPT, ONE LINE AT A TIME. A long step is several lines
 * (the route takes 300 characters a line), and the queue holds only three
 * waiting, so the lines are handed over as each one ends. Every line carries
 * the key "cook": a new screen's first line cuts off whatever was being said,
 * so moving on mid-sentence moves the voice on too.
 *
 * Deliberately a module, not a hook, like the queue it feeds: one voice per
 * page.
 */

const ENDPOINT = "/api/food/voice";
const KEY = "cook";
/** A line may wait this long for its turn: the script hands them over one at a time, so only a slow recording waits. */
const FRESH_MS = 60_000;

let script: string[] = [];
let following: (() => void) | null = null;

/**
 * From the tap that turns hands-free on: sound unlocked, the recordings
 * switched on and fetched ahead. The screen's own lines go in a request of
 * their own, before the rest: a batch comes back when its slowest line is
 * recorded (4.4 s for the first four on the drive, 12.7 s for the rest), and
 * the screen is the first thing said.
 */
export function startCookVoice(naturalVoice: boolean, first: readonly string[], rest: readonly string[]): void {
  warmUpSpeech();
  unlockAudio();
  if (naturalVoice) {
    setClipSource({ endpoint: ENDPOINT, voice: chosenVoice() });
    prefetchLines(first);
    prefetchLines(rest);
  }
  following ??= subscribeVoiceBusy(feed);
}

/** Say these, in order, instead of whatever is being said. */
export function sayCook(lines: readonly string[]): void {
  if (!following || lines.length === 0) return;
  script = lines.slice(1);
  speak({ text: lines[0], priority: "normal", key: KEY, freshMs: FRESH_MS });
}

/** The next line, once the one before has been said. */
function feed(): void {
  if (script.length === 0 || isVoiceBusy()) return;
  const [next, ...rest] = script;
  script = rest;
  speak({ text: next, priority: "normal", key: KEY, freshMs: FRESH_MS });
}

/** Stop talking now, and forget the rest: a timer rang, so the person can be heard. */
export function hushCook(): void {
  script = [];
  silence();
}

/** Hands-free off, or cook mode left: nothing more is said, and no more is fetched. */
export function stopCookVoice(): void {
  script = [];
  following?.();
  following = null;
  silence();
  setClipSource(null);
}
