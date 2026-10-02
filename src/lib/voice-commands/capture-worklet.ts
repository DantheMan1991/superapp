/**
 * THE MICROPHONE'S WORKLET (docs/modules/voice-commands.md, "How a phrase is
 * heard"). It runs on the phone's audio thread: it gathers the microphone's
 * sound into blocks of a tenth of a second and hands each block, on a port of
 * its own, straight to the listener's worker. The page never holds the sound.
 *
 * Kept as a string and loaded from a blob, because an AudioWorklet module is
 * fetched by URL and the bundler has no way to build one; it is plain
 * JavaScript for the same reason. Each sample is held to [-1, 1] (the engine
 * refuses a block that strays outside), and a stray NaN is silence.
 */

export const CAPTURE_PROCESSOR = "yosher-voice-capture";

export const CAPTURE_WORKLET_SOURCE = `
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.max(128, Math.round(sampleRate / 10));
    this.block = new Float32Array(this.size);
    this.filled = 0;
    this.out = null;
    this.port.onmessage = (event) => {
      if (event.data && event.data.audio) this.out = event.data.audio;
    };
  }
  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel || !this.out) return true;
    for (let i = 0; i < channel.length; i++) {
      const v = channel[i];
      this.block[this.filled++] = v > 1 ? 1 : v < -1 ? -1 : v || 0;
      if (this.filled === this.size) {
        this.out.postMessage({ samples: this.block, rate: sampleRate, sent: Date.now() }, [this.block.buffer]);
        this.block = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor(${JSON.stringify(CAPTURE_PROCESSOR)}, Capture);
`;
