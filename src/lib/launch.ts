/**
 * The launch: the moment the mobile app opens, before the sign-in card or
 * the business appears.
 *
 * The shell shows a plain blue screen the instant the process starts (its
 * native splash, docs/modules/mobile-app.md), and the SITE plays the
 * animation on its first paint inside the app — the mark zooming in on blue,
 * then lifting away. That split keeps the look in the web deploy, where it
 * can change without an app release, and keeps the shell's part to the one
 * thing only a native screen can do: be there before any page has loaded.
 *
 * Once per app launch, not once per page: a session cookie set when the
 * animation ends, which a webview forgets when the app is closed, is the
 * closest thing the web has to "this process started". The server reads it
 * so a second page load renders no overlay at all — nothing to hide, so
 * nothing flashes.
 */

export const LAUNCH_COOKIE = "yosher_launched";

export function shouldShowLaunch(input: {
  nativeApp: boolean;
  launchedCookie: string | null | undefined;
}): boolean {
  return input.nativeApp && input.launchedCookie !== "1";
}
