import { describe, expect, it } from "vitest";
import {
  DependencyCycleError,
  blockingDependents,
  installOrder,
  labelFor,
  missingRequirements,
  resolveLabels,
  unlistedRequirements,
  type DependencyGraph,
} from "@/lib/packs/resolve";
import { packRegistry } from "@/packs";
import { industryRegistry, getIndustryProfile, NO_PROFILE } from "@/industries";

/**
 * Layer 2 dependency and vocabulary rules.
 *
 * PURE — imports the registries, which are plain data, and never `@/db` or
 * `@/lib/features` (the latter pulls in module Components and would drag React
 * server components into a unit test).
 *
 * KNOWN GAP, deliberate: nothing here asserts that every pack in `packRegistry`
 * also has a row in `scripts/seed.ts`. That file calls `main()` at module load,
 * so importing it would try to open a database connection. The backstop is the
 * `tenant_modules.module_id` foreign key, which fails loudly at install rather
 * than silently — see docs/modules/packs-and-profiles.md open items.
 */

// A deliberately small graph, so the rules are tested against fixtures rather
// than against whichever packs happen to exist this week.
const GRAPH: DependencyGraph = {
  core: [],
  base: [],
  middle: ["base"],
  top: ["middle", "core"],
  loner: [],
};

describe("missingRequirements", () => {
  it("is empty when every requirement is already on", () => {
    expect(missingRequirements("top", ["middle", "core"], GRAPH)).toEqual([]);
  });

  it("names only what is actually missing", () => {
    expect(missingRequirements("top", ["core"], GRAPH)).toEqual(["middle"]);
  });

  it("is empty for something with no requirements", () => {
    expect(missingRequirements("loner", [], GRAPH)).toEqual([]);
  });

  it("treats an unknown slug as requiring nothing", () => {
    // An unimplemented pack must not be undecidable — it simply has no
    // declared requirements yet.
    expect(missingRequirements("ghost", [], GRAPH)).toEqual([]);
  });
});

describe("blockingDependents", () => {
  it("names enabled features that would break", () => {
    expect(blockingDependents("base", ["base", "middle"], GRAPH)).toEqual([
      "middle",
    ]);
  });

  it("ignores dependents that are switched off", () => {
    expect(blockingDependents("base", ["base"], GRAPH)).toEqual([]);
  });

  it("never reports the slug itself", () => {
    expect(blockingDependents("base", ["base"], GRAPH)).not.toContain("base");
  });

  it("is sorted, so an error message is stable", () => {
    const graph: DependencyGraph = { a: [], z: ["a"], m: ["a"] };
    expect(blockingDependents("a", ["z", "m", "a"], graph)).toEqual(["m", "z"]);
  });
});

describe("installOrder", () => {
  it("puts every dependency before its dependents", () => {
    const order = installOrder(["top", "middle", "base", "core"], GRAPH);
    expect(order.indexOf("base")).toBeLessThan(order.indexOf("middle"));
    expect(order.indexOf("middle")).toBeLessThan(order.indexOf("top"));
    expect(order.indexOf("core")).toBeLessThan(order.indexOf("top"));
  });

  it("is deterministic regardless of input order", () => {
    const a = installOrder(["top", "base", "core", "middle"], GRAPH);
    const b = installOrder(["core", "middle", "top", "base"], GRAPH);
    expect(a).toEqual(b);
  });

  it("returns every slug exactly once", () => {
    const order = installOrder(["top", "middle", "base", "core"], GRAPH);
    expect(order.slice().sort()).toEqual(["base", "core", "middle", "top"]);
  });

  it("ignores requirements outside the requested set", () => {
    // Pulling `middle` in would install something the profile never listed.
    // `unlistedRequirements` reports that separately as a refusal.
    expect(installOrder(["top"], GRAPH)).toEqual(["top"]);
  });

  it("throws on a cycle rather than looping or half-ordering", () => {
    const cyclic: DependencyGraph = { a: ["b"], b: ["c"], c: ["a"] };
    expect(() => installOrder(["a", "b", "c"], cyclic)).toThrow(
      DependencyCycleError,
    );
  });

  it("reports the cycle it found", () => {
    const cyclic: DependencyGraph = { a: ["b"], b: ["a"] };
    try {
      installOrder(["a", "b"], cyclic);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DependencyCycleError);
      expect((err as DependencyCycleError).cycle.length).toBeGreaterThan(1);
    }
  });

  it("handles an empty set", () => {
    expect(installOrder([], GRAPH)).toEqual([]);
  });
});

describe("unlistedRequirements", () => {
  it("is empty for a self-contained list", () => {
    expect(unlistedRequirements(["base", "middle"], GRAPH)).toEqual([]);
  });

  it("names a requirement the list forgot", () => {
    expect(unlistedRequirements(["middle"], GRAPH)).toEqual(["base"]);
  });

  it("deduplicates and sorts", () => {
    const graph: DependencyGraph = { x: ["z"], y: ["z"], z: [] };
    expect(unlistedRequirements(["x", "y"], graph)).toEqual(["z"]);
  });
});

