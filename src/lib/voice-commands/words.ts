import type { ListenerFailure } from "./listener";

/**
 * What a screen says about the listener, the same in every tool that listens
 * (Food's cook mode, Workouts' workout mode): why it stopped, and how far its
 * first download has come. Pure.
 */

/** Why hands-free stopped, and what to do about it. */
export function listenerFailureWords(failure: ListenerFailure, inApp: boolean): string {
  switch (failure) {
    case "unsupported":
      return "Hands-free needs a newer browser. Chrome, or the Yosher app, has what it needs.";
    case "denied":
      return inApp
        ? "The microphone is blocked for the Yosher app. Allow it in the phone's settings, then try again."
        : "The microphone is blocked for this site. Allow it in the browser's site settings, then try again.";
    case "no-microphone":
      return "No microphone would start. Another app may be using it.";
    case "download":
      return "Hands-free could not be downloaded. Check the connection, then try again.";
    case "engine":
      return "Hands-free would not start on this phone.";
  }
}

/** Whether trying again can help: not for a browser that lacks the parts, or an engine that would not run. */
export function canRetry(failure: ListenerFailure): boolean {
  return failure !== "unsupported" && failure !== "engine";
}

/** The model's share of the first download, which is most of it. */
export function downloadPercent(loaded: number, total: number): number {
  return Math.min(100, Math.round((loaded / total) * 100));
}
