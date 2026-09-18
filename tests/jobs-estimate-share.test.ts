import { describe, expect, it } from "vitest";
import {
  SHARE_STANDING_LABELS,
  shareAcceptsSignature,
  shareOpens,
  shareStanding,
  type ShareFacts,
} from "../src/packs/jobs/estimate-share-status";
import { SHARE_DEFAULT_DAYS, shareExpiryFor } from "../src/packs/jobs/estimate-shares";
import { buildProposalDocument } from "../src/packs/jobs/proposal-sections";
import { renderProposalHtml } from "../src/packs/jobs/proposal-html";
import type { ProposalInput } from "../src/packs/jobs/proposal-model";

/**
 * THE CLIENT'S LINK (E5c, ADR 0085) — the pure half.
 *
 * The standing is derived from the facts, so it is pinned here rather than
 * discovered on a live link: every one of these is a state a real client link
 * reaches, and getting one wrong means either a dead proposal or a live one
 * that should not be.
 */

const NOW = new Date("2026-10-14T12:00:00Z");

function facts(over: Partial<ShareFacts> = {}): ShareFacts {
  return {
    revokedAt: null,
    expiresAt: new Date("2026-11-14T00:00:00Z"),
    signedAt: null,
    signedEstimateVersion: null,
    estimateVersion: 7,
    ...over,
  };
}

describe("shareStanding: what a client link is, derived", () => {
  it("is open when nothing has happened to it", () => {
    expect(shareStanding(facts(), NOW)).toBe("open");
  });

  it("is signed when it was accepted at the version the estimate is still at", () => {
    expect(shareStanding(facts({ signedAt: NOW, signedEstimateVersion: 7 }), NOW)).toBe("signed");
  });

  /**
   * The one standing that is a fact about TWO rows. A link that was signed and
   * whose estimate then moved cannot go on serving a document that is not the
   * one that was signed, and must not offer a second signature against
   * different content.
   */
  it("is superseded when the estimate moved on after the signature", () => {
    expect(shareStanding(facts({ signedAt: NOW, signedEstimateVersion: 6 }), NOW)).toBe("superseded");
  });

  it("is expired the instant its date passes, and the boundary is not open", () => {
    const at = new Date("2026-11-14T00:00:00Z");
    expect(shareStanding(facts({ expiresAt: at }), new Date(at.getTime() - 1))).toBe("open");
    expect(shareStanding(facts({ expiresAt: at }), at)).toBe("expired");
  });

  it("is revoked, and revoked beats every other reading — it is the builder saying no", () => {
    expect(shareStanding(facts({ revokedAt: NOW }), NOW)).toBe("revoked");
    // Even signed, even in date.
    expect(
      shareStanding(facts({ revokedAt: NOW, signedAt: NOW, signedEstimateVersion: 7 }), NOW),
    ).toBe("revoked");
  });

  it("puts expiry ahead of a signature, so an expired link stops opening although its signature stands", () => {
    const standing = shareStanding(
      facts({ expiresAt: new Date("2026-10-01T00:00:00Z"), signedAt: NOW, signedEstimateVersion: 7 }),
      NOW,
    );
    expect(standing).toBe("expired");
  });

  it("opens only while open or signed, and accepts a signature only while open", () => {
    expect(shareOpens("open")).toBe(true);
    expect(shareOpens("signed")).toBe(true);
    for (const dead of ["revoked", "expired", "superseded"] as const) {
      expect(shareOpens(dead), dead).toBe(false);
      expect(shareAcceptsSignature(dead), dead).toBe(false);
    }
    // A link is signed ONCE. A signed one is readable and not signable.
    expect(shareAcceptsSignature("signed")).toBe(false);
    expect(shareAcceptsSignature("open")).toBe(true);
  });

  it("has a label for every standing, so the builder's list can never render a blank", () => {
    for (const standing of ["open", "signed", "revoked", "expired", "superseded"] as const) {
      expect(SHARE_STANDING_LABELS[standing], standing).not.toBe("");
    }
  });
});

