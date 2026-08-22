/**
 * **WHICH RECORDED EVENT RELEASES A CATEGORY'S COST, AND WHERE TO.** PURE — no
 * imports, no database.
 * [ADR 0013](../../../../docs/decisions/0013-inventory-tax-treatment.md) §A.1,
 * §A.2 and §A.5.
 *
 * ## The one thing to understand before changing anything here
 *
 * **THIS FILE HOLDS NO OPINION ABOUT TAX, AND THAT IS THE DESIGN RATHER THAN A
 * LIMITATION.** `TIMING_RULES` is a list of moments the ledger can put a date
 * on. It is not a list of tax treatments. A list of treatments would be a
 * reading of the regulations, maintained by people not qualified to read them,
 * and every gap in it would be invisible to everybody. A list of dates is
 * checkable: each value names a column that exists.
 *
 * So the software's job is to be able to honour any of them, and somebody
 * qualified picks. If an election needs a moment that is not on the list, the
 * answer is to add another observable event — never to round to the nearest one
 * that is already here.
 *
 * ## What is settable today is NARROWER than what is listed
 *
 * `consumed` is the only rule the report lens can apply, because it is the only
 * one that means "change nothing". The rest are listed so a person deciding can
 * see the shape of the question, and are refused on the way in until the lens
 * learns them — see `isImplementedRule`. **A setting that claims to change a
 * report and does not is the exact failure ADR 0013 exists to prevent**, so the
 * gap is enforced rather than documented.
 */

/** Every moment the ledger can date. See the header for why this is the list. */
export const TIMING_RULES = [
  "consumed",
  "billed",
  "paid",
  "sold",
  "later_of_paid_and_consumed",
  "later_of_paid_and_sold",
] as const;

export type TimingRule = (typeof TIMING_RULES)[number];

/**
 * What the report lens can actually honour today.
 *
 * **ONE ENTRY, AND IT IS THE ONE THAT MEANS "LEAVE EVERYTHING ALONE".** Widen
 * this as the lens learns a rule, never ahead of it: the list is what stops a
 * recorded decision from being a lie about what the reports do.
 */
export const IMPLEMENTED_TIMING_RULES: readonly TimingRule[] = ["consumed"];

export function isTimingRule(value: string): value is TimingRule {
  return (TIMING_RULES as readonly string[]).includes(value);
}

export function isImplementedRule(value: string): value is TimingRule {
  return (IMPLEMENTED_TIMING_RULES as readonly string[]).includes(value);
}

/**
 * **THE DEFAULT, AND IT IS TODAY'S BEHAVIOUR EXACTLY.** A tenant with no rows at
 * all resolves to this, so writing nothing down changes nothing — which is what
 * makes the whole feature safe to ship into live books.
 */
export const DEFAULT_TIMING_RULE: TimingRule = "consumed";

/** One stored decision. `itemKind` null is the tenant's default row. */
export interface TaxRuleRow {
  itemKind: string | null;
  timingRule: TimingRule;
  expenseAccountId: string | null;
}

export interface ResolvedTaxRule {
  timingRule: TimingRule;
  expenseAccountId: string | null;
  /** Which row answered, so a screen can say WHY an item resolves as it does. */
  source: "item_kind" | "tenant_default" | "built_in";
  /** The `item_kind` row that answered, when one did. */
  matchedKind: string | null;
}

/**
 * **MOST SPECIFIC FIRST: the item's category, then the tenant default, then the
 * built-in.** ADR 0013 §A.5 fixed this order for the expense account, and §A.2
 * put the timing rule on the same key so one order serves both.
 *
 * **THE TWO FIELDS RESOLVE TOGETHER, FROM ONE ROW.** Resolving them
 * independently — the rule from the category, the account from the default —
 * would let a category say "expense this at payment" while the account came
 * from somewhere that never agreed to it. One row, one decision, one author.
 *
 * `expenseAccountId` is allowed to come back null. That is not a failure: under
 * `consumed` nothing substitutes, so nothing needs an account, and demanding one
 * up front would make a tenant answer a question their rule never asks.
 */
export function resolveTaxRule(
  itemKind: string | null,
  rows: TaxRuleRow[],
): ResolvedTaxRule {
  if (itemKind) {
    const byKind = rows.find((r) => r.itemKind === itemKind);
    if (byKind) {
      return {
        timingRule: byKind.timingRule,
        expenseAccountId: byKind.expenseAccountId,
        source: "item_kind",
        matchedKind: itemKind,
      };
    }
  }
  const fallback = rows.find((r) => r.itemKind === null);
  if (fallback) {
    return {
      timingRule: fallback.timingRule,
      expenseAccountId: fallback.expenseAccountId,
      source: "tenant_default",
      matchedKind: null,
    };
  }
  return {
    timingRule: DEFAULT_TIMING_RULE,
    expenseAccountId: null,
    source: "built_in",
    matchedKind: null,
  };
}

/**
 * Human wording for each rule, for the screen where somebody records a decision.
 *
 * **NAMED AFTER THE EVENT, NOT AFTER A TREATMENT.** `paid` is a fact about a
 * bank account and means the same thing to a bakery and a feedlot — which is
 * also why none of these carry a trade-specific noun, per ADR 0013.
 */
export const TIMING_RULE_LABELS: Record<TimingRule, string> = {
  consumed: "When it is used",
  billed: "When the bill is dated",
  paid: "When it is paid for",
  sold: "When it is sold to a customer",
  later_of_paid_and_consumed: "The later of paid and used",
  later_of_paid_and_sold: "The later of paid and sold",
};

export const TIMING_RULE_NOTES: Record<TimingRule, string> = {
  consumed:
    "Stock is an asset until it is issued or used, and the cost lands then. This is what the books do today.",
  billed: "The cost lands on the date of the supplier's bill, whether or not it has been paid.",
  paid: "The cost lands when the money actually left, taken from the payment against the supplier's bill.",
  sold: "The cost lands when the item goes to a customer, rather than when it is used internally.",
  later_of_paid_and_consumed:
    "Both have to have happened. The cost lands on whichever came second.",
  later_of_paid_and_sold:
    "Both have to have happened. The cost lands on whichever came second.",
};
