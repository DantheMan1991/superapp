import { describe, expect, it } from "vitest";
import { LAUNCH_COOKIE, shouldShowLaunch } from "@/lib/launch";

/**
 * The launch plays once per app launch and never in a browser. The decision
 * is one line; the cost of getting it wrong is either a splash on every
 * page load or a blank blue screen for laptop users.
 */
describe("the launch", () => {
  it("plays inside the app until the launch cookie says it has played", () => {
    expect(shouldShowLaunch({ nativeApp: true, launchedCookie: null })).toBe(true);
    expect(shouldShowLaunch({ nativeApp: true, launchedCookie: undefined })).toBe(true);
    expect(shouldShowLaunch({ nativeApp: true, launchedCookie: "" })).toBe(true);
    expect(shouldShowLaunch({ nativeApp: true, launchedCookie: "1" })).toBe(false);
  });

  it("never plays in a browser, cookie or no cookie", () => {
    expect(shouldShowLaunch({ nativeApp: false, launchedCookie: null })).toBe(false);
    expect(shouldShowLaunch({ nativeApp: false, launchedCookie: "1" })).toBe(false);
  });

  it("names the cookie the overlay sets", () => {
    expect(LAUNCH_COOKIE).toBe("yosher_launched");
  });
});
