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

export interface NativeBridge {
  platform: NativePlatform;
  /** Null when the shell does not carry the plugin (a build before push existed). */
  push: PushPlugin | null;
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
  return { platform, push: usable ? (push as unknown as PushPlugin) : null };
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
