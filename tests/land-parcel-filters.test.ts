import { describe, expect, it } from "vitest";
import { statusFrom } from "@/packs/land/core/list";

/**
 * Which ground the Land list shows.
 *
 * **THE LEGACY PARAMETER IS THE WHOLE REASON THIS IS TESTED.** Retired parcels
 * were opt-in via `?retired=1` with no control on the page, and a tenant guide
 * told people to edit the address. A bookmark made from that guide has to keep
 * working while the new control writes `?status=`.
 */
describe("statusFrom", () => {
  it("shows ground in use when nothing is asked for", () => {
    expect(statusFrom(null, null)).toBe("active");
    expect(statusFrom(undefined, undefined)).toBe("active");
  });

  it("reads the new parameter", () => {
    expect(statusFrom("retired", null)).toBe("retired");
    expect(statusFrom("all", null)).toBe("all");
    expect(statusFrom("active", null)).toBe("active");
  });

  it("still honours ?retired=1, which meant BOTH", () => {
    expect(statusFrom(null, "1")).toBe("all");
  });

  it("lets the new parameter win over the old one", () => {
    // Only reachable by hand-editing a URL, and the control deletes `retired`
    // the moment it is used — but a rule nobody stated is a rule that gets
    // decided differently by the next person.
    expect(statusFrom("retired", "1")).toBe("retired");
    expect(statusFrom("active", "1")).toBe("active");
  });

  it("falls back to ground in use for anything it does not recognise", () => {
    expect(statusFrom("sold", null)).toBe("active");
    expect(statusFrom("", null)).toBe("active");
    expect(statusFrom(null, "yes")).toBe("active");
    expect(statusFrom(null, "0")).toBe("active");
  });
});
