/**
 * WHAT THIS DEPLOYMENT CAN DRIVE A BROWSER WITH — pure, no imports, no
 * filesystem of its own (E5b, ADR 0084).
 *
 * Printing an HTML document needs a Chromium, and where that Chromium comes
 * from is the only thing that differs between a laptop and a serverless
 * function. So the whole difference is ONE pure function over the environment,
 * testable without a browser, and `print-html.ts` does nothing but obey it.
 *
 * **A laptop's own browser wins over a hosted pack.** Both can be configured
 * at once — a developer with `CHROMIUM_PACK_URL` in `.env` has the production
 * value on a machine that cannot run it — and downloading 50MB to launch a
 * Linux binary on Windows is never the right answer. In a function no local
 * browser exists, so the pack is what is left.
 */

/** The press, once resolved: a browser already here, one to fetch, or neither. */
export type Press =
  /** Serverless: `@sparticuz/chromium-min` inflates this pack into `/tmp`. */
  | { kind: "pack"; packUrl: string }
  /** A Chromium already on this machine — a developer's Chrome, or a container's. */
  | { kind: "local"; executablePath: string }
  /** Nothing to print with, and `why` is what to do about it. */
  | { kind: "none"; why: string };

/**
 * Where a Chromium usually is, per platform. Edge is listed because it is the
 * same engine and prints the same page, and on Windows it is the browser that
 * is always there.
 */
export function browserPaths(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {},
): string[] {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA;
    return [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      ...(local ? [`${local}/Google/Chrome/Application/chrome.exe`] : []),
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    ];
  }
  if (platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
}

/** What to set, named in the message, because "printing failed" helps nobody. */
export const PRESS_MISSING =
  "No browser to print with. Set CHROMIUM_PACK_URL to a hosted chromium pack " +
  "(a chromium-v*-pack.x64.tar, which is how this runs in production), or " +
  "PUPPETEER_EXECUTABLE_PATH to a Chrome or Edge on this machine.";

/**
 * `exists` is injected rather than imported so this stays pure: the test drives
 * every platform and every combination of variables without a filesystem, and
 * `print-html.ts` passes `existsSync`.
 */
export function pressFor(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
  exists: (path: string) => boolean,
): Press {
  // Named outright beats everything — it is somebody saying which browser.
  const named = env.PUPPETEER_EXECUTABLE_PATH?.trim() || env.CHROME_PATH?.trim() || "";
  if (named !== "" && exists(named)) return { kind: "local", executablePath: named };

  const found = browserPaths(platform, env).find(exists);
  if (found) return { kind: "local", executablePath: found };

  const packUrl = env.CHROMIUM_PACK_URL?.trim() || "";
  if (packUrl !== "") return { kind: "pack", packUrl };

  return { kind: "none", why: PRESS_MISSING };
}

/**
 * Thrown when there is no press at all, so a route can tell "this deployment
 * cannot print" from "the print failed" and answer differently. The first is a
 * configuration fact worth stating; the second is a bug worth logging.
 */
export class PrintUnavailableError extends Error {
  constructor(why: string) {
    super(why);
    this.name = "PrintUnavailableError";
  }
}
