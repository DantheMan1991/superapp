import "server-only";
import type { RecordedVoice } from "./voices";

/**
 * THE VENDOR THAT RECORDS A LINE (ADR 0115): Deepgram's Aura-2 voices.
 *
 * Deepgram because it is already this product's speech vendor (the tell box's
 * transcription, `providers.ts`): the same account, the same key, the same
 * terms, and no new company holding anything. Aura-2 is $0.030 per 1,000
 * characters on pay-as-you-go (checked 2026-09-27). A session's lines are
 * about 1,400 characters, so about 4 cents, once: the phone keeps the
 * recordings and asks again only for a line it has never heard.
 *
 * ── WHAT IS SENT, AND WHAT IS KEPT ──────────────────────────────────────────
 *
 * The line's words and nothing else: the program's exercise names, sets and
 * cues, never how the person felt, what hurt, or who they are. Sent with
 * `mip_opt_out`, so Deepgram keeps a request only as long as it takes to
 * answer it and never uses it to train. The recording comes back and is
 * handed to the phone. This server keeps neither.
 *
 * LAZY, like the transcription: no key is needed to build or boot, and a
 * missing one means the page offers no recorded voice and the device speaks.
 */

const SPEAK_URL = "https://api.deepgram.com/v1/speak";

/** Each voice's model at the vendor: `arcas` is `aura-2-arcas-en`. */
function model(voice: RecordedVoice): string {
  return `aura-2-${voice}-en`;
}

/** How long one line may take. A line the phone waited this long for is said in its own voice. */
const LINE_TIMEOUT_MS = 10_000;

/** Lines recorded at once, per request: the vendor's rate limit is generous, a phone's patience is not. */
const AT_ONCE = 6;

export function isSynthesisConfigured(): boolean {
  const key = process.env.DEEPGRAM_API_KEY;
  return typeof key === "string" && key.length > 0;
}

/** One line in the voice, as MP3 bytes; null when the vendor would not. */
async function record(text: string, voice: RecordedVoice, key: string): Promise<Uint8Array | null> {
  const params = new URLSearchParams({
    model: model(voice),
    encoding: "mp3",
    bit_rate: "48000",
    mip_opt_out: "true",
  });
  try {
    const response = await fetch(`${SPEAK_URL}?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(LINE_TIMEOUT_MS),
    });
    if (!response.ok) {
      // The status only. The body can carry the line back inside it, and the
      // line is the program's words.
      console.error(`deepgram speak failed: ${response.status} ${response.statusText}`);
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.byteLength > 0 ? bytes : null;
  } catch (err) {
    console.error("deepgram speak failed", err instanceof Error ? err.name : "unknown");
    return null;
  }
}

/**
 * Every line in the voice, in the order asked, `AT_ONCE` at a time. A line the
 * vendor refused is null, and the rest still come back: one bad line is no
 * reason to leave a whole session in the device's voice.
 */
export async function synthesizeLines(
  lines: readonly string[],
  voice: RecordedVoice,
): Promise<(Uint8Array | null)[]> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return lines.map(() => null);
  const out: (Uint8Array | null)[] = new Array(lines.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < lines.length) {
      const i = next;
      next += 1;
      out[i] = await record(lines[i], voice, key!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, lines.length) }, () => worker()));
  return out;
}
