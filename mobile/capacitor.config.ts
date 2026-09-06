import { readFileSync } from "node:fs";
import path from "node:path";
import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Yosher mobile app: a native shell that loads yosherapp.com (ADR 0032,
 * docs/modules/mobile-app.md). Nothing of the product is bundled — only the
 * page shown when the site cannot be reached.
 *
 * app.json holds the few values the web repo's tests read too: the user
 * agent marker here must be the one src/lib/native-app-core.ts looks for,
 * or the app would show purchase buttons a reviewer will reject.
 */
// The CLI loads this file two ways: transpiled to CommonJS by TypeScript 5,
// where __dirname exists, or as a native ES module by Node when TypeScript 7
// is installed, where it does not and the working directory is this folder
// (npm scripts and the workflow both run here).
const here = typeof __dirname === "string" ? __dirname : process.cwd();
const app = JSON.parse(readFileSync(path.join(here, "app.json"), "utf8")) as {
  appId: string;
  appName: string;
  version: string;
  url: string;
  startPath: string;
  userAgentMarker: string;
};

const NAVY = "#13203e";

/** `YosherApp/1.0.0 (ios)` — the web reads the marker, and the platform when it matters. */
const userAgent = (platform: "ios" | "android") =>
  `${app.userAgentMarker}/${app.version} (${platform})`;

const config: CapacitorConfig = {
  appId: app.appId,
  appName: app.appName,
  webDir: "www",
  // The status bar strip on iOS and the moment before the site paints show
  // this; the site's own header is the same navy.
  backgroundColor: NAVY,
  server: {
    // The app opens on the dashboard: the sign-in card when signed out, the
    // business when signed in. The marketing landing page is for browsers.
    url: `${app.url}${app.startPath}`,
    // Bundled in www/, shown when the URL cannot be loaded — no network, or
    // the site is down. "Try again" on it reloads the site.
    errorPath: "offline.html",
    // Clerk's own hosts are the only other places the webview may go. Every
    // other link — a customer's marketing site, a document a share link
    // points at — opens in the phone's browser.
    allowNavigation: ["clerk.yosherapp.com", "accounts.yosherapp.com"],
  },
  ios: {
    appendUserAgent: userAgent("ios"),
    // Keep the page below the status bar. The site does not yet pad for a
    // notch itself; when it does, this becomes "never" and the header runs
    // under the status bar in the site's own navy.
    contentInset: "always",
  },
  android: {
    appendUserAgent: userAgent("android"),
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: NAVY,
      showSpinner: false,
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: NAVY,
    },
    // A notification that arrives while the app is open still shows, with
    // sound and badge; the digest is a morning event, not a chat.
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
