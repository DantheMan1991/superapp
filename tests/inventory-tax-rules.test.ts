import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMING_RULE,
  IMPLEMENTED_TIMING_RULES,
  TIMING_RULES,
  TIMING_RULE_LABELS,
  TIMING_RULE_NOTES,
  isImplementedRule,
  isTimingRule,
  resolveTaxRule,
  type TaxRuleRow,
} from "../src/packs/inventory/core/tax-rules";

/**
 * Which recorded event releases a category's cost, and where to.
 * ADR 0013 §A.1, §A.2, §A.5. Pure — no database anywhere near it.
 */
describe("resolveTaxRule", () => {
  const rule = (over: Partial<TaxRuleRow> = {}): TaxRuleRow => ({
    itemKind: null,
    timingRule: "consumed",
    expenseAccountId: null,
    ...over,
  });

  it("FALLS BACK TO TODAY'S BEHAVIOUR when nothing is recorded", () => {
    /**
     * The property that makes this safe to ship into live books: a tenant who
     * never touches the screen is unaffected, and the resolver says so rather
     * than the caller having to remember it.
     */
    const resolved = resolveTaxRule("feed", []);
    expect(resolved.timingRule).toBe(DEFAULT_TIMING_RULE);
    expect(resolved.timingRule).toBe("consumed");
    expect(resolved.source).toBe("built_in");
    expect(resolved.expenseAccountId).toBeNull();
  });

  it("prefers the category over the tenant default", () => {
    const rows = [
      rule({ itemKind: null, expenseAccountId: "acct-default" }),
      rule({ itemKind: "feed", expenseAccountId: "acct-feed" }),
    ];
    const resolved = resolveTaxRule("feed", rows);
    expect(resolved.source).toBe("item_kind");
    expect(resolved.matchedKind).toBe("feed");
    expect(resolved.expenseAccountId).toBe("acct-feed");
  });

  it("falls through to the tenant default for a category with no row", () => {
    const rows = [rule({ itemKind: null, expenseAccountId: "acct-default" })];
    const resolved = resolveTaxRule("bedding", rows);
    expect(resolved.source).toBe("tenant_default");
    expect(resolved.matchedKind).toBeNull();
    expect(resolved.expenseAccountId).toBe("acct-default");
  });

  it("RESOLVES BOTH FIELDS FROM ONE ROW, never mixed across rows", () => {
    /**
     * Resolving them independently — the rule from the category, the account
     * from the default — would let a category say "expense this at payment"
     * while the account came from a row that never agreed to it. One row, one
     * decision, one author.
     */
    const rows = [
      rule({ itemKind: null, expenseAccountId: "acct-default" }),
      // A category row that named a rule and deliberately no account.
      rule({ itemKind: "feed", expenseAccountId: null }),
    ];
    const resolved = resolveTaxRule("feed", rows);
    expect(resolved.source).toBe("item_kind");
    // NOT acct-default: the category's row answered, and it said nothing.
    expect(resolved.expenseAccountId).toBeNull();
  });

  it("ignores a category row when asked about the default itself", () => {
    const rows = [rule({ itemKind: "feed", expenseAccountId: "acct-feed" })];
    const resolved = resolveTaxRule(null, rows);
    expect(resolved.source).toBe("built_in");
  });
});

describe("timing rules", () => {
  it("SETTABLE IS NARROWER THAN LISTED", () => {
    /**
     * The list exists so a person deciding can see the shape of the question;
     * the implemented set is what the report lens can honour. **Widen the
     * second only as the lens learns a rule.** A setting that claims to change
     * a report and does not is the failure ADR 0013 was written to end.
     *
     * This assertion is SUPPOSED to fail when the lens grows, and it did once:
     * slice 3d iii added `paid` and this test failing is what marked the
     * change. That is the coupling working, not a brittle test.
     */
    expect(IMPLEMENTED_TIMING_RULES).toEqual(["consumed", "paid"]);
    expect(TIMING_RULES.length).toBeGreaterThan(
      IMPLEMENTED_TIMING_RULES.length,
    );
    for (const implemented of IMPLEMENTED_TIMING_RULES) {
      expect(isTimingRule(implemented)).toBe(true);
    }
  });

  it("the implemented rule is the default, so silence changes nothing", () => {
    expect(isImplementedRule(DEFAULT_TIMING_RULE)).toBe(true);
  });

  it("refuses a rule that is not a moment the ledger can date", () => {
    expect(isTimingRule("when_the_accountant_says")).toBe(false);
    // Listed, dateable, and still not built: the lens would have to compare two
    // dates per line and place the result in whichever window it falls in.
    expect(isImplementedRule("later_of_paid_and_consumed")).toBe(false);
    expect(isTimingRule("later_of_paid_and_consumed")).toBe(true);
  });

  it("gives every rule a label and a note, including the unbuilt ones", () => {
    // They are SHOWN disabled rather than hidden, so a rule with no wording
    // would render as a blank disabled row on the one screen that exists to
    // explain the question.
    for (const r of TIMING_RULES) {
      expect(TIMING_RULE_LABELS[r]).toBeTruthy();
      expect(TIMING_RULE_NOTES[r]).toBeTruthy();
    }
  });
});
