import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectLabelDefinitions,
  labelRows,
  resolveLabels,
} from "../src/lib/packs/resolve";
import { packRegistry } from "../src/packs";
import { moduleRegistry } from "../src/modules";
import { getIndustryProfile, industryRegistry } from "../src/industries";
import { PARTY_LABEL_KEYS } from "../src/lib/parties/vocabulary";

const homesteadFarm = getIndustryProfile("homestead-farm");

/**
 * The vocabulary registry, and the check that keeps it honest.
 *
 * Before this existed, "what words can a tenant change?" could only be answered
 * by grepping for `labelFor` — and the answer was ONE, while three keys were
 * declared and two of them were read by nothing. A declaration that nothing
 * verifies drifts back to that within a slice or two, so the important test
 * here is the source scan: **every key a feature RENDERS must be a key it
 * DECLARES.**
 */

const declarations = collectLabelDefinitions([
  ...Object.values(moduleRegistry).map((m) => ({
    slug: m.slug,
    name: m.name,
    labels: m.labels,
  })),
  ...Object.values(packRegistry).map((p) => ({
    slug: p.slug,
    name: p.name,
    labels: p.labels,
  })),
]);

/**
 * Every `labelFor(x, "key", …)` and `useLabel("key", …)` in the source tree.
 *
 * `useLabel` was added to the scan on 2026-09-13, with the client-side provider
 * it belongs to. A word rendered through a hook is as undeclarable as one
 * rendered through the server helper, so both have to be visible here or the
 * ratchet only covers half the product.
 */
function usedLabelKeys(): { key: string; file: string }[] {
  const out: { key: string; file: string }[] = [];
  // Assembled rather than written whole, so this file does not match its own
  // rule — the same trick tests/db-backed-files.test.ts uses on its markers.
  // Two patterns rather than one alternation: each reads on its own, and the
  // combined version did not.
  const patterns = [
    new RegExp("labelFor" + "\\(\\s*[^,]+,\\s*[\"'`]([^\"'`]+)", "g"),
    new RegExp("useLabel" + "\\(\\s*[\"'`]([^\"'`]+)", "g"),
  ];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === ".next") continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const text = readFileSync(full, "utf8");
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          out.push({ key: match[1], file: full });
        }
      }
    }
  };
  walk("src");
  return out;
}

describe("collectLabelDefinitions", () => {
  it("attributes each word to the feature that owns it", () => {
    const { labels } = collectLabelDefinitions([
      { slug: "land", name: "Land", labels: [{ key: "zone", fallback: "Zone", describes: "…" }] },
    ]);
    expect(labels[0].owner).toBe("land");
    expect(labels[0].ownerName).toBe("Land");
  });

  it("reports a key claimed by two features rather than merging them", () => {
    // Two owners for one word means renaming it does something one of them did
    // not expect, which is worse than a refusal.
    const { conflicts } = collectLabelDefinitions([
      { slug: "land", name: "Land", labels: [{ key: "lot", fallback: "Lot", describes: "…" }] },
      { slug: "inventory", name: "Inventory", labels: [{ key: "lot", fallback: "Batch", describes: "…" }] },
    ]);
    expect(conflicts).toEqual(["lot"]);
  });

  it("is empty for features that declare nothing", () => {
    const { labels } = collectLabelDefinitions([{ slug: "hello", name: "Hello" }]);
    expect(labels).toEqual([]);
  });
});

describe("the real registry", () => {
  it("has no key claimed by two features", () => {
    expect(declarations.conflicts).toEqual([]);
  });

  it("gives every word a fallback and a description a person can read", () => {
    for (const label of declarations.labels) {
      expect(label.fallback.length).toBeGreaterThan(0);
      // The description is what appears beside the field on the admin screen.
      // "zone" means nothing to somebody deciding whether to rename it.
      expect(label.describes.length).toBeGreaterThan(20);
    }
  });

  it("EVERY key rendered through labelFor is declared", () => {
    // The check the registry exists for. A pack that renders a word without
    // declaring it is a word nobody can find, let alone change.
    const undeclared = usedLabelKeys().filter(
      (use) => !declarations.labels.some((l) => l.key === use.key),
    );
    expect(
      undeclared.map((u) => `${u.key} (${u.file})`),
      "labelFor keys must be declared in the feature's `labels`",
    ).toEqual([]);
  });

  /**
   * THE SOURCE SCAN ABOVE CANNOT SEE A KEY PASSED AS A CONSTANT, and that is
   * not hypothetical: `enterprise` is rendered on the nav rail of every
   * dashboard page through `ENTERPRISE_LABEL_KEY` and is declared by nothing at
   * all — it slips the scan because the regex needs a literal. Found
   * 2026-09-13 while adding the party words, and left alone in that slice
   * because `enterprises` is Layer 0 with no registry entry to declare it on
   * (logged in docs/modules/packs-and-profiles.md).
   *
   * The party words use constants too, deliberately — a magic string in twenty
   * files is worse — so they are checked by name here instead. Any subsystem
   * that keys labels off constants should add its list the same way.
   */
  it("declares every key the party vocabulary names", () => {
    const declared = declarations.labels.map((l) => l.key);
    for (const key of PARTY_LABEL_KEYS) {
      expect(declared, `${key} is rendered but declared nowhere`).toContain(key);
    }
  });

  it("attributes the party words to accounting, which owns the screens", () => {
    // Not CRM, though CRM renders them: one key has one owner, and the
    // Customers and Vendors pages are accounting's.
    for (const key of PARTY_LABEL_KEYS) {
      expect(declarations.labels.find((l) => l.key === key)?.owner).toBe(
        "accounting",
      );
    }
  });

  it("declares more than one word, which is the whole point", () => {
    // The state this replaced: three declared, one read, everything else
    // hardcoded English. If this ever drops back to a handful, the mechanism
    // has quietly stopped being used again.
    expect(declarations.labels.length).toBeGreaterThanOrEqual(6);
  });
});

