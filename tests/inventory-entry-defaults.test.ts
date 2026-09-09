import { describe, expect, it } from "vitest";
import {
  defaultBatch,
  defaultPlace,
  lastPlaceUsed,
} from "../src/packs/inventory/core/entry-defaults";

describe("lastPlaceUsed", () => {
  it("is the newest entry that named a place, skipping the ones that did not", () => {
    expect(
      lastPlaceUsed([
        { locationAssetId: null },
        { locationAssetId: "truck" },
        { locationAssetId: "freezer" },
      ]),
    ).toBe("truck");
  });

  it("is null when no entry ever named one", () => {
    expect(lastPlaceUsed([{ locationAssetId: null }])).toBeNull();
    expect(lastPlaceUsed([])).toBeNull();
  });
});

describe("defaultPlace", () => {
  const entries = [{ locationAssetId: "truck" }, { locationAssetId: "freezer" }];

  it("starts where the item went last time", () => {
    expect(defaultPlace(entries, ["freezer", "truck"])).toBe("truck");
  });

  it("does not point at a place that has since been retired", () => {
    // The truck is gone; two places remain, so nothing is assumed.
    expect(defaultPlace(entries, ["freezer", "barn"])).toBeNull();
  });

  it("starts on the only place when the item has never been placed", () => {
    expect(defaultPlace([], ["freezer"])).toBe("freezer");
    expect(defaultPlace([{ locationAssetId: null }], ["freezer"])).toBe("freezer");
  });

  it("assumes nothing between two places", () => {
    expect(defaultPlace([], ["freezer", "truck"])).toBeNull();
    expect(defaultPlace([], [])).toBeNull();
  });
});

describe("defaultBatch", () => {
  it("is the only open batch, and nothing when there is a choice", () => {
    expect(defaultBatch(["a"])).toBe("a");
    expect(defaultBatch(["a", "b"])).toBeNull();
    expect(defaultBatch([])).toBeNull();
  });
});
