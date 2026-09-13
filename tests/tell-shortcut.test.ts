import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readNativeBridge, TELL_URL, urlWantsToTell } from "../src/lib/native-bridge";

/**
 * One tap from the home screen: long-press the icon and the app opens already
 * listening.
 *
 * The shell declares the door and the WEB decides what it means (ADR 0032), so
 * everything worth testing is either this pure rule or a string in the
 * manifest — and both matter, because the two halves are in different
 * packages and nothing else makes them agree.
 */

const shell = (...parts: string[]) =>
  path.join(process.cwd(), "mobile", "android", "app", "src", "main", ...parts);

/**
 * The manifest WITHOUT its comments.
 *
 * Asserting "this file does not contain X" against a file that EXPLAINS why it
 * does not contain X is a trap, and this test fell in it immediately: the
 * comment beside the meta-data spells out the `<data>` element that is
 * deliberately absent, so the naive check failed on the reason for its own
 * existence. Strip the prose and ask the markup.
 */
const markupOf = (file: string) =>
  readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");

describe("what means start listening", () => {
  it("recognises the shortcut's own url", () => {
    expect(urlWantsToTell(TELL_URL)).toBe(true);
    expect(urlWantsToTell("yosher://tell")).toBe(true);
    expect(urlWantsToTell("YOSHER://TELL")).toBe(true);
    expect(urlWantsToTell("yosher://tell?from=shortcut")).toBe(true);
  });

  it("recognises the web spelling, so a second door needs no second mechanism", () => {
    expect(urlWantsToTell("/dashboard?tell=1")).toBe(true);
    expect(urlWantsToTell("https://yosherapp.com/dashboard/today?tell=1")).toBe(true);
    expect(urlWantsToTell("https://yosherapp.com/dashboard?a=b&tell=1")).toBe(true);
  });

  it("does NOT open a microphone because a page mentions the word", () => {
    // Parsed rather than matched as a substring. A customer named "tell=1", a
    // search for "tell", a document called `tell=1.pdf` — none of these are a
    // request to start recording, and a substring check would say they were.
    expect(urlWantsToTell("https://yosherapp.com/dashboard/m/crm?q=tell%3D1")).toBe(false);
    expect(urlWantsToTell("https://yosherapp.com/dashboard/tell=1")).toBe(false);
    expect(urlWantsToTell("https://yosherapp.com/dashboard?tell=0")).toBe(false);
    expect(urlWantsToTell("https://yosherapp.com/dashboard?tell=true")).toBe(false);
    expect(urlWantsToTell("yosher://something-else")).toBe(false);
  });

  it("is false for everything that is not a url", () => {
    expect(urlWantsToTell(null)).toBe(false);
    expect(urlWantsToTell(undefined)).toBe(false);
    expect(urlWantsToTell("")).toBe(false);
    expect(urlWantsToTell(42)).toBe(false);
    expect(urlWantsToTell({ url: TELL_URL })).toBe(false);
  });
});

describe("the bridge finds the App plugin, or does not", () => {
  const nativeWindow = (plugins: Record<string, unknown>) => ({
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: plugins,
    },
  });

  it("offers the plugin when the shell carries a usable one", () => {
    const bridge = readNativeBridge(
      nativeWindow({ App: { getLaunchUrl: () => {}, addListener: () => {} } }),
    );
    expect(bridge?.app).not.toBeNull();
  });

  it("is null on a build from before the shortcut existed", () => {
    // The web has to keep working on every app version still installed. An
    // older shell has no App plugin and simply has no shortcut — the floating
    // button is untouched.
    expect(readNativeBridge(nativeWindow({}))?.app).toBeNull();
    expect(readNativeBridge(nativeWindow({ App: {} }))?.app).toBeNull();
    expect(
      readNativeBridge(nativeWindow({ App: { getLaunchUrl: () => {} } }))?.app,
    ).toBeNull();
  });

  it("is nothing at all in a plain browser", () => {
    expect(readNativeBridge({})).toBeNull();
  });
});

describe("the shell declares the door", () => {
  it("the shortcut fires exactly the url the web listens for", () => {
    // THE ONE STRING TWO PACKAGES MUST AGREE ON. Nothing else would catch a
    // change to either side, and the symptom would be a long-press that opens
    // the app and does nothing.
    const shortcuts = readFileSync(shell("res", "xml", "shortcuts.xml"), "utf8");
    expect(shortcuts).toContain(`android:data="${TELL_URL}"`);
  });

  it("names the activity explicitly rather than publishing a scheme", () => {
    const shortcuts = readFileSync(shell("res", "xml", "shortcuts.xml"), "utf8");
    expect(shortcuts).toContain("android:targetClass");
    // No `<data android:scheme="yosher" />` filter: an explicit intent needs
    // none, and one would publish a door any app could knock on for nothing.
    expect(markupOf(shell("AndroidManifest.xml"))).not.toContain(
      'android:scheme="yosher"',
    );
  });

  it("is registered on the launcher activity, or Android never shows it", () => {
    const manifest = readFileSync(shell("AndroidManifest.xml"), "utf8");
    expect(manifest).toContain('android:name="android.app.shortcuts"');
    expect(manifest).toContain('android:resource="@xml/shortcuts"');
  });
});
