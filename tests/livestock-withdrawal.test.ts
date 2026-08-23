import { describe, expect, it } from "vitest";
import {
  blocksProcessing,
  clearsOn,
  describeWithdrawal,
  formatWithdrawal,
  lastEnteredFor,
  lotWithdrawal,
  withdrawalStatus,
  type TreatmentLike,
} from "../src/packs/livestock/core/withdrawal";

/**
 * Livestock slice 3 — the withdrawal clock.
 *
 * **This is the one file in the pack where being quietly wrong is a legal
 * problem**, so the tests are almost entirely about the directions it errs in:
 *
 *   1. **An unknown period is not clearance.** A treatment recorded before
 *      anybody read the label leaves the lot NOT clear, because the alternative
 *      is the app inventing the most dangerous number available to it.
 *   2. **The binding treatment clears LAST, not most recently.** A long-
 *      withdrawal product given first outlasts a short one given after it.
 *   3. **Zero is a real period and null is not zero.** Plenty of products state
 *      no withdrawal; that is a fact, and a blank column is the absence of one.
 */

const t = (over: Partial<TreatmentLike> = {}): TreatmentLike => ({
  id: "t1",
  treatedOn: "2026-08-01",
  product: "Penicillin G",
  meatWithdrawalDays: 10,
  milkWithdrawalDays: 4,
  withdrawalSource: "label",
  ...over,
});

describe("clearsOn", () => {
  it("counts the stated days forward from the treatment", () => {
    // Ten days given on the 1st clears on the 11th — the industry reading of
    // "ten days must elapse".
    expect(clearsOn("2026-08-01", 10)).toBe("2026-08-11");
  });

  it("clears the same day for a product with no withdrawal", () => {
    // A real answer for plenty of products, and different from not knowing.
    expect(clearsOn("2026-08-01", 0)).toBe("2026-08-01");
  });

  it("IS NULL WHEN THE PERIOD IS NULL, and null is not zero", () => {
    expect(clearsOn("2026-08-01", null)).toBeNull();
  });

  it("crosses a month and a leap day without drifting", () => {
    expect(clearsOn("2026-08-25", 10)).toBe("2026-09-04");
    expect(clearsOn("2028-02-25", 5)).toBe("2028-03-01");
  });
});

describe("withdrawalStatus", () => {
  it("is under while the clock runs, and says how long is left", () => {
    const status = withdrawalStatus([t()], "meat", "2026-08-05");
    expect(status.state).toBe("under");
    expect(status.clearsOn).toBe("2026-08-11");
    expect(status.daysLeft).toBe(6);
  });

  it("clears ON the day it clears, not the day after", () => {
    expect(withdrawalStatus([t()], "meat", "2026-08-11").state).toBe("clear");
    expect(withdrawalStatus([t()], "meat", "2026-08-10").state).toBe("under");
  });

  it("KEEPS THE TWO CLOCKS APART", () => {
    // The same injection: milk clears in 4 days, meat in 10. On the 6th the milk
    // is saleable and the animal is not.
    const meat = withdrawalStatus([t()], "meat", "2026-08-06");
    const milk = withdrawalStatus([t()], "milk", "2026-08-06");
    expect(meat.state).toBe("under");
    expect(milk.state).toBe("clear");
  });

  it("THE BINDING TREATMENT IS THE ONE THAT CLEARS LAST, not the latest given", () => {
    // A 30-day product on the 1st outlasts a 2-day product on the 10th. A clock
    // that showed the most recent treatment would clear the lot on the 12th,
    // while the first product was still in the animal.
    const status = withdrawalStatus(
      [
        t({ id: "long", treatedOn: "2026-08-01", meatWithdrawalDays: 30, product: "Long" }),
        t({ id: "short", treatedOn: "2026-08-10", meatWithdrawalDays: 2, product: "Short" }),
      ],
      "meat",
      "2026-08-15",
    );
    expect(status.clearsOn).toBe("2026-08-31");
    expect(status.binding?.product).toBe("Long");
  });

  it("AN UNKNOWN PERIOD IS NOT CLEARANCE", () => {
    // The safety decision in the whole file. A treatment given before anybody
    // read the label leaves the lot in a state that is not clear, and the honest
    // answer is "somebody has to go and look".
    const status = withdrawalStatus(
      [t({ meatWithdrawalDays: null, milkWithdrawalDays: null, withdrawalSource: "none_stated" })],
      "meat",
      "2026-09-01",
    );
    expect(status.state).toBe("unknown");
    expect(status.clearsOn).toBeNull();
    expect(blocksProcessing(status)).toBe(true);
  });

  it("does not let an unknown outrank a date somebody can act on", () => {
    // A lot already blocked by a known 21-day period is blocked. Adding "and we
    // are also unsure about another one" changes nothing a person would do, and
    // the binding treatment is the one with the date.
    const status = withdrawalStatus(
      [
        t({ id: "known", meatWithdrawalDays: 21, product: "Known" }),
        t({ id: "mystery", meatWithdrawalDays: null, withdrawalSource: "none_stated" }),
      ],
      "meat",
      "2026-08-05",
    );
    expect(status.state).toBe("under");
    expect(status.binding?.product).toBe("Known");
  });

  it("a null period from a LABEL reading is not an unknown", () => {
    // "The label states no milk withdrawal" is a fact about the product. Only
    // `none_stated` means nobody looked, and only that blocks.
    const status = withdrawalStatus(
      [t({ milkWithdrawalDays: null, withdrawalSource: "label" })],
      "milk",
      "2026-08-05",
    );
    expect(status.state).toBe("clear");
  });

  it("is clear for a lot nothing was ever given", () => {
    const status = withdrawalStatus([], "meat", "2026-08-05");
    expect(status.state).toBe("clear");
    expect(status.binding).toBeNull();
    expect(blocksProcessing(status)).toBe(false);
  });
});

