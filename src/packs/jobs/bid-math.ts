/**
 * WHERE A BID REQUEST HAS GOT TO (X3, ADR 0098) — pure, so the standing of
 * an invitation is testable without a token or a clock of its own.
 *
 * **A REPLY OUTLIVES THE DOOR.** The order below puts what a subcontractor
 * SAID ahead of what happened to their link: a number given and then a link
 * revoked is still a number they gave, and a page that showed "revoked" over
 * a real bid would lose the fact that matters. Revoking takes back access,
 * not testimony.
 */

export type BidStanding =
  /** They gave a number. */
  | "bid"
  /** They looked and said no. Not the same as silence, and worth knowing. */
  | "no bid"
  /** The link was taken back before they answered. */
  | "revoked"
  /** The link died before they answered. */
  | "expired"
  /** They opened it and have not answered. */
  | "opened"
  /** Nothing has happened. */
  | "waiting";

export interface InvitationFacts {
  amountCents: number | null;
  declined: boolean;
  revokedAt: Date | null;
  expiresAt: Date;
  viewCount: number;
}

export function bidStanding(f: InvitationFacts, now: Date): BidStanding {
  if (f.amountCents !== null) return "bid";
  if (f.declined) return "no bid";
  if (f.revokedAt !== null) return "revoked";
  if (f.expiresAt.getTime() <= now.getTime()) return "expired";
  return f.viewCount > 0 ? "opened" : "waiting";
}

/** Whether the door opens at all. A reply already given closes it too. */
export function invitationOpens(f: InvitationFacts, now: Date): boolean {
  if (f.revokedAt !== null) return false;
  if (f.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Whether a subcontractor may still answer — opens, and has not already. */
export function invitationAcceptsReply(f: InvitationFacts, now: Date): boolean {
  if (!invitationOpens(f, now)) return false;
  return f.amountCents === null && !f.declined;
}

export interface PackageSummary {
  asked: number;
  /** Gave a number. */
  bid: number;
  /** Said no. */
  declined: number;
  /** Opened it and said nothing. */
  opened: number;
  /** Heard nothing at all. */
  silent: number;
  lowestCents: number | null;
  highestCents: number | null;
  awardedCents: number | null;
}

/**
 * What a package comes to at a glance.
 *
 * **THE SPREAD IS THE POINT**, not the average: three numbers within five
 * per cent means the scope is understood and any of them is safe, and one at
 * half the others means somebody has read it differently. An average would
 * hide exactly that.
 */
export function summarizePackage(
  invitations: readonly (InvitationFacts & { isAwarded: boolean })[],
  now: Date,
): PackageSummary {
  const out: PackageSummary = {
    asked: invitations.length,
    bid: 0,
    declined: 0,
    opened: 0,
    silent: 0,
    lowestCents: null,
    highestCents: null,
    awardedCents: null,
  };
  for (const i of invitations) {
    switch (bidStanding(i, now)) {
      case "bid":
        out.bid += 1;
        break;
      case "no bid":
        out.declined += 1;
        break;
      case "opened":
        out.opened += 1;
        break;
      default:
        out.silent += 1;
    }
    if (i.amountCents !== null) {
      out.lowestCents =
        out.lowestCents === null ? i.amountCents : Math.min(out.lowestCents, i.amountCents);
      out.highestCents =
        out.highestCents === null ? i.amountCents : Math.max(out.highestCents, i.amountCents);
      if (i.isAwarded) out.awardedCents = i.amountCents;
    }
  }
  return out;
}

/** No never-expiring anonymous links — `document_shares`' rule. */
export const BID_DEFAULT_DAYS = 30;

/**
 * When an invitation should die.
 *
 * The package usually says: a due date is the day numbers are wanted by, and
 * a link that outlived it would be collecting bids after the decision. It
 * ends at the END of that day, because "by the 14th" includes the 14th — and
 * then a week of grace, because a sub who answers the morning after the
 * deadline is a sub whose number you still want.
 */
export const BID_GRACE_DAYS = 7;

export function invitationExpiryFor(dueOn: string | null, now: Date): Date {
  if (dueOn !== null) {
    const end = new Date(`${dueOn}T23:59:59.999Z`);
    if (!Number.isNaN(end.getTime())) {
      const withGrace = new Date(end.getTime() + BID_GRACE_DAYS * 86_400_000);
      if (withGrace.getTime() > now.getTime()) return withGrace;
    }
  }
  return new Date(now.getTime() + BID_DEFAULT_DAYS * 86_400_000);
}
