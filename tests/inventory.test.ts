import { describe, expect, it } from "vitest";
import {
  UnitError,
  convert,
  formatQuantity,
  getUnit,
  isKnownUnit,
  purchaseUnitFactor,
  roundQuantity,
  unitsInDimensionOf,
  UNITS,
} from "../src/packs/inventory/core/units";
import {
  balanceByItem,
  balanceByLocation,
  balanceByLot,
  balanceOfLot,
  balanceOfLotAtLocation,
  wouldGoNegative,
  type MovementRow,
} from "../src/packs/inventory/core/balances";
import {
  SLUG_FORMAT,
  SUGGESTED_ITEM_KINDS,
  isLotSource,
  isValidSlug,
  movementKindLabel,
} from "../src/packs/inventory/vocabulary";

/**
 * The pure half of `inventory`: units and the balance fold.
 *
 * Two things carry most of the weight. **Conversions must refuse across
 * dimensions** rather than guess, because an invented pounds-to-gallons factor
 * produces balances nobody can explain. And **the balance is a fold over the
 * ledger**, never a stored number, so these tests are what certify that the
 * arithmetic underneath every screen adds up.
 */

const row = (r: Partial<MovementRow> & { quantity: number }): MovementRow => ({
  itemId: "item-1",
  lotId: null,
  locationAssetId: null,
  ...r,
});

describe("units", () => {
  it("converts exactly within a dimension", () => {
    expect(convert(1, "ton", "lb")).toBe(2000);
    expect(convert(2000, "lb", "ton")).toBe(1);
    expect(convert(1, "dozen", "each")).toBe(12);
    expect(convert(24, "each", "dozen")).toBe(2);
    expect(convert(16, "oz", "lb")).toBe(1);
  });

  it("REFUSES across dimensions instead of guessing", () => {
    // There is no universal factor between pounds and gallons — it depends
    // entirely on what is in the container. An app that invented one would
    // produce a balance nobody could explain.
    expect(() => convert(1, "lb", "gal")).toThrow(UnitError);
    expect(() => convert(1, "each", "lb")).toThrow(UnitError);
  });

  it("refuses a unit it does not know", () => {
    expect(() => convert(1, "hogshead", "gal")).toThrow(UnitError);
    expect(isKnownUnit("hogshead")).toBe(false);
  });

  it("treats head as an ordinary count unit", () => {
    // The decision that let the lot spine be ONE mechanism: "70 head" is a
    // quantity exactly as "500 lb" is, so livestock needs no parallel counter.
    expect(getUnit("head")?.dimension).toBe("count");
    expect(convert(70, "head", "head")).toBe(70);
  });

  it("offers only units it can actually convert to", () => {
    const massCodes = unitsInDimensionOf("lb").map((u) => u.code);
    expect(massCodes).toContain("ton");
    expect(massCodes).not.toContain("gal");
    expect(unitsInDimensionOf("nonsense")).toEqual([]);
  });

  it("has no duplicate codes and a base unit per dimension", () => {
    const codes = UNITS.map((u) => u.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const dim of ["mass", "volume", "count", "area"] as const) {
      const bases = UNITS.filter((u) => u.dimension === dim && u.perBase === 1);
      expect(bases.length).toBeGreaterThan(0);
    }
  });

  it("rounds to the column's scale", () => {
    expect(roundQuantity(1.234567)).toBe(1.2346);
    expect(convert(1, "g", "lb")).toBe(0.0022);
  });

  it("renders an unknown quantity as an em dash, never as zero", () => {
    // "None on hand" and "never counted" are different facts — the same rule
    // `land` applies to an unmeasured area.
    expect(formatQuantity(null, "lb")).toBe("—");
    expect(formatQuantity(0, "lb")).toBe("0 pounds");
  });

  it("singularises one", () => {
    expect(formatQuantity(1, "lb")).toBe("1 pound");
    expect(formatQuantity(2, "lb")).toBe("2 pounds");
    // "head" is its own plural, and a farmer would notice "2 heads".
    expect(formatQuantity(2, "head")).toBe("2 head");
  });
});

