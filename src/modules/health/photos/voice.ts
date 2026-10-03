import { audioContext, unlockAudio } from "@/lib/audio-context";
import { prefetchLines, setClipSource } from "@/lib/speech/clips";
import { warmUpSpeech } from "@/lib/speech/say";
import { chosenVoice } from "@/lib/speech/voice-choice";
import { silence, speak } from "@/lib/speech/voice-queue";
import { photoLines } from "../core/photos";

/**
 * THE PHOTOS' COUNTDOWN, OUT LOUD (H2b): the phone is across the room, so it
 * says when to turn, through the page's one voice (`voice-queue.ts`, ADR
 * 0114) in the recorded voice the phone chose for the workout coach (ADR
 * 0115), fetched ahead from `/api/health/voice` when the camera opens. Where
 * the platform has no recorded voice, the device's own says it. A beep each of
 * the last three seconds, and a click as each photo is taken.
 *
 * Only words go to the server, never a picture. A module, not a hook: one
 * voice per page.
 */

const ENDPOINT = "/api/health/voice";
const KEY = "photos";

/** From the tap that opens the camera: sound unlocked, the lines fetched ahead. */
export function startPhotoVoice(naturalVoice: boolean): void {
  warmUpSpeech();
  unlockAudio();
  if (naturalVoice) {
    setClipSource({ endpoint: ENDPOINT, voice: chosenVoice() });
    prefetchLines(photoLines());
  }
}

/** Say this now, instead of whatever is being said. */
export function sayPhoto(text: string): void {
  speak({ text, priority: "normal", key: KEY, freshMs: 6_000 });
}

/** Stop talking now: the count was stopped. The recordings stay on for the next Start. */
export function hushPhoto(): void {
  silence();
}

/** The screen is left: nothing more is said or fetched. */
export function stopPhotoVoice(): void {
  silence();
  setClipSource(null);
}

function tone(frequency: number, ms: number, volume = 0.12): void {
  const context = audioContext();
  if (!context || context.state !== "running") return;
  try {
    const at = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + ms / 1000);
    osc.connect(gain).connect(context.destination);
    osc.start(at);
    osc.stop(at + ms / 1000 + 0.02);
  } catch {
    // A context that has gone away: silence, never an error mid-count.
  }
}

/** One of the last three seconds. */
export function beep(): void {
  tone(880, 120);
}

/** The photo is taken. */
export function click(): void {
  tone(1400, 60, 0.18);
}
