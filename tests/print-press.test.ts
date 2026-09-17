import { describe, expect, it } from "vitest";
import { browserPaths, PRESS_MISSING, pressFor } from "../src/lib/pdf/print-press";

/**
 * WHICH BROWSER PRINTS A DOCUMENT (E5b, ADR 0084).
 *
 * The whole difference between a laptop and a serverless function is this one
 * function over the environment, so it is pinned here rather than discovered
 * in production — where the only symptom of getting it wrong is a proposal
 * that will not print, and the only place to see it is a log.
 *
 * `exists` is injected, so every platform and every combination of variables
 * is driven without a filesystem and without a browser.
 */

const NONE = () => false;
const ALL = () => true;
const only =
  (...paths: string[]) =>
  (p: string) =>
    paths.includes(p);

const CHROME_WIN = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const EDGE_WIN = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const CHROME_MAC = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHROME_LINUX = "/usr/bin/google-chrome";

describe("pressFor: the browser a deployment prints with", () => {
  it("takes a browser named outright", () => {
    const press = pressFor({ PUPPETEER_EXECUTABLE_PATH: "/opt/chrome" }, "linux", only("/opt/chrome"));
    expect(press).toEqual({ kind: "local", executablePath: "/opt/chrome" });
  });

  it("accepts CHROME_PATH under its other name", () => {
    const press = pressFor({ CHROME_PATH: "/opt/chrome" }, "linux", only("/opt/chrome"));
    expect(press).toEqual({ kind: "local", executablePath: "/opt/chrome" });
  });

  it("IGNORES a named browser that is not there, and keeps looking", () => {
    // A stale path in someone's .env must not make the whole feature dead.
    const press = pressFor({ PUPPETEER_EXECUTABLE_PATH: "/opt/gone" }, "linux", only(CHROME_LINUX));
    expect(press).toEqual({ kind: "local", executablePath: CHROME_LINUX });
  });

  it("treats a blank variable as unset", () => {
    expect(pressFor({ PUPPETEER_EXECUTABLE_PATH: "   ", CHROMIUM_PACK_URL: "  " }, "linux", NONE)).toEqual({
      kind: "none",
      why: PRESS_MISSING,
    });
  });

  it("finds the usual Chrome on each platform", () => {
    expect(pressFor({}, "win32", only(CHROME_WIN))).toEqual({ kind: "local", executablePath: CHROME_WIN });
    expect(pressFor({}, "darwin", only(CHROME_MAC))).toEqual({ kind: "local", executablePath: CHROME_MAC });
    expect(pressFor({}, "linux", only(CHROME_LINUX))).toEqual({ kind: "local", executablePath: CHROME_LINUX });
  });

  it("falls back to Edge on Windows, which is the browser that is always there", () => {
    expect(pressFor({}, "win32", only(EDGE_WIN))).toEqual({ kind: "local", executablePath: EDGE_WIN });
  });

  it("looks in the per-user install too, where Chrome lands without an admin", () => {
    const local = "C:/Users/dan/AppData/Local";
    const perUser = `${local}/Google/Chrome/Application/chrome.exe`;
    expect(pressFor({ LOCALAPPDATA: local }, "win32", only(perUser))).toEqual({
      kind: "local",
      executablePath: perUser,
    });
  });

  it("prefers Chrome over Edge when both are installed", () => {
    expect(pressFor({}, "win32", ALL)).toEqual({ kind: "local", executablePath: CHROME_WIN });
  });

  it("uses the hosted pack when there is no browser on the machine — the function's case", () => {
    const press = pressFor({ CHROMIUM_PACK_URL: "https://pack.example/chromium.tar" }, "linux", NONE);
    expect(press).toEqual({ kind: "pack", packUrl: "https://pack.example/chromium.tar" });
  });

  /**
   * THE PRECEDENCE THAT MATTERS. A developer who copies production's variables
   * into `.env` has a pack URL on a machine that cannot run a Linux binary.
   * The browser in front of them wins, or every local print downloads 50MB to
   * fail.
   */
  it("prefers a browser already here over a pack it would have to download", () => {
    const press = pressFor({ CHROMIUM_PACK_URL: "https://pack.example/chromium.tar" }, "win32", only(CHROME_WIN));
    expect(press).toEqual({ kind: "local", executablePath: CHROME_WIN });
  });

  it("says what to set when there is nothing at all", () => {
    const press = pressFor({}, "linux", NONE);
    expect(press.kind).toBe("none");
    // The message is the only diagnosis anyone gets, so it names both doors.
    expect(press.kind === "none" && press.why).toContain("CHROMIUM_PACK_URL");
    expect(press.kind === "none" && press.why).toContain("PUPPETEER_EXECUTABLE_PATH");
  });
});

describe("browserPaths", () => {
  it("names absolute paths only, so nothing is resolved against the working directory", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      for (const p of browserPaths(platform)) {
        expect(p, p).toMatch(platform === "win32" ? /^[A-Za-z]:\// : /^\//);
      }
    }
  });

  it("leaves the per-user path out when the variable that builds it is unset", () => {
    expect(browserPaths("win32", {}).some((p) => p.includes("AppData"))).toBe(false);
  });

  it("treats anything that is not Windows or macOS as the Linux layout", () => {
    expect(browserPaths("freebsd")).toEqual(browserPaths("linux"));
  });
});