describe("purchaseUnitFactor", () => {
  it("prefers the ITEM's own conversion over any global one", () => {
    // A flat of eggs is THIRTY, not twelve, and no global table can know that.
    const factor = purchaseUnitFactor({
      stockingUnit: "each",
      purchaseUnit: "flat",
      purchaseUnitQty: 30,
    });
    expect(factor).toBe(30);
  });

  it("falls back to an exact global conversion", () => {
    expect(
      purchaseUnitFactor({
        stockingUnit: "lb",
        purchaseUnit: "ton",
        purchaseUnitQty: null,
      }),
    ).toBe(2000);
  });

  it("is 1 when the units are the same or none is set", () => {
    expect(
      purchaseUnitFactor({ stockingUnit: "lb", purchaseUnit: null, purchaseUnitQty: null }),
    ).toBe(1);
    expect(
      purchaseUnitFactor({ stockingUnit: "lb", purchaseUnit: "lb", purchaseUnitQty: null }),
    ).toBe(1);
  });

  it("returns null rather than 1 when it cannot convert", () => {
    // The caller must treat this as "cannot convert". Defaulting to 1 would
    // silently record a bag as one pound.
    expect(
      purchaseUnitFactor({ stockingUnit: "lb", purchaseUnit: "bag", purchaseUnitQty: null }),
    ).toBeNull();
  });
});

describe("balances", () => {
  it("sums the ledger per item", () => {
    const rows = [
      row({ quantity: 100 }),
      row({ quantity: -30 }),
      row({ itemId: "item-2", quantity: 5 }),
    ];
    expect(balanceByItem(rows).get("item-1")).toBe(70);
    expect(balanceByItem(rows).get("item-2")).toBe(5);
  });

  it("DROPS anything that nets to zero", () => {
    // A lot that went in and came out again is not "0 lb in the freezer" — it
    // is not in the freezer. Listing it would fill the day-one screen with
    // everything the farm has ever held.
    const rows = [
      row({ locationAssetId: "freezer", quantity: 40 }),
      row({ locationAssetId: "freezer", quantity: -40 }),
      row({ locationAssetId: "barn", quantity: 10 }),
    ];
    const byLocation = balanceByLocation(rows);
    expect(byLocation).toHaveLength(1);
    expect(byLocation[0]).toEqual({ locationAssetId: "barn", quantity: 10 });
  });

  it("keeps an unknown location rather than hiding it", () => {
    // "Somewhere, uncounted" is the honest state for a farm that has never
    // tracked anything, and hiding it would make the totals not add up.
    const rows = [
      row({ locationAssetId: null, quantity: 12 }),
      row({ locationAssetId: "freezer", quantity: 8 }),
    ];
    const byLocation = balanceByLocation(rows);
    expect(byLocation.map((b) => b.locationAssetId)).toContain(null);
    expect(byLocation.reduce((s, b) => s + b.quantity, 0)).toBe(20);
  });

  it("answers which freezer has the ribeyes, largest first", () => {
    const rows = [
      row({ locationAssetId: "freezer-a", quantity: 12 }),
      row({ locationAssetId: "freezer-b", quantity: 40 }),
      row({ locationAssetId: "freezer-c", quantity: 25 }),
    ];
    expect(balanceByLocation(rows).map((b) => b.locationAssetId)).toEqual([
      "freezer-b",
      "freezer-c",
      "freezer-a",
    ]);
  });

  it("sums per lot, which is what is left of each batch", () => {
    const rows = [
      row({ lotId: "lot-a", quantity: 70 }),
      row({ lotId: "lot-a", quantity: -4 }),
      row({ lotId: "lot-b", quantity: 68 }),
    ];
    expect(balanceOfLot(rows, "lot-a")).toBe(66);
    expect(balanceByLot(rows)).toHaveLength(2);
  });

  it("sums one lot in one place, which is what a split has to check", () => {
    const rows = [
      row({ lotId: "lot-a", locationAssetId: "pen-1", quantity: 70 }),
      row({ lotId: "lot-a", locationAssetId: "pen-2", quantity: 30 }),
      row({ lotId: "lot-a", locationAssetId: "pen-1", quantity: -5 }),
    ];
    expect(balanceOfLotAtLocation(rows, "lot-a", "pen-1")).toBe(65);
    expect(balanceOfLotAtLocation(rows, "lot-a", "pen-2")).toBe(30);
    expect(balanceOfLot(rows, "lot-a")).toBe(95);
  });

  it("a split balances — the ledger total does not move", () => {
    // The property that makes a head count reconcile with its own history
    // rather than being asserted.
    const before = [row({ lotId: "lot-a", quantity: 70 })];
    const after = [
      ...before,
      row({ lotId: "lot-a", quantity: -20 }),
      row({ lotId: "lot-b", quantity: 20 }),
    ];
    expect(balanceByItem(before).get("item-1")).toBe(70);
    expect(balanceByItem(after).get("item-1")).toBe(70);
    expect(balanceOfLot(after, "lot-a")).toBe(50);
    expect(balanceOfLot(after, "lot-b")).toBe(20);
  });

  it("reports a negative balance rather than pretending it cannot happen", () => {
    // Stock goes negative the moment somebody issues feed on Tuesday and
    // records Monday's delivery on Wednesday. A system that refuses the
    // Tuesday entry teaches people to stop entering things.
    const rows = [row({ lotId: "lot-a", quantity: -5 })];
    expect(balanceOfLot(rows, "lot-a")).toBe(-5);
    expect(wouldGoNegative([], "lot-a", -1)).toBe(true);
    expect(wouldGoNegative([row({ lotId: "lot-a", quantity: 10 })], "lot-a", -4)).toBe(
      false,
    );
  });

  it("handles fractional quantities without drift", () => {
    const rows = [
      row({ quantity: 0.1 }),
      row({ quantity: 0.2 }),
      row({ quantity: -0.3 }),
    ];
    // 0.1 + 0.2 - 0.3 is famously not 0 in floating point. Rounding to the
    // column's scale is what makes the zero-drop rule reliable.
    expect(balanceByItem(rows).get("item-1")).toBeUndefined();
  });

  it("is empty for no movements at all", () => {
    expect(balanceByItem([]).size).toBe(0);
    expect(balanceByLocation([])).toEqual([]);
    expect(balanceOfLot([], "lot-a")).toBe(0);
  });
});

