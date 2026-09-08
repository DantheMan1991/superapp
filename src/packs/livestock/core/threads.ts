/**
 * The advisor's threads. PURE — no imports, no database.
 *
 * What a kept conversation needs that a forgotten one did not: a title for
 * the list, a bound on how much of it travels back to the model, and a cap
 * on how much a farm asks in a day.
 */

/** How long a thread's title runs. One line on a phone. */
export const THREAD_TITLE_MAX = 80;

/**
 * The first question, cut to a line on a word boundary.
 *
 * Whitespace collapsed, because a question typed on a phone arrives with the
 * newlines a thumb put there; never empty, because a thread with no title
 * cannot be told from the others in the list.
 */
export function threadTitle(question: string): string {
  const flat = question.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "Untitled";
  if (flat.length <= THREAD_TITLE_MAX) return flat;
  const cut = flat.slice(0, THREAD_TITLE_MAX);
  const space = cut.lastIndexOf(" ");
  return `${(space > THREAD_TITLE_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface TurnLike {
  role: "user" | "assistant";
  content: string;
}

/**
 * The turns that travel with a question: the last `max` of them, starting on
 * a question. A window that opened on an answer would hand the model a reply
 * to nothing, which it reads as its own and builds on.
 */
export function historyForModel<T extends TurnLike>(turns: T[], max: number): T[] {
  const kept = turns.slice(Math.max(0, turns.length - Math.max(0, max)));
  const first = kept.findIndex((t) => t.role === "user");
  // No question in the window at all: hand over nothing, not a reply to nothing.
  if (first === -1) return [];
  return first === 0 ? kept : kept.slice(first);
}

/**
 * How many questions a farm may ask in a rolling day.
 *
 * The first bound the advisor has had. Every question is a model call on the
 * tenant's behalf, and until the thread was a row there was nothing to count.
 * A hundred is more than a farm asks and less than a script does.
 */
export const ADVISOR_DAILY_CAP = 100;

/** What the box says when the cap is reached. */
export function capMessage(cap: number): string {
  return `This farm has asked ${cap} questions in the last day. It starts again as the oldest ones fall out of the day.`;
}

/** A day, in milliseconds — the cap's window. */
export const DAY_MS = 24 * 60 * 60 * 1000;
