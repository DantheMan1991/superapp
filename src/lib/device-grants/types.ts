/**
 * The device grant's limits and wire shapes. ADR 0048.
 *
 * DELIBERATELY NOT `server-only`. The settings screen is a client component
 * and reads `MAX_GRANTS_PER_PERSON` and `GRANT_DAYS` from here, the same split
 * `tell-sources/shape.ts` and `paste-targets/shape.ts` keep: the limits are
 * pure, and the database and the network live elsewhere.
 *
 * Everything here is pure. Nothing here reads or writes.
 */

/**
 * How long a grant lives without being used, slid forward on every use.
 *
 * THE FOUNDER'S ANSWER TO "WOULD ANYBODY REVOKE A DEPARTED WORKER'S PHONE?"
 * WAS NO, so this is the backstop rather than the formality it is on a feed
 * token. Thirty days: long enough that a phone somebody talks to every
 * morning never asks them to sign in again, short enough that a phone in a
 * drawer stops being a credential within a season.
 *
 * It is NOT what stops somebody who left — sliding expiry rewards use, and a
 * person still talking to it every day renews it forever. That is
 * `redeem.ts`'s INNER JOIN on `memberships`.
 */
export const GRANT_DAYS = 30;

/** How many phones one person may have pointed at one business. */
export const MAX_GRANTS_PER_PERSON = 5;

/**
 * How long a proposal a person has not confirmed stays confirmable.
 *
 * Five minutes because the failure it prevents is the surprising one: you say
 * "move Dexter 1 to paddock 5", a gate needs shutting, and an hour later in
 * the truck "yes" means something else entirely. Saying the sentence again is
 * a smaller cost than a write nobody remembers asking for. It also keeps
 * "yes" unambiguous — inside five minutes there is only ever one thing it
 * could mean.
 */
export const PROPOSAL_TTL_MS = 5 * 60 * 1_000;

/**
 * How far the phone's own clock may differ from the server's before it stops
 * being believed.
 *
 * A DEVICE CLOCK IS USER-SETTABLE, AND FOR A CLOCK-IN THE DIFFERENCE IS
 * WAGES. Inside the tolerance the phone is trusted, which matters because a
 * sentence queued in a barn with no signal may not reach us for hours and its
 * REAL time is the one it was spoken at. Outside it, the server's clock wins
 * and `device_grant_uses` keeps both, so a phone whose owner set the date
 * back is visible rather than quietly believed.
 */
export const SPOKEN_AT_TOLERANCE_MS = 15 * 60 * 1_000;

/**
 * The rate limit, per grant. Every sentence is a model call, so a phone in
 * somebody else's pocket is a bill as well as a write — and unlike the box on
 * a screen there is no disabled button to slow it down.
 *
 * Counted from `device_grant_uses` rather than an in-process map, because the
 * limit has to hold across serverless instances to mean anything.
 */
export const RATE_WINDOW_MS = 60 * 60 * 1_000;
export const RATE_MAX_PER_WINDOW = 60;

/**
 * Rough shape check before spending a database round trip. `mintToken()`
 * produces 32 random bytes as base64url, so 43 characters; the range is the
 * same generous one `looksLikeToken` uses.
 */
export function looksLikeDeviceToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{40,50}$/.test(value);
}

/**
 * The bearer token out of an Authorization header, or null.
 *
 * IN A HEADER AND NEVER IN THE PATH, unlike the calendar feed's token. That
 * one has no choice — a calendar client fetches a URL and nothing else. This
 * one is a WRITE credential, and a path lands in access logs, proxy logs and
 * any `Referer` the page leaks. The header does not.
 */
export function bearerFrom(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** What the phone sends back, signed, when the person says yes. */
export interface ProposalPayload {
  exp: number;
  /** Bound to the grant that made it: another phone cannot confirm your cards. */
  grantId: string;
  entries: Array<{ actionSlug: string; values: Record<string, string | number | null> }>;
}