describe("vocabulary", () => {
  it("mirrors the _format CHECKs", () => {
    expect(SLUG_FORMAT.source).toBe("^[a-z][a-z0-9_]{0,62}$");
  });

  it("accepts and rejects the right slugs", () => {
    expect(isValidSlug("feed")).toBe(true);
    expect(isValidSlug("split_out")).toBe(true);
    expect(isValidSlug("Feed")).toBe(false);
    expect(isValidSlug("2nd_cut")).toBe(false);
    expect(isValidSlug("")).toBe(false);
  });

  it("every suggested kind is a valid value", () => {
    for (const kind of SUGGESTED_ITEM_KINDS) {
      expect(isValidSlug(kind)).toBe(true);
    }
  });

  it("does not sort the suggestions alphabetically", () => {
    // `land` paid for this: sorting put `building_site` first and made it the
    // default answer for a paddock. Feed is what a farm reaches for.
    expect(SUGGESTED_ITEM_KINDS[0]).toBe("feed");
    expect([...SUGGESTED_ITEM_KINDS]).not.toEqual([...SUGGESTED_ITEM_KINDS].sort());
  });

  it("keeps lot source closed, because each one costs differently", () => {
    expect(isLotSource("purchased")).toBe(true);
    expect(isLotSource("raised")).toBe(true);
    expect(isLotSource("borrowed")).toBe(false);
  });

  it("labels a movement kind another pack invented", () => {
    // The column is an open taxonomy, so `livestock` adds `death` without a
    // migration — and the UI must not render a raw slug when it does.
    expect(movementKindLabel("receipt")).toBe("Received");
    expect(movementKindLabel("weighed_out")).toBe("Weighed out");
  });
});
