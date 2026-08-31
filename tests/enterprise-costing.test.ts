import { describe, expect, it } from "vitest";
import {
  enterpriseForMovement,
  enterpriseForRun,
} from "../src/packs/inventory/core/enterprise";

/**
 * **WHICH LINE OF BUSINESS BEARS A COST** — enterprises slice 3, the pure half.
 *
 * The whole slice is this rule plus plumbing, so the rule is pinned here where
 * it can be read without a database.
 */

const BROILERS = "e-broilers";
const BEEF = "e-beef";

describe("enterpriseForMovement", () => {
  const move = (over: Partial<Parameters<typeof enterpriseForMovement>[0]>) =>
    enterpriseForMovement({
      itemEnterpriseId: null,
      lotEnterpriseId: null,
      consumerEnterpriseId: null,
      hasLot: false,
      ...over,
    });

  it("charges feed to the pen that ate it, not to the feed", () => {
    // The case the dossier names: "Grower crumble" belongs to no one part of a
    // business while the pen it was fed to belongs to exactly one.
    expect(
      move({
        itemEnterpriseId: null,
        lotEnterpriseId: null,
        hasLot: true,
        consumerEnterpriseId: BROILERS,
      }).cost,
    ).toBe(BROILERS);
  });

  it("DOES NOT MOVE THE FEED'S STOCK ONTO THE PEN'S BOOKS", () => {
    /**
     * **THE BUG THE DB SUITE CAUGHT, PINNED HERE.** Tagging both journal lines
     * with the cost bearer had `1300` grouped by enterprise reading minus $40
     * for Broilers, because the untagged feed leaving stock was labelled as
     * Broilers' stock leaving. Broilers never held that feed.
     */
    const tags = move({ hasLot: true, consumerEnterpriseId: BROILERS });
    expect(tags.cost).toBe(BROILERS);
    expect(tags.stock).toBeNull();
  });

  it("lets the consuming batch win even when the feed is tagged too", () => {
    // Somebody who tagged their crumble Beef and then fed it to broilers has
    // said two things: the cost went to the pen, and the stock that left was
    // Beef's. Both are true and they are different lines.
    const tags = move({
      itemEnterpriseId: BEEF,
      lotEnterpriseId: BEEF,
      hasLot: true,
      consumerEnterpriseId: BROILERS,
    });
    expect(tags.cost).toBe(BROILERS);
    expect(tags.stock).toBe(BEEF);
  });

  it("takes the batch's own tag on both sides when nothing consumed it", () => {
    // A market sale: meat leaves the freezer and no lot ate it, so the stock
    // relieved and the cost incurred are the same enterprise's.
    const tags = move({ lotEnterpriseId: BROILERS, hasLot: true });
    expect(tags).toEqual({ cost: BROILERS, stock: BROILERS });
  });

  it("does NOT fall back from an untagged batch to its item", () => {
    // The one decision here somebody could reasonably make the other way. A
    // stored null on a lot cannot be told apart from "the item was untagged
    // when this batch was made", so falling back would override somebody who
    // explicitly said none. Incomplete beats confidently wrong.
    expect(
      move({ itemEnterpriseId: BROILERS, lotEnterpriseId: null, hasLot: true }),
    ).toEqual({ cost: null, stock: null });
  });

  it("uses the item only for stock with no batch at all", () => {
    // Cartons and baling twine carry no lineage, so the item is all there is.
    expect(move({ itemEnterpriseId: BROILERS, hasLot: false })).toEqual({
      cost: BROILERS,
      stock: BROILERS,
    });
  });

  it("returns null on both sides when nothing is tagged", () => {
    expect(move({})).toEqual({ cost: null, stock: null });
  });
});

describe("enterpriseForRun", () => {
  it("derives from the batches that went in", () => {
    // The ordinary path: a farm that tagged the pen months ago gets its kill
    // day's fee under Broilers without ever opening the run form.
    expect(
      enterpriseForRun({
        override: null,
        inputEnterpriseIds: [BROILERS, BROILERS],
      }),
    ).toBe(BROILERS);
  });

  it("ignores untagged inputs rather than reading them as a second opinion", () => {
    // A run that consumed tagged broilers and an untagged pallet of ice is
    // still a Broilers run.
    expect(
      enterpriseForRun({
        override: null,
        inputEnterpriseIds: [BROILERS, null, null],
      }),
    ).toBe(BROILERS);
  });

  it("refuses a genuinely mixed run", () => {
    // The mixed market stall's answer wearing different clothes. Splitting the
    // plant's fee across two enterprises is an allocation and wants its own
    // decision, not a helper inventing one.
    expect(
      enterpriseForRun({
        override: null,
        inputEnterpriseIds: [BROILERS, BEEF],
      }),
    ).toBeNull();
  });

  it("lets the run's own column settle a mixed one", () => {
    // Which is the only reason the column exists — see `RunInput.enterpriseId`.
    expect(
      enterpriseForRun({
        override: BEEF,
        inputEnterpriseIds: [BROILERS, BEEF],
      }),
    ).toBe(BEEF);
  });

  it("lets the override beat a derivation that disagrees with it", () => {
    expect(
      enterpriseForRun({ override: BEEF, inputEnterpriseIds: [BROILERS] }),
    ).toBe(BEEF);
  });

  it("returns null for a run with no inputs at all", () => {
    expect(enterpriseForRun({ override: null, inputEnterpriseIds: [] })).toBeNull();
  });
});
