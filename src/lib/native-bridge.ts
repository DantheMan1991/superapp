/**
 * The shell's bridge, as the page sees it.
 *
 * Capacitor injects `window.Capacitor` into every page the app's webview
 * loads — the site included, though the site ships none of Capacitor's
 * code. So the web reaches the phone's plugins through that global, with
 * runtime checks rather than types, and a page in a plain browser (or in a
 * shell that does not carry a given plugin yet) simply finds nothing and
 * does nothing. Pure, and tested with hand-built windows.
 */

export type NativePlatform = "ios" | "android";

export interface PushPermission {
  receive: "prompt" | "prompt-with-rationale" | "granted" | "denied" | string;
}

export interface PushListenerHandle {
  remove(): void | Promise<void>;
}

/** The subset of @capacitor/push-notifications the page uses. */
export interface PushPlugin {
  checkPermissions(): Promise<PushPermission>;
  requestPermissions(): Promise<PushPermission>;
  register(): Promise<void>;
  addListener(
    event: "registration" | "registrationError" | "pushNotificationActionPerformed",
    callback: (payload: unknown) => void,
  ): Promise<PushListenerHandle> | PushListenerHandle;
}

/** The subset of @capacitor/app the page uses. */
export interface AppPlugin {
  /** The url the app was COLD-STARTED with, or null. */
  getLaunchUrl(): Promise<{ url?: string } | null | undefined>;
  addListener(
    event: "appUrlOpen",
    callback: (payload: unknown) => void,
  ): Promise<PushListenerHandle> | PushListenerHandle;
}

/**
 * The shell's own speech hatch (`TellPlugin`).
 *
 * Present only on a build that captures speech natively. When it is here the
 * web must NOT start its own recorder on a shortcut launch — the phone already
 * listened, before the page existed, and two microphones for one sentence is
 * the bug that would replace the slow one.
 */
export interface TellPlugin {
  /** Whatever was said before the page loaded, cleared as it is handed over. */
  takePending(): Promise<{ utterance?: string | null } | null | undefined>;
  addListener(
    event: "utterance",
    callback: (payload: unknown) => void,
  ): Promise<PushListenerHandle> | PushListenerHandle;
}

export interface NativeBridge {
  platform: NativePlatform;
  /** Null when the shell does not carry the plugin (a build before push existed). */
  push: PushPlugin | null;
  /**
   * Null on a build before the home-screen shortcut existed. Reaching the app
   * through `@capacitor/app` is how a shortcut says "open already listening"
   * without a line of Java: the shortcut fires a url, this delivers it, and
   * the WEB decides what it means (ADR 0032).
   */
  app: AppPlugin | null;
  /** Null in a browser, and on any app build before native capture. */
  tell: TellPlugin | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readNativeBridge(w: unknown): NativeBridge | null {
  if (!isRecord(w)) return null;
  const cap = w.Capacitor;
  if (!isRecord(cap)) return null;
  if (typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) {
    return null;
  }
  const platform = typeof cap.getPlatform === "function" ? cap.getPlatform() : null;
  if (platform !== "ios" && platform !== "android") return null;
  const plugins = isRecord(cap.Plugins) ? cap.Plugins : null;
  const push = plugins && isRecord(plugins.PushNotifications) ? plugins.PushNotifications : null;
  const usable =
    push !== null &&
    typeof push.register === "function" &&
    typeof push.addListener === "function" &&
    typeof push.checkPermissions === "function" &&
    typeof push.requestPermissions === "function";
  const appPlugin = plugins && isRecord(plugins.App) ? plugins.App : null;
  const appUsable =
    appPlugin !== null &&
    typeof appPlugin.getLaunchUrl === "function" &&
    typeof appPlugin.addListener === "function";
  const tell = plugins && isRecord(plugins.Tell) ? plugins.Tell : null;
  const tellUsable =
    tell !== null &&
    typeof tell.takePending === "function" &&
    typeof tell.addListener === "function";
  return {
    platform,
    push: usable ? (push as unknown as PushPlugin) : null,
    app: appUsable ? (appPlugin as unknown as AppPlugin) : null,
    tell: tellUsable ? (tell as unknown as TellPlugin) : null,
  };
}

/** The sentence out of a `takePending` answer or an `utterance` event, or null. */
export function utteranceFrom(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const said = payload.utterance;
  if (typeof said !== "string") return null;
  const trimmed = said.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * THE SHORTCUT'S OWN ADDRESS. Long-pressing the app icon fires this, and the
 * web is what decides it means "open already listening".
 *
 * A CUSTOM SCHEME rather than an https url, and the reason is not taste: a
 * shortcut firing `https://yosherapp.com/...` opens the phone's BROWSER unless
 * the app has verified App Links, which needs an `assetlinks.json` carrying
 * the signing certificate's fingerprint — and the debug key and the Play key
 * have different ones, so it would work for exactly one of the two builds
 * anybody is holding. A scheme the app owns has none of that.
 */
export const TELL_URL = "yosher://tell";

/**
 * Does this url mean "start listening"? Pure, and deliberately generous about
 * SHAPE and strict about meaning.
 *
 * Two spellings, because two doors will use it: the app's shortcut fires
 * `yosher://tell`, and anything web-side — a bookmark, a future Siri intent
 * handing over to the site — can reach the same place with `?tell=1` on any
 * dashboard url. Recognising both here is what stops the second door needing
 * a second mechanism.
 */
export function urlWantsToTell(url: unknown): boolean {
  if (typeof url !== "string" || url === "") return false;
  const lower = url.toLowerCase();
  if (lower === TELL_URL || lower.startsWith(`${TELL_URL}?`) || lower.startsWith(`${TELL_URL}/`)) {
    return true;
  }
  // `?tell=1` on an ordinary page. Parsed rather than matched as a substring,
  // so a customer called "tell=1" in a search query never opens a microphone.
  try {
    const parsed = new URL(url, "https://yosherapp.com");
    return parsed.searchParams.get("tell") === "1";
  } catch {
    return false;
  }
}

/** The tap on a notification carries `data.url`; anything else lands on the day's page. */
export function urlFromNotificationAction(payload: unknown): string {
  if (isRecord(payload) && isRecord(payload.notification) && isRecord(payload.notification.data)) {
    const url = payload.notification.data.url;
    if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) return url;
  }
  return "/dashboard/today";
}

/** The `registration` event's token, or null for a payload that has none. */
export function tokenFromRegistration(payload: unknown): string | null {
  if (isRecord(payload) && typeof payload.value === "string" && payload.value.length >= 16) {
    return payload.value;
  }
  return null;
}
