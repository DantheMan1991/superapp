import { describe, expect, it } from "vitest";
import { isCodableAccount } from "../src/modules/accounting/core/coa";

/**
 * Which accounts a person may point a bill or invoice line AT.
 *
 * Pure — it takes an account and the set of register account ids and decides.
 * The rule is small and every exclusion in it is a bug somebody already paid
 * for, which is exactly the kind of thing that gets quietly widened later.
 */
describe("isCodableAccount", () => {
  const noRegisters = new Set<string>();
  const account = (over: Partial<{ id: string; subtype: string; isSystem: boolean }> = {}) => ({
    id: "acct-1",
    subtype: "other",
    isSystem: false,
    ...over,
  });

  it("allows an ordinary expense account", () => {
    expect(isCodableAccount(account(), noRegisters)).toBe(true);
  });

  it("REFUSES INVENTORY, because the receipt capitalises and the bill clears", () => {
    /**
     * ADR 0012 §A.1: stock arriving posts `Dr Inventory / Cr GRNI`, and the
     * bill for it CLEARS GRNI. A line coded straight to Inventory capitalises
     * the same delivery a second time — the "both capitalise" failure that ADR
     * opens with, where the stock is on the books twice and nothing reconciles
     * it.
     *
     * It was reachable and nobody had done it: zero such lines existed on
     * either database when this was written.
     */
    expect(isCodableAccount(account({ subtype: "inventory" }), noRegisters)).toBe(
      false,
    );
  });

  it("refuses GRNI, which is set by allocating rather than by hand", () => {
    expect(
      isCodableAccount(account({ subtype: "goods_received" }), noRegisters),
    ).toBe(false);
  });

  it("REFUSES SERVICES RECEIVED NOT INVOICED, which is GRNI one account along", () => {
    /**
     * `2060` is credited when a processing run accrues its fee and debited when
     * the plant's bill is matched to that run. Coding a line straight to it
     * clears an accrual no run ever made — the same defect as GRNI, in the
     * account nobody had been bitten by yet, which is exactly why it was
     * missing from the list until a bill line's coding could survive a save
     * that destroyed its match.
     */
    expect(
      isCodableAccount(account({ subtype: "services_received" }), noRegisters),
    ).toBe(false);
  });

  it("refuses a bank register, opening balance and the affiliate accounts", () => {
    expect(isCodableAccount(account({ id: "reg" }), new Set(["reg"]))).toBe(false);
    for (const subtype of [
      "opening_balance",
      "due_from_affiliate",
      "due_to_affiliate",
    ]) {
      expect(isCodableAccount(account({ subtype }), noRegisters)).toBe(false);
    }
  });

  it("refuses the SYSTEM control accounts and allows a tenant's own", () => {
    // The system AR/AP are maintained by the document tools. A tenant that made
    // its own account with the same subtype is still allowed to use it.
    for (const subtype of ["accounts_receivable", "accounts_payable"]) {
      expect(
        isCodableAccount(account({ subtype, isSystem: true }), noRegisters),
      ).toBe(false);
      expect(
        isCodableAccount(account({ subtype, isSystem: false }), noRegisters),
      ).toBe(true);
    }
  });
});
