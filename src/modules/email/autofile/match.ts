import type { JmapEmail, JmapEmailFilter } from "@/lib/email/jmap/types";
import { KEYWORD_DRAFT } from "@/lib/email/jmap/types";

/**
 * What an auto-filing rule asks the mail server for, and what it accepts back.
 *
 * Pure and free of `server-only`, so the two decisions that decide whether this
 * feature files the right things — the query it sends and the messages it keeps
 * — are testable without a mail server. Every fact encoded here came from
 * `npm run mail:probe-autofile` against a live Stalwart rather than from the
 * spec.
 */

/**
 * One page of work. Small on purpose: the sweep downloads whole messages, and a
 * rule that has been switched off for a month must not try to file a month of
 * mail inside one 60-second cron invocation.
 */
export const AUTOFILE_PAGE = 10;

/**
 * The filter for one rule.
 *
 * THREE CONDITIONS, AND EACH ONE EXISTS BECAUSE THE PROBE FOUND SOMETHING:
 *
 *   • `hasAttachment: true` — the trigger. Confirmed to match a message with a
 *     real attachment, and confirmed NOT to match one whose only part is an
 *     inline `cid:` logo. That second half is what makes this affordable: every
 *     business signature carries a logo, so a flag that counted them would have
 *     the sweep download the entire mailbox to discover there was nothing to
 *     file.
 *   • `notKeyword: "$draft"` — the probe found `Email/changes.created` includes
 *     the user's OWN drafts, and a query would see them too. Filing somebody's
 *     outgoing work back into the cabinet is the loop this feature must not
 *     have.
 *   • `after: cursor - CURSOR_OVERLAP_MS` — the watermark, deliberately backed
 *     off. Not a correctness guarantee (the filing target is idempotent on the
 *     raw message's sha256) but a cost one: without it, every sweep
 *     re-downloads every message it has ever filed just to compute that hash.
 *
 * `inMailbox` narrows to a folder when the rule names one. When it does not,
 * the caller passes the INBOX rather than leaving it open — an unrestricted
 * query would reach Sent and Drafts, which is the same loop by another door.
 */
export function autofileFilter(
  rule: { matchMailboxId: string | null; cursor: Date | null },
  fallbackMailboxId: string,
): JmapEmailFilter {
  const filter: JmapEmailFilter = {
    inMailbox: rule.matchMailboxId ?? fallbackMailboxId,
    hasAttachment: true,
    notKeyword: KEYWORD_DRAFT,
  };
  if (rule.cursor) {
    filter.after = new Date(rule.cursor.getTime() - CURSOR_OVERLAP_MS);
  }
  return filter;
}

/**
 * How far BEHIND the watermark the query starts, and why it is not zero.
 *
 * **`after` is EXCLUSIVE on this server** — `npm run mail:probe-autofile`
 * asked, and the answer contradicts RFC 8621, which says the receivedAt "must
 * be the same as or after this". Querying `after: cursor` therefore steps over
 * every message sharing the boundary's timestamp, and `receivedAt` has
 * second granularity: two invoices sent together, or a batch landing in a busy
 * `accounts@`, arrive in the same second routinely. Those messages would never
 * be filed and nothing would ever say so.
 *
 * That is the unrecoverable direction, so the query starts a second early and
 * the overlap is absorbed by the filing target's idempotency — the probe
 * confirmed both halves: that the boundary message is excluded at `cursor`, and
 * that it comes back at `cursor - 1s`.
 *
 * The COST is bounded and small: at most one second's worth of already-filed
 * messages re-examined per rule per tick. The alternative — storing a fudged
 * value in the column — would make the stored number mean something other than
 * what it says, and the next person to read it would have to know that.
 */
export const CURSOR_OVERLAP_MS = 1000;

/**
 * Does this sender match the rule?
 *
 * A case-folded substring of the ADDRESS, deliberately not the display name: a
 * display name is chosen by the sender and "Acme Ltd Accounts" is trivially
 * spoofable, while the address is at least the thing the mail was delivered
 * from. An empty pattern matches everything, which is only reachable when the
 * rule names a folder — `saveAutofileRuleAction` refuses a rule that constrains
 * neither, because that one files the entire mailbox.
 */
export function senderMatches(fromAddress: string, matchFrom: string): boolean {
  const pattern = matchFrom.trim().toLowerCase();
  if (pattern.length === 0) return true;
  return fromAddress.trim().toLowerCase().includes(pattern);
}

/**
 * Attachments worth filing as documents of their own.
 *
 * The same rule `filing.ts` applies when a person files by hand, restated here
 * because the sweep has to answer it BEFORE downloading anything. An inline
 * `cid:` part is a logo in somebody's signature, not a file for the cabinet;
 * it is still inside the `.eml` either way.
 *
 * Duplicated rather than imported because `filing.ts` is `server-only` and this
 * module is deliberately not — and there is a test asserting the two agree, the
 * same arrangement `labelPatch` has with the JMAP client's copy.
 */
export function filableParts(message: JmapEmail) {
  return message.attachments.filter(
    (a) => a.blobId !== null && (a.disposition !== "inline" || !a.cid),
  );
}

export type SkipReason = "draft" | "sender" | "no-attachment" | null;

/**
 * Should this message be filed by this rule?
 *
 * Runs over the message METADATA the query already returned, before a single
 * byte of body or attachment is fetched. That ordering is the whole point: a
 * message rejected here costs one row in a list somebody already asked for,
 * while one rejected after downloading costs an attachment's worth of transfer
 * and a serverless function's memory.
 *
 * The `$draft` and attachment checks duplicate what the filter already asked
 * for, and that is intentional. A JMAP condition the server accepted and
 * silently ignored looks exactly like one that worked — the lesson
 * `mail:probe-search` cost four hand-written checks to learn — so the client
 * re-asserts the two conditions whose failure would be actively harmful rather
 * than merely wasteful.
 */
export function skipReasonFor(
  message: JmapEmail,
  rule: { matchFrom: string },
): SkipReason {
  if (message.keywords[KEYWORD_DRAFT] === true) return "draft";
  if (!senderMatches(message.from[0]?.email ?? "", rule.matchFrom)) {
    return "sender";
  }
  if (filableParts(message).length === 0) return "no-attachment";
  return null;
}

/**
 * Where the watermark moves to.
 *
 * MONOTONIC, and never past a message that was not dealt with. The sweep
 * advances only over the prefix it actually finished, so a failure in the
 * middle of a page leaves everything after it to be retried — filing twice is a
 * no-op (the target dedupes on the raw message's sha256) and skipping is a
 * document nobody ever sees.
 *
 * A null `receivedAt` cannot move the cursor: it carries no position, and
 * treating it as "now" would step over messages that had not been considered.
 */
export function advanceCursor(
  current: Date | null,
  processed: readonly (Date | null)[],
): Date | null {
  let next = current;
  for (const at of processed) {
    if (!at) continue;
    if (!next || at > next) next = at;
  }
  return next;
}
