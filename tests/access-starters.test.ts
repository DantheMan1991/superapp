import { describe, expect, it } from "vitest";
import { STARTER_LEVELS, allowedKeys, starterById } from "@/lib/access/starters";
import { featureRegistry } from "@/lib/features";
import { moduleOf, reaches } from "@/lib/access/can";

/**
 * LEVELS YOU CAN START FROM (ADR 0097).
 *
 * A starter is a list of key strings, and a key string that answers to nothing
 * is the failure worth testing for: it would silently allow nothing, and the
 * owner would get a level quietly narrower than its name claims — the opposite
 * direction from a leak, and still wrong. Every key here is checked against the
 * real registry.
 */

/** Every key any tool could offer, whether or not a given tenant has it on. */
const EVERY_KEY = new Set(
  Object.entries(featureRegistry).flatMap(([slug, feature]) => [
    slug,
    ...(feature.areas ?? []).map((a) => `${slug}:${a.key}`),
  ]),
);

describe("the starter list", () => {
  it("has starters, and each is findable by its id", () => {
    expect(STARTER_LEVELS.length).toBeGreaterThan(2);
    for (const s of STARTER_LEVELS) expect(starterById(s.id)).toBe(s);
  });

  it("answers null for an id nothing matches", () => {
    expect(starterById("no-such-starter")).toBeNull();
  });

  it("has unique ids and unique names", () => {
    expect(new Set(STARTER_LEVELS.map((s) => s.id)).size).toBe(STARTER_LEVELS.length);
    expect(
      new Set(STARTER_LEVELS.map((s) => s.name.toLowerCase())).size,
    ).toBe(STARTER_LEVELS.length);
  });

  /**
   * **THE ONE THAT MATTERS.** A starter naming `accounting:recievables` — or a
   * key renamed last month — allows nothing, and produces a level narrower than
   * its own description. Nothing else would notice.
   */
  it.each(STARTER_LEVELS)("$name names only keys that exist", (starter) => {
    for (const key of [...starter.tools, ...starter.areas]) {
      expect(EVERY_KEY.has(key), `${starter.id} names ${key}, which no tool offers`).toBe(
        true,
      );
    }
  });

  it.each(STARTER_LEVELS)("$name names an area only under a real tool", (starter) => {
    for (const key of starter.areas) {
      expect(key).toContain(":");
      expect(featureRegistry[moduleOf(key)], `${key} has no such tool`).toBeTruthy();
    }
  });
});

describe("what a starter allows", () => {
  /**
   * Naming an area has to bring its tool with it. Without this a level would
   * deny Accounting outright and the areas underneath could never be reached —
   * `reaches` closes everything below a denied module, deliberately.
   */
  it("implies the tool behind every area it names", () => {
    for (const starter of STARTER_LEVELS) {
      const allowed = allowedKeys(starter);
      for (const key of starter.areas) {
        expect(allowed, `${starter.id}: ${key} without ${moduleOf(key)}`).toContain(
          moduleOf(key),
        );
      }
    }
  });

  it("keeps every tool it named outright", () => {
    for (const starter of STARTER_LEVELS) {
      expect(allowedKeys(starter)).toEqual(expect.arrayContaining(starter.tools));
    }
  });

  it("lists nothing twice", () => {
    for (const starter of STARTER_LEVELS) {
      const keys = allowedKeys(starter);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  /**
   * The round trip the action performs: deny everything on offer that the
   * starter does not allow, and the result must let exactly the starter's keys
   * through `reaches`.
   */
  it("produces a level that reaches what it allows and nothing else", () => {
    const onOffer = [...EVERY_KEY];
    for (const starter of STARTER_LEVELS) {
      const allowed = new Set(allowedKeys(starter));
      const denied = onOffer.filter((key) => !allowed.has(key));
      for (const key of allowed) {
        expect(reaches(denied, key), `${starter.id} cannot reach ${key}`).toBe(true);
      }
      // And a spot check in the other direction, on a key no starter grants.
      if (!allowed.has("marketing")) {
        expect(reaches(denied, "marketing")).toBe(false);
      }
    }
  });

  /**
   * **NAMING A TOOL MUST ALLOW ITS PARTS.** The first version of the action
   * denied them: a starter saying `tools: ["documents"]` created a level with
   * Documents ticked and all seven of its parts unticked, so its only reachable
   * page was the front door. Every test above passed — the TOOL was allowed —
   * and it was the screen reading "Documents (some)" that gave it away.
   *
   * This asserts the rule the action now applies, against the real registry.
   */
  it("allows the parts of any tool a starter names whole", () => {
    const onOffer = [...EVERY_KEY];
    for (const starter of STARTER_LEVELS) {
      const whole = new Set(starter.tools);
      const allowed = new Set(allowedKeys(starter));
      const denied = onOffer.filter(
        (key) => !allowed.has(key) && !whole.has(moduleOf(key)),
      );
      for (const tool of starter.tools) {
        for (const area of featureRegistry[tool]?.areas ?? []) {
          const key = `${tool}:${area.key}`;
          expect(
            reaches(denied, key),
            `${starter.id} names ${tool} whole but cannot reach ${key}`,
          ).toBe(true);
        }
      }
    }
  });

  /** The founder's own example, asserted as a case rather than a comment. */
  it("gives the invoicing-and-bills starter both sides and neither ledger", () => {
    const starter = starterById("both-sides")!;
    const allowed = new Set(allowedKeys(starter));
    expect(allowed.has("accounting:invoices")).toBe(true);
    expect(allowed.has("accounting:bills")).toBe(true);
    expect(allowed.has("accounting:journal")).toBe(false);
    expect(allowed.has("accounting:pnl")).toBe(false);
    expect(allowed.has("accounting:trial-balance")).toBe(false);
  });
});
