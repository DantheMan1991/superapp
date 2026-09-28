/**
 * THE PAGE'S ONE AUDIO CONTEXT: the workout's tones and the coach's recorded
 * lines (ADR 0115) play through it.
 *
 * A browser lets a context start only from a tap, so it is made or resumed
 * in `unlockAudio`, which the workout screen calls on any tap. Until then
 * `audioContext()` is null, or a context still suspended, and whatever wanted
 * to play falls back or stays quiet: never an error mid-set.
 */

let context: AudioContext | null = null;

/** The context, once a tap has made it. It may still be suspended. */
export function audioContext(): AudioContext | null {
  return context;
}

/** Called from a tap: the only moment a browser allows sound to start. */
export function unlockAudio(): void {
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
