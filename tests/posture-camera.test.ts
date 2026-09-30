import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POSE_MODELS, POSE_MODEL_NAMES, TASKS_VISION_VERSION } from "../src/modules/fitness/posture/core/assets";
import { lockPlan, parseCameraLabel, rankCameras, streamConstraints, type CameraInfo } from "../src/modules/fitness/posture/core/camera";
import { allSetupLines, missingLine } from "../src/modules/fitness/posture/core/lines";
import { emptyReadout, readoutText } from "../src/modules/fitness/posture/core/readout";
import { STICKERS } from "../src/modules/fitness/posture/core/sticker-map";
import { RECORD_BATCH_MAX, recordRequestSchema } from "../src/lib/speech/voices";

/**
 * THE POSTURE CHECK'S PLUMBING (docs/modules/posture.md): the camera it picks,
 * the model files it serves, the lines it says and the readout it hands over.
 */

const cam = (over: Partial<CameraInfo>): CameraInfo => ({
  deviceId: "x",
  label: "",
  facing: "back",
  index: null,
  maxWidth: 4000,
  maxHeight: 3000,
  torch: false,
  zoomMax: null,
  focusModes: [],
  exposureModes: [],
  whiteBalanceModes: [],
  ...over,
});

describe("choosing the camera", () => {
  it("reads Chrome's labels, old and new", () => {
    expect(parseCameraLabel("camera2 0, facing back")).toEqual({ index: 0, facing: "back" });
    expect(parseCameraLabel("camera 2, facing back")).toEqual({ index: 2, facing: "back" });
    expect(parseCameraLabel("camera2 1, facing front")).toEqual({ index: 1, facing: "front" });
    expect(parseCameraLabel("FaceTime HD Camera")).toEqual({ index: null, facing: "unknown" });
  });

  it("picks the main lens, never the ultrawide Chrome's own `environment` would open", () => {
    // A Samsung lists back cameras highest-number first; facingMode picks the first.
    const ranked = rankCameras([
      cam({ deviceId: "wide", label: "camera 2, facing back", index: 2, maxWidth: 4000, maxHeight: 3000 }),
      cam({ deviceId: "selfie", label: "camera 1, facing front", index: 1, facing: "front" }),
      cam({ deviceId: "main", label: "camera 0, facing back", index: 0, torch: true, maxWidth: 4000, maxHeight: 3000 }),
    ]);
    expect(ranked[0].deviceId).toBe("main");
    expect(ranked.map((c) => c.deviceId)).not.toContain("selfie");
    expect(ranked[0].why.join(" ")).toMatch(/main lens/);
  });

  it("still picks something on a laptop whose one camera says nothing about itself", () => {
    const ranked = rankCameras([cam({ deviceId: "only", label: "Integrated Webcam", facing: "unknown", index: null })]);
    expect(ranked[0].deviceId).toBe("only");
  });

  it("asks the chosen camera for its whole 4K picture, unscaled", () => {
    const c = streamConstraints("main");
    expect(c.audio).toBe(false);
    expect(c.video).toMatchObject({ deviceId: { exact: "main" }, width: { ideal: 3840 }, resizeMode: "none" });
    // Never alongside facingMode: on a Samsung that can override the id.
    expect(c.video).not.toHaveProperty("facingMode");
  });

  it("locks what the camera can lock, and exposure only with its ISO read back", () => {
    expect(
      lockPlan(
        { whiteBalanceMode: ["continuous", "manual"], focusMode: ["manual", "continuous"], exposureMode: ["continuous", "manual"] },
        { focusDistance: 3.1, iso: 200, exposureTime: 166 },
      ),
    ).toEqual({ whiteBalance: true, focus: { distance: 3.1 }, exposure: { iso: 200, exposureTime: 166 } });
    expect(lockPlan({ exposureMode: ["manual"] }, { exposureTime: 166 }).exposure).toBeNull();
    expect(lockPlan({}, {})).toEqual({ whiteBalance: false, focus: null, exposure: null });
  });
});

describe("the pose model's files", () => {
  it("serves the version that is installed", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@mediapipe/tasks-vision"]).toBe(TASKS_VISION_VERSION);
  });

  it("names each model file by its pinned hash, so a path never changes what it serves", () => {
    for (const name of POSE_MODEL_NAMES) {
      const m = POSE_MODELS[name];
      expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(m.path).toContain(m.sha256.slice(0, 12));
      expect(m.path.startsWith("/pose/models/")).toBe(true);
      expect(m.source.startsWith("https://storage.googleapis.com/mediapipe-models/")).toBe(true);
    }
  });
});

describe("what the check says", () => {
  it("fits the recorded voice's request rules, a batch at a time", () => {
    const lines = allSetupLines();
    expect(new Set(lines).size).toBe(lines.length);
    for (let i = 0; i < lines.length; i += RECORD_BATCH_MAX) {
      expect(recordRequestSchema.safeParse({ voice: "arcas", lines: lines.slice(i, i + RECORD_BATCH_MAX) }).success).toBe(true);
    }
  });

  it("names a missing sticker in plain words", () => {
    expect(missingLine(STICKERS.find((s) => s.id === "right-front-hip")!)).toBe(
      "I can't find the right front hip bone sticker.",
    );
  });
});

describe("the readout", () => {
  const base = () =>
    emptyReadout(new Date("2026-09-30T12:00:00Z"), {
      userAgent: "Mozilla/5.0 (Linux; Android 16; SM-S938B) Chrome/154",
      screen: "412x891",
      pixelRatio: 3.5,
      cores: 8,
      memoryGb: 8,
    });

  it("rounds numbers and drops what is not a number", () => {
    const r = base();
    r.plumb = { found: true, roll: 0.123456, rmsPx: Number.NaN, coverage: 0.9, pxPerMetre: 891.23456, marks: 2 };
    const text = readoutText(r);
    expect(text).toContain('"roll": 0.123');
    expect(text).toContain('"rmsPx": null');
    expect(JSON.parse(text).version).toBe(1);
  });

  it("refuses anything picture-shaped", () => {
    const withUrl = base();
    withUrl.notes.push("data:image/png;base64,AAAA");
    expect(() => readoutText(withUrl)).toThrow(/picture/);
    const withLong = base();
    withLong.notes.push("x".repeat(5000));
    expect(() => readoutText(withLong)).toThrow(/characters/);
    const withPixels = base() as unknown as { notes: unknown[] };
    withPixels.notes.push(new Uint8Array(10));
    expect(() => readoutText(withPixels as never)).toThrow(/binary/);
  });
});
