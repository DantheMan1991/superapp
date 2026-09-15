import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ICONS } from "@/components/app/icon-registry";
import { moduleRegistry } from "@/modules";
import { packRegistry } from "@/packs";

/**
 * THE TWO SEAMS A NEW MODULE HAS TO TOUCH THAT FAIL SILENTLY.
 *
 * `icon-registry.ts` says it plainly: *"There is still no test that would catch
 * it: the fix is to add the key in the same commit as the pack."* Adding the
 * key in the same commit is exactly the discipline that failed — five packs
 * shipped rendering a generic box because `getIcon` falls back to `Boxes`
 * rather than throwing, and every pack shipped in accounting's emerald because
 * `var(--accent-<slug>, var(--accent-brand))` falls through rather than
 * failing. Neither is visible in `tsc`, in lint, in the build or in any test;
 * both were live for months. This is that test.
 */

const CSS = readFileSync("src/app/globals.css", "utf8");

/**
 * A token has to exist in all three, and the second and third are the ones that
 * get forgotten: `:root` is where somebody adds it, and a value tuned for the
 * page background is wrong on the dark theme and wrong again on the navy rail.
 */
const BLOCKS = [":root", ".dark", "[data-sidebar-surface]"] as const;

function blockBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} block not found in globals.css`).toBeGreaterThan(-1);
  const end = CSS.indexOf("\n}", start);
  return CSS.slice(start, end);
}

/**
 * Slugs that KNOWINGLY share the brand accent, and are therefore allowed to
 * have no token of their own.
 *
 * Being on this list is a decision somebody made, not an oversight — which is
 * the whole point of writing it down. Give one an `--accent-<slug>` and take it
 * off; the wheel's spacing is documented above the pack accents in
 * `globals.css`.
 */
const SHARES_BRAND_ACCENT = new Set(["professional-services"]);

describe("every registered module names an icon the registry can resolve", () => {
  const entries = [
    ...Object.values(moduleRegistry).map((m) => ["module", m.slug, m.icon] as const),
    ...Object.values(packRegistry).map((p) => ["pack", p.slug, p.icon] as const),
  ];

  it.each(entries)("%s %s uses icon %s", (_kind, _slug, icon) => {
    // `getIcon` falls back to `Boxes` instead of throwing, so a missing key is
    // a wrong icon rather than an error — invisible until somebody looks.
    expect(Object.keys(ICONS)).toContain(icon);
  });
});

describe("every registered module has an accent, in all three blocks", () => {
  const slugs = [
    ...Object.values(moduleRegistry).map((m) => m.slug),
    ...Object.values(packRegistry).map((p) => p.slug),
  ];

  it.each(slugs.filter((s) => !SHARES_BRAND_ACCENT.has(s)))(
    "%s defines --accent-<slug> everywhere it is themed",
    (slug) => {
      for (const selector of BLOCKS) {
        expect(
          blockBody(selector),
          `--accent-${slug} missing from ${selector} — it will silently fall back to --accent-brand there`,
        ).toContain(`--accent-${slug}:`);
      }
    },
  );

  it("only lists a slug as sharing the brand accent if it really has no token", () => {
    // Stops the allowlist rotting into a place where real tokens hide.
    for (const slug of SHARES_BRAND_ACCENT) {
      expect(
        blockBody(":root"),
        `${slug} is listed as sharing the brand accent but defines --accent-${slug}; take it off the list`,
      ).not.toContain(`--accent-${slug}:`);
    }
  });
});

describe("the pack accents stay spread around the wheel", () => {
  it("keeps every pair of module hues at least 15° apart", () => {
    const body = blockBody(":root");
    const hues = [...body.matchAll(/--accent-[a-z-]+: oklch\([\d.]+ [\d.]+ ([\d.]+)\)/g)]
      .map((m) => Number(m[1]))
      // `--accent-brand` is the fallback every untokened module shares, and
      // `--accent-accounting` deliberately matches it. Counting both would
      // report a 0° gap that is not a clash.
      .filter((h, i, all) => all.indexOf(h) === i)
      .sort((a, b) => a - b);

    expect(hues.length).toBeGreaterThan(10);
    for (let i = 1; i < hues.length; i++) {
      expect(
        hues[i] - hues[i - 1],
        `${hues[i - 1]}° and ${hues[i]}° are too close to tell apart in the rail`,
      ).toBeGreaterThanOrEqual(15);
    }
  });
});
