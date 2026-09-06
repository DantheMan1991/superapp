import { describe, expect, it } from "vitest";
import {
  isNativeAppRequest,
  isNativeAppUserAgent,
  nativeAppInfo,
} from "@/lib/native-app-core";

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
