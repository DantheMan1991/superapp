/**
 * THE PACER'S SOUNDS (docs/modules/fitness.md, F2): a soft tone at each turn
 * of the breath, and a two-note chime and a buzz when a set is done, so a
 * person with their face on the floor does not have to look.
 *
 * Tones, not words. Words are F2b's coach voice, which is ONE queue so that a
 * spoken cue (and, later, the founder's posture feedback) never talks over a
 * count. A tone is short enough to sit under a word.
 *
 * Made with the Web Audio API, which a browser only lets start after a tap:
 * `unlockSound` is called from the Start button. The buzz is the Vibration
 * API: the phone's browser has it; the Android app does not until a build
 * adds the VIBRATE permission (an open item, with the camera).
 */

let context: AudioContext | null = null;

const MUTE_KEY = "yosher.fitness.sound";
let muted: boolean | null = null;
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
  for (const listener of listeners) listener();
}

export function subscribeMuted(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Called from a tap: the only moment a browser allows sound to start. */
export function unlockSound(): void {
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