describe("resolveLabels", () => {
  it("returns the profile's labels when there are no overrides", () => {
    expect(resolveLabels({ zone: "Paddock" })).toEqual({ zone: "Paddock" });
  });

  it("lets a tenant override one label without losing the rest", () => {
    expect(
      resolveLabels({ zone: "Paddock", lot: "Lot" }, { zone: "Field" }),
    ).toEqual({ zone: "Field", lot: "Lot" });
  });

  // Totality matters here more than anywhere: `tenants.industry` defaults to
  // `general`, so the no-profile path runs for every tenant on every request
  // that resolves a label. None of these may throw.
  it("survives a null profile", () => {
    expect(resolveLabels(null)).toEqual({});
    expect(resolveLabels(undefined, { zone: "Field" })).toEqual({
      zone: "Field",
    });
  });

  it("drops non-string override values individually", () => {
    expect(
      resolveLabels(
        { zone: "Paddock" },
        { zone: 42, lot: "Lot", other: { nested: true } },
      ),
    ).toEqual({ zone: "Paddock", lot: "Lot" });
  });

  it("drops empty strings rather than blanking a label", () => {
    expect(resolveLabels({ zone: "Paddock" }, { zone: "" })).toEqual({
      zone: "Paddock",
    });
  });

  it("ignores overrides that are not an object", () => {
    expect(resolveLabels({ zone: "Paddock" }, ["Field"])).toEqual({
      zone: "Paddock",
    });
    expect(resolveLabels({ zone: "Paddock" }, "Field")).toEqual({
      zone: "Paddock",
    });
    expect(resolveLabels({ zone: "Paddock" }, null)).toEqual({
      zone: "Paddock",
    });
  });
});

describe("labelFor", () => {
  it("prefers the resolved label", () => {
    expect(labelFor({ zone: "Paddock" }, "zone", "Zone")).toBe("Paddock");
  });

  it("falls back to the core word", () => {
    expect(labelFor({}, "zone", "Zone")).toBe("Zone");
  });
});

describe("the real pack registry", () => {
  const graph: DependencyGraph = Object.fromEntries(
    Object.entries(packRegistry).map(([slug, p]) => [slug, p.requires]),
  );

  it("keys every entry by its own slug", () => {
    for (const [key, pack] of Object.entries(packRegistry)) {
      expect(pack.slug).toBe(key);
    }
  });

  it("only requires packs that are registered", () => {
    for (const pack of Object.values(packRegistry)) {
      for (const dep of pack.requires) {
        expect(
          packRegistry[dep],
          `${pack.slug} requires unregistered "${dep}"`,
        ).toBeDefined();
      }
    }
  });

  it("has no dependency cycle", () => {
    expect(() => installOrder(Object.keys(packRegistry), graph)).not.toThrow();
  });

  it("never requires itself", () => {
    for (const pack of Object.values(packRegistry)) {
      expect(pack.requires).not.toContain(pack.slug);
    }
  });

  it("names no industry — a pack that does has the boundary wrong", () => {
    // docs/extension-model.md §6 step 7: grep your own diff for industry nouns.
    // "farm" is the one this profile would leak first.
    const banned = /\b(farm|homestead|plumb|electric|dental|construction)/i;
    for (const pack of Object.values(packRegistry)) {
      expect(banned.test(pack.slug), pack.slug).toBe(false);
      expect(banned.test(pack.name), pack.name).toBe(false);
    }
  });
});

describe("the real industry registry", () => {
  const graph: DependencyGraph = Object.fromEntries(
    Object.entries(packRegistry).map(([slug, p]) => [slug, p.requires]),
  );

  it("keys every profile by its own slug", () => {
    for (const [key, profile] of Object.entries(industryRegistry)) {
      expect(profile.slug).toBe(key);
    }
  });

  it("lists only registered packs", () => {
    for (const profile of Object.values(industryRegistry)) {
      for (const slug of profile.packs) {
        expect(
          packRegistry[slug],
          `${profile.slug} lists unregistered pack "${slug}"`,
        ).toBeDefined();
      }
    }
  });

  it("lists every pack its packs require", () => {
    // A profile should say what it means; the installer refuses rather than
    // quietly pulling in a pack nobody chose.
    for (const profile of Object.values(industryRegistry)) {
      expect(
        unlistedRequirements(profile.packs, graph),
        `${profile.slug} is missing transitive requirements`,
      ).toEqual([]);
    }
  });

  it("can be ordered for install", () => {
    for (const profile of Object.values(industryRegistry)) {
      expect(() => installOrder(profile.packs, graph)).not.toThrow();
    }
  });

  it("does not register the no-profile sentinel as a profile", () => {
    // `general` is the ABSENCE of a profile, not one of them.
    expect(getIndustryProfile(NO_PROFILE)).toBeNull();
  });

  it("returns null for an unknown slug rather than throwing", () => {
    expect(getIndustryProfile("does-not-exist")).toBeNull();
  });
});

describe("the homestead-farm profile", () => {
  const profile = getIndustryProfile("homestead-farm");

  it("is registered", () => {
    expect(profile).not.toBeNull();
  });

  it("installs land and inventory before livestock", () => {
    const graph: DependencyGraph = Object.fromEntries(
      Object.entries(packRegistry).map(([slug, p]) => [slug, p.requires]),
    );
    const order = installOrder(profile!.packs, graph);
    expect(order.indexOf("inventory")).toBeLessThan(order.indexOf("livestock"));
    expect(order.indexOf("land")).toBeLessThan(order.indexOf("livestock"));
    expect(order.indexOf("inventory")).toBeLessThan(order.indexOf("production"));
  });
});
