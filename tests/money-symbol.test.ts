import { describe, expect, it } from "vitest";
import {
  formatCents,
  formatMoney,
  formatMoneySign,
  formatMoneySigned,
} from "../src/lib/money";
import { homesteadFarm } from "../src/industries/homestead-farm";
import { listIndustryProfiles } from "../src/industries";

/**
 * The currency symbol, which is a TENANT setting an industry suggests.
 *
 * The founder's ask, after seeing "Fed · 85.00" on a farm card: *"this should
 * be a feature that you can turn on for the industry selection. for farming i
 * definitely want it to show the dollar."*
 */

describe("formatMoney", () => {
  it("does nothing at all without a symbol, which is the house style", () => {
    // `formatCents` was written for debit/credit columns whose headers carry
    // the currency. Doing nothing has to keep giving exactly that, or every
    // ledger grid in the app changes by accident.
    expect(formatMoney(8_500, null)).toBe(formatCents(8_500));
    expect(formatMoney(8_500, null)).toBe("85.00");
  });

  it("puts the tenant's symbol in front when they have one", () => {
    expect(formatMoney(8_500, "$")).toBe("$85.00");
    expect(formatMoney(43, "$")).toBe("$0.43");
    expect(formatMoney(123_456_789, "$")).toBe("$1,234,567.89");
  });

  it("is not a currency conversion, and does not care what the symbol is", () => {
    // Presentation only. The platform is single-currency and nothing here
    // converts anything — a real multi-currency story needs the amount to
    // carry its own currency, which is a much larger change.
    expect(formatMoney(8_500, "£")).toBe("£85.00");
    expect(formatMoney(8_500, "")).toBe("85.00");
  });

  it("keeps the symbol INSIDE accounting parentheses", () => {
    // "($85.00)", never "$(85.00)". The parentheses are the minus sign, and a
    // symbol outside them reads as a positive amount next to a bracket.
    expect(formatMoneySigned(-8_500, "$")).toBe("($85.00)");
    expect(formatMoneySigned(8_500, "$")).toBe("$85.00");
    expect(formatMoneySigned(-8_500, null)).toBe("(85.00)");
  });
});

describe("formatMoneySign", () => {
  /**
   * Written after a market-day card read **"Margin $53.00"** for a day that
   * took nothing and cost $53 to stand there. `formatMoney` drops the sign by
   * design, so the loss rendered as an identical-looking profit - the exact
   * fact the retail pack exists to surface, inverted.
   */
  it("KEEPS THE MINUS, which is the whole reason it exists", () => {
    // A true minus sign (U+2212), not a hyphen - it lines up in a tabular-nums
    // column, which is where every one of these numbers is rendered.
    expect(formatMoneySign(-5_300, "$")).toBe("−$53.00");
    expect(formatMoneySign(-5_300, "$")).not.toBe(formatMoney(5_300, "$"));
  });

  it("leaves a positive alone rather than decorating it with a plus", () => {
    // A margin is not a delta. Only the cash variance says "+", because there
    // the direction against an expectation is the point.
    expect(formatMoneySign(5_300, "$")).toBe("$53.00");
    expect(formatMoneySign(0, "$")).toBe("$0.00");
  });

  it("still does nothing about a symbol nobody asked for", () => {
    expect(formatMoneySign(5_300, null)).toBe("53.00");
  });
});

describe("industry display defaults", () => {
  it("the farm profile asks for a dollar", () => {
    expect(homesteadFarm.display?.currencySymbol).toBe("$");
  });

  it("every profile that names a symbol names exactly one character-ish", () => {
    // A guard rather than a rule: this lands in front of every money figure a
    // tenant sees, so a profile quietly setting "USD " would be visible
    // everywhere at once.
    for (const profile of listIndustryProfiles()) {
      const symbol = profile.display?.currencySymbol;
      if (symbol === undefined) continue;
      expect(symbol.length).toBeGreaterThan(0);
      expect(symbol.length).toBeLessThanOrEqual(3);
      expect(symbol.trim()).toBe(symbol);
    }
  });

  it("a profile may say nothing, and then the house style stands", () => {
    // `display` is optional on purpose. Most industries read ledgers more than
    // they read cards, and no symbol is the right default for them.
    const silent = listIndustryProfiles().filter((p) => p.display === undefined);
    for (const profile of silent) {
      expect(profile.display?.currencySymbol ?? null).toBeNull();
    }
  });
});
