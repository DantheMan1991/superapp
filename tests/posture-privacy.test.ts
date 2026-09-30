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
  [/\.objectStore\s*\(/, "storage"],
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
  "src/modules/fitness/posture/components/posture-check.tsx": ["a picture made into a URL"],
  // The one database a check keeps on the phone (slice 2): each check's
  // numbers, and the photos a person chose to keep. The browser's own storage
  // for this site, never sent, never the gallery (ADR 0118).
  "src/modules/fitness/posture/store/db.ts": ["storage"],
  // Reads, lists and deletes those for the report, filtered to the signed-in
  // personal space. Sends nothing.
  "src/modules/fitness/posture/store/checks.ts": ["storage"],
  // A kept photo: one frame per view, made a JPEG and written into that
  // database by the worker itself, so no picture crosses to the page by message.
  "src/modules/fitness/posture/worker/photo-writer.ts": ["storage", "a picture made into a file"],
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

  it("keeps a photo only when the person turned photos on, and only from the worker", () => {
    const text = (end: string) => all.find((f) => f.path.endsWith(end))!.text;
    // The check asks for a photo in one place, behind the person's switch.
    const session = text("client/check-session.ts");
    expect(session.match(/this\.keepViewPhoto\(/g)).toHaveLength(1);
    expect(session).toMatch(/if \(this\.photosOn && [^\n]*\) await this\.keepViewPhoto\(/);
    // The switch is the person's, set before the check starts; nothing turns it on after.
    expect(session).toMatch(/this\.photosOn = check\.keepPhotos;/);
    expect(session.match(/this\.photosOn = true/g)).toBeNull();
    expect(session.match(/type: "photo"/g)).toHaveLength(1);
    // The worker keeps one only when asked, from the frame it is reading.
    const worker = text("worker/posture.worker.ts");
    expect(worker.match(/keepPhoto\(/g)).toHaveLength(1);
    expect(worker).toMatch(/if \(pendingPhoto\) \{/);
    // And nothing else in the posture code makes a picture into a file.
    expect(all.filter((f) => /convertToBlob|toBlob\s*\(/.test(f.text)).map((f) => f.path)).toEqual([
      "src/modules/fitness/posture/worker/photo-writer.ts",
    ]);
  });

  it("never leaves an abandoned check's photos behind for long", () => {
    const session = all.find((f) => f.path.endsWith("client/check-session.ts"))!.text;
    // The lock is taken before the check is written, so no sweep sees one without it.
    expect(session).toMatch(/this\.releaseLock = holdCheckLock\(this\.check\.id\);\s*try \{\s*await saveCheck\(this\.record\("running"\)\);/);
    // Both screens that open after a check was left sweep it up.
    for (const screen of ["components/posture-check.tsx", "components/checks-on-phone.tsx"]) {
      expect(all.find((f) => f.path.endsWith(screen))!.text, screen).toMatch(/sweepAbandoned\(owner\)/);
    }
  });

  it("reads a kept photo back only for the personal space that took it", () => {
    const store = all.find((f) => f.path.endsWith("store/checks.ts"))!.text;
    expect(store).toMatch(/export async function readPhotos\(owner: string, checkId: string\)[^{]*\{\s*const check = await getCheck\(owner, checkId\);\s*if \(!check\) return \[\];/);
    expect(store).toMatch(/check && check\.owner === owner/);
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
