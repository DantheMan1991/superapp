import { describe, expect, it } from "vitest";
import { readDeepgramTranscript } from "../src/lib/speech/providers";
import {
  isSupportedAudioType,
  pickSpeechRoute,
  whyNoSpeech,
  type SpeechCapabilities,
} from "../src/lib/speech/types";

/**
 * The speech seam (voice slice 2) — the pure half, which is all of the
 * decisions and none of the audio.
 *
 * The vendor call itself is not exercised here and cannot be: it needs a key
 * and a network. What IS exercised is everything that would go wrong silently
 * — which route a given client takes, what counts as a recording, and reading
 * a transcript out of a response shape that could change under us.
 */

const caps = (over: Partial<SpeechCapabilities> = {}): SpeechCapabilities => ({
  nativeApp: false,
  deviceEngine: false,
  canRecord: true,
  serverConfigured: true,
  ...over,
});

describe("which engine a client uses", () => {
  it("prefers the phone's own engine whenever the app actually has one", () => {
    // Free, no upload, and the audio never leaves the handset. Preferring the
    // paid and less private route because it is more uniform would be the
    // wrong default to reach for.
    expect(pickSpeechRoute(caps({ nativeApp: true, deviceEngine: true }))).toBe(
      "device",
    );
  });

  it("falls through to the server for an app build that has no plugin yet", () => {
    // THE CASE THAT MAKES THE PROBE A RUNTIME QUESTION. Somebody's phone is
    // two releases behind; the web still has to work on it (ADR 0032).
    expect(
      pickSpeechRoute(caps({ nativeApp: true, deviceEngine: false })),
    ).toBe("server");
  });

  it("uses the server in a browser, which has no device engine at all", () => {
    expect(pickSpeechRoute(caps())).toBe("server");
  });

  it("is none when the server has no vendor and the phone has no engine", () => {
    expect(pickSpeechRoute(caps({ serverConfigured: false }))).toBe("none");
  });

  it("is none when the browser cannot record, however well the server is set up", () => {
    expect(pickSpeechRoute(caps({ canRecord: false }))).toBe("none");
  });

  it("still reaches the device engine when the server has no vendor", () => {
    // The two halves are independent: an unconfigured server must not switch
    // off speech for people whose phones never needed it.
    expect(
      pickSpeechRoute(
        caps({ nativeApp: true, deviceEngine: true, serverConfigured: false }),
      ),
    ).toBe("device");
  });
});

describe("what it says when it cannot listen", () => {
  it("tells an old app to update rather than blaming the browser", () => {
    expect(
      whyNoSpeech(
        caps({
          nativeApp: true,
          deviceEngine: false,
          canRecord: false,
          serverConfigured: false,
        }),
      ),
    ).toContain("Update it");
  });

  it("blames the browser when the browser is the problem", () => {
    expect(whyNoSpeech(caps({ canRecord: false }))).toContain("browser");
  });

  it("says it is not switched on when the platform has no vendor", () => {
    expect(whyNoSpeech(caps({ serverConfigured: false }))).toContain(
      "not switched on",
    );
  });
});

describe("what counts as a recording", () => {
  it("matches on the base type, because a browser always appends its codec", () => {
    // This is the trap: `MediaRecorder` reports `audio/webm;codecs=opus`, and
    // an equality check against `audio/webm` would refuse every real recording
    // Chrome makes.
    expect(isSupportedAudioType("audio/webm;codecs=opus")).toBe(true);
    expect(isSupportedAudioType("audio/mp4; codecs=mp4a.40.2")).toBe(true);
    expect(isSupportedAudioType("AUDIO/WEBM")).toBe(true);
  });

  it("takes what Safari and Chrome each actually produce", () => {
    expect(isSupportedAudioType("audio/webm")).toBe(true);
    expect(isSupportedAudioType("audio/mp4")).toBe(true);
    expect(isSupportedAudioType("audio/ogg")).toBe(true);
  });

  it("refuses anything that is not audio", () => {
    expect(isSupportedAudioType("video/mp4")).toBe(false);
    expect(isSupportedAudioType("application/json")).toBe(false);
    expect(isSupportedAudioType("")).toBe(false);
    expect(isSupportedAudioType(null)).toBe(false);
    expect(isSupportedAudioType(undefined)).toBe(false);
  });
});

describe("reading a transcript out of the vendor's answer", () => {
  /** The shape Deepgram documents, trimmed to what is read. */
  const body = (transcript: unknown) => ({
    metadata: { request_id: "abc", model_info: {} },
    results: {
      channels: [
        {
          alternatives: [{ transcript, confidence: 0.99 }],
        },
      ],
    },
  });

  it("finds the transcript where the vendor puts it", () => {
    expect(readDeepgramTranscript(body("Clock me in."))).toBe("Clock me in.");
  });

  it("reads an empty transcript as an empty string, not as a failure", () => {
    // Somebody pressed the button and said nothing. That is a real outcome
    // with its own message, and turning it into null here would send them the
    // vendor-outage sentence instead.
    expect(readDeepgramTranscript(body(""))).toBe("");
  });

  it("is null for every shape that is not the one we expect", () => {
    // If the vendor changes this, the route says "try again" rather than
    // handing `undefined` to the textarea.
    expect(readDeepgramTranscript(null)).toBeNull();
    expect(readDeepgramTranscript({})).toBeNull();
    expect(readDeepgramTranscript({ results: {} })).toBeNull();
    expect(readDeepgramTranscript({ results: { channels: [] } })).toBeNull();
    expect(
      readDeepgramTranscript({ results: { channels: [{ alternatives: [] }] } }),
    ).toBeNull();
    expect(readDeepgramTranscript(body(42))).toBeNull();
    expect(readDeepgramTranscript(body(undefined))).toBeNull();
    expect(readDeepgramTranscript("a string")).toBeNull();
  });
});
