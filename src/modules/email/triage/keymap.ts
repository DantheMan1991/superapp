/**
 * Which key does what in the mail list.
 *
 * Pure on purpose. Deciding what a keystroke means and then doing it are two
 * different jobs, and only the second one needs a browser — so the rules live
 * here where a test can assert them, and the hook that binds them stays small
 * enough to read in one go.
 *
 * The letters are the ones every mail client has used since mutt, and that
 * Gmail, Outlook and Superhuman all inherited. Picking different ones to be
 * original would only make the feature worse: muscle memory is the entire
 * point of a keyboard shortcut, and nobody wants to learn a fourth dialect.
 */

export type MailShortcut =
  | "next"
  | "previous"
  | "open"
  | "close"
  | "select"
  | "star"
  | "archive"
  | "trash"
  | "read"
  | "unread"
  | "reply"
  | "compose"
  | "search"
  | "help";

/** The parts of a KeyboardEvent this needs. Keeps the tests free of a DOM. */
export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * Escape is the only key that still means something while typing.
 *
 * Anything else has to stay out of the way: `e` inside the composer is a
 * letter, not "archive", and a mail client that swallows characters mid-sentence
 * is one people turn shortcuts off in. The reverse mistake is worse — Escape
 * has to keep working, or the composer becomes a room with no door.
 */
const WHILE_EDITING: MailShortcut = "close";

const KEYS: Record<string, MailShortcut> = {
  j: "next",
  k: "previous",
  ArrowDown: "next",
  ArrowUp: "previous",
  o: "open",
  Enter: "open",
  Escape: "close",
  x: "select",
  s: "star",
  e: "archive",
  "#": "trash",
  I: "read",
  U: "unread",
  r: "reply",
  c: "compose",
  "/": "search",
  "?": "help",
};

/**
 * What this keystroke means, or null to let the browser have it.
 *
 * Modified keys are always declined. Ctrl-R is reload and Cmd-F is find, and a
 * web app that steals those has broken the browser rather than extended it.
 */
export function resolveShortcut(
  event: KeyEventLike,
  context: { isEditing: boolean },
): MailShortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const action = KEYS[event.key] ?? null;
  if (action === null) return null;

  if (context.isEditing) {
    return action === WHILE_EDITING ? WHILE_EDITING : null;
  }
  return action;
}

/**
 * The parts of an event target this needs. Structural rather than
 * `instanceof HTMLElement`, so the rule is testable in a node environment —
 * and so it cannot be fooled by an element from another document or frame,
 * where `instanceof` quietly returns false.
 */
export interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * Is the keystroke landing in something the user is typing into?
 *
 * `isContentEditable` is the one that matters and the one that gets forgotten:
 * a rich-text composer is a div, not a textarea, so a tag-name check alone
 * would eat every letter somebody types into a reply.
 */
export function isEditingTarget(
  target: EditableTargetLike | null | undefined,
): boolean {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Where j and k land.
 *
 * Extracted from the component because it is the part with edges, and edges in
 * a keyboard handler are invisible until somebody holds a key down: running off
 * the end of the list, and the first press when nothing is open yet.
 *
 * Clamps rather than wraps. Wrapping means holding `j` at the bottom silently
 * teleports you to the top, and the next `#` deletes a message you were not
 * looking at.
 *
 * @param count  how many rows are on screen
 * @param index  the cursor's row, or -1 when nothing is open
 * @returns the row to move to, or null when there is nowhere to go
 */
export function moveCursor(
  count: number,
  index: number,
  direction: "next" | "previous",
): number | null {
  if (count <= 0) return null;
  // Nothing open: the first press lands on the first row, so the keyboard
  // works without clicking something first — which is the entire point.
  if (index < 0) return 0;
  const next = direction === "next" ? index + 1 : index - 1;
  if (next < 0 || next >= count) return null;
  return next;
}

/** Shown by `?`. Order is the order they are worth learning. */
export const SHORTCUT_HELP: ReadonlyArray<{ keys: string; does: string }> = [
  { keys: "j / k", does: "Next and previous message" },
  { keys: "Enter", does: "Open" },
  { keys: "Esc", does: "Close, or clear the selection" },
  { keys: "x", does: "Select" },
  { keys: "s", does: "Flag" },
  { keys: "e", does: "Archive" },
  { keys: "#", does: "Trash" },
  { keys: "Shift + I / U", does: "Mark read or unread" },
  { keys: "r", does: "Reply" },
  { keys: "c", does: "Compose" },
  { keys: "/", does: "Search" },
  { keys: "?", does: "This list" },
];
