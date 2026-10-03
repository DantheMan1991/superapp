import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRESS PHOTOS NEVER LEAVE THE PHONE (ADR 0128), held to the code by
 * reading it, as the posture check's are (`posture-privacy.test.ts`, ADR
 * 0118): nothing under `src/modules/health/photos/` or the photo pages may
 * reach the network, call a server action, or keep or turn a picture into a
 * file or an address, but for the files listed with their reasons.
 *
 * The countdown's voice reaches this site through the shared speech code
 * (`src/lib/speech/clips.ts`), which sends words, never a picture, and is not
 * in this folder. A token found here is a failure until it is argued for in
 * the ADR and listed below.
 */

const ROOTS = ["src/modules/health/photos", "src/app/personal/(space)/m/health/photos"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const all = ROOTS.flatMap(files).map((path) => ({
  path: relative(".", path).replaceAll("\\", "/"),
  text: readFileSync(path, "utf8"),
}));

/** Ways out, and ways to keep or hand on a picture. */
const FORBIDDEN: [RegExp, string][] = [
  [/\bfetch\s*\(/, "network"],
  [/XMLHttpRequest/, "network"],
  [/sendBeacon/, "network"],
  [/\bWebSocket\b/, "network"],
  [/\bEventSource\b/, "network"],
  [/["']use server["']|\/actions["']/, "a server action"],
  [/\bindexedDB\b/, "storage"],
  [/\.objectStore\s*\(/, "storage"],
  [/\bcaches\s*\.\s*open/, "storage"],
  [/sessionStorage/, "storage"],
  [/localStorage/, "storage"],
  [/toDataURL|toBlob\s*\(|convertToBlob/, "a picture made into a file"],
  [/\bMediaRecorder\b/, "recording"],
  [/takePhoto|grabFrame/, "a photograph"],
  [/navigator\.share|window\.open/, "sharing"],
  [/\bnew Image\s*\(|createObjectURL|readAsDataURL/, "a picture made into an address"],
  [/writeFile/, "a file written"],
];

/** Each exception, and why it is not a way out. */
const ALLOWED: Record<string, string[]> = {
  // The one database the photos are kept in: the browser's own storage for
  // this site, each record under the personal space it belongs to. Never sent,
  // never the gallery.
  "src/modules/health/photos/store.ts": ["storage"],
  // The one place a frame becomes a JPEG: drawn from the camera's picture onto
  // a canvas no one sees, then handed to the review on screen.
  "src/modules/health/photos/capture.ts": ["a picture made into a file"],
  // "Save a copy", the founder's call: on his tap, one photo onto this phone's
  // own files. A browser's download needs an address for the file, revoked
  // after; inside the app the shell writes it into Documents.
  "src/modules/health/photos/save-copy.ts": ["a picture made into an address", "a file written"],
};

describe("the progress photos' code", () => {
  it("is where the rule looks", () => {
    expect(all.length).toBeGreaterThanOrEqual(10);
    expect(all.some((f) => f.path.endsWith("photos/photo-take.tsx"))).toBe(true);
    expect(all.some((f) => f.path.endsWith("photos/take/page.tsx"))).toBe(true);
  });

  for (const [pattern, what] of FORBIDDEN) {
    it(`has no ${what} (${pattern.source})`, () => {
      const offenders = all
        .filter((f) => pattern.test(f.text))
        .filter((f) => !(ALLOWED[f.path] ?? []).includes(what))
        .map((f) => f.path);
      expect(offenders).toEqual([]);
    });
  }

  it("lists no exception for a file that no longer needs it", () => {
    for (const [path, whats] of Object.entries(ALLOWED)) {
      const file = all.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      for (const what of whats) {
        const needs = FORBIDDEN.filter(([, w]) => w === what).some(([pattern]) => pattern.test(file?.text ?? ""));
        expect(needs, `${path}: ${what}`).toBe(true);
      }
    }
  });

  it("saves a copy only from a person's tap, in one file, and revokes the address it made", () => {
    const save = all.find((f) => f.path === "src/modules/health/photos/save-copy.ts")?.text ?? "";
    expect(save).toMatch(/revokeObjectURL/);
    const callers = all.filter((f) => /\bsaveCopy\s*\(/.test(f.text)).map((f) => f.path);
    expect(callers.sort()).toEqual(["src/modules/health/photos/photo-compare.tsx", "src/modules/health/photos/save-copy.ts"]);
  });

  it("keeps its countdown's voice to words: the photos' own voice file sends nothing itself", () => {
    const voice = all.find((f) => f.path === "src/modules/health/photos/voice.ts")?.text ?? "";
    expect(voice).toMatch(/@\/lib\/speech\/clips/);
    expect(voice).not.toMatch(/\bfetch\s*\(|Blob|canvas/i);
  });
});
