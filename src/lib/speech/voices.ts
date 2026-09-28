import { z } from "zod";

/**
 * THE RECORDED VOICES (ADR 0115; docs/modules/fitness.md, F2d).
 *
 * The founder heard the workout's coach in the device's own voice and called
 * it "very robotic". On a Windows PC that voice is Microsoft David, which the
 * old pick took because it came first in the list. So the coach's lines are now
 * recorded by a vendor's natural voice (`synthesis.ts`, Deepgram, the vendor
 * the tell box already listens with), fetched before they are needed, kept on
 * the phone (`clips.ts`), and played through the one voice queue. The device's
 * voice is what speaks when a recording is not there in time.
 *
 * This half is pure and shared by the browser and the route: which voices
 * there are, what a request may ask for, and the shape of the answer.
 */

/**
 * The four voices on offer, picked on 2026-09-27 from the vendor's forty-one
 * English ones by how the vendor describes them (calm and clear suits a
 * program that is mostly slow breathing), then heard by the founder as
 * samples. He chose Arcas. A fifth, Harmonia, was dropped: read back by the
 * vendor's own transcription, its sample had rushed "8 to" into "h".
 */
export const RECORDED_VOICES = [
  { id: "arcas", name: "Arcas", about: "male, clear" },
  { id: "orion", name: "Orion", about: "male, calm" },
  { id: "helena", name: "Helena", about: "female, warm" },
  { id: "vesta", name: "Vesta", about: "female, unhurried" },
] as const;

export type RecordedVoice = (typeof RECORDED_VOICES)[number]["id"];

export const DEFAULT_RECORDED_VOICE: RecordedVoice = "arcas";

const VOICE_IDS = RECORDED_VOICES.map((voice) => voice.id) as [RecordedVoice, ...RecordedVoice[]];

export function isRecordedVoice(value: unknown): value is RecordedVoice {
  return typeof value === "string" && (VOICE_IDS as string[]).includes(value);
}

/**
 * The longest line the route records. The coach's longest is a first set's
 * line (the exercise, its prescription and a cue), about 200 characters.
 * Every character is money, so the cap is the cost's first bound.
 */
export const RECORD_LINE_MAX = 300;

/** Lines in one request. A session's lines are 20 to 40. */
export const RECORD_BATCH_MAX = 40;

export const recordRequestSchema = z.object({
  voice: z.enum(VOICE_IDS),
  lines: z.array(z.string().trim().min(1).max(RECORD_LINE_MAX)).min(1).max(RECORD_BATCH_MAX),
});

export type RecordRequest = z.infer<typeof recordRequestSchema>;

/**
 * THE ANSWER'S SHAPE: the recordings one after another, in the order the lines
 * were asked for, each as its length in four bytes (big-endian) and then its
 * bytes. A line that could not be recorded has length 0, and the phone says
 * that one in its own voice.
 *
 * Not JSON: a session's recordings are a few hundred kilobytes, and base64
 * would add a third to what a phone downloads over a gym's signal.
 */
export function packClips(clips: readonly (Uint8Array | null)[]): Uint8Array<ArrayBuffer> {
  const total = clips.reduce((sum, clip) => sum + 4 + (clip?.byteLength ?? 0), 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const clip of clips) {
    const length = clip?.byteLength ?? 0;
    view.setUint32(at, length);
    at += 4;
    if (clip) {
      out.set(clip, at);
      at += length;
    }
  }
  return out;
}

/**
 * Read an answer back into `count` recordings (null for a line with none), or
 * null for a body that is not one: cut short, or holding more than was asked.
 */
export function unpackClips(
  body: ArrayBuffer | Uint8Array,
  count: number,
): (Uint8Array<ArrayBuffer> | null)[] | null {
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const clips: (Uint8Array<ArrayBuffer> | null)[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 4 > bytes.byteLength) return null;
    const length = view.getUint32(at);
    at += 4;
    if (at + length > bytes.byteLength) return null;
    clips.push(length === 0 ? null : bytes.slice(at, at + length));
    at += length;
  }
  return at === bytes.byteLength ? clips : null;
}
