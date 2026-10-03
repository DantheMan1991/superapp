import { describe, expect, it } from "vitest";
import {
  appCanSaveFiles,
  appCanUseCamera,
  APP_CAMERA_VERSION,
  APP_FILES_VERSION,
  compareVersions,
  isNativeAppRequest,
  isNativeAppUserAgent,
  nativeAppEntryRedirect,
  nativeAppInfo,
} from "@/lib/native-app-core";
import { readNativeBridge } from "@/lib/native-bridge";

/**
 * The one question the web asks about the mobile app: am I inside it? The
 * answer decides whether purchase buttons and sign-up exist on a screen, so
 * a wrong "yes" hides a paying owner's billing and a wrong "no" ships a
 * store rejection.
 */

const shellUa =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 YosherApp/1.2.0 (ios)";

describe("isNativeAppUserAgent", () => {
  it("recognises the shell's marker and nothing else", () => {
    expect(isNativeAppUserAgent(shellUa)).toBe(true);
    expect(isNativeAppUserAgent("Mozilla/5.0 (iPhone) Safari/605.1.15")).toBe(false);
    expect(isNativeAppUserAgent("Mozilla/5.0 YosherAppetizer/1.0")).toBe(false);
    expect(isNativeAppUserAgent(null)).toBe(false);
    expect(isNativeAppUserAgent(undefined)).toBe(false);
  });
});

describe("nativeAppInfo", () => {
  it("reads the version and platform the shell reports", () => {
    expect(nativeAppInfo(shellUa)).toEqual({ version: "1.2.0", platform: "ios" });
    expect(nativeAppInfo("Something YosherApp/2.0 (Android)")).toEqual({
      version: "2.0",
      platform: "android",
    });
  });

  it("tolerates a marker without a platform, and is null outside the app", () => {
    expect(nativeAppInfo("YosherApp/1.0")).toEqual({ version: "1.0", platform: null });
    expect(nativeAppInfo("Mozilla/5.0")).toBeNull();
  });
});

describe("nativeAppEntryRedirect", () => {
  it("sends the app, and only the app, from the front page to the dashboard", () => {
    expect(nativeAppEntryRedirect("/", shellUa)).toBe("/dashboard");
    expect(nativeAppEntryRedirect("/", "Mozilla/5.0 (iPhone) Safari/605.1.15")).toBeNull();
    expect(nativeAppEntryRedirect("/about", shellUa)).toBeNull();
    expect(nativeAppEntryRedirect("/dashboard", shellUa)).toBeNull();
    expect(nativeAppEntryRedirect("/", null)).toBeNull();
  });
});

describe("isNativeAppRequest", () => {
  it("answers yes for the shell's user agent or the laptop cookie", () => {
    expect(isNativeAppRequest({ userAgent: shellUa })).toBe(true);
    expect(isNativeAppRequest({ userAgent: "Mozilla/5.0", cookie: "1" })).toBe(true);
    expect(isNativeAppRequest({ userAgent: "Mozilla/5.0", cookie: " 1 " })).toBe(true);
  });

  it("answers no for a browser, an empty cookie, or any other cookie value", () => {
    expect(isNativeAppRequest({ userAgent: "Mozilla/5.0" })).toBe(false);
    expect(isNativeAppRequest({ userAgent: "Mozilla/5.0", cookie: "" })).toBe(false);
    expect(isNativeAppRequest({ userAgent: "Mozilla/5.0", cookie: "true" })).toBe(false);
    expect(isNativeAppRequest({})).toBe(false);
  });
});

/**
 * WHICH APP CAN USE THE CAMERA (docs/modules/mobile-app.md, 1.0.8): an older
 * build never declared it, so Android refuses it with no dialog, and the
 * posture check must tell that person to update rather than to allow.
 */
describe("the camera in the app", () => {
  it("compares versions as numbers, part by part", () => {
    expect(compareVersions("1.0.8", "1.0.8")).toBe(0);
    expect(compareVersions("1.0.10", "1.0.8")).toBeGreaterThan(0);
    expect(compareVersions("1.0.7", "1.0.8")).toBeLessThan(0);
    expect(compareVersions("1.1", "1.0.9")).toBeGreaterThan(0);
    expect(compareVersions("2", "1.9.9")).toBeGreaterThan(0);
  });

  it("knows a build before 1.0.8 cannot, and a browser is not the question", () => {
    expect(APP_CAMERA_VERSION).toBe("1.0.8");
    expect(appCanUseCamera(nativeAppInfo("Mozilla/5.0 YosherApp/1.0.7 (android)"))).toBe(false);
    expect(appCanUseCamera(nativeAppInfo("Mozilla/5.0 YosherApp/1.0.8 (android)"))).toBe(true);
    expect(appCanUseCamera(nativeAppInfo("Mozilla/5.0 YosherApp/1.0.12 (android)"))).toBe(true);
    expect(appCanUseCamera({ version: null, platform: "android" })).toBe(false);
    expect(appCanUseCamera(null)).toBe(true);
  });
});

describe("saving a file in the app", () => {
  const nativeWindow = (plugins: Record<string, unknown>) => ({
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: plugins },
  });

  it("is 1.0.9 and later; a browser saves through its own download", () => {
    expect(APP_FILES_VERSION).toBe("1.0.9");
    expect(appCanSaveFiles(nativeAppInfo("Mozilla/5.0 YosherApp/1.0.8 (android)"))).toBe(false);
    expect(appCanSaveFiles(nativeAppInfo("Mozilla/5.0 YosherApp/1.0.9 (android)"))).toBe(true);
    expect(appCanSaveFiles(nativeAppInfo("Mozilla/5.0 YosherApp/1.0.10 (android)"))).toBe(true);
    expect(appCanSaveFiles({ version: null, platform: "android" })).toBe(false);
    expect(appCanSaveFiles(null)).toBe(true);
  });

  it("finds the shell's file plugin only when it can write", () => {
    const files = { writeFile: async () => ({ uri: "file:///x" }) };
    expect(readNativeBridge(nativeWindow({ Filesystem: files }))?.files).toBe(files);
    expect(readNativeBridge(nativeWindow({}))?.files).toBeNull();
    expect(readNativeBridge(nativeWindow({ Filesystem: { readFile: async () => ({}) } }))?.files).toBeNull();
  });
});

describe("the shell's privacy screen and keep-awake", () => {
  const nativeWindow = (plugins: Record<string, unknown>) => ({
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android", Plugins: plugins },
  });

  it("finds each only when the shell carries all of its methods", () => {
    const privacy = { enable: async () => ({}), disable: async () => ({}) };
    const keepAwake = { keepAwake: async () => {}, allowSleep: async () => {} };
    const bridge = readNativeBridge(nativeWindow({ PrivacyScreen: privacy, KeepAwake: keepAwake }));
    expect(bridge?.privacy).toBe(privacy);
    expect(bridge?.keepAwake).toBe(keepAwake);
    // A build before 1.0.8, or a half-built shell: nothing to call.
    expect(readNativeBridge(nativeWindow({}))?.privacy).toBeNull();
    expect(readNativeBridge(nativeWindow({ PrivacyScreen: { enable: async () => ({}) } }))?.privacy).toBeNull();
    expect(readNativeBridge(nativeWindow({ KeepAwake: { keepAwake: async () => {} } }))?.keepAwake).toBeNull();
  });
});
