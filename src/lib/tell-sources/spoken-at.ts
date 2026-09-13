/**
 * WHEN WAS IT SAID — and how much of the phone's answer to believe.
 *
 * ── THE RULE, AND WHY IT IS NOT SYMMETRIC ([ADR 0055](../../../docs/decisions/0055-a-queued-sentence-is-old-not-wrong.md)) ──
 *
 * [ADR 0048](../../../docs/decisions/0048-a-phone-holds-a-grant-that-may-only-tell.md)
 * clamped a claimed time to ±15 minutes of the server's, and justified it with
 * *"a sentence queued in a barn with no signal may not reach us for hours"* —
 * which the rule then refused. One number was answering two questions:
 *
 *   how WRONG might this clock be?     symmetric, minutes
 *   how OLD might this sentence be?    one-directional, hours
 *
 * Nothing about a phone being out of signal for three hours suggests its clock
 * is three hours wrong. So: **believe the past, bound the future.**
 *
 * ── WHY IT LIVES HERE AND NOT IN `device-grants` ─────────────────────────────
 *
 * The thing being timestamped is a told SENTENCE, not a grant. The web box has
 * no grant at all and needs the same answer for the offline queue
 * ([tell.md](../../../docs/modules/tell.md), slice D2), and two copies of this
 * rule is how two paths come to disagree about somebody's wages.
 *
 * Pure, and deliberately not `server-only`: the box can use it to tell somebody
 * their queued sentence is too old to be believed BEFORE it sends it.
 */

/**
 * How far INTO THE FUTURE a claimed time may sit before the server's wins.
 *
 * Small, because a sentence cannot have been spoken later than it arrived.
 * Anything beyond honest clock skew is a wrong clock or a lie — and **this is
 * the direction fraud points in**, since back-dating a clock-in pays and
 * post-dating one does not.
 */
export const SPOKEN_AT_FUTURE_SKEW_MS = 2 * 60 * 1_000;

/**
 * How far INTO THE PAST a claimed time may sit before the server's wins.
 *
 * Generous, because that is the ordinary case: a phone out of signal overnight
 * and into the next day is a farm, not an attack. A sentence arriving a week
 * late is likelier a bug or a clock set wrong than a field recording, so there
 * is still a bound.
 */
export const SPOKEN_AT_MAX_AGE_MS = 48 * 60 * 60 * 1_000;

export interface SpokenAt {
  /** The time the rest of the system should treat as "now" for this sentence. */
  effectiveAt: Date;
  /** The claim was not believed, and the server's clock was used instead. */
  clamped: boolean;
  /**
   * How long the sentence waited, in milliseconds, when it WAS believed.
   *
   * Returned rather than merely stored so a caller can put it in front of
   * somebody — on the card, in the summary, in the audit line. A three-hour-old
   * clock-in recorded silently is indistinguishable from a fresh one, and
   * "visible in a table nobody reads" is not a control.
   */
  delayedMs: number;
}

/**
 * What time the sentence happened, given what the device claims.
 *
 * A missing or unparseable claim is not an error and not a lie — most sentences
 * are typed on a screen and simply happened now.
 */
export function clampSpokenAt(claimed: Date | null, serverNow: Date): SpokenAt {
  if (!claimed || Number.isNaN(claimed.getTime())) {
    return { effectiveAt: serverNow, clamped: false, delayedMs: 0 };
  }

  const ahead = claimed.getTime() - serverNow.getTime();

  // Later than it arrived. No honest device produces this beyond skew.
  if (ahead > SPOKEN_AT_FUTURE_SKEW_MS) {
    return { effectiveAt: serverNow, clamped: true, delayedMs: 0 };
  }

  // Older than anything that is plausibly still a field recording.
  if (-ahead > SPOKEN_AT_MAX_AGE_MS) {
    return { effectiveAt: serverNow, clamped: true, delayedMs: 0 };
  }

  // Believed. A claim a few seconds ahead is honest skew, and treating it as a
  // negative delay would be arithmetic rather than a fact about the world.
  return {
    effectiveAt: claimed,
    clamped: false,
    delayedMs: Math.max(0, -ahead),
  };
}

/**
 * Long enough ago that somebody should be TOLD it was recorded late.
 *
 * Not a bound — the sentence is believed either side of this. It is the line
 * between "that just happened" and "this is a sentence from earlier", and it
 * sits where the old symmetric tolerance did, which is about the longest a
 * delay can go unremarked before it stops being a rounding difference.
 */
export const WORTH_MENTIONING_MS = 15 * 60 * 1_000;

export function wasSaidEarlier(spoken: SpokenAt): boolean {
  return !spoken.clamped && spoken.delayedMs >= WORTH_MENTIONING_MS;
}
