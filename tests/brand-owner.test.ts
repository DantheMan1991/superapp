import { describe, expect, it } from "vitest";
import {
  BUSINESS_KIT,
  inheritsFromBusiness,
  isBusinessKit,
  ownerFields,
  ownerFrom,
  type KitOwner,
} from "../src/lib/brand/owner";

/**
 * Whose look a brand kit is (`src/lib/brand/owner.ts`, ADR 0045).
 *
 * `isBusinessKit` gets a test of its own because the one-column version of it
 * has now been wrong in THREE places, and every one of them was silent: it
 * would have printed a website's logo on the invoices, let a save to the
 * business kit overwrite a website's, and shown a website's brand as the
 * business's on the Marketing screen. None of those throws — they just show
 * the wrong brand — so nothing but a test catches a regression.
 */

const company: KitOwner = { kind: "company", entityId: "e1" };
const site: KitOwner = { kind: "site", siteId: "s1" };

describe("an owner's columns", () => {
  it("sets exactly one, and the business sets neither", () => {
    expect(ownerFields(BUSINESS_KIT)).toEqual({ entityId: null, siteId: null });
    expect(ownerFields(company)).toEqual({ entityId: "e1", siteId: null });
    expect(ownerFields(site)).toEqual({ entityId: null, siteId: "s1" });
  });

  it("never sets both, for any owner", () => {
    for (const owner of [BUSINESS_KIT, company, site]) {
      const fields = ownerFields(owner);
      expect(Boolean(fields.entityId) && Boolean(fields.siteId), owner.kind).toBe(false);
    }
  });

  it("round-trips through the wire shape", () => {
    for (const owner of [BUSINESS_KIT, company, site]) {
      expect(ownerFrom(ownerFields(owner)), owner.kind).toEqual(owner);
    }
  });

  it("reads an absent field as the business", () => {
    expect(ownerFrom({})).toEqual(BUSINESS_KIT);
    expect(ownerFrom({ entityId: null })).toEqual(BUSINESS_KIT);
    expect(ownerFrom({ entityId: null, siteId: null })).toEqual(BUSINESS_KIT);
  });
});

describe("isBusinessKit", () => {
  it("is true ONLY when both owner columns are null", () => {
    expect(isBusinessKit({ entityId: null, siteId: null })).toBe(true);
  });

  it("is false for a company's kit", () => {
    expect(isBusinessKit({ entityId: "e1", siteId: null })).toBe(false);
  });

  it("is false for a WEBSITE's kit, which also has a null entityId", () => {
    // The whole point. `entityId === null` was the old test and this row
    // passes it, which is how a site's logo could reach the invoices.
    expect(isBusinessKit({ entityId: null, siteId: "s1" })).toBe(false);
  });

  it("picks the business kit out of a list that holds all three", () => {
    const kits = [
      { entityId: null, siteId: "s1" },
      { entityId: "e1", siteId: null },
      { entityId: null, siteId: null },
    ];
    // `find` returns the FIRST match, and the site's row is first on purpose:
    // the old predicate would have returned it.
    expect(kits.find(isBusinessKit)).toEqual({ entityId: null, siteId: null });
  });
});

describe("what inherits", () => {
  it("is everything but the business itself", () => {
    expect(inheritsFromBusiness(BUSINESS_KIT)).toBe(false);
    expect(inheritsFromBusiness(company)).toBe(true);
    expect(inheritsFromBusiness(site)).toBe(true);
  });
});
