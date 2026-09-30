import { prefetchLines, setClipSource } from "@/lib/speech/clips";
import { silence } from "@/lib/speech/voice-queue";
import { coachSay, coachVoice, unlockSound } from "../../components/workout/sound";

/**
 * THE POSTURE CHECK'S VOICE (docs/modules/posture.md, "The voice"): the
 * coach's, through the one queue workout mode speaks through (ADR 0114), in
 * the recorded voice the phone chose (ADR 0115) when the platform has one.
 *
 * Every line is `key: "posture"`, so a newer instruction replaces an older one
 * not yet said ("Step back a little" superseded by "I can see you" is never
 * said late), and the same line is not repeated within a few seconds, which
 * is what keeps framing advice from nagging while someone is moving.
 */

const ENDPOINT = "/api/fitness/voice";

let lastText = "";
let lastAt = 0;

/** From the Start tap: sound unlocked, the recordings switched on and fetched ahead. */
export function startPostureVoice(naturalVoice: boolean, lines: readonly string[]): void {
  unlockSound();
  if (!naturalVoice) return;
  setClipSource({ endpoint: ENDPOINT, voice: coachVoice() });
  prefetchLines(lines);
}

export function sayPosture(text: string, opts: { repeatAfterMs?: number } = {}): void {
  const now = performance.now();
  if (text === lastText && now - lastAt < (opts.repeatAfterMs ?? 5000)) return;
  lastText = text;
  lastAt = now;
  coachSay({ text, priority: "normal", key: "posture" });
}

export function stopPostureVoice(): void {
  silence();
  setClipSource(null);
  lastText = "";
}
