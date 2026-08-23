import { describe, expect, it } from "vitest";
import {
  averageCostRate,
  costPerUnit,
  issueCostCents,
  lotCost,
  splitCostAdjustment,
} from "../src/packs/inventory/core/costing";
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
  ADJUSTMENT_REASON_LABELS,
  ADJUSTMENT_REASON_NOTES,
  COUNT_STATUSES,
  COUNT_VARIANCE_REASON,
  SLUG_FORMAT,
  SUGGESTED_ADJUSTMENT_REASONS,
  SUGGESTED_ITEM_KINDS,
  adjustmentReasonLabel,
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

/**
 * Costing — layer two of three, and the one that closes the livestock loop.
 *
 * The tests that matter here are the ones where a defensible implementation is
 * quietly wrong: an average that folds its own issues back in, a cost that
 * moves under a pen after the fact, and a zero that reads as "free".
 */
describe("averageCostRate", () => {
  const receipt = (quantity: number, costCents: number | null) => ({
    quantity,
    costCents,
    movementKind: "receipt",
  });

  it("is cents per stocking unit across everything received", () => {
    // 12 bags at 50 lb = 600 lb for $340. 34000 / 600 cents per lb.
    expect(averageCostRate([receipt(600, 34_000)])).toBeCloseTo(56.6667, 3);
  });

  it("does NOT fold issues back in, which would be circular", () => {
    // An issue's own cost was derived from this average. Counting it again
    // would make the rate depend on how much had been used, which is nonsense.
    const rate = averageCostRate([
      receipt(600, 34_000),
      { quantity: -200, costCents: 11_333, movementKind: "issue" },
    ]);
    expect(rate).toBeCloseTo(56.6667, 3);
  });

  it("ignores stock that arrived with no price", () => {
    // Raised stock has no purchase basis at all, and a delivery whose invoice
    // has not arrived has none yet. Treating either as free would drag the
    // average down and quietly understate every pen.
    expect(averageCostRate([receipt(600, 34_000), receipt(400, null)])).toBeCloseTo(
      56.6667,
      3,
    );
  });

  it("is null when nothing priced has ever arrived", () => {
    // Not zero. "Free" and "not known" are different, and only one of them
    // should ever reach a screen.
    expect(averageCostRate([])).toBeNull();
    expect(averageCostRate([receipt(600, null)])).toBeNull();
  });
});

describe("issueCostCents", () => {
  it("rounds once, at the moment it is stored", () => {
    expect(issueCostCents(56.6667, 200)).toBe(11_333);
  });

  it("costs an issue the same whichever direction the quantity is signed", () => {
    // The ledger stores issues negative; the cost of using 200 lb does not
    // depend on that convention.
    expect(issueCostCents(56.6667, -200)).toBe(issueCostCents(56.6667, 200));
  });

  it("has no cost to stamp when nothing priced has arrived", () => {
    expect(issueCostCents(null, 200)).toBeNull();
  });

  it("leaves a remainder that does not compound", () => {
    // 100 cents over 3 units, issued one at a time, sums to 99. That is
    // ordinary average costing — the point is that it is one cent, not one
    // cent per issue forever.
    const rate = averageCostRate([{ quantity: 3, costCents: 100, movementKind: "receipt" }]);
    const pieces = [1, 1, 1].map((q) => issueCostCents(rate, q) ?? 0);
    expect(pieces).toEqual([33, 33, 33]);
    expect(pieces.reduce((a, b) => a + b, 0)).toBe(99);
  });
});

describe("lotCost", () => {
  it("keeps what a batch cost to buy apart from what was fed into it", () => {
    // A pen has both — the chicks and their feed — and adding them into one
    // number would answer neither question.
    const own = [{ quantity: 210, costCents: 39_000, movementKind: "receipt" }];
    const eaten = [
      { quantity: -200, costCents: 11_333, movementKind: "issue" },
      { quantity: -150, costCents: 8_500, movementKind: "issue" },
    ];
    expect(lotCost(own, eaten)).toEqual({
      purchasedCents: 39_000,
      consumedCents: 19_833,
    });
  });

  it("counts an unpriced issue as nothing rather than refusing to total", () => {
    expect(
      lotCost([], [{ quantity: -10, costCents: null, movementKind: "issue" }]),
    ).toEqual({ purchasedCents: 0, consumedCents: 0 });
  });
});

