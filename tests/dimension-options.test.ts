import { describe, expect, it } from "vitest";
import { dimensionTypesFrom } from "../src/lib/dimension-options";

/**
 * **THE OPTIONS A TAG PICKER OFFERS.** Pure, and the whole reason it exists as
 * a function rather than three lines in each page is the active filter.
 */

const member = (
  id: string,
  dimensionType: string,
  displayName: string,
  isActive = true,
) => ({ id, dimensionType, displayName, isActive });

describe("dimensionTypesFrom", () => {
  it("NEVER OFFERS A RETIRED MEMBER, which is the whole point", () => {
    /**
     * `listDimensionMembers` does not filter by `is_active` and `postEntry`
     * refuses an inactive member with `DIMENSION_INVALID`, so a screen that
     * offered one would fail the entire save when somebody picked it. The fix
     * for a per-caller trap is to leave the caller no way to get it wrong.
     */
    const out = dimensionTypesFrom([
      member("m1", "enterprise", "Broilers"),
      member("m2", "enterprise", "Pigs", false),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].members.map((m) => m.name)).toEqual(["Broilers"]);
  });

  it("drops a type entirely when every member of it is retired", () => {
    // Not an empty group: a picker with a heading and no options under it is
    // furniture, and `DimensionTags` would render the label for nothing.
    const out = dimensionTypesFrom([
      member("m1", "enterprise", "Broilers"),
      member("m2", "zone", "North paddock", false),
    ]);
    expect(out.map((t) => t.type)).toEqual(["enterprise"]);
  });

  it("groups by type and takes the list from the data, never from a list in code", () => {
    // The property that keeps the word "enterprise" out of `accounting`: a
    // tenant with paddocks and no lines of business gets a paddock picker from
    // the same code, and nothing had to be told that paddocks exist.
    const out = dimensionTypesFrom([
      member("m1", "zone", "North paddock"),
      member("m2", "parcel", "Home field"),
      member("m3", "zone", "South paddock"),
    ]);
    expect(out.map((t) => t.type)).toEqual(["parcel", "zone"]);
    expect(out[1].members.map((m) => m.name)).toEqual([
      "North paddock",
      "South paddock",
    ]);
  });

  it("labels a type by capitalising its slug, underscores included", () => {
    // What the report's "Split by" picker already shows, so the write side and
    // the read side agree. Resolving the profile's real word is its own work.
    const out = dimensionTypesFrom([member("m1", "cost_code", "CC-1")]);
    expect(out[0].label).toBe("Cost code");
  });

  it("sorts both axes, because a picker whose options move gets mis-clicked", () => {
    const out = dimensionTypesFrom([
      member("m1", "zone", "Zulu"),
      member("m2", "zone", "Alpha"),
      member("m3", "asset", "Tractor"),
    ]);
    expect(out.map((t) => t.type)).toEqual(["asset", "zone"]);
    expect(out[1].members.map((m) => m.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("returns nothing at all for a business with no dimensions", () => {
    // `DimensionTags` renders null on this, which is most tenants on most days.
    expect(dimensionTypesFrom([])).toEqual([]);
  });
});
