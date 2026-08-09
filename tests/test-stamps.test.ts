import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_STAMP_PATTERN, TEST_TENANT_SLUG_PREFIXES } from "./test-tenants";

/**
 * Guards the cleanup pattern in test-tenants.ts. No database needed.
 *
 * Two ways it can go wrong, both caught here: a new suite invents a stamp
 * nobody added to the list (its tenants would linger forever), or the pattern
 * loosens far enough to match a real client slug (its tenant would be
 * deleted). The live database has three "keep" tenants with "test" in the
 * slug — they are in the negative cases below.
 */
const stampRe = /`([a-z0-9-]+?)-\$\{process\.pid\}`/g;

describe("test tenant stamps", () => {
  it("every ${process.pid} stamp in tests/ has a cleanup prefix", () => {
    const dir = __dirname;
    const found = new Map<string, string>(); // prefix → file that uses it

    for (const file of readdirSync(dir).filter((f) => f.endsWith(".test.ts"))) {
      const src = readFileSync(path.join(dir, file), "utf8");
      for (const [, prefix] of src.matchAll(stampRe)) {
        if (!found.has(prefix)) found.set(prefix, file);
      }
    }

    expect(found.size, "no stamps found — did the regex or layout change?").toBeGreaterThan(5);

    const missing = [...found].filter(
      ([prefix]) => !(TEST_TENANT_SLUG_PREFIXES as readonly string[]).includes(prefix),
    );
    expect(
      missing,
      `add these to TEST_TENANT_SLUG_PREFIXES in tests/test-tenants.ts, or their ` +
        `tenants survive an interrupted run: ${missing.map(([p, f]) => `${p} (${f})`).join(", ")}`,
    ).toEqual([]);
  });

  it("matches stamped slugs and nothing that looks like a client", () => {
    const re = new RegExp(TEST_STAMP_PATTERN);

    for (const slug of [
      "iso-test-26164-a",
      "iso-test-26164-b",
      "export-test-18884-b",
      "retainer-billing-4127",
      "iso-interview-991",
      "interview-test-1234-decks-2",
    ]) {
      expect(re.test(slug), `${slug} should be swept`).toBe(true);
    }

    for (const slug of [
      "test", // real prospect record
      "test-1784496066921840490", // real workspace — slug is a snowflake, not a pid stamp
      "greenline-test-landscaping", // real prospect
      "acme-plumbing",
      "iso-test", // no pid segment
      "iso-test-abc", // pid segment must be digits
      "my-iso-test-123", // must match from the start
    ]) {
      expect(re.test(slug), `${slug} must never be swept`).toBe(false);
    }
  });
});
