import { describe, expect, it } from "vitest";
import { SLUG_FORMAT, slugify, uniqueSlug } from "../src/lib/enterprises/slug";

/**
 * Turning a name into a handle. PURE — no database, so this lives on the `pure`
 * side of `tests/db-backed-files.ts`.
 *
 * **THE SLUG IS THE ONE PART OF AN ENTERPRISE THAT CANNOT BE CHANGED LATER**,
 * because a rename deliberately leaves it alone. So the edge cases are worth
 * pinning: every one of these produced a row the database would have refused,
 * or a handle nobody could have typed on purpose.
 */

describe("slugify", () => {
  it("makes the ordinary case boring", () => {
    expect(slugify("Broilers")).toBe("broilers");
    expect(slugify("Beef")).toBe("beef");
    expect(slugify("Laying hens & eggs")).toBe("laying_hens_eggs");
  });

  it("strips accents rather than mangling them", () => {
    // "cafe", never "cafx" and never an empty handle.
    expect(slugify("Café crops")).toBe("cafe_crops");
  });

  it("PREFIXES A NAME THAT STARTS WITH A DIGIT, rather than dropping it", () => {
    /**
     * `enterprises_slug_format` demands a LETTER first, so "2026 broilers"
     * would otherwise produce `2026_broilers` and be refused by the database at
     * insert time — an error about a column the person never saw. Dropping the
     * digits instead would silently make two years' flocks share a handle.
     */
    const slug = slugify("2026 broilers");
    expect(slug).toBe("e_2026_broilers");
    expect(SLUG_FORMAT.test(slug!)).toBe(true);
  });

  it("collapses and trims the punctuation somebody actually types", () => {
    expect(slugify("  Pigs -- weaners  ")).toBe("pigs_weaners");
    expect(slugify("Beef/Dairy")).toBe("beef_dairy");
  });

  it("IS NULL WHEN NOTHING SURVIVES, rather than inventing a handle", () => {
    // A row under `enterprise_1` is a row named something the person never
    // typed. The caller asks for a different name instead.
    expect(slugify("🐔")).toBeNull();
    expect(slugify("---")).toBeNull();
    expect(slugify("   ")).toBeNull();
  });

  it("never returns something the CHECK would refuse", () => {
    const names = [
      "Broilers",
      "2026 broilers",
      "Café crops",
      "A".repeat(200),
      "x".repeat(62) + " y",
      "___leading",
    ];
    for (const name of names) {
      const slug = slugify(name);
      if (slug !== null) expect(SLUG_FORMAT.test(slug)).toBe(true);
    }
  });

  it("stays inside 63 characters and does not end on an underscore", () => {
    // The slice can land mid-word and leave a trailing separator, which reads
    // as the truncation accident it is.
    const slug = slugify("x".repeat(60) + " broilers")!;
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug.endsWith("_")).toBe(false);
    expect(SLUG_FORMAT.test(slug)).toBe(true);
  });
});

describe("uniqueSlug", () => {
  it("leaves a free handle alone", () => {
    expect(uniqueSlug("broilers", [])).toBe("broilers");
    expect(uniqueSlug("broilers", ["beef"])).toBe("broilers");
  });

  it("counts up past a collision", () => {
    expect(uniqueSlug("broilers", ["broilers"])).toBe("broilers_2");
    expect(uniqueSlug("broilers", ["broilers", "broilers_2"])).toBe("broilers_3");
  });

  it("keeps the suffix inside the length limit", () => {
    // Appending blindly would push a 63-character base to 65 and the insert
    // would fail on a constraint nobody could see from the form.
    const base = "x".repeat(63);
    const slug = uniqueSlug(base, [base]);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug.endsWith("_2")).toBe(true);
    expect(SLUG_FORMAT.test(slug)).toBe(true);
  });
});
