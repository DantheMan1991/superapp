import { describe, expect, it } from "vitest";
import { depositOptionsFor } from "../src/modules/accounting/lib/deposit-options";

const maple = "11111111-1111-1111-1111-111111111111";
const oak = "22222222-2222-2222-2222-222222222222";

const registers = [
  { accountId: "acct-maple", name: "Maple Checking", entityId: maple },
  { accountId: "acct-oak", name: "Oak Operating", entityId: oak },
];
const companies = [
  { id: maple, name: "Maple Street LLC" },
  { id: oak, name: "Oak Row LLC" },
];

describe("depositOptionsFor", () => {
  it("labels only the other company's account, and puts Undeposited Funds last", () => {
    expect(
      depositOptionsFor({
        registers,
        companies,
        undepositedAccountId: "acct-undeposited",
        entityId: maple,
      }),
    ).toEqual([
      { id: "acct-maple", label: "Maple Checking", otherCompany: undefined },
      { id: "acct-oak", label: "Oak Operating", otherCompany: "Oak Row LLC" },
      { id: "acct-undeposited", label: "Undeposited Funds" },
    ]);
  });

  it("labels nothing on a single-company tenant", () => {
    const options = depositOptionsFor({
      registers: [registers[0]],
      companies: [companies[0]],
      undepositedAccountId: null,
      entityId: maple,
    });
    expect(options).toEqual([
      { id: "acct-maple", label: "Maple Checking", otherCompany: undefined },
    ]);
    expect(options.some((o) => o.otherCompany)).toBe(false);
  });

  it("falls back to 'another company' for a register whose owner is not listed", () => {
    expect(
      depositOptionsFor({
        registers,
        companies: [companies[0]],
        undepositedAccountId: null,
        entityId: maple,
      })[1],
    ).toEqual({ id: "acct-oak", label: "Oak Operating", otherCompany: "another company" });
  });

  it("keeps the registers in the caller's order, whichever company the invoice is in", () => {
    expect(
      depositOptionsFor({
        registers,
        companies,
        undepositedAccountId: null,
        entityId: oak,
      }).map((o) => [o.label, o.otherCompany]),
    ).toEqual([
      ["Maple Checking", "Maple Street LLC"],
      ["Oak Operating", undefined],
    ]);
  });
});
