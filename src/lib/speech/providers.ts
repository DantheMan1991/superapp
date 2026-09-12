import "server-only";
import {
  isSupportedAudioType,
  SPEECH_MAX_BYTES,
  SpeechRefusal,
} from "./types";

/**
 * The SERVER route's vendor — only ever reached by a browser, never by the
 * app (see the fork described in `types.ts`).
 *
 * ── ONE PROVIDER, BEHIND A CONTRACT, AND WHY BOTH ────────────────────────────
 *
 * Deepgram is the default because of what this product is for: a sentence said
 * once, outdoors, next to machinery, by somebody with a regional accent. Its
 * pricing is per minute of audio rather than per token, which for "clock me in"
 * is fractions of a cent, and it does not require sending the audio through a
 * second model to get a plain transcript back.
 *
 * The contract exists because the choice is not permanent and is not mine.
 * Swapping to Whisper or AssemblyAI is one file and one line in `PROVIDERS` —
 * no route, component or test changes — and the dossier says so.
 *
 * ── AUDIO IS NEVER STORED, ANYWHERE ──────────────────────────────────────────
 *
 * It arrives in memory, goes to the vendor, and the bytes are dropped when the
 * request ends. Nothing is written to blob storage, nothing is logged, and the
 * transcript is not written either — it is handed straight back to the browser,
 * which puts it in the textarea for a person to read before anything is
 * proposed. A recording of somebody's business is not ours to keep, and the
 * tenant guide says so in those words.
 *
 * LAZY, like `getClaude()`: no key is needed to build or boot, and a missing
 * one is a sentence rather than a crash at import time.
 */

export interface SpeechInput {
  audio: ArrayBuffer;
  /** The browser's own `MediaRecorder` type, codec parameters and all. */
  mimeType: string;
  /**
   * Words this tenant uses that a general model will not know — pen names,
   * paddock names, an animal called Rosie. Passed as hints where the vendor
   * supports them, ignored where it does not.
   *
   * LABELS ONLY, and the same rule `tell-sources` follows (S9): names, never
   * what is in them, what they cost or who owns them.
   */
  vocabulary?: string[];
}

export interface SpeechProvider {
  slug: string;
  /** Named in errors and in the dossier, never shown to a tenant. */
  label: string;
  /** False when its key is absent, so the route can fail closed with a sentence. */
  isConfigured(): boolean;
  transcribe(input: SpeechInput): Promise<string>;
}

/* -- Deepgram -------------------------------------------------------------- */

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";

/**
 * `nova-3` with smart formatting, which is what turns "pen two" into "Pen 2"
 * and puts a full stop at the end. `punctuate` is implied by it and is passed
 * anyway, because relying on one flag to imply another is how a vendor's
 * default change becomes our bug.
 */
function deepgramQuery(vocabulary: string[]): string {
  const params = new URLSearchParams({
    model: "nova-3",
    smart_format: "true",
    punctuate: "true",
  });
  // Deepgram takes repeated `keyterm` parameters. Capped: a farm with three
  // hundred paddocks would otherwise build a URL no proxy will forward.
  for (const term of vocabulary.slice(0, 50)) {
    const clean = term.trim();
    if (clean !== "") params.append("keyterm", clean);
  }
  return params.toString();
}

/** What comes back, narrowed to the one field we read. */
export function readDeepgramTranscript(body: unknown): string | null {
  const alt = (
    body as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: unknown }> }> };
    } | null
  )?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof alt === "string" ? alt : null;
}

export const deepgramProvider: SpeechProvider = {
  slug: "deepgram",
  label: "Deepgram",

  isConfigured() {
    return typeof process.env.DEEPGRAM_API_KEY === "string"
      && process.env.DEEPGRAM_API_KEY.length > 0;
  },

  async transcribe(input) {
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new SpeechRefusal("Speech is not set up on this platform.");

    const response = await fetch(
      `${DEEPGRAM_URL}?${deepgramQuery(input.vocabulary ?? [])}`,
      {
        method: "POST",
        headers: {
          Authorization: `Token ${key}`,
          "Content-Type": input.mimeType,
        },
        body: input.audio,
      },
    );

    if (!response.ok) {
      // The vendor's own body can carry a customer's words back in an error
      // message, so it is read for a status and never echoed to the browser.
      console.error(
        `deepgram transcribe failed: ${response.status} ${response.statusText}`,
      );
      throw new SpeechRefusal(
        response.status === 401
          ? "Speech is not set up correctly on this platform."
          : "That did not come through. Try saying it again.",
      );
    }

    const text = readDeepgramTranscript(await response.json());
    if (text === null) {
      throw new SpeechRefusal("That did not come through. Try saying it again.");
    }
    return text.trim();
  },
};

/* -- The registry ---------------------------------------------------------- */

/**
 * THE COMPOSITION ROOT for the server route. One entry today; a second is a
 * file beside this one and a line here.
 */
const PROVIDERS: readonly SpeechProvider[] = [deepgramProvider];

/** The configured provider, or null — which is what makes the button hide. */
export function activeSpeechProvider(): SpeechProvider | null {
  return PROVIDERS.find((p) => p.isConfigured()) ?? null;
}

export function isServerSpeechConfigured(): boolean {
  return activeSpeechProvider() !== null;
}

/**
 * Check, then transcribe. The checks are here rather than in the route so that
 * every future caller gets them, and because a size limit enforced by only one
 * of two callers is not a limit.
 */
export async function transcribeAudio(input: SpeechInput): Promise<string> {
  if (!isSupportedAudioType(input.mimeType)) {
    throw new SpeechRefusal("That is not a kind of recording Yosher can read.");
  }
  if (input.audio.byteLength === 0) {
    throw new SpeechRefusal("Nothing was recorded. Hold the button while you speak.");
  }
  if (input.audio.byteLength > SPEECH_MAX_BYTES) {
    throw new SpeechRefusal("That is too long. Say one thing at a time.");
  }

  const provider = activeSpeechProvider();
  if (!provider) throw new SpeechRefusal("Speech is not set up on this platform.");

  return provider.transcribe(input);
}