describe("labelRows", () => {
  /**
   * The admin screen's view of the same three layers `resolveLabels` renders.
   * It got them wrong by doing the arithmetic inline: a homestead farm whose
   * every Land screen said "Paddock" had an editor headed "Zone", with help
   * text promising that clearing the box would give "Zone". Found by clicking,
   * 2026-08-16.
   */
  const zone = {
    key: "zone",
    fallback: "Zone",
    describes: "A management area inside a parcel.",
  };
  const asset = {
    key: "asset",
    fallback: "Asset",
    describes: "Anything owned with a cost and a working life.",
  };

  it("shows the PROFILE's word as what an empty box means, and names it", () => {
    const [row] = labelRows([zone], { zone: "Paddock" }, "Homestead Farm");
    expect(row.inherited).toBe("Paddock");
    expect(row.inheritedFrom).toBe("Homestead Farm");
    // The pack's own word is still carried, because the editor says both.
    expect(row.fallback).toBe("Zone");
  });

  it("falls back to the pack's word and attributes it to nobody", () => {
    const [row] = labelRows([asset], { zone: "Paddock" }, "Homestead Farm");
    expect(row.inherited).toBe("Asset");
    // Null, not the profile name — saying "Homestead Farm calls this Asset"
    // when it says nothing about assets is the same lie in the other
    // direction.
    expect(row.inheritedFrom).toBeNull();
  });

  it("agrees with resolveLabels about what an empty string means", () => {
    // Both must treat "" as no rename, or the editor and the renderer answer
    // the same question differently.
    const [row] = labelRows([zone], { zone: "" }, "Homestead Farm");
    expect(row.inherited).toBe("Zone");
    expect(row.inheritedFrom).toBeNull();
    expect(resolveLabels({ zone: "" })).toEqual({});
  });

  it("survives a tenant with no profile at all", () => {
    // `industry` defaults to `general`, which has no manifest, so this is the
    // common path rather than an edge case.
    const [row] = labelRows([zone], undefined, null);
    expect(row.inherited).toBe("Zone");
    expect(row.inheritedFrom).toBeNull();
  });

  it("keeps the real registry's words matched to the real profile", () => {
    // Not a fixture: the homestead-farm profile renames `zone`, and this is
    // the case the bug was found on.
    const rows = labelRows(
      declarations.labels,
      homesteadFarm?.labels,
      homesteadFarm?.name ?? null,
    );
    const zoneRow = rows.find((r) => r.key === "zone");
    expect(zoneRow?.inherited).toBe("Paddock");
    expect(zoneRow?.inheritedFrom).toBe(homesteadFarm?.name);
  });
});

/**
 * A profile may only rename a word somebody declared. A label for a key
 * nothing renders is a rename nobody will ever see — and the day the key IS
 * rendered under a different spelling, the profile's word is silently lost.
 */
describe("every profile's labels", () => {
  /**
   * The one Layer 0 word with no home yet: `enterprises` is not a module and
   * not a pack, so nothing declares its label, and both the farm and the
   * construction profile set it anyway. Named here so the exception is one
   * line to delete when the subsystem declares it.
   */
  const LAYER_0_UNDECLARED = new Set(["enterprise"]);

  it("name only declared keys, or the Layer 0 word nobody has declared yet", () => {
    const declared = new Set(declarations.labels.map((l) => l.key));
    for (const profile of Object.values(industryRegistry)) {
      for (const key of Object.keys(profile.labels)) {
        expect(
          declared.has(key) || LAYER_0_UNDECLARED.has(key),
          `${profile.slug} renames "${key}", which nothing declares`,
        ).toBe(true);
      }
    }
  });
});
