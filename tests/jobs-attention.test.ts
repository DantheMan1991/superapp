import { describe, expect, it } from "vitest";
import {
  acceptedProposalAttention,
  daysBetween,
  overdueSelectionAttention,
  subcontractorCoverAttention,
  type AcceptedProposal,
  type SubcontractorCover,
} from "../src/packs/jobs/attention-math";

/**
 * WHAT A JOB SAYS YOU OWE (the pack's fourth attention source).
 *
 * Pinned here because the alternative to a test is a morning email: an
 * obligation that reads wrong, points at the wrong screen or never clears is
 * something a person mutes, and a muted digest tells nobody anything. Every
 * case below is a state a real job reaches.
 */

const TODAY = "2026-10-14";

const signed: AcceptedProposal = {
  estimateId: "e1",
  projectId: "p1",
  projectNumber: "24-108",
  projectName: "Oak Row",
  number: "EST-2",
  title: "As drawn",
  signedName: "Marion Whitfield",
  signedOn: TODAY,
  amount: "$190,537.53",
  movedSince: false,
};

describe("a client accepted a proposal and nobody has answered", () => {
  it("names who accepted, which proposal and for how much", () => {
    const [item] = acceptedProposalAttention([signed], TODAY);
    expect(item.title).toBe("Marion Whitfield accepted EST-2 — $190,537.53");
    expect(item.detail).toContain("24-108 · Oak Row");
    expect(item.detail).toContain("As drawn");
  });

  it("links to the estimate itself, not to a list", () => {
    const [item] = acceptedProposalAttention([signed], TODAY);
    expect(item.href).toBe("/dashboard/m/jobs/p1/estimates/e1");
  });

  /**
   * The client has finished and the business has not. A day is as long as
   * that should sit, so the day itself is `today` and everything after is
   * overdue — the strongest badge the page has, behind the clearest fact.
   */
  it("is today on the day it was signed and overdue from the next", () => {
    expect(acceptedProposalAttention([signed], TODAY)[0].urgency).toBe("today");
    expect(acceptedProposalAttention([signed], "2026-10-15")[0].urgency).toBe("overdue");
    expect(acceptedProposalAttention([signed], "2026-11-20")[0].urgency).toBe("overdue");
  });

  it("carries the day they signed as the date it became due", () => {
    expect(acceptedProposalAttention([signed], TODAY)[0].dueOn).toBe(TODAY);
  });

  /**
   * An estimate edited after the signature must not print the signed price as
   * if it were current — but the acceptance still happened, so the line stays
   * and says both things.
   */
  it("says so when the estimate has changed since, and does not present the old price as current", () => {
    const [item] = acceptedProposalAttention([{ ...signed, movedSince: true }], TODAY);
    expect(item.title).toBe("Marion Whitfield accepted EST-2, and it has changed since");
    expect(item.title).not.toContain("$190,537.53");
    expect(item.detail).toContain("Accepted at $190,537.53 on 2026-10-14");
  });

  it("leaves an untitled estimate's separator out rather than printing a dangling dot", () => {
    const [item] = acceptedProposalAttention([{ ...signed, title: "" }], TODAY);
    expect(item.detail).toBe("24-108 · Oak Row");
  });

  it("is one line per signature and keys on the estimate, so nothing is reported twice", () => {
    const items = acceptedProposalAttention([signed, { ...signed, estimateId: "e2" }], TODAY);
    expect(items.map((i) => i.key)).toEqual([
      "jobs:estimate-signed:e1",
      "jobs:estimate-signed:e2",
    ]);
  });
});

