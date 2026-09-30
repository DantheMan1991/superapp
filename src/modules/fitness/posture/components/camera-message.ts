import { appCanUseCamera, nativeAppInfo } from "@/lib/native-app-core";

/**
 * The camera's refusal, in words that name the fix that works for how the
 * page was opened. An app build from before 1.0.8 never declared the camera,
 * so Android refused it without asking and there is no switch to turn on:
 * that person is told to update, not to allow (the microphone's lesson,
 * docs/modules/mobile-app.md). Any other failure is passed through.
 */
export function cameraMessage(message: string): string {
  const denied = /NotAllowed|Permission|denied/i.test(message);
  if (!denied) return message;
  const app = typeof navigator === "undefined" ? null : nativeAppInfo(navigator.userAgent);
  if (app && !appCanUseCamera(app)) {
    return "This version of the app cannot use the camera. Update the app, or open yosherapp.com in Chrome.";
  }
  if (app) {
    return "The camera was not allowed. Allow it for Yosher in your phone's settings, under Apps, Yosher, Permissions, then try again.";
  }
  return "The camera was not allowed. Allow it for this site in Chrome's settings, then try again.";
}
