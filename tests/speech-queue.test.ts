import { describe, expect, it } from "vitest";
import {
  admit,
  estimateSpeechMs,
  nextLine,
  toQueued,
  VOICE_FRESH_MS,
  VOICE_QUEUE_LIMIT,
  type QueuedLine,
  type VoiceLine,
} from "../src/lib/speech/queue-policy";
import { isRealSpeechFailure } from "../src/lib/speech/say";

/**
 * THE ONE VOICE's rules (ADR 0114, docs/modules/fitness.md F2b): who waits, who
 * interrupts, and what is dropped rather than said late. A person on the floor
 * hears the result and cannot see it, so the rules are pinned here.
 */

let n = 0;
function line(text: string, extra: Omit<VoiceLine, "text"> = {}, at = 0): QueuedLine {
  return toQueued({ text, ...extra }, ++n, at);
}

/** Admit lines one after another with nothing being said, then read the queue's order. */
function order(queue: QueuedLine[]): string[] {
  return queue.map((q) => q.text);
}

describe("taking a line in", () => {
  it("says a line at once when nothing is being said, and defaults to normal", () => {
    const intro = line("Set 2 of 3. Right side.");
    expect(intro.priority).toBe("normal");
    expect(intro.freshMs).toBe(VOICE_FRESH_MS.normal);
    const { queue, interrupt } = admit([], null, intro);
    expect(interrupt).toBe(false);
    expect(order(queue)).toEqual(["Set 2 of 3. Right side."]);
  });

  it("lets a count cut off a cue, and never the other way round", () => {
    const cue = line("Ribs down.", { priority: "low", key: "cue" });
    const last = line("Last one.", { priority: "normal", key: "count" });
    expect(admit([], cue, last).interrupt).toBe(true);
    const { queue, interrupt } = admit([], last, cue);
    expect(interrupt).toBe(false);
    expect(order(queue)).toEqual(["Ribs down."]);
  });

  it("lets a correction cut in on anything below it, and plays it first", () => {
    const intro = line("Now the left side.", { key: "step" });
    const waiting = line("Ribs down.", { priority: "low", key: "cue" });
    const posture = line("Knees out.", { priority: "high", key: "posture" });
    const { queue, interrupt } = admit([waiting], intro, posture);
    expect(interrupt).toBe(true);
    expect(order(queue)).toEqual(["Knees out.", "Ribs down."]);
  });

  it("replaces an older version of the same thing, waiting or being said", () => {
    const first = line("Knees out.", { priority: "high", key: "posture" });
    const second = line("Good.", { priority: "high", key: "posture" });
    // Being said: the newer is the true one, so it interrupts its own kind.
    expect(admit([], first, second).interrupt).toBe(true);
    // Waiting: the older goes, and the newer keeps its place in the order.
    const intro = line("Set 1 of 2.", { key: "step" });
    const { queue } = admit([first], intro, second);
    expect(order(queue)).toEqual(["Good."]);
  });

  it("waits behind its own rank and ahead of lower ones", () => {
    const speaking = line("Sidelying pullback. 2 sets of 5 to 8 breaths, each side.", { key: "step" });
    let queue: QueuedLine[] = [];
    queue = admit(queue, speaking, line("Ribs down.", { priority: "low", key: "cue" })).queue;
    queue = admit(queue, speaking, line("Last one.", { key: "count" })).queue;
    queue = admit(queue, speaking, line("Exercise done.", { key: "done" })).queue;
    expect(order(queue)).toEqual(["Last one.", "Exercise done.", "Ribs down."]);
  });

  it("keeps a short queue, dropping the lowest and newest", () => {
    const speaking = line("Set 1 of 2.", { key: "step" });
    let queue: QueuedLine[] = [];
    for (const text of ["one.", "two.", "three.", "four."]) {
      queue = admit(queue, speaking, line(text, { priority: "low" })).queue;
    }
    expect(queue).toHaveLength(VOICE_QUEUE_LIMIT);
    expect(order(queue)).toEqual(["one.", "two.", "three."]);
    // A higher line still gets in, pushing the lowest out.
    queue = admit(queue, speaking, line("Last one.", { key: "count" })).queue;
    expect(order(queue)).toEqual(["Last one.", "one.", "two."]);
  });
});

describe("choosing what to say next", () => {
  it("drops a line that waited past its freshness, rather than say it late", () => {
    const cue = line("Ribs down.", { priority: "low", key: "cue" }, 0);
    const intro = line("Now the left side.", { key: "step" }, 1_000);
    const late = nextLine([intro, cue], 1_000 + VOICE_FRESH_MS.normal + 1);
    expect(late.line).toBeNull();
    expect(late.queue).toEqual([]);

    const soon = nextLine([cue, intro], VOICE_FRESH_MS.low + 1);
    expect(soon.line?.text).toBe("Now the left side.");
    expect(soon.queue).toEqual([]);
  });

  it("takes a line's own freshness over its priority's", () => {
    const posture = line("Knees out.", { priority: "high", freshMs: 500 }, 0);
    expect(nextLine([posture], 400).line?.text).toBe("Knees out.");
    expect(nextLine([posture], 600).line).toBeNull();
  });

  it("says nothing when there is nothing", () => {
    expect(nextLine([], 0)).toEqual({ line: null, queue: [] });
  });
});

describe("the engine's edges", () => {
  it("estimates a line's length a little over, and slower at a slower rate", () => {
    const short = estimateSpeechMs("Last one.");
    const long = estimateSpeechMs("Sidelying Adductor Pullback. 2 sets of 5 to 8 breaths, each side.");
    expect(short).toBeGreaterThan(700);
    expect(short).toBeLessThan(1_500);
    expect(long).toBeGreaterThan(4_000);
    expect(estimateSpeechMs("Last one.", 0.5)).toBeGreaterThan(short);
  });

  it("does not take a cancelled or not-yet-allowed line as a device that cannot speak", () => {
    // What cancel() does to the line it stops, and what a browser says before
    // the page's first tap: neither says anything about the next line.
    expect(isRealSpeechFailure("interrupted")).toBe(false);
    expect(isRealSpeechFailure("canceled")).toBe(false);
    expect(isRealSpeechFailure("not-allowed")).toBe(false);
    expect(isRealSpeechFailure("synthesis-failed")).toBe(true);
    expect(isRealSpeechFailure("synthesis-unavailable")).toBe(true);
    expect(isRealSpeechFailure(undefined)).toBe(true);
  });
});