describe("selections past the date the client was asked for", () => {
  const job = { projectId: "p1", projectNumber: "24-108", projectName: "Oak Row", overdue: 3 };

  it("is one line per job, because they are chased in one conversation", () => {
    const items = overdueSelectionAttention([job]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("3 selections still to choose on 24-108");
  });

  it("says selection, not selections, when there is one", () => {
    expect(overdueSelectionAttention([{ ...job, overdue: 1 }])[0].title).toBe(
      "1 selection still to choose on 24-108",
    );
  });

  it("raises nothing for a job with none", () => {
    expect(overdueSelectionAttention([{ ...job, overdue: 0 }])).toEqual([]);
  });

  /**
   * The dates belong to the individual selections and this line speaks for
   * several, so it carries none rather than electing one of them to stand for
   * the rest — a wrong date is worse than no date.
   */
  it("carries no due date, because it speaks for several", () => {
    expect(overdueSelectionAttention([job])[0].dueOn).toBeNull();
    expect(overdueSelectionAttention([job])[0].urgency).toBe("overdue");
  });

  it("points at the job's own selections screen", () => {
    expect(overdueSelectionAttention([job])[0].href).toBe("/dashboard/m/jobs/p1/selections");
  });
});

describe("a subcontractor on a live job whose cover does not stand up", () => {
  const party: SubcontractorCover = {
    partyId: "party1",
    partyName: "Ridge Plumbing",
    projectNumbers: ["24-108", "24-110"],
    lapsed: [],
    expiring: [],
    soonestExpiry: null,
  };

  it("raises nothing for a party in good standing", () => {
    expect(subcontractorCoverAttention([party])).toEqual([]);
  });

  /**
   * Two different asks, so two lines: somebody uninsured may be on site today,
   * while a certificate running out is a phone call this week. Collapsing them
   * would either overstate the second or bury the first.
   */
  it("separates lapsed from expiring, overdue from soon", () => {
    const items = subcontractorCoverAttention([
      {
        ...party,
        lapsed: ["Insurance certificate"],
        expiring: ["W9"],
        soonestExpiry: "2026-11-01",
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].urgency).toBe("overdue");
    expect(items[0].title).toBe("Ridge Plumbing is not covered");
    expect(items[0].detail).toContain("Insurance certificate expired or never on file");
    expect(items[1].urgency).toBe("soon");
    expect(items[1].dueOn).toBe("2026-11-01");
  });

  it("names the live jobs they are on, so the reader knows which site to look at", () => {
    const items = subcontractorCoverAttention([{ ...party, lapsed: ["Insurance certificate"] }]);
    expect(items[0].detail).toContain("on 24-108, 24-110");
  });

  it("omits the jobs clause entirely rather than printing an empty one", () => {
    const items = subcontractorCoverAttention([
      { ...party, projectNumbers: [], lapsed: ["Insurance certificate"] },
    ]);
    expect(items[0].detail).toBe("Insurance certificate expired or never on file");
  });

  it("falls back to a phrase when an expiring kind somehow has no date", () => {
    const items = subcontractorCoverAttention([{ ...party, expiring: ["W9"], soonestExpiry: null }]);
    expect(items[0].detail).toBe("within the month · on 24-108, 24-110");
    expect(items[0].dueOn).toBeNull();
  });

  it("keys the two lines apart, so one clearing does not clear the other", () => {
    const items = subcontractorCoverAttention([
      { ...party, lapsed: ["Insurance certificate"], expiring: ["W9"], soonestExpiry: "2026-11-01" },
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(2);
  });
});

describe("daysBetween", () => {
  it("counts whole days and goes negative backwards", () => {
    expect(daysBetween("2026-10-14", "2026-10-15")).toBe(1);
    expect(daysBetween("2026-10-15", "2026-10-14")).toBe(-1);
    expect(daysBetween("2026-10-14", "2026-10-14")).toBe(0);
  });

  /** UTC has no daylight saving, which is the whole reason for the helper. */
  it("is exact across a daylight-saving boundary", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });

  it("counts across a month and a year end", () => {
    expect(daysBetween("2026-01-31", "2026-02-01")).toBe(1);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });
});

describe("every item this source can produce", () => {
  /**
   * The contract's own requirements, checked once over every shape rather
   * than trusted: a key for dedup and delta comparison, a title with no
   * trailing period, and an `href` to the RECORD so the email is actionable
   * without a round trip through a list page.
   */
  it("has a key, a title with no trailing period, and a deep link", () => {
    const items = [
      ...acceptedProposalAttention([signed, { ...signed, estimateId: "e9", movedSince: true }], TODAY),
      ...overdueSelectionAttention([
        { projectId: "p1", projectNumber: "24-108", projectName: "Oak Row", overdue: 2 },
      ]),
      ...subcontractorCoverAttention([
        {
          partyId: "party1",
          partyName: "Ridge Plumbing",
          projectNumbers: ["24-108"],
          lapsed: ["Insurance certificate"],
          expiring: ["W9"],
          soonestExpiry: "2026-11-01",
        },
      ]),
    ];
    expect(items).toHaveLength(5);
    expect(new Set(items.map((i) => i.key)).size).toBe(5);
    for (const i of items) {
      expect(i.key, i.key).toMatch(/^jobs:/);
      expect(i.title, i.key).not.toMatch(/\.$/);
      expect(i.title.length, i.key).toBeGreaterThan(0);
      expect(i.href, i.key).toMatch(/^\/dashboard\/m\/jobs\//);
      expect(["overdue", "today", "soon"], i.key).toContain(i.urgency);
    }
  });
});
