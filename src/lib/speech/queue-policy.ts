/**
 * ONE VOICE, AND WHO GETS TO SPEAK (ADR 0114; docs/modules/fitness.md, F2b).
 *
 * The pure half of `voice-queue.ts`. `sayIt` (say.ts) cancels whatever it is
 * saying on every new line, which is right for the tell box, where the newest
 * answer is the true one, and wrong for a workout. A pacer's "last one", a
 * cue and (later) the founder's posture feedback all want to speak in the same
 * minute. With cancel-on-new, the cue cuts off the count. With a plain queue,
 * a correction arrives three sentences late, when it is no longer true.
 *
 * So every line says three things about itself:
 *
 *   priority  `high` interrupts anything lower. It is for what must be heard
 *             now or not at all: the posture tool's corrections. `normal` is
 *             what happens next ("Set 2 of 3. Left side."). `low` is
 *             coaching that can wait its turn: a cue.
 *   key       a newer line with the same key replaces an older one, queued or
 *             already being said. The newest version of one thing is the true
 *             one, so a step announced a second time does not stack up.
 *   freshMs   how late it may start and still be worth saying. A line past it
 *             is dropped, never said late.
 *
 * An interrupted line is not said again: by the time it could be, it is out of
 * date. Pure, so the rules can be argued with in one place and tested.
 */

export type VoicePriority = "low" | "normal" | "high";

export const VOICE_RANK: Record<VoicePriority, number> = { low: 0, normal: 1, high: 2 };

/**
 * How long a line may wait to start, by priority, unless it says otherwise.
 * A correction is only true for a moment; an announcement holds for about as
 * long as the countdown it announces; a cue can wait for one line to finish.
 */
export const VOICE_FRESH_MS: Record<VoicePriority, number> = {
  high: 2_000,
  normal: 8_000,
  low: 4_000,
};

/** Past this, the lowest and newest lines go. A queue is not a script. */
export const VOICE_QUEUE_LIMIT = 3;

/** What a caller hands the voice. */
export interface VoiceLine {
  text: string;
  priority?: VoicePriority;
  key?: string;
  freshMs?: number;
}

/** A line with its place in the queue. */
export interface QueuedLine {
  id: number;
  text: string;
  priority: VoicePriority;
  key: string | null;
  /** When it was asked for, in ms. */
  at: number;
  freshMs: number;
}

export function toQueued(line: VoiceLine, id: number, now: number): QueuedLine {
  const priority = line.priority ?? "normal";
  return {
    id,
    text: line.text.trim(),
    priority,
    key: line.key ?? null,
    at: now,
    freshMs: line.freshMs ?? VOICE_FRESH_MS[priority],
  };
}

/**
 * Take a new line in. It interrupts the line being said when it outranks it or
 * is a newer version of it (the same key); otherwise it waits behind every
 * line of its own rank or higher.
 */
export function admit(
  queue: readonly QueuedLine[],
  speaking: QueuedLine | null,
  line: QueuedLine,
): { queue: QueuedLine[]; interrupt: boolean } {
  const rest = line.key === null ? [...queue] : queue.filter((q) => q.key !== line.key);
  const interrupt =
    speaking !== null &&
    (VOICE_RANK[line.priority] > VOICE_RANK[speaking.priority] ||
      (line.key !== null && line.key === speaking.key));
  if (interrupt) return { queue: [line, ...rest].slice(0, VOICE_QUEUE_LIMIT), interrupt };
  const behind = rest.findIndex((q) => VOICE_RANK[q.priority] < VOICE_RANK[line.priority]);
  const next = behind === -1 ? [...rest, line] : [...rest.slice(0, behind), line, ...rest.slice(behind)];
  return { queue: next.slice(0, VOICE_QUEUE_LIMIT), interrupt: false };
}

/** The next line still worth saying, and the queue without it (and without the stale). */
export function nextLine(
  queue: readonly QueuedLine[],
  now: number,
): { line: QueuedLine | null; queue: QueuedLine[] } {
  const fresh = queue.filter((q) => now - q.at <= q.freshMs);
  return { line: fresh[0] ?? null, queue: fresh.slice(1) };
}

/**
 * About how long a line takes to say, for an engine that does not say when it
 * has finished (the app's own voice). Around 14 characters a second at the
 * rate the voice uses, and a little over is safer than under: the cost of
 * over is a short silence, the cost of under is the next line cutting this
 * one off.
 */
export function estimateSpeechMs(text: string, rate = 1): number {
  return Math.round(300 + (text.trim().length * 70) / rate);
}
