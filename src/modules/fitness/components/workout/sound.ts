/**
 * WHAT WORKOUT MODE MAKES HEARD (docs/modules/fitness.md, F2): a soft tone at
 * each turn of the breath, a two-note chime and a buzz when a set is done, and
 * the coach's voice (F2b), so a person with their face on the floor does not
 * have to look.
 *
 * The tones are the Web Audio API, which a browser only lets start after a
 * tap: any tap on the workout screen calls `unlockSound`, which also warms the
 * voice up (iOS will not speak otherwise). The buzz is the Vibration API: the
 * phone's browser has it; the Android app does not until a build adds the
 * VIBRATE permission (an open item, with the camera).
 *
 * THE VOICE IS ONE QUEUE (`@/lib/speech/voice-queue`, ADR 0114), so a cue never
 * talks over a count and, later, the founder's posture feedback can cut in on
 * both. Everything in workout mode speaks through `coachSay`, which honours the
 * two switches: sounds (everything) and the coach's voice (words only).
 */

import { warmUpSpeech } from "@/lib/speech/say";
import { silence, speak, type VoiceLine } from "@/lib/speech/voice-queue";

let context: AudioContext | null = null;

const MUTE_KEY = "yosher.fitness.sound";
const VOICE_KEY = "yosher.fitness.voice";
let muted: boolean | null = null;
let voiceOff: boolean | null = null;
const listeners = new Set<() => void>();

function readMutedFromStorage(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "off";
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  if (muted === null) muted = readMutedFromStorage();
  return muted;
}

export function mutedOnTheServer(): boolean {
  return false;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    if (value) window.localStorage.setItem(MUTE_KEY, "off");
    else window.localStorage.removeItem(MUTE_KEY);
  } catch {
    // Kept in memory for this page.
  }
  if (value) silence();
  for (const listener of listeners) listener();
}

/** The coach's voice is off on this device; the tones may still be on. */
export function isVoiceOff(): boolean {
  if (voiceOff === null) {
    try {
      voiceOff = window.localStorage.getItem(VOICE_KEY) === "off";
    } catch {
      voiceOff = false;
    }
  }
  return voiceOff;
}

export function voiceOffOnTheServer(): boolean {
  return false;
}

export function setVoiceOff(value: boolean): void {
  voiceOff = value;
  try {
    if (value) window.localStorage.setItem(VOICE_KEY, "off");
    else window.localStorage.removeItem(VOICE_KEY);
  } catch {
    // Kept in memory for this page.
  }
  if (value) silence();
  for (const listener of listeners) listener();
}

/** Either switch changing: sounds, or the coach's voice. */
export function subscribeMuted(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/**
 * Say a line in the coach's voice, when both switches allow it. The one way
 * anything in workout mode speaks, the founder's posture feedback included:
 * `coachSay({ text: "Knees out.", priority: "high", key: "posture" })`
 * interrupts a cue or a count, and replaces its own unsaid last correction.
 */
export function coachSay(line: VoiceLine | null): void {
  if (!line || isMuted() || isVoiceOff()) return;
  speak(line);
}

/** Called from a tap: the only moment a browser allows sound to start. */
export function unlockSound(): void {
  warmUpSpeech();
  try {
    if (!context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      context = new Ctor();
    }
    void context.resume();
  } catch {
    context = null;
  }
}

function tone(frequency: number, ms: number, volume: number, delayMs = 0): void {
  if (!context || isMuted()) return;
  try {
    const start = context.currentTime + delayMs / 1000;
    const end = start + ms / 1000;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(end + 0.05);
  } catch {
    // A context that has gone away: silence, never an error mid-set.
  }
}

export function buzz(ms: number): void {
  if (isMuted()) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    // No vibration here.
  }
}

export const sounds = {
  /** The turn to breathe out: low. */
  breatheOut: () => tone(392, 280, 0.05),
  /** The turn to breathe in: a step higher, and quieter. */
  breatheIn: () => tone(523, 280, 0.035),
  /** A countdown's last seconds. */
  tick: () => tone(660, 90, 0.03),
  /** A set done: two notes up, and a buzz. */
  setDone: () => {
    tone(659, 160, 0.07);
    tone(880, 280, 0.07, 170);
    buzz(180);
  },
};
