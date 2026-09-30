import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A POSTURE CHECK'S PICTURES NEVER LEAVE THE PHONE (ADR 0118), held to the
 * code by reading it: nothing under `src/modules/fitness/posture/` or the
 * posture pages may reach the network, store a picture, or record one. The
 * worker is the only place frames are read, and it posts through one `send`
 * that refuses anything binary.
 *
 * A token found here is a failure until it is argued for in the ADR and
 * listed below with its reason, so the next change to this area meets the
 * rule rather than rediscovering it.
 */

const ROOTS = ["src/modules/fitness/posture", "src/app/personal/(space)/m/fitness/posture"];

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

/** Ways out, and ways to keep a picture. */
const FORBIDDEN: [RegExp, string][] = [
  [/\bfetch\s*\(/, "network"],
  [/XMLHttpRequest/, "network"],
  [/sendBeacon/, "network"],
  [/\bWebSocket\b/, "network"],
  [/\bEventSource\b/, "network"],
  [/\bindexedDB\b/, "storage"],
  [/\bcaches\s*\.\s*open/, "storage"],
  [/sessionStorage/, "storage"],
  [/localStorage/, "storage"],
  [/toDataURL|toBlob\s*\(|convertToBlob/, "a picture made into a file"],
  [/\bMediaRecorder\b/, "recording"],
  [/takePhoto|grabFrame/, "a photograph"],
  [/navigator\.share|window\.open/, "sharing"],
  [/\bnew Image\s*\(|createObjectURL/, "a picture made into a URL"],
];

/** Each exception, and why it is not a way out. */
const ALLOWED: Record<string, string[]> = {
  // The phone's own settings: which lens is the main one, the sensor's offset,
  // the last readout (numbers only). Never a picture.
  "src/modules/fitness/posture/client/device-settings.ts": ["storage"],
  // Development only (testSources is false in production): a local picture or
  // film read into the page to stand in for the camera. It is never sent.
  "src/modules/fitness/posture/components/setup-check.tsx": ["a picture made into a URL"],
};

describe("the posture check's code", () => {
  it("is where the rule looks", () => {
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((f) => f.path.endsWith("worker/posture.worker.ts"))).toBe(true);
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

  it("posts from the worker only through the one `send` that refuses binary data", () => {
    const worker = all.find((f) => f.path.endsWith("worker/posture.worker.ts"))!.text;
    expect(worker.match(/postMessage\s*\(/g)).toHaveLength(1);
    expect(worker).toMatch(/function send\(message: FromWorker\): void \{\s*if \(hasBinary\(message\)\) throw/);
  });

  it("closes every frame it reads", () => {
    const worker = all.find((f) => f.path.endsWith("worker/posture.worker.ts"))!.text;
    // Every path out of the frame loop closes the frame or the bitmap.
    expect(worker.match(/frame\.close\(\)/g)!.length).toBeGreaterThanOrEqual(2);
    expect(worker.match(/bitmap\.close\(\)/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it("loads the pose model's library and models from this site, never from anyone else's", () => {
    // core/assets.ts names Google's model store as where the BUILD downloads
    // from (scripts/copy-pose-assets.ts); nothing the phone runs may.
    const shipped = all.filter((f) => !f.path.endsWith("core/assets.ts"));
    for (const f of shipped) expect(f.text, f.path).not.toMatch(/https?:\/\//);
    const assets = all.find((f) => f.path.endsWith("core/assets.ts"))!.text;
    expect(assets).toMatch(/POSE_BASE = `\/pose\//);
    expect(assets).toMatch(/path: `\/pose\/models\//);
  });
});