describe("blocksProcessing", () => {
  it("is true for BOTH under and unknown", () => {
    // To somebody about to load a trailer they mean the same thing.
    expect(blocksProcessing(withdrawalStatus([t()], "meat", "2026-08-05"))).toBe(true);
    expect(
      blocksProcessing(
        withdrawalStatus(
          [t({ meatWithdrawalDays: null, withdrawalSource: "none_stated" })],
          "meat",
          "2026-08-05",
        ),
      ),
    ).toBe(true);
    expect(blocksProcessing(withdrawalStatus([], "meat", "2026-08-05"))).toBe(false);
  });
});

describe("lotWithdrawal", () => {
  it("folds both clocks and counts what it folded", () => {
    const both = lotWithdrawal([t()], "2026-08-06");
    expect(both.meat.state).toBe("under");
    expect(both.milk.state).toBe("clear");
    expect(both.treatmentCount).toBe(1);
  });
});

describe("wording", () => {
  it("says how long is left rather than a bare date", () => {
    expect(formatWithdrawal(withdrawalStatus([t()], "meat", "2026-08-05"))).toBe(
      "6 days left",
    );
    expect(formatWithdrawal(withdrawalStatus([t()], "meat", "2026-08-10"))).toBe(
      "1 day left",
    );
    expect(formatWithdrawal(withdrawalStatus([], "meat", "2026-08-10"))).toBe(
      "Clear",
    );
  });

  it("tells somebody what to DO about an unknown", () => {
    const status = withdrawalStatus(
      [t({ meatWithdrawalDays: null, withdrawalSource: "none_stated" })],
      "meat",
      "2026-08-05",
    );
    expect(formatWithdrawal(status)).toBe("Not looked up");
    expect(describeWithdrawal(status)).toContain("reads the label");
    expect(describeWithdrawal(status)).toContain("an unknown is not a zero");
  });

  it("names the product holding the lot back", () => {
    const status = withdrawalStatus([t()], "meat", "2026-08-05");
    expect(describeWithdrawal(status)).toContain("Penicillin G");
    expect(describeWithdrawal(status)).toContain("2026-08-11");
  });

  it("says which sale the milk clock is about", () => {
    const status = withdrawalStatus([t()], "milk", "2026-08-02");
    expect(describeWithdrawal(status)).toContain("sold for milk");
  });
});

describe("lastEnteredFor", () => {
  it("finds what THIS FARM entered last time, case-insensitively", () => {
    // The only default the app offers anywhere, and it is their own record
    // rather than a claim about the drug.
    const previous = lastEnteredFor(
      [
        t({ id: "old", treatedOn: "2026-06-01", meatWithdrawalDays: 8 }),
        t({ id: "new", treatedOn: "2026-07-01", product: "penicillin g", meatWithdrawalDays: 10 }),
      ],
      "PENICILLIN G",
    );
    expect(previous?.id).toBe("new");
  });

  it("offers nothing for a product never used here", () => {
    expect(lastEnteredFor([t()], "Draxxin")).toBeNull();
    expect(lastEnteredFor([t()], "   ")).toBeNull();
  });
});
