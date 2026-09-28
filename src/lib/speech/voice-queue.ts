/**
 * THE ONE VOICE (ADR 0114; docs/modules/fitness.md, F2b).
 *
 * Everything that talks during a workout talks through here: the coach's
 * announcements and cues today, and the founder's posture feedback when it
 * lands. One queue, so two of them never speak at once, and the rules for who
 * waits, who interrupts and what is dropped are `queue-policy.ts`'s, pure and
 * tested. This file only keeps the queue and feeds the engine.
 *
 * THE ENGINE (ADR 0115, F2d): a line's recording in the coach's natural voice
 * when the workout has one (`playClip`, clips.ts), and otherwise `speakLine`
 * (say.ts), the app's own voice inside the app and the browser's outside it.
 * A line still waiting for its recording keeps its place as the line being
 * said, so nothing jumps it.
 *
 * Not the tell box's voice: `sayIt` stays as it is, cancelling on every new
 * answer, because there the newest answer is the true one. Both share the
 * engine, and a device that proves it cannot speak is silent for both.
 *
 * Deliberately not `server-only` and not a React hook: a module-level queue,
 * because there is one voice per page, and a posture tool, a pacer and a
 * screen must all reach the same one.
 */

import { hasClipSource, playClip, type SaidLine } from "./clips";
import { canSpeak, speakLine } from "./say";
import { admit, nextLine, toQueued, type QueuedLine, type VoiceLine } from "./queue-policy";

export type { VoiceLine, VoicePriority } from "./queue-policy";

/**
 * How long a line may wait for a recording still on its way. Long enough for
 * one asked for on the spot to arrive on a fair signal; short enough that a
 * step is not said late. A `high` line never waits: it must be heard now.
 */
const CLIP_WAIT_MS = 2_000;

let queue: QueuedLine[] = [];
let current: { line: QueuedLine; said: SaidLine } | null = null;
let lastId = 0;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Say it when its turn comes, or now if it outranks what is being said. */
export function speak(line: VoiceLine): void {
  if (typeof window === "undefined" || line.text.trim() === "") return;
  if (!canSpeak() && !hasClipSource()) return;
  lastId += 1;
  const queued = toQueued(line, lastId, Date.now());
  const decision = admit(queue, current?.line ?? null, queued);
  queue = decision.queue;
  if (decision.interrupt) {
    // Cut, not stopped: a line in the device's voice is cut off by the next
    // line's own engine call (the browser cancels, the app flushes), and
    // stopping it separately would race the new line in the app. A recording,
    // or a line still waiting for one, has nothing else to stop it. Its
    // `done` arrives later and is ignored.
    current?.said.cut();
    current = null;
  }
  if (!current) sayNext();
  changed();
}

function sayNext(): void {
  const picked = nextLine(queue, Date.now());
  queue = picked.queue;
  const line = picked.line;
  if (!line) return;
  const done = () => {
    if (current?.line.id !== line.id) return;
    current = null;
    sayNext();
    changed();
  };
  const said = playClip(line.text, done, line.priority === "high" ? 0 : CLIP_WAIT_MS) ?? byTheDevice(line.text, done);
  current = { line, said };
}

function byTheDevice(text: string, done: () => void): SaidLine {
  const stop = speakLine(text, done);
  return { stop, cut: () => {} };
}

/** Stop talking and forget everything waiting: sound off, leaving the workout. */
export function silence(): void {
  queue = [];
  const speaking = current;
  current = null;
  speaking?.said.stop();
  changed();
}

/**
 * Something is being said, or waits to be: what the demo holds its start for
 * (F2d), so the coach is heard before the movement is shown.
 */
export function isVoiceBusy(): boolean {
  return current !== null || queue.length > 0;
}

/** Told whenever the voice starts, finishes, or is silenced. */
export function subscribeVoiceBusy(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
