import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoveryBusiness,
  discoveryFactsFrom,
  discoverySystemPrompt,
  EMPTY_FACTS,
  engagementContextMessage,
  isBriefed,
  reportInstruction,
} from "../src/packs/professional-services/core/discovery-prompt";

/**
 * The discovery copilot's prompt — PURE.
 *
 * The test that matters most is the last one. The prompt this replaced named
 * one company, described its four pricing tiers and quoted their dollar
 * figures; carrying any of that into a pack would mean the pack knew which
 * business it was running inside. That is the boundary ADR 0004 draws, and a
 * scan is the only thing that keeps it true as the file is edited.
 */

const FACTS = {
  what: "We run the back office for small builders.",
  offering: "Health check, free. Setup, £2,000 one-off. Monthly office, £900.",
  alternative: "Hiring an office manager, or the owner doing it at 9pm.",
  clientHourlyRate: "£60",
};

describe("discoveryFactsFrom", () => {
  it("reads a well-formed brief", () => {
    expect(discoveryFactsFrom({ discovery: FACTS })).toEqual(FACTS);
  });

  it("answers empty for anything unreadable, and never throws", () => {
    for (const config of [null, undefined, 7, "discovery", [], {}, { discovery: [] }]) {
      expect(discoveryFactsFrom(config)).toEqual(EMPTY_FACTS);
    }
  });

  it("drops a field that is not text without losing its siblings", () => {
    const facts = discoveryFactsFrom({
      discovery: { what: "We do bookkeeping.", offering: 42, alternative: null },
    });
    expect(facts.what).toBe("We do bookkeeping.");
    expect(facts.offering).toBe("");
    expect(facts.alternative).toBe("");
  });

  it("trims and caps, so a pasted essay cannot run away with the prompt", () => {
    const facts = discoveryFactsFrom({
      discovery: { what: "  spaced  ", offering: "x".repeat(9000) },
    });
    expect(facts.what).toBe("spaced");
    expect(facts.offering).toHaveLength(5000);
  });
});

describe("isBriefed", () => {
  it("is false for a business that has said nothing", () => {
    expect(isBriefed(discoveryBusiness("Acme", EMPTY_FACTS))).toBe(false);
    // A rate on its own is not a briefing — it says nothing about the offer.
    expect(
      isBriefed(discoveryBusiness("Acme", { ...EMPTY_FACTS, clientHourlyRate: "£60" })),
    ).toBe(false);
  });

  it("is true once any of the three real facts is filled in", () => {
    expect(isBriefed(discoveryBusiness("Acme", { ...EMPTY_FACTS, what: "We do books." }))).toBe(
      true,
    );
  });
});

describe("discoverySystemPrompt", () => {
  const briefed = discoverySystemPrompt(discoveryBusiness("Hollis & Co", FACTS));
  const bare = discoverySystemPrompt(discoveryBusiness("Hollis & Co", EMPTY_FACTS));

  it("tells the copilot whose workspace it is in", () => {
    expect(briefed).toContain("Hollis & Co");
    expect(bare).toContain("Hollis & Co");
  });

  it("carries the business's own facts when it has them", () => {
    expect(briefed).toContain("We run the back office for small builders.");
    expect(briefed).toContain("Monthly office, £900.");
    expect(briefed).toContain("Hiring an office manager");
    expect(briefed).toContain("£60");
  });

  it("REFUSES TO INVENT when it has not been briefed", () => {
    // The important degradation: a prompt that makes up a price list is worse
    // than one that says it has none.
    expect(bare).toContain("NOBODY HAS TOLD YOU");
    expect(bare).toContain("do not invent an offering, a price or a tier");
    // And it asks for the missing figure rather than assuming one.
    expect(bare).toContain("state the hourly figure");
  });

  it("keeps the parts that are true of any services business", () => {
    for (const prompt of [briefed, bare]) {
      expect(prompt).toContain("license-gated");
      expect(prompt).toContain("show the arithmetic");
      expect(prompt).toMatch(/skeptic/i);
    }
  });

  it("names a fallback rather than an empty string for a nameless workspace", () => {
    expect(discoverySystemPrompt(discoveryBusiness("  ", EMPTY_FACTS))).toContain(
      "this business",
    );
  });
});

describe("reportInstruction", () => {
  it("asks for both halves, and names the business for the internal one", () => {
    const instruction = reportInstruction(discoveryBusiness("Hollis & Co", FACTS));
    expect(instruction).toContain("# Business Health Check");
    expect(instruction).toContain("# Build Spec — internal");
    expect(instruction).toContain("Hollis & Co's own eyes");
    expect(instruction).toContain("Hollis & Co's own prices");
  });

  it("tells it not to invent a price when the business has no offering on file", () => {
    const instruction = reportInstruction(discoveryBusiness("Hollis & Co", EMPTY_FACTS));
    expect(instruction).toContain("rather than inventing one");
  });

  it("carries no pricing tier of its own", () => {
    // "Tier 0" meant something in one company's price list and nothing
    // anywhere else.
    expect(reportInstruction(discoveryBusiness("Hollis & Co", FACTS))).not.toMatch(/Tier \d/);
  });
});

describe("engagementContextMessage", () => {
  it("carries what is known and leaves out what is not", () => {
    const message = engagementContextMessage({
      businessName: "Baxter Plumbing",
      industry: "general",
      contactName: null,
      context: "",
    });
    expect(message).toContain("Baxter Plumbing");
    expect(message).not.toContain("Contact:");
    expect(message).not.toContain("Intake notes:");
  });
});

/**
 * The scan. Every file the pack ships, read for the name of the business that
 * happens to pilot it — the same shape `tests/packs.test.ts` uses on pack
 * slugs, applied to the one pack most at risk of it.
 */
function packFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...packFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("the pack names no business", () => {
  const files = packFiles(join("src", "packs", "professional-services"));

  it("reads more than a handful of files, or the scan proves nothing", () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it("never names the company that pilots it, nor its product", () => {
    // Assembled so this file does not match its own rule.
    const banned = new RegExp(["yosher", "outsourced business office"].join("|"), "i");
    const offenders = files.filter((f) => banned.test(readFileSync(f, "utf8")));
    expect(offenders, "a pack must not know which business it runs inside").toEqual([]);
  });

  it("carries no price list — money belongs to the tenant, not the pack", () => {
    // A figure with a currency in front of it, in a pack, is somebody's price.
    const priced = /[$£€]\s?\d/;
    const offenders = files.filter((f) => priced.test(readFileSync(f, "utf8")));
    expect(offenders, "prices are Layer 3 — tenant_modules.config").toEqual([]);
  });
});
