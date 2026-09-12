import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * EVERY BRAND READ ON A SITE SURFACE IS THE SITE'S (ADR 0045).
 *
 * A scan rather than a behaviour test, because the failure this catches is
 * invisible at runtime: `resolveBrandFor(tx, tenantId, null)` returns a real
 * brand and renders a real logo. It is simply the WRONG business's, and only
 * on a tenant that has given one of its sites a look of its own — which no
 * test fixture had, and which is exactly the tenant the feature exists for.
 *
 * It shipped that way. The per-site look landed with the header logo, the
 * favicon and the drawn map all still reading the business kit, because the
 * seven call sites were enumerated and two were changed. A person re-reading
 * the diff would not have seen it either: every line looked like the line
 * beside it.
 *
 * Everything under `src/lib/sites/` serves ONE site by definition, so there is
 * no legitimate business-kit read in it and the rule can be absolute. The two
 * places that legitimately read the business kit are elsewhere and named
 * below.
 */

const SITES_DIR = join(process.cwd(), "src", "lib", "sites");

/**
 * Where the BUSINESS kit is still the right answer, with the reason. Both are
 * outside `src/lib/sites/`; this list exists so a reader of the rule can see
 * that the exceptions were considered rather than missed.
 *
 *   - `site-actions.ts` `createSiteAction` — there is no site yet to have a
 *     kit, so the business's is what the new site is built from.
 *   - `actions.ts` — the kit editor's own preview, which branches on whether
 *     a site was named.
 */
const BUSINESS_KIT_IS_CORRECT = [
  "src/modules/marketing/site-actions.ts",
  "src/modules/marketing/actions.ts",
];

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

describe("a site surface resolves the site's brand", () => {
  it("no file under src/lib/sites/ calls resolveBrandFor", () => {
    const offenders = filesUnder(SITES_DIR)
      .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
      .filter((f) => /\bresolveBrandFor\s*\(/.test(readFileSync(f, "utf8")))
      .map((f) => f.replace(process.cwd(), "").replace(/\\/g, "/"));

    expect(
      offenders,
      `Every one of these serves a single site, so it must call resolveBrandForSite. ` +
        `resolveBrandFor(tx, tenantId, null) returns the BUSINESS's brand, which renders ` +
        `perfectly well and is the wrong one.`,
    ).toEqual([]);
  });

  it("names the two places the business kit is still right", () => {
    // Not an assertion about behaviour — a guard on the list above, so it
    // cannot quietly grow to cover a real mistake.
    expect(BUSINESS_KIT_IS_CORRECT).toHaveLength(2);
    for (const file of BUSINESS_KIT_IS_CORRECT) {
      expect(readFileSync(join(process.cwd(), file), "utf8")).toContain("resolveBrandFor(");
    }
  });
});
