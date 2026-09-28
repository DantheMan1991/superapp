import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECORDED_VOICE,
  isRecordedVoice,
  packClips,
  RECORD_BATCH_MAX,
  RECORD_LINE_MAX,
  RECORDED_VOICES,
  recordRequestSchema,
  unpackClips,
} from "../src/lib/speech/voices";

/**
 * THE RECORDED VOICES' CONTRACT (ADR 0115; docs/modules/fitness.md, F2d): what
 * the workout may ask the route for, and the shape the recordings come back
 * in. The route's bounds are the cost's bounds, so they are pinned here.
 */

const bytes = (...values: number[]) => new Uint8Array(values);

describe("the voices on offer", () => {
  it("starts with the founder's choice, Arcas, which is one of them", () => {
    expect(DEFAULT_RECORDED_VOICE).toBe("arcas");
    expect(RECORDED_VOICES.map((voice) => voice.id)).toEqual(["arcas", "orion", "helena", "vesta"]);
    expect(isRecordedVoice(DEFAULT_RECORDED_VOICE)).toBe(true);
  });

  it("knows a voice it offers from anything else a phone might have kept", () => {
    expect(isRecordedVoice("vesta")).toBe(true);
    expect(isRecordedVoice("harmonia")).toBe(false);
    expect(isRecordedVoice("Arcas")).toBe(false);
    expect(isRecordedVoice(null)).toBe(false);
    expect(isRecordedVoice(3)).toBe(false);
  });
});

describe("what a request may ask for", () => {
  it("takes a voice and the lines, trimmed", () => {
    const parsed = recordRequestSchema.parse({ voice: "orion", lines: ["  Last one. ", "Exercise done."] });
    expect(parsed).toEqual({ voice: "orion", lines: ["Last one.", "Exercise done."] });
  });

  it("refuses a voice not on offer", () => {
    expect(recordRequestSchema.safeParse({ voice: "harmonia", lines: ["Last one."] }).success).toBe(false);
  });

  it("refuses nothing to say, an empty line, and more lines or longer ones than a session has", () => {
    const ok = (lines: unknown) => recordRequestSchema.safeParse({ voice: "arcas", lines }).success;
    expect(ok([])).toBe(false);
    expect(ok(["   "])).toBe(false);
    expect(ok(Array.from({ length: RECORD_BATCH_MAX }, (_, i) => `Set ${i + 1}.`))).toBe(true);
    expect(ok(Array.from({ length: RECORD_BATCH_MAX + 1 }, (_, i) => `Set ${i + 1}.`))).toBe(false);
    expect(ok(["a".repeat(RECORD_LINE_MAX)])).toBe(true);
    expect(ok(["a".repeat(RECORD_LINE_MAX + 1)])).toBe(false);
    expect(ok("Last one.")).toBe(false);
  });
});

describe("the recordings, in one body", () => {
  it("come back in the order asked, a line with none as null", () => {
    const body = packClips([bytes(1, 2, 3), null, bytes(9)]);
    expect(Array.from(body)).toEqual([0, 0, 0, 3, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 1, 9]);
    const back = unpackClips(body, 3);
    expect(back?.map((clip) => (clip ? Array.from(clip) : null))).toEqual([[1, 2, 3], null, [9]]);
  });

  it("reads each recording out as bytes of its own, ready to be kept", () => {
    const back = unpackClips(packClips([bytes(4, 5), bytes(6)]).buffer, 2);
    expect(back?.[1]?.buffer.byteLength).toBe(1);
  });

  it("refuses a body cut short, one holding more than was asked, or one of the wrong count", () => {
    const body = packClips([bytes(1, 2, 3), bytes(4)]);
    expect(unpackClips(body.slice(0, body.length - 1), 2)).toBeNull();
    expect(unpackClips(body, 1)).toBeNull();
    expect(unpackClips(body, 3)).toBeNull();
    expect(unpackClips(new Uint8Array(0), 0)).toEqual([]);
  });
});