describe("shareExpiryFor: the proposal's own validity decides", () => {
  it("ends the link when the offer ends, at the end of that day", () => {
    const at = shareExpiryFor("2026-11-30", NOW);
    expect(at.toISOString().startsWith("2026-11-30T23:59:59")).toBe(true);
  });

  it("falls back to thirty days when the estimate names no date", () => {
    const at = shareExpiryFor(null, NOW);
    expect(at.getTime() - NOW.getTime()).toBe(SHARE_DEFAULT_DAYS * 24 * 60 * 60 * 1000);
  });

  /**
   * A proposal whose validity has already passed would otherwise mint a link
   * that was dead on arrival — which reads as a broken feature rather than as
   * an expired offer. Thirty days from now, and the document still prints its
   * own *valid until* line for the client to read.
   */
  it("does not mint a link that is already expired", () => {
    const at = shareExpiryFor("2026-01-01", NOW);
    expect(at.getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("ignores a date it cannot read rather than producing an invalid one", () => {
    const at = shareExpiryFor("not-a-date", NOW);
    expect(Number.isNaN(at.getTime())).toBe(false);
    expect(at.getTime()).toBeGreaterThan(NOW.getTime());
  });
});

/* ------------------------------------------------------------------ the page */

const base: ProposalInput = {
  businessName: "Ops Builder LLC",
  toName: "Oak Row Owner",
  toAddress: "17 Main St, Mount Vernon, OH 43050",
  projectNumber: "24-108",
  projectName: "Oak Row residence",
  projectAddress: "4 Mill Lane",
  number: "EST-1",
  title: "As drawn",
  status: "sent",
  sentOn: "2026-10-01",
  validUntil: "2026-11-30",
  presentation: "lines",
  scope: "A new home as drawn on sheets A1-A9.",
  exclusions: "Permits and utility fees.",
  terms: "Ten percent on signing.",
  markupPpm: 150_000,
  overheadPpm: 100_000,
  profitPpm: 100_000,
  lines: [
    { description: "Slab, 4in, fibre mesh", unit: "cy", quantityThousandths: 120_000, unitCostCents: 185_00, markupPpm: null, unitPriceCents: null, codeLabel: "03 30 00 · Cast-in-place concrete" },
  ],
};

const brand = { businessName: "Ops Builder LLC", tagline: "", primaryColor: null, logo: null };
const doc = () => buildProposalDocument(base, {}, "brochure");

describe("the reply card the client link adds", () => {
  it("is absent from the document every other door serves", () => {
    const html = renderProposalHtml(doc(), brand);
    expect(html).not.toContain('class="accept"');
    expect(html).not.toContain("<form");
  });

  it("asks for a name and carries the version being shown, so a revision can refuse", () => {
    const html = renderProposalHtml(doc(), brand, {
      acceptUrl: "/proposal/tok/accept",
      estimateVersion: 9,
      signed: null,
    });
    expect(html).toContain('action="/proposal/tok/accept"');
    expect(html).toContain('name="version" value="9"');
    expect(html).toContain('name="name"');
    expect(html).toContain("Accept this proposal");
  });

  it("says who accepted and asks nothing more, once it is signed", () => {
    const html = renderProposalHtml(doc(), brand, {
      acceptUrl: "/proposal/tok/accept",
      estimateVersion: 9,
      signed: { name: "Dana Reeves", on: "14 October 2026" },
    });
    expect(html).toContain("Dana Reeves");
    expect(html).toContain("14 October 2026");
    expect(html).not.toContain("<form");
  });

  it("escapes what the client typed, so a name cannot become markup", () => {
    const html = renderProposalHtml(doc(), brand, {
      acceptUrl: "/proposal/tok/accept",
      estimateVersion: 1,
      signed: { name: '<script>alert("x")</script>', on: "today" },
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows a refusal above the field rather than on a page of its own", () => {
    const html = renderProposalHtml(doc(), brand, {
      acceptUrl: "/proposal/tok/accept",
      estimateVersion: 1,
      signed: null,
      error: "This proposal was updated while you had it open.",
    });
    expect(html).toContain('class="bad"');
    expect(html).toContain("This proposal was updated while you had it open.");
    // And still asks, because the client has something to do about it.
    expect(html).toContain("<form");
  });

  /**
   * **THE PAPER IS THE SAME PAPER.** The reply card is screen-only, so a
   * client who prints their copy gets byte-for-byte what the builder prints —
   * which is what keeps "one document, three doors" true once a third door
   * exists (ADR 0083, 0084).
   */
  it("prints on nothing: the document is identical with and without a link", () => {
    const plain = renderProposalHtml(doc(), brand);
    const shared = renderProposalHtml(doc(), brand, {
      acceptUrl: "/proposal/tok/accept",
      estimateVersion: 1,
      signed: null,
    });
    expect(shared).toContain(".print-me, .accept { display: none; }");
    // The sheet — the document itself — is the same string in both.
    const sheetOf = (h: string) => h.slice(h.indexOf('<div class="sheet">'), h.lastIndexOf("</div>"));
    expect(sheetOf(shared)).toBe(sheetOf(plain));
    // And with no link, the card's element is absent entirely — the stylesheet
    // still carries its rules, which cost a printed document nothing.
    expect(plain).not.toContain("<aside");
    expect(shared).toContain("<aside");
  });
});
