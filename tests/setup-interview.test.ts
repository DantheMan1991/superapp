import { describe, expect, it } from "vitest";
import {
  PLAN_SCREENS,
  SETUP_WRAP_TARGET,
  digestLines,
  planInstruction,
  setupSystemPrompt,
  validateSetupPlan,
  validateSetupTurn,
  type SetupDigest,
} from "../src/lib/setup-interview/prompt";

/**
 * The setup interview's pure half (ADR 0040): the digest that stops it asking
 * what the app can already see, and the two boundaries.
 *
 * What this file certifies: the digest says whether a thing EXISTS and never
 * what it holds; the system prompt carries it and forbids asking for any of
 * it; a plan step's screen is resolved against the list the model was given,
 * so a made-up screen becomes a step with no link rather than a link to
 * nowhere; and a malformed answer is a refusal, not a half-parsed plan.
 */

const DIGEST: SetupDigest = {
  businessName: "Hilltop Farm",
  industry: "homestead-farm",
  modules: ["accounting", "livestock"],
  booksStartOn: null,
  registers: { total: 3, personal: 1 },
  counts: {
    vendors: 9,
    customers: 2,
    items: 14,
    animals: 4,
    assets: 6,
    bankTransactions: 212,
  },
  outstanding: [
    { section: "Accounting", title: "Say when your books begin" },
    { section: "Livestock", title: "Add your animals" },
  ],
};

describe("the digest", () => {
  it("says what exists, and never what it holds", () => {
    const lines = digestLines(DIGEST);
    expect(lines).toContain("Hilltop Farm");
    expect(lines).toContain("accounting, livestock");
    expect(lines).toContain("NOT SET");
    expect(lines).toContain("3 (1 of them personal/mixed), 212 transactions imported");
    expect(lines).toContain("vendors 9");
    expect(lines).toContain("Accounting: Say when your books begin");
    // Counts and flags only — no balance, no name of a customer or a paddock.
    expect(lines).not.toMatch(/\$|balance|owed/i);
  });

  it("says plainly when the day is set, so the interview does not ask again", () => {
    expect(digestLines({ ...DIGEST, booksStartOn: "2026-01-01" })).toContain(
      "set to 2026-01-01",
    );
  });

  it("says when nothing is outstanding rather than leaving the line empty", () => {
    expect(digestLines({ ...DIGEST, outstanding: [] })).toContain(
      "nothing — every tool has what it needs",
    );
  });

  it("the prompt carries the digest and forbids asking for it", () => {
    const prompt = setupSystemPrompt(DIGEST);
    expect(prompt).toContain("Never ask for any of this");
    expect(prompt).toContain(digestLines(DIGEST));
    expect(prompt).toContain(`within ${SETUP_WRAP_TARGET} exchanges`);
    // The first question is the one the plan says changes everything.
    expect(prompt).toContain("mixed with personal");
  });
});

describe("validateSetupTurn", () => {
  it("takes a reply and a flag, and refuses anything else", () => {
    expect(validateSetupTurn({ reply: "And when do the books begin?", done: false })).toEqual({
      reply: "And when do the books begin?",
      done: false,
    });
    expect(validateSetupTurn({ reply: "" , done: false })).toBeNull();
    expect(validateSetupTurn({ reply: "ok" })).toBeNull();
    expect(validateSetupTurn("ok")).toBeNull();
  });
});

describe("validateSetupPlan", () => {
  it("resolves a step's screen against the list the model was given", () => {
    const plan = validateSetupPlan({
      summary: "Your money is mixed and your books start in January.",
      steps: [
        { title: "Set the day", why: "Everything else hangs off it.", screen: "Opening position" },
        { title: "Add the mixed account", why: "So personal lines stay out.", screen: "banking" },
      ],
    })!;
    expect(plan.steps[0]).toMatchObject({
      href: "/dashboard/m/accounting/opening",
      guide: "accounting/opening",
      screen: "Opening position",
    });
    // Case does not matter; the label does.
    expect(plan.steps[1].href).toBe("/dashboard/m/accounting/banking");
  });

  it("a screen it invented becomes a step with no link, never a link to nowhere", () => {
    const plan = validateSetupPlan({
      summary: "…",
      steps: [
        { title: "Ask your accountant for the depreciation figure", why: "They hold it." },
        { title: "Go to the magic page", why: "…", screen: "Magic setup wizard" },
      ],
    })!;
    expect(plan.steps[0]).toMatchObject({ href: null, guide: null, screen: null });
    expect(plan.steps[1]).toMatchObject({ href: null, screen: null });
  });

  it("refuses a malformed plan rather than half-parsing one", () => {
    expect(validateSetupPlan({ steps: [] })).toBeNull();
    expect(validateSetupPlan({ summary: "x", steps: [{ title: "a" }] })).toBeNull();
    expect(
      validateSetupPlan({
        summary: "x",
        steps: Array.from({ length: 13 }, () => ({ title: "a", why: "b" })),
      }),
    ).toBeNull();
  });

  it("every screen the model is offered is a real one", () => {
    const instruction = planInstruction(DIGEST);
    for (const screen of PLAN_SCREENS) {
      expect(instruction).toContain(`- ${screen.label}`);
      expect(screen.href.startsWith("/dashboard/")).toBe(true);
    }
  });
});
