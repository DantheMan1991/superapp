/**
 * THE ONE VOICE (ADR 0114; docs/modules/fitness.md, F2b).
 *
 * Everything that talks during a workout talks through here: the coach's
 * announcements and cues today, and the founder's posture feedback when it
 * lands. One queue, so two of them never speak at once, and the rules for who
 * waits, who interrupts and what is dropped are `queue-policy.ts`'s, pure and
 * tested. This file only keeps the queue and feeds the engine (`speakLine` in
 * say.ts, which is the app's own voice inside the app and the browser's
 * outside it).
 *
 * Not the tell box's voice: `sayIt` stays as it is, cancelling on every new
 * answer, because there the newest answer is the true one. Both share the
 * engine, and a device that proves it cannot speak is silent for both.
 *
 * Deliberately not `server-only` and not a React hook: a module-level queue,
 * because there is one voice per page, and a posture tool, a pacer and a
 * screen must all reach the same one.
 */

import { canSpeak, speakLine } from "./say";
import { admit, nextLine, toQueued, type QueuedLine, type VoiceLine } from "./queue-policy";

export type { VoiceLine, VoicePriority } from "./queue-policy";

let queue: QueuedLine[] = [];
let current: { line: QueuedLine; stop: () => void } | null = null;
let lastId = 0;

/** Say it when its turn comes, or now if it outranks what is being said. */
export function speak(line: VoiceLine): void {
  if (typeof window === "undefined" || line.text.trim() === "" || !canSpeak()) return;
  lastId += 1;
  const queued = toQueued(line, lastId, Date.now());
  const decision = admit(queue, current?.line ?? null, queued);
  queue = decision.queue;
  if (decision.interrupt) {
    // Not stopped first: the next line's engine call cuts it off (the browser
    // cancels, the app flushes), and stopping it separately would race the
    // new line in the app. Its `done` arrives later and is ignored.
    current = null;
  }
  if (!current) sayNext();
}

function sayNext(): void {
  const picked = nextLine(queue, Date.now());
  queue = picked.queue;
  const line = picked.line;
  if (!line) return;
  const stop = speakLine(line.text, () => {
    if (current?.line.id !== line.id) return;
    current = null;
    sayNext();
  });
  current = { line, stop };
}

/** Stop talking and forget everything waiting: sound off, leaving the workout. */
export function silence(): void {
  queue = [];
  const speaking = current;
  current = null;
  speaking?.stop();
}
