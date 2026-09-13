import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listeningFrom,
  readNativeBridge,
  TELL_URL,
  urlWantsToTell,
  utteranceFrom,
} from "../src/lib/native-bridge";

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

describe("the sentence the phone heard before the page existed", () => {
  it("takes the words out of either shape the shell sends", () => {
    // `takePending()` resolves with one; the "utterance" event carries one.
    expect(utteranceFrom({ utterance: "clock me in" })).toBe("clock me in");
    expect(utteranceFrom({ utterance: "  three chicks dead  " })).toBe(
      "three chicks dead",
    );
  });

  it("is null for nothing waiting, which is the ordinary answer", () => {
    // Every launch that is not a long-press answers this way.
    expect(utteranceFrom({ utterance: null })).toBeNull();
    expect(utteranceFrom({})).toBeNull();
    expect(utteranceFrom(null)).toBeNull();
    expect(utteranceFrom(undefined)).toBeNull();
  });

  it("is null for a recogniser that heard only silence", () => {
    expect(utteranceFrom({ utterance: "" })).toBeNull();
    expect(utteranceFrom({ utterance: "   " })).toBeNull();
  });

  it("is null for anything that is not a sentence", () => {
    expect(utteranceFrom({ utterance: 42 })).toBeNull();
    expect(utteranceFrom({ utterance: ["clock me in"] })).toBeNull();
    expect(utteranceFrom("clock me in")).toBeNull();
  });
});

describe("the shell's own ears", () => {
  const nativeWindow = (plugins: Record<string, unknown>) => ({
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => "android",
      Plugins: plugins,
    },
  });

  it("is found when the build carries a usable hatch", () => {
    expect(
      readNativeBridge(
        nativeWindow({ Tell: { takePending: () => {}, addListener: () => {} } }),
      )?.tell,
    ).not.toBeNull();
  });

  it("is null on an older build, which is what keeps the web recorder working", () => {
    // THE WHOLE REASON THIS IS A RUNTIME PROBE. A phone two releases behind
    // has no native capture, and its shortcut must still fall back to the
    // web's own microphone rather than waiting for words that never come.
    expect(readNativeBridge(nativeWindow({}))?.tell).toBeNull();
    expect(readNativeBridge(nativeWindow({ Tell: {} }))?.tell).toBeNull();
    expect(
      readNativeBridge(nativeWindow({ Tell: { takePending: () => {} } }))?.tell,
    ).toBeNull();
  });
});

describe("whether the phone is recording right now", () => {
  it("is true only when the shell says so in as many words", () => {
    expect(listeningFrom({ listening: true })).toBe(true);
  });

  it("is false for absent, which is what an older shell sends", () => {
    // A build that never listens on its own sends no flag, and must not be
    // read as listening — the page would paint a live microphone over nothing.
    expect(listeningFrom({})).toBe(false);
    expect(listeningFrom({ utterance: "clock me in" })).toBe(false);
    expect(listeningFrom(null)).toBe(false);
    expect(listeningFrom(undefined)).toBe(false);
  });

  it("is false for anything truthy that is not exactly true", () => {
    // Strict, because the consequence of a false positive is a sheet that
    // shows "Listening…" forever over a microphone that is not open.
    expect(listeningFrom({ listening: "true" })).toBe(false);
    expect(listeningFrom({ listening: 1 })).toBe(false);
    expect(listeningFrom({ listening: false })).toBe(false);
  });
});
