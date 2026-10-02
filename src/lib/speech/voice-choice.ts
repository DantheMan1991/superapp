import { DEFAULT_RECORDED_VOICE, isRecordedVoice, type RecordedVoice } from "./voices";

/**
 * WHOSE VOICE, ON THIS PHONE (ADR 0115): the recorded voice chosen on the
 * workout's start screen (F2d), shared by every tool that speaks in one. The
 * workout coach is where it is chosen; Food's hands-free cook mode (D1c)
 * reads the steps in the same voice, the founder's call.
 *
 * The key keeps its workout name, so a phone that chose before cook mode
 * could speak keeps its choice.
 */

const KEY = "yosher.fitness.coach-voice";
let whose: RecordedVoice | null = null;

export function chosenVoice(): RecordedVoice {
  if (whose === null) {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(KEY);
    } catch {
      // A private window: the default, for this page.
    }
    whose = isRecordedVoice(stored) ? stored : DEFAULT_RECORDED_VOICE;
  }
  return whose;
}

export function chosenVoiceOnTheServer(): RecordedVoice {
  return DEFAULT_RECORDED_VOICE;
}

export function setChosenVoice(value: RecordedVoice): void {
  whose = value;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Kept in memory for this page.
  }
}
