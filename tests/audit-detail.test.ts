import { describe, expect, it } from "vitest";
import {
  MAX_DETAILS,
  describeMeta,
  formatValue,
  humanise,
} from "../src/lib/audit-detail";

/**
 * Reading `audit_log.meta`.
 *
 * The column is `jsonb` with no shape constraint, written by 234 call sites
 * across every pack, plus webhooks and background jobs. So the tests worth
 * having are not "does it format a string" — they are:
 *
 *   1. **A correction diffs to what MOVED.** That is the whole reason the
 *      renderer exists; two blobs side by side would be worse than nothing.
 *   2. **Nothing throws, ever.** A malformed blob must degrade to a readable
 *      line rather than take down the one page a superadmin uses to find out
 *      what happened.
 *   3. **Absence is a fact, not a gap.** "invited: —" says no invitation went
 *      out, and dropping the row would hide it.
 */

describe("humanise", () => {
  it("turns the app's key styles into words", () => {
    expect(humanise("meatWithdrawalDays")).toBe("meat withdrawal days");
    expect(humanise("clerkOrgId")).toBe("clerk org id");
    expect(humanise("switched_on")).toBe("switched on");
    expect(humanise("packs")).toBe("packs");
  });

  it("survives a key that is not camel or snake", () => {
    expect(humanise("")).toBe("");
    expect(humanise("A")).toBe("a");
    expect(humanise("sizeBytes2")).toBe("size bytes2");
  });
});

describe("formatValue", () => {
  it("says yes and no rather than true and false", () => {
    // "delegated: true" reads as jargon under a muted label.
    expect(formatValue(true)).toBe("yes");
    expect(formatValue(false)).toBe("no");
  });

  it("renders an ABSENCE rather than dropping it", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue("")).toBe("—");
  });

  it("flattens a list, and says so when it is empty", () => {
    expect(formatValue(["land", "assets", "inventory"])).toBe(
      "land, assets, inventory",
    );
    // "none" rather than "" — an empty list is the answer to "which packs
    // switched on", and it means none of them did.
    expect(formatValue([])).toBe("none");
  });

  it("flattens a nested object without printing JSON at somebody", () => {
    expect(formatValue({ meatWithdrawalDays: 21, route: "injection" })).toBe(
      "meat withdrawal days 21, route injection",
    );
  });

  it("cuts a long value rather than blowing out the row", () => {
    const long = "x".repeat(200);
    const out = formatValue(long);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("…")).toBe(true);
  });

  it("collapses whitespace so a pasted blob stays one line", () => {
    expect(formatValue("two\n\nlines   here")).toBe("two lines here");
  });

  it("NEVER THROWS on whatever jsonb hands back", () => {
    expect(() => formatValue(Number.NaN)).not.toThrow();
    expect(formatValue(Number.NaN)).toBe("—");
    expect(() => formatValue(Object.create(null))).not.toThrow();
    expect(() => formatValue(Symbol("x"))).not.toThrow();
    expect(() => formatValue(BigInt(123))).not.toThrow();
  });
});

describe("describeMeta", () => {
  it("is empty for a row with nothing recorded", () => {
    // The default is `{}`, and most rows have it.
    expect(describeMeta({})).toEqual([]);
    expect(describeMeta(null)).toEqual([]);
    expect(describeMeta("nonsense")).toEqual([]);
    expect(describeMeta([1, 2])).toEqual([]);
  });

  it("flattens an ordinary event", () => {
    expect(describeMeta({ packs: ["land", "assets"], switchedOn: 2 })).toEqual([
      { label: "packs", value: "land, assets", changed: false },
      { label: "switched on", value: "2", changed: false },
    ]);
  });

  it("DIFFS A CORRECTION DOWN TO WHAT MOVED", () => {
    // The whole reason this exists. A withdrawal clock corrected from 21 days
    // to 28 is one line, not two objects to compare by eye.
    const details = describeMeta({
      was: {
        treatedOn: "2026-08-18",
        product: "Penicillin G",
        meatWithdrawalDays: 21,
        milkWithdrawalDays: null,
      },
      now: {
        treatedOn: "2026-08-18",
        product: "Penicillin G",
        meatWithdrawalDays: 28,
        milkWithdrawalDays: null,
      },
    });
    expect(details).toEqual([
      { label: "meat withdrawal days", value: "21 → 28", changed: true },
    ]);
  });

  it("shows a field that was CLEARED, which lives only on the before side", () => {
    const details = describeMeta({
      was: { sampleWeightLb: 62.5, heartGirthIn: null },
      now: { sampleWeightLb: null, heartGirthIn: 40 },
    });
    expect(details).toEqual([
      { label: "sample weight lb", value: "62.5 → —", changed: true },
      { label: "heart girth in", value: "— → 40", changed: true },
    ]);
  });

  it("says so when a correction changed nothing", () => {
    // Somebody opened the dialog and saved it unchanged. A real outcome, and an
    // empty cell would look like a rendering failure.
    const details = describeMeta({ was: { a: 1 }, now: { a: 1 } });
    expect(details).toEqual([
      { label: "no change", value: "saved as it was", changed: false },
    ]);
  });

  it("degrades to the new values when the before side had already gone", () => {
    // `was: null` happens when the row was read back and was no longer there.
    const details = describeMeta({ was: null, now: { product: "Draxxin" } });
    expect(details).toEqual([
      { label: "product", value: "Draxxin", changed: false },
    ]);
  });

  it("does not mistake an ordinary key called `now` for a correction", () => {
    // `now` has to be an OBJECT to mean before/after. A timestamp called `now`
    // is just a value.
    expect(describeMeta({ now: "2026-08-20" })).toEqual([
      { label: "now", value: "2026-08-20", changed: false },
    ]);
  });

  it("CAPS AND SAYS SO rather than truncating silently", () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < MAX_DETAILS + 5; i++) wide[`key${i}`] = i;
    const details = describeMeta(wide);
    expect(details).toHaveLength(MAX_DETAILS + 1);
    expect(details[details.length - 1]).toEqual({
      label: "…and",
      value: "5 more not shown",
      changed: false,
    });
  });

  it("survives the shapes this app actually writes", () => {
    // Sampled from real call sites: a webhook, a mailbox connect, an inbound
    // attachment, a retainer entry, a livestock treatment.
    const real: unknown[] = [
      { clerkOrgId: "org_123" },
      { mailboxId: "abc", hasRefreshToken: true, delegated: false },
      { folderId: "f1", mimeType: "application/pdf", sizeBytes: 91234 },
      { minutes: 78, workDate: "2026-08-20", source: "manual" },
      {
        treatedOn: "2026-08-18",
        product: "Penicillin G",
        route: "injection",
        meatWithdrawalDays: 28,
        milkWithdrawalDays: null,
        withdrawalSource: "label",
      },
      { keys: ["currencySymbol", "zone"] },
      { invited: null },
    ];
    for (const meta of real) {
      expect(() => describeMeta(meta)).not.toThrow();
      expect(Array.isArray(describeMeta(meta))).toBe(true);
    }
    // The one that would otherwise vanish: no invitation went out.
    expect(describeMeta({ invited: null })).toEqual([
      { label: "invited", value: "—", changed: false },
    ]);
  });
});
