import {
  WORK_STATES,
  WORK_CLOSED_STATES,
  type WorkState,
} from "@/lib/work/vocabulary";

/**
 * The state vocabulary, in one place, with no database anywhere near it.
 *
 * NO `"use client"` AND NO `server-only` HERE, deliberately. conventions §8:
 * a server component that imports a plain value from a `"use client"` module
 * gets a client *reference* and throws at render, and `npm run build`, `tsc`
 * and eslint are all green either way. `centsToInput` living in `deal-form.tsx`
 * took the whole CRM deal page down in production. A board renders these labels
 * in the browser and the digest renders them on the server, so this file has to
 * be importable by both.
 */

/**
 * What core calls each state when nothing else does.
 *
 * These are DEFAULTS, not the truth: a profile supplies "On the way" where core
 * says "In progress", and `describeWorkState` is the only thing that decides
 * which one a reader sees. Nothing else in the product may join a state to a
 * label, or there will be two answers.
 */
const STATE_LABELS: Record<WorkState, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

/** Board column order. Least finished first, matching WORK_STATES. */
export const WORK_STATE_ORDER: readonly WorkState[] = WORK_STATES;

export function isWorkState(value: string): value is WorkState {
  return (WORK_STATES as readonly string[]).includes(value);
}

/** Done or cancelled — finished with, either way. See `closed_at`. */
export function isClosedState(state: WorkState): boolean {
  return (WORK_CLOSED_STATES as readonly string[]).includes(state);
}

/**
 * What to show a person for one item's state.
 *
 * THE MECHANISM/VOCABULARY SPLIT, EXPRESSED AS ONE FUNCTION. `state` is what
 * code reasons about and `status` is the label a profile or pack supplied; when
 * a label exists it wins, and when it does not core's own word stands in. Every
 * surface calls this rather than reading either column directly, so a pack
 * shipping "Awaiting parts" reaches the board, the list and the digest without
 * any of them learning the word.
 *
 * A `status` of whitespace is treated as absent: an empty label rendered in
 * place of "Blocked" is a chip with nothing in it, which reads as a bug.
 */
export function describeWorkState(state: WorkState, status: string): string {
  const label = status.trim();
  return label.length > 0 ? label : STATE_LABELS[state];
}

/** Core's own word for a state, ignoring any supplied label. */
export function coreStateLabel(state: WorkState): string {
  return STATE_LABELS[state];
}
