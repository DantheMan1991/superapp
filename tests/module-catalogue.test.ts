import { describe, expect, it } from "vitest";
import { MODULES } from "../scripts/seed-catalogue";
import { packRegistry } from "../src/packs";
import { moduleRegistry } from "../src/modules";

/**
 * Every feature the code registers has a row in the module catalogue.
 *
 * **THE OPEN ITEM THIS CLOSES**, recorded in `packs-and-profiles.md` since Layer
 * 2 shipped: *"Nothing asserts a pack in code has a seed row in
 * `scripts/seed.ts`. That file calls `main()` at module load, so a test cannot
 * import its catalogue without opening a database connection. The backstop is
 * the `tenant_modules.module_id` foreign key, which fails loudly at install
 * rather than silently — acceptable, but it fails at the worst moment."*
 *
 * The catalogue now lives in `scripts/seed-catalogue.ts`, which imports the
 * schema for TYPES only, so this test can read it without a driver.
 *
 * ── WHAT THIS WOULD AND WOULD NOT HAVE CAUGHT ───────────────────────────────
 *
 * It would NOT have caught the `jobs` incident on its own: that pack had its
 * seed row in code from the day it shipped, and what was missing was the row in
 * the production DATABASE. That is `scripts/verify-modules.ts`'s job, and the
 * two are siblings — this one proves the code agrees with itself, that one
 * proves a database agrees with the code.
 *
 * Both exist because the same slice produced both failures: a catalogue nobody
 * could test, and a deploy step nobody could verify.
 */
describe("the module catalogue", () => {
  const ids = new Set(MODULES.map((m) => m.id));

  it("has a row for every registered PACK", () => {
    const missing = Object.keys(packRegistry).filter((slug) => !ids.has(slug));
    expect(
      missing,
      "a pack with no catalogue row cannot be installed: the tenant_modules " +
        "foreign key refuses it, at install time, which is the worst moment",
    ).toEqual([]);
  });

  it("has a row for every registered CORE MODULE", () => {
    const missing = Object.keys(moduleRegistry).filter((slug) => !ids.has(slug));
    expect(missing).toEqual([]);
  });

  it("gives every pack row category 'pack'", () => {
    // `ownerFeatureAllowsWrite` reads this column to decide whether an
    // accountant may record a chore, and anything not a pack gets the STRICTER
    // rule. A pack miscategorised as core silently refuses writes it should
    // allow — see src/lib/packs/authorize.ts.
    const wrong = MODULES.filter(
      (m) => packRegistry[m.id as string] && m.category !== "pack",
    ).map((m) => m.id);
    expect(wrong).toEqual([]);
  });

  it("gives every core module row a category that is not 'pack'", () => {
    const wrong = MODULES.filter(
      (m) => moduleRegistry[m.id as string] && m.category === "pack",
    ).map((m) => m.id);
    expect(wrong).toEqual([]);
  });

  it("has no duplicate ids", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const m of MODULES) {
      const id = m.id as string;
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });

  it("gives every row a name and a description a person can read", () => {
    for (const m of MODULES) {
      expect(m.name, `${m.id} has no name`).toBeTruthy();
      // The description is what a superadmin reads when deciding whether to
      // switch something on for a client.
      expect((m.description ?? "").length, `${m.id}`).toBeGreaterThan(20);
    }
  });

  it("does not declare a pack RENDERABLE before it can render", () => {
    /*
     * A pack may be declared and unbuilt on purpose — it still installs with a
     * profile and shows as an empty slot. What it must not be is `available`
     * with no `Component`, which would put a dead row in a client's nav.
     */
    const dead = MODULES.filter((m) => {
      const pack = packRegistry[m.id as string];
      return pack && m.status === "available" && !pack.Component;
    }).map((m) => m.id);
    expect(dead).toEqual([]);
  });
});
