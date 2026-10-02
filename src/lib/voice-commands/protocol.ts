import type { Keyword } from "./phrases";

/**
 * What the page and the listener's worker say to each other
 * (docs/modules/voice-commands.md). Words and labels only: the sound itself
 * goes straight from the microphone's worklet to the worker on a port of its
 * own, and never comes back out of either.
 */

export type ToListener =
  /** Load the engine and the model, then hear these keywords. */
  | { type: "start"; keywords: Keyword[] }
  /** Where the microphone's blocks arrive from now on (a new worklet, a new port). */
  | { type: "audio"; port: MessagePort }
  /** Listen for these instead: a screen's commands changed. */
  | { type: "keywords"; keywords: Keyword[] }
  /** Drop the sound while the phone talks, and start afresh after (`on: false`). */
  | { type: "hold"; on: boolean };

export type ListenerStage = "engine" | "model" | "spotter" | "audio";

export type FromListener =
  /** The model downloading: bytes so far, of the whole. */
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready" }
  /** A keyword heard: its label, the tool's command. */
  | { type: "heard"; label: string }
  | { type: "error"; stage: ListenerStage; message: string };

/** One block of the microphone's sound, from the worklet: about a tenth of a second, mono. */
export interface AudioBlock {
  samples: Float32Array;
  rate: number;
  /** When the worklet sent it, in epoch ms: a block left waiting too long is dropped. */
  sent: number;
}
