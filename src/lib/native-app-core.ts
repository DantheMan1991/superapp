/**
 * How the web app knows it is running inside the Yosher mobile app.
 *
 * The app is the web app in a native shell (ADR 0032): a Capacitor webview
 * that loads yosherapp.com. Nothing about the pages changes for it except
 * what the app stores require — no purchase inside the app, no sign-up
 * inside the app — so the one thing the web needs is a reliable "am I inside
 * the shell" answer. The shell appends a marker to its user agent
 * (`YosherApp/<version> (<platform>)`, set in the Capacitor config), and
 * every request the webview makes carries it, page loads and server-action
 * calls alike.
 *
 * A cookie of the same name is honoured too, for looking at the app's face
 * from a laptop. It hides purchase buttons from whoever sets it and nothing
 * else, so it needs no protection.
 *
 * Pure, so the proxy, server components and tests can all ask.
 */

export const NATIVE_APP_UA_MARKER = "YosherApp/";
export const NATIVE_APP_COOKIE = "yosher_app";

export type NativeAppPlatform = "ios" | "android";

export interface NativeAppInfo {
  version: string | null;
  platform: NativeAppPlatform | null;
}

export function isNativeAppUserAgent(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && userAgent.includes(NATIVE_APP_UA_MARKER);
}

/** `YosherApp/1.2.0 (ios)` → version and platform; null for anything else. */
export function nativeAppInfo(userAgent: string | null | undefined): NativeAppInfo | null {
  if (!isNativeAppUserAgent(userAgent)) return null;
  const match = /YosherApp\/([\w.-]+)(?:\s*\((ios|android)\))?/i.exec(userAgent ?? "");
  return {
    version: match?.[1] ?? null,
    platform: (match?.[2]?.toLowerCase() as NativeAppPlatform | undefined) ?? null,
  };
}

/**
 * The first app build that declares CAMERA (docs/modules/mobile-app.md,
 * 2026-09-30). An older build asks Android for the camera and is refused
 * without a dialog, so the web must not tell its user to "allow" something
 * with no switch anywhere: it tells them to update instead.
 */
export const APP_CAMERA_VERSION = "1.0.8";

/**
 * The first app build that can write a file where the person finds it
 * (`@capacitor/filesystem`, docs/modules/mobile-app.md, 2026-10-03): Health's
 * progress photos' "Save a copy" (ADR 0128). An older build's WebView ignores
 * a download, so its person is told to update.
 */
export const APP_FILES_VERSION = "1.0.9";

/** Dotted versions compared part by part as numbers: below zero when `a` is older. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((p) => Number.parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Can this app build be given the camera at all? A browser is not an app
 * build (`null`), so yes; an app that does not say its version is taken to be
 * an old one.
 */
export function appCanUseCamera(info: NativeAppInfo | null): boolean {
  if (!info) return true;
  if (!info.version) return false;
  return compareVersions(info.version, APP_CAMERA_VERSION) >= 0;
}

/** Can this app build save a file (1.0.9)? A browser saves through its own download, so yes. */
export function appCanSaveFiles(info: NativeAppInfo | null): boolean {
  if (!info) return true;
  if (!info.version) return false;
  return compareVersions(info.version, APP_FILES_VERSION) >= 0;
}

/**
 * Where the app lands when it asks for the site's front page. The marketing
 * landing page is for browsers; the app opens on the dashboard, which is the
 * sign-in card when signed out and the business when signed in. Decided
 * HERE, in the site, rather than baked into the shell's start address: a
 * build the founder already installed starts opening in the right place the
 * moment the site deploys, with nothing to reinstall.
 */
export const NATIVE_APP_ENTRY = "/dashboard";

export function nativeAppEntryRedirect(
  pathname: string,
  userAgent: string | null | undefined,
): string | null {
  if (!isNativeAppUserAgent(userAgent)) return null;
  return pathname === "/" ? NATIVE_APP_ENTRY : null;
}

export function isNativeAppRequest(input: {
  userAgent?: string | null;
  /** The `yosher_app` cookie's value, if present. */
  cookie?: string | null;
}): boolean {
  if (isNativeAppUserAgent(input.userAgent)) return true;
  return input.cookie?.trim() === "1";
}
