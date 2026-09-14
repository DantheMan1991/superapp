import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DELIVERY_METHOD_FORMAT,
  PACK,
  PROJECT_STATUSES,
  STATUS_LABELS,
  deliveryMethodsFrom,
  isProjectStatus,
  slugLabel,
} from "../src/packs/jobs/vocabulary";
import { packRegistry } from "../src/packs";

/**
 * The `jobs` pack's pure half: the words, and the two places they must agree
 * with the database.
 *
 * **THE MIRROR TESTS ARE THE POINT.** `DELIVERY_METHOD_FORMAT` and
 * `PROJECT_STATUSES` each exist twice — once in TypeScript, once as a CHECK
 * constraint in `drizzle/0325_jobs.sql` — and two copies of a rule is how one of
 * them drifts. A drift here does not fail loudly: the app would accept a value
 * the database then refuses, so the user sees "Something went wrong" on a form
 * that looked fine. So the SQL is read and compared rather than trusted.
 */
const MIGRATION = readFileSync("drizzle/0325_jobs.sql", "utf8");

describe("the pack declares itself consistently", () => {
  it("registers under the slug its own constant names", () => {
    // A mismatch would make `requireModuleEnabled` check a module that is not
    // this one, which fails open on a tenant that happens to have both.
    expect(packRegistry[PACK]).toBeDefined();
    expect(packRegistry[PACK].slug).toBe(PACK);
  });

  it("depends on nothing — it is the bottom of the family", () => {
    expect(packRegistry[PACK].requires).toEqual([]);
  });

  it("names an icon the registry actually has", async () => {
    // `getIcon` falls back to a generic box rather than throwing, which is how
    // five packs once shipped showing the wrong icon. See the registry header.
    const { ICONS } = await import("../src/components/app/icon-registry");
    expect(Object.keys(ICONS)).toContain(packRegistry[PACK].icon);
  });
});

describe("delivery method", () => {
  it("accepts the shape the database accepts", () => {
    for (const ok of ["a", "luxury_custom", "commercial", "semi_custom", "x9"]) {
      expect(DELIVERY_METHOD_FORMAT.test(ok), ok).toBe(true);
    }
  });

  it("refuses what the database refuses", () => {
    // A trailing underscore is deliberately NOT here: it is legal, matching the
    // `[a-z0-9_]*` tail the constraint allows.
    for (const bad of ["", "Luxury", "9lives", "has space", "_lead", "a-b"]) {
      expect(DELIVERY_METHOD_FORMAT.test(bad), bad).toBe(false);
    }
  });

  it("MIRRORS the CHECK constraint in the migration, character for character", () => {
    // The pattern in the SQL, pulled out of the constraint itself.
    const m = MIGRATION.match(
      /job_projects_delivery_method_format[^~]*~ '([^']+)'/,
    );
    expect(m, "constraint not found in drizzle/0325_jobs.sql").not.toBeNull();
    expect(m![1]).toBe(DELIVERY_METHOD_FORMAT.source);
  });

  it("reads suggestions from a profile's config, and tolerates junk", () => {
    expect(deliveryMethodsFrom({ deliveryMethods: ["commercial", "semi_custom"] })).toEqual(
      ["commercial", "semi_custom"],
    );
    // Total by construction: most tenants have no profile at all, and the jsonb
    // has no shape constraint. Anything unreadable means an empty list and a
    // free-text field — never a crash.
    expect(deliveryMethodsFrom(undefined)).toEqual([]);
    expect(deliveryMethodsFrom(null)).toEqual([]);
    expect(deliveryMethodsFrom("nonsense")).toEqual([]);
    expect(deliveryMethodsFrom({ deliveryMethods: "nonsense" })).toEqual([]);
    expect(deliveryMethodsFrom([])).toEqual([]);
  });

  it("drops individual entries the database would refuse", () => {
    // One bad word in a profile must not take the whole list down with it.
    expect(
      deliveryMethodsFrom({ deliveryMethods: ["commercial", "Not A Slug", 7, "ok_one"] }),
    ).toEqual(["commercial", "ok_one"]);
  });

  it("ships NO list of its own, which is the boundary", () => {
    // A pack that knew what "commercial" meant would know what industry it was
    // in (ADR 0004). The only way to get a suggestion is from a profile.
    const source = readFileSync("src/packs/jobs/vocabulary.ts", "utf8");
    // The words may appear in prose explaining why they are absent; what must
    // not exist is a default the code falls back to.
    expect(deliveryMethodsFrom({})).toEqual([]);
    expect(source).not.toMatch(/deliveryMethods\s*[:=]\s*\[\s*"/);
  });
});

describe("status", () => {
  it("MIRRORS the CHECK constraint in the migration", () => {
    const m = MIGRATION.match(/job_projects_status_valid[^(]*\(([^)]*)\)/);
    expect(m, "constraint not found").not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(inSql.sort()).toEqual([...PROJECT_STATUSES].sort());
  });

  it("gives every status a label a person can read", () => {
    for (const s of PROJECT_STATUSES) {
      expect(STATUS_LABELS[s], s).toBeTruthy();
    }
  });

  it("recognises its own statuses and nothing else", () => {
    expect(isProjectStatus("active")).toBe(true);
    expect(isProjectStatus("archived")).toBe(false);
  });
});

describe("slugLabel", () => {
  it("turns a slug into something readable", () => {
    expect(slugLabel("luxury_custom")).toBe("Luxury custom");
    expect(slugLabel("commercial")).toBe("Commercial");
  });

  it("does not fall over on an empty string", () => {
    expect(slugLabel("")).toBe("");
  });
});
