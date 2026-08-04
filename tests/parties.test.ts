import { describe, expect, it } from "vitest";
import {
  normalizeName,
  normalizeOptional,
  personDisplayName,
} from "../src/lib/parties/names";

/**
 * The pure half of the party subsystem. No database, so these run in the
 * default gate rather than only when TEST_DATABASE_URL is set — the pattern
 * conventions.md asks for: push logic somewhere it can be tested without a
 * session, then test it there.
 *
 * The rules that matter are the two asymmetries: whitespace-only is "not
 * known" rather than a value, and a display name is never invented from
 * nothing.
 */

describe("normalizeName", () => {
  it("collapses runs of whitespace and trims", () => {
    expect(normalizeName("  Probe   Construction  Ltd ")).toBe(
      "Probe Construction Ltd",
    );
  });

  it("collapses newlines and tabs, which paste brings in", () => {
    expect(normalizeName("Probe\n\tConstruction")).toBe("Probe Construction");
  });

  it("reduces a whitespace-only string to empty, so callers can refuse it", () => {
    expect(normalizeName("   \t\n ")).toBe("");
  });
});

describe("normalizeOptional", () => {
  it("treats null, undefined, empty and whitespace-only as the same absence", () => {
    // One spelling of "not known" rather than four, so no reader has to handle
    // the difference between null and "".
    expect(normalizeOptional(null)).toBeNull();
    expect(normalizeOptional(undefined)).toBeNull();
    expect(normalizeOptional("")).toBeNull();
    expect(normalizeOptional("   ")).toBeNull();
  });

  it("normalizes a real value the same way as a required one", () => {
    expect(normalizeOptional("  Ó  Braonáin ")).toBe("Ó Braonáin");
  });
});

describe("personDisplayName", () => {
  it("joins the parts that are known", () => {
    expect(personDisplayName("Aoife", "Ó Braonáin")).toBe("Aoife Ó Braonáin");
  });

  it("uses whichever single part is present", () => {
    expect(personDisplayName("Aoife", null)).toBe("Aoife");
    expect(personDisplayName(null, "Ó Braonáin")).toBe("Ó Braonáin");
  });

  it("returns null when nothing usable was supplied", () => {
    // Null rather than "" so the caller refuses the write instead of storing a
    // blank name that every surface would then render as nothing.
    expect(personDisplayName(null, null)).toBeNull();
    expect(personDisplayName("  ", "")).toBeNull();
  });

  it("does not pad when one part is whitespace", () => {
    expect(personDisplayName("Aoife", "   ")).toBe("Aoife");
  });
});