describe("splitCostAdjustment", () => {
  /**
   * **THE HALF PEOPLE DO NOT EXPECT.** ADR 0012 §A.4: a correction to what a
   * delivery cost is not all an asset if part of the delivery has already been
   * eaten. Capitalising that part would put cost back on the balance sheet for
   * feed that is gone, which is the double-count the whole ADR opens with.
   */
  it("splits by what is still on the shelf", () => {
    // $60 the ticket left out, 60 of the 100 lb still on hand.
    expect(
      splitCostAdjustment({
        amountCents: 6_000,
        quantityOnHand: 60,
        quantityReceived: 100,
      }),
    ).toEqual({ onHandCents: 3_600, issuedCents: 2_400 });
  });

  it("keeps the whole correction when nothing has left", () => {
    expect(
      splitCostAdjustment({
        amountCents: 6_000,
        quantityOnHand: 100,
        quantityReceived: 100,
      }),
    ).toEqual({ onHandCents: 6_000, issuedCents: 0 });
  });

  it("sends the whole correction to consumption when the batch is empty", () => {
    // The invoice arriving after the feed was eaten, which is an ordinary farm
    // month rather than an edge case.
    expect(
      splitCostAdjustment({
        amountCents: 6_000,
        quantityOnHand: 0,
        quantityReceived: 100,
      }),
    ).toEqual({ onHandCents: 0, issuedCents: 6_000 });
  });

  it("splits a correction DOWNWARDS the same way", () => {
    // The direction a movement could not carry: `cost_cents >= 0`.
    expect(
      splitCostAdjustment({
        amountCents: -5_000,
        quantityOnHand: 60,
        quantityReceived: 100,
      }),
    ).toEqual({ onHandCents: -3_000, issuedCents: -2_000 });
  });

  it("CLAMPS A BATCH THAT HAS GONE NEGATIVE", () => {
    /**
     * Negative stock is allowed in this pack and is not a bug — Monday's
     * delivery entered on Wednesday. Unclamped, a batch at −20 of 100 would
     * send 120% of the correction to consumption and take 20% back OFF the
     * balance sheet for stock that is not there to lose it.
     */
    expect(
      splitCostAdjustment({
        amountCents: 6_000,
        quantityOnHand: -20,
        quantityReceived: 100,
      }),
    ).toEqual({ onHandCents: 0, issuedCents: 6_000 });
  });

  it("keeps the whole correction when nothing has ever come in", () => {
    expect(
      splitCostAdjustment({
        amountCents: 6_000,
        quantityOnHand: 0,
        quantityReceived: 0,
      }),
    ).toEqual({ onHandCents: 6_000, issuedCents: 0 });
  });

  it("ALWAYS SUMS TO THE CORRECTION, whatever the rounding", () => {
    /**
     * The database CHECKs this, so a split that did not add up would be a
     * failed insert rather than a wrong number — but the reason it never can is
     * here: the rounding lands once, on the on-hand half, and the issued half
     * takes the remainder.
     */
    for (const onHand of [1, 7, 33, 66, 99]) {
      const parts = splitCostAdjustment({
        amountCents: 3_331,
        quantityOnHand: onHand,
        quantityReceived: 100,
      });
      expect(parts.onHandCents + parts.issuedCents).toBe(3_331);
    }
  });
});

describe("costPerUnit", () => {
  it("divides, and refuses to divide by nothing", () => {
    expect(costPerUnit(19_833, 200)).toBe(99);
    // A pen showing $0.00 a bird because the count is zero reads as "free",
    // which is the opposite of "not known yet".
    expect(costPerUnit(19_833, 0)).toBeNull();
  });
});

describe("adjustment reasons", () => {
  it("has a label and a note for every suggestion, and for the count's own", () => {
    /**
     * A reason with no copy is a slug on a screen. The count's own reason is in
     * the maps but NOT in the suggestions, on purpose: `count_variance` is
     * written by posting a count and must never be pickable by hand, or the
     * diagnostic stops telling drift apart from loss.
     */
    for (const reason of SUGGESTED_ADJUSTMENT_REASONS) {
      expect(ADJUSTMENT_REASON_LABELS[reason]).toBeTruthy();
      expect(ADJUSTMENT_REASON_NOTES[reason].length).toBeGreaterThan(20);
    }
    expect(ADJUSTMENT_REASON_LABELS[COUNT_VARIANCE_REASON]).toBeTruthy();
    expect(
      (SUGGESTED_ADJUSTMENT_REASONS as readonly string[]).includes(
        COUNT_VARIANCE_REASON,
      ),
    ).toBe(false);
  });

  it("keeps every reason a valid slug, because the column checks the format", () => {
    for (const reason of [...SUGGESTED_ADJUSTMENT_REASONS, COUNT_VARIANCE_REASON]) {
      expect(isValidSlug(reason)).toBe(true);
    }
  });

  it("falls back to the slug for a reason nobody wrote copy for", () => {
    // The taxonomy is open: a tenant will type one this pack has never seen.
    expect(adjustmentReasonLabel("dropped_in_the_mud")).toBe("Dropped in the mud");
    expect(adjustmentReasonLabel("spoilage")).toBe("Went off");
  });

  it("keeps a count in exactly two states", () => {
    expect([...COUNT_STATUSES]).toEqual(["draft", "posted"]);
  });
});
