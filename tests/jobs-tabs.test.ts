import { describe, expect, it } from "vitest";
import {
  ALWAYS_ON,
  JOB_TABS,
  OPTIONAL_TABS,
  TAB_COPY,
  tabsOffFrom,
  visibleTabs,
  type JobTab,
} from "@/packs/jobs/tabs";

/**
 * WHICH PARTS OF A JOB A BUSINESS DOES.
 *
 * Two things are worth a test here and neither is visible on the screen: that
 * a config nobody can read means EVERY tab rather than none — the failure that
 * would empty the strip for a tenant whose jsonb went odd — and that a tab with
 * rows on it is shown whatever the setting says, which is the rule that stops
 * this feature losing somebody's warranty claims.
 */

describe("the tabs a job has", () => {
  it("keeps the three that make a job a job", () => {
    expect(ALWAYS_ON).toEqual(["overview", "contracts", "cost"]);
  });

  it("offers everything else", () => {
    expect(OPTIONAL_TABS).toHaveLength(JOB_TABS.length - ALWAYS_ON.length);
    for (const tab of ALWAYS_ON) expect(OPTIONAL_TABS).not.toContain(tab);
  });

  it("says what each one is, so the settings screen never has a bare slug", () => {
    for (const tab of JOB_TABS) {
      expect(TAB_COPY[tab]?.label, tab).toBeTruthy();
      expect(TAB_COPY[tab]?.describes, tab).toBeTruthy();
    }
  });
});

describe("reading the setting", () => {
  it("reads a list of slugs", () => {
    expect(tabsOffFrom({ tabsOff: ["selections", "warranty"] })).toEqual([
      "selections",
      "warranty",
    ]);
  });

  it("ignores a tab that cannot be switched off", () => {
    expect(tabsOffFrom({ tabsOff: ["cost", "contracts", "overview", "log"] })).toEqual(["log"]);
  });

  it("ignores a slug that is not a tab", () => {
    expect(tabsOffFrom({ tabsOff: ["selections", "bonding", 7, null] })).toEqual(["selections"]);
  });

  /**
   * The config is jsonb with no shape constraint and most tenants have never
   * touched it. Anything unreadable has to mean "nothing is off".
   */
  it("means nothing is off for anything it cannot read", () => {
    for (const bad of [undefined, null, {}, [], "selections", 3, { tabsOff: "selections" }, { tabsOff: {} }]) {
      expect(tabsOffFrom(bad), JSON.stringify(bad) ?? "undefined").toEqual([]);
    }
  });
});

describe("what a project shows", () => {
  it("is everything when nothing is configured", () => {
    expect(visibleTabs({})).toEqual([...JOB_TABS]);
  });

  it("drops what the tenant switched off, and keeps the order", () => {
    const shown = visibleTabs({ tabsOff: ["selections", "warranty"] });
    expect(shown).not.toContain("selections");
    expect(shown).not.toContain("warranty");
    expect(shown).toEqual(JOB_TABS.filter((t) => t !== "selections" && t !== "warranty"));
  });

  /** The rule that keeps this feature safe: a setting never hides work. */
  it("shows a switched-off tab anyway when the project has rows on it", () => {
    const shown = visibleTabs({ tabsOff: ["selections", "warranty"] }, ["warranty"]);
    expect(shown).toContain("warranty");
    expect(shown).not.toContain("selections");
  });

  it("never drops one of the three", () => {
    const shown = visibleTabs({ tabsOff: [...JOB_TABS] as JobTab[] });
    for (const tab of ALWAYS_ON) expect(shown).toContain(tab);
  });

  it("is the tenant's preference alone when no project is in front of it", () => {
    expect(visibleTabs({ tabsOff: ["drawings"] })).not.toContain("drawings");
  });
});
