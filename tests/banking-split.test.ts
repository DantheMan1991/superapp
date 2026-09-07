import { describe, expect, it } from "vitest";
import { splitFarSide } from "../src/modules/accounting/banking/split";

const REGISTER = "acct-bank";
const REPAIRS = "acct-6400";
const OFFICE = "acct-6300";

describe("splitFarSide", () => {
  it("signs the lines by direction: money out debits the categories, money in credits them", () => {
    const out = splitFarSide(
      [
        { accountId: REPAIRS, amountCents: 6_000 },
        { accountId: OFFICE, amountCents: 3_000, dimensionMemberIds: ["dim-1"] },
      ],
      9_000,
      REGISTER,
      false,
    );
    expect(out).toEqual([
      { accountId: REPAIRS, amountCents: 6_000, dimensionMemberIds: undefined },
      { accountId: OFFICE, amountCents: 3_000, dimensionMemberIds: ["dim-1"] },
    ]);

    const inn = splitFarSide(
      [
        { accountId: REPAIRS, amountCents: 1_000 },
        { accountId: OFFICE, amountCents: 2_000 },
      ],
      3_000,
      REGISTER,
      true,
    );
    expect(inn.map((l) => l.amountCents)).toEqual([-1_000, -2_000]);
  });

  it("refuses fewer than two lines — that is a plain posting", () => {
    expect(() =>
      splitFarSide([{ accountId: REPAIRS, amountCents: 9_000 }], 9_000, REGISTER, false),
    ).toThrow(expect.objectContaining({ code: "SPLIT_TOO_FEW" }));
  });

  it("refuses a line without a category, or with a zero, negative or fractional amount", () => {
    const bad = [
      [{ accountId: "", amountCents: 4_500 }, { accountId: OFFICE, amountCents: 4_500 }],
      [{ accountId: REPAIRS, amountCents: 0 }, { accountId: OFFICE, amountCents: 9_000 }],
      [{ accountId: REPAIRS, amountCents: -1 }, { accountId: OFFICE, amountCents: 9_001 }],
      [{ accountId: REPAIRS, amountCents: 4_500.5 }, { accountId: OFFICE, amountCents: 4_499.5 }],
    ];
    for (const lines of bad) {
      expect(() => splitFarSide(lines, 9_000, REGISTER, false)).toThrow(
        expect.objectContaining({ code: "SPLIT_LINE_INVALID" }),
      );
    }
  });

  it("refuses lines that do not add up to the row, and says by how much", () => {
    expect(() =>
      splitFarSide(
        [
          { accountId: REPAIRS, amountCents: 6_000 },
          { accountId: OFFICE, amountCents: 2_000 },
        ],
        9_000,
        REGISTER,
        false,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "SPLIT_MISMATCH",
        meta: { assignedCents: 8_000, rowCents: 9_000 },
      }),
    );
  });

  it("refuses the register's own account, as a plain posting does", () => {
    expect(() =>
      splitFarSide(
        [
          { accountId: REGISTER, amountCents: 6_000 },
          { accountId: OFFICE, amountCents: 3_000 },
        ],
        9_000,
        REGISTER,
        false,
      ),
    ).toThrow(expect.objectContaining({ code: "ACCOUNT_NOT_FOUND" }));
  });
});
