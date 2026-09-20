import { describe, expect, it } from "vitest";
import {
  BID_DEFAULT_DAYS,
  BID_GRACE_DAYS,
  bidStanding,
  invitationAcceptsReply,
  invitationExpiryFor,
  invitationOpens,
  summarizePackage,
  type InvitationFacts,
} from "../src/packs/jobs/bid-math";

/**
 * ASKING SUBCONTRACTORS FOR A NUMBER (X3, ADR 0098).
 *
 * The load-bearing rule here is that **a reply outlives the door**: what
 * somebody SAID is a fact, and what happened to their link afterwards does
 * not unsay it.
 */

const NOW = new Date("2026-09-20T12:00:00Z");

function facts(over: Partial<InvitationFacts> = {}): InvitationFacts {
  return {
    amountCents: null,
    declined: false,
    revokedAt: null,
    expiresAt: new Date("2026-10-20T12:00:00Z"),
    viewCount: 0,
    ...over,
  };
}

describe("bidStanding", () => {
  it("is waiting when nothing has happened", () => {
    expect(bidStanding(facts(), NOW)).toBe("waiting");
  });

  it("is opened once they have looked", () => {
    expect(bidStanding(facts({ viewCount: 3 }), NOW)).toBe("opened");
  });

  it("is a bid once there is a number", () => {
    expect(bidStanding(facts({ amountCents: 1_250_000 }), NOW)).toBe("bid");
  });

  it("is a no bid when they said so", () => {
    expect(bidStanding(facts({ declined: true }), NOW)).toBe("no bid");
  });

  it("is revoked or expired when the door shut before they answered", () => {
    expect(bidStanding(facts({ revokedAt: NOW }), NOW)).toBe("revoked");
    expect(bidStanding(facts({ expiresAt: new Date("2026-09-01T00:00:00Z") }), NOW)).toBe(
      "expired",
    );
  });

  /**
   * **A REPLY OUTLIVES THE DOOR.** A number given and then a link revoked is
   * still a number they gave; a page that showed "revoked" over a real bid
   * would lose the only fact that matters. Revoking takes back access, not
   * testimony.
   */
  it("keeps a reply ahead of whatever happened to the link", () => {
    expect(bidStanding(facts({ amountCents: 900_00, revokedAt: NOW }), NOW)).toBe("bid");
    expect(
      bidStanding(
        facts({ amountCents: 900_00, expiresAt: new Date("2026-09-01T00:00:00Z") }),
        NOW,
      ),
    ).toBe("bid");
    expect(bidStanding(facts({ declined: true, revokedAt: NOW }), NOW)).toBe("no bid");
  });

  it("expires exactly at the moment, not a tick after", () => {
    expect(bidStanding(facts({ expiresAt: NOW }), NOW)).toBe("expired");
  });
});

describe("what the door does", () => {
  it("opens while the link is live", () => {
    expect(invitationOpens(facts(), NOW)).toBe(true);
  });

  it("shuts when revoked or expired", () => {
    expect(invitationOpens(facts({ revokedAt: NOW }), NOW)).toBe(false);
    expect(invitationOpens(facts({ expiresAt: new Date("2026-01-01") }), NOW)).toBe(false);
  });

  /**
   * A subcontractor who sent a number and comes back to check what they sent
   * should SEE it. `acceptsReply` is the separate question of whether they
   * may send another, and they may not.
   */
  it("still opens after a reply, but takes no second one", () => {
    const replied = facts({ amountCents: 1_000_00 });
    expect(invitationOpens(replied, NOW)).toBe(true);
    expect(invitationAcceptsReply(replied, NOW)).toBe(false);
    const declined = facts({ declined: true });
    expect(invitationOpens(declined, NOW)).toBe(true);
    expect(invitationAcceptsReply(declined, NOW)).toBe(false);
  });

  it("takes no reply through a shut door", () => {
    expect(invitationAcceptsReply(facts({ revokedAt: NOW }), NOW)).toBe(false);
  });
});

describe("summarizePackage: the spread, not the average", () => {
  it("counts every kind of answer and both ends of the range", () => {
    const out = summarizePackage(
      [
        { ...facts({ amountCents: 1_200_000 }), isAwarded: false },
        { ...facts({ amountCents: 1_050_000 }), isAwarded: true },
        { ...facts({ declined: true }), isAwarded: false },
        { ...facts({ viewCount: 2 }), isAwarded: false },
        { ...facts(), isAwarded: false },
      ],
      NOW,
    );
    expect(out).toEqual({
      asked: 5,
      bid: 2,
      declined: 1,
      opened: 1,
      silent: 1,
      lowestCents: 1_050_000,
      highestCents: 1_200_000,
      awardedCents: 1_050_000,
    });
  });

  it("counts a revoked or expired silence as silence", () => {
    const out = summarizePackage(
      [
        { ...facts({ revokedAt: NOW }), isAwarded: false },
        { ...facts({ expiresAt: new Date("2026-01-01") }), isAwarded: false },
      ],
      NOW,
    );
    expect(out.silent).toBe(2);
    expect(out.lowestCents).toBeNull();
  });

  it("says nothing about a package nobody was asked for", () => {
    expect(summarizePackage([], NOW)).toEqual({
      asked: 0,
      bid: 0,
      declined: 0,
      opened: 0,
      silent: 0,
      lowestCents: null,
      highestCents: null,
      awardedCents: null,
    });
  });

  /** One price is a range of one, and that is not a spread worth drawing. */
  it("gives the same figure at both ends for a single bid", () => {
    const out = summarizePackage(
      [{ ...facts({ amountCents: 500_00 }), isAwarded: false }],
      NOW,
    );
    expect(out.lowestCents).toBe(out.highestCents);
  });
});

describe("invitationExpiryFor", () => {
  it("runs to the end of the due day plus the grace week", () => {
    const out = invitationExpiryFor("2026-10-01", NOW);
    const expected = new Date("2026-10-01T23:59:59.999Z").getTime() + BID_GRACE_DAYS * 86_400_000;
    expect(out.getTime()).toBe(expected);
  });

  /**
   * A sub who answers the morning after the deadline is a sub whose number
   * you still want; a link that died at midnight would throw it away.
   */
  it("gives a week past a deadline that has only just gone", () => {
    const out = invitationExpiryFor("2026-09-19", NOW);
    expect(out.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("falls back to thirty days with no date, and for a long-dead one", () => {
    const fallback = new Date(NOW.getTime() + BID_DEFAULT_DAYS * 86_400_000).getTime();
    expect(invitationExpiryFor(null, NOW).getTime()).toBe(fallback);
    expect(invitationExpiryFor("2020-01-01", NOW).getTime()).toBe(fallback);
  });

  it("ignores a date it cannot read", () => {
    const fallback = new Date(NOW.getTime() + BID_DEFAULT_DAYS * 86_400_000).getTime();
    expect(invitationExpiryFor("not a date", NOW).getTime()).toBe(fallback);
  });
});
