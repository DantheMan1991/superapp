/**
 * Turning speech into a sentence the tell box can read — the pure half.
 *
 * DELIBERATELY NOT `server-only`. The dictate button is a client component and
 * reads the limits and `pickSpeechRoute` from here, the split
 * `tell-sources/shape.ts` and `device-grants/types.ts` both keep.
 *
 * ── THE SEAM IS A FORK IN THE ROAD, NOT TWO IMPLEMENTATIONS OF ONE INTERFACE ─
 *
 * It is tempting to declare `SpeechProvider` and give it two members, the way
 * every other extension point here works. It would be wrong. The two engines do
 * not run in the same place:
 *
 *   in the app     the phone's own engine (iOS SFSpeechRecognizer, Android
 *                  SpeechRecognizer) runs ON THE DEVICE. No audio is uploaded,
 *                  nothing reaches our server, and it costs nothing.
 *   in a browser   there is no such engine, so the page records, uploads, and
 *                  the SERVER asks a vendor.
 *
 * A single interface would have to pretend the first one has a server side. So
 * the seam is `pickSpeechRoute`, below — a pure decision the client makes about
 * WHERE transcription happens — and only the server route has a provider
 * registry behind it (`providers.ts`).
 *
 * Everything here is pure. Nothing here records, uploads or transcribes.
 */

/**
 * A sentence is short. Thirty seconds is already four times longer than "three
 * chicks dead in pen two" and long enough for somebody to say two things.
 * Past that it is a note, and `TELL_MAX_CHARS` would cut it anyway.
 */
export const SPEECH_MAX_SECONDS = 30;

/**
 * The upload ceiling. Thirty seconds of Opus at a voice bitrate is well under
 * 200 KB; this is generous enough for a browser that picks a wasteful codec
 * and small enough that nothing has to stream.
 */
export const SPEECH_MAX_BYTES = 2 * 1024 * 1024;

/**
 * What a browser's `MediaRecorder` actually produces, which is not what the
 * spec suggests: Chrome and Firefox give WebM/Opus, Safari gives MP4/AAC, and
 * both append codec parameters to the type. Matched on the PREFIX for that
 * reason — `audio/webm;codecs=opus` is `audio/webm`.
 */
export const SPEECH_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
] as const;

export function isSupportedAudioType(mime: string | null | undefined): boolean {
  if (!mime) return false;
  const base = mime.split(";")[0].trim().toLowerCase();
  return (SPEECH_AUDIO_TYPES as readonly string[]).includes(base);
}

/**
 * Where a given client should turn speech into words.
 *
 * `device` — the phone's own engine, through the app shell. Free, private,
 *            and the audio never leaves the handset.
 * `server` — record here, upload, a vendor transcribes. Costs money per
 *            minute and the audio leaves to a third party.
 * `none`   — this client cannot dictate at all, and the button says so rather
 *            than failing when pressed.
 */
export type SpeechRoute = "device" | "server" | "none";

export interface SpeechCapabilities {
  /** Running inside the Yosher app shell (`isNativeAppUserAgent`). */
  nativeApp: boolean;
  /**
   * The app shell actually exposes a speech plugin RIGHT NOW — probed at
   * runtime, never assumed from the user agent.
   *
   * THIS IS WHY THE CHOOSER IS NOT DEAD CODE while the plugin is unbuilt. An
   * older installed app has no plugin and must fall through to the server
   * route rather than call something that is not there; a newer one answers
   * true and nothing here changes. The web decides what the app shows
   * (ADR 0032), so the web must also cope with every version of the app that
   * is still on a phone.
   */
  deviceEngine: boolean;
  /** `MediaRecorder` and a microphone exist in this browser. */
  canRecord: boolean;
  /** A speech vendor is configured on the server. */
  serverConfigured: boolean;
}

export function pickSpeechRoute(caps: SpeechCapabilities): SpeechRoute {
  // The phone's own engine first WHENEVER IT IS THERE, even though the server
  // route would also work in the app: it is free, it is faster with no upload,
  // and the audio stays on the handset. Preferring the paid, less private one
  // because it is more uniform would be the wrong default to reach for.
  if (caps.nativeApp && caps.deviceEngine) return "device";
  if (caps.canRecord && caps.serverConfigured) return "server";
  return "none";
}

/** Why this client cannot dictate, in words somebody can act on. */
export function whyNoSpeech(caps: SpeechCapabilities): string {
  if (caps.nativeApp && !caps.canRecord && !caps.serverConfigured) {
    return "This version of the app cannot listen yet. Update it, or type instead.";
  }
  if (!caps.canRecord) {
    return "This browser cannot record audio. Type instead.";
  }
  return "Talking to Yosher is not switched on for this platform yet. Type instead.";
}

/**
 * A refusal the person can act on — audio too long, too big, the wrong kind,
 * or a vendor that said no. Thrown by the server route and turned into a
 * sentence by the endpoint. Anything else is a failure, not a refusal.
 */
export class SpeechRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpeechRefusal";
  }
}
