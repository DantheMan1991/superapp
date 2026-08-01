/**
 * The out-of-office reply: what counts as a usable one, and what it is doing
 * right now.
 *
 * Pure, because every bug in this feature is silent. An auto-reply that never
 * fires looks identical to one nobody triggered, and one that never stops looks
 * fine until a customer mentions it three weeks later. Nothing here can be
 * caught by using the product — only by checking the arithmetic.
 *
 * THE MAIL SERVER SENDS THE REPLY, not us. That is the whole point: it fires
 * while nobody is signed in, which is exactly when somebody is away. So this
 * validates what we hand over, and after that the behaviour is the server's.
 */

export interface AutoReplyDraft {
  isEnabled: boolean;
  /** RFC 3339, or null for "starting now". */
  fromDate: string | null;
  toDate: string | null;
  subject: string;
  textBody: string;
}

/** Long enough for a real message, short enough that nobody pastes a novel. */
export const MAX_BODY = 4_000;
export const MAX_SUBJECT = 200;

export type AutoReplyProblem =
  | { field: "textBody"; message: string }
  | { field: "subject"; message: string }
  | { field: "toDate"; message: string };

/**
 * What is wrong with this draft, or null.
 *
 * Only checked when ENABLED. A disabled auto-reply with an empty body is
 * somebody who turned it off, not somebody who made a mistake, and refusing to
 * save that would trap them in a form they are trying to leave.
 */
export function validateAutoReply(
  draft: AutoReplyDraft,
  now: Date,
): AutoReplyProblem | null {
  if (!draft.isEnabled) return null;

  // An enabled reply with no body makes the server send an empty message to
  // everyone who writes to you, which is worse than sending nothing at all.
  if (draft.textBody.trim() === "") {
    return { field: "textBody", message: "Write the message people will get." };
  }
  if (draft.textBody.length > MAX_BODY) {
    return {
      field: "textBody",
      message: `Keep it under ${MAX_BODY.toLocaleString()} characters.`,
    };
  }
  if (draft.subject.length > MAX_SUBJECT) {
    return {
      field: "subject",
      message: `Keep the subject under ${MAX_SUBJECT} characters.`,
    };
  }

  const from = parseDate(draft.fromDate);
  const to = parseDate(draft.toDate);

  if (draft.toDate !== null && to === null) {
    return { field: "toDate", message: "That end date isn't a date." };
  }
  if (from && to && to.getTime() <= from.getTime()) {
    return { field: "toDate", message: "The end has to come after the start." };
  }
  // Enabling something whose window has already closed is the quiet failure
  // this whole file exists for: it saves, it reports success, and it never
  // sends anything. Refuse it while the person is still looking at the form.
  if (to && to.getTime() <= now.getTime()) {
    return {
      field: "toDate",
      message: "That end date has already passed, so this would never send.",
    };
  }
  return null;
}

export type AutoReplyState =
  | { state: "off" }
  | { state: "active"; until: Date | null }
  | { state: "scheduled"; from: Date }
  | { state: "ended"; ended: Date };

/**
 * What the reply is doing at this instant, for the UI to say out loud.
 *
 * Worth its own function because `isEnabled` is not the same question. A reply
 * can be enabled and dormant (the window has not opened), or enabled and spent
 * (the window closed but nobody unticked the box). "On" would be true and
 * misleading in both cases, and the second one is how somebody believes their
 * customers are being answered when they are not.
 */
export function autoReplyState(
  draft: Pick<AutoReplyDraft, "isEnabled" | "fromDate" | "toDate">,
  now: Date,
): AutoReplyState {
  if (!draft.isEnabled) return { state: "off" };

  const from = parseDate(draft.fromDate);
  const to = parseDate(draft.toDate);

  if (to && to.getTime() <= now.getTime()) return { state: "ended", ended: to };
  if (from && from.getTime() > now.getTime()) return { state: "scheduled", from };
  return { state: "active", until: to };
}

function parseDate(value: string | null): Date | null {
  if (value === null || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
