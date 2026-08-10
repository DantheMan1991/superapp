import { describe, expect, it } from "vitest";
import {
  describeConditions,
  matchRules,
  parseConditions,
  sortRules,
  type MatchableRule,
  type MatchableTxn,
} from "../src/modules/accounting/banking/rules-match";
import {
  commonDescriptionPhrase,
  suggestedRuleName,
  titleCasePhrase,
} from "../src/modules/accounting/banking/rules-learn";

/**
 * The rule engine, tested without a database. Everything that decides how a
 * bank row gets coded lives in these two pure modules, so this is where the
 * behaviour is pinned.
 */

const REGISTER = "11111111-1111-1111-1111-111111111111";
const OTHER_REGISTER = "22222222-2222-2222-2222-222222222222";
const INSURANCE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const UTILITIES = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function rule(over: Partial<MatchableRule> = {}): MatchableRule {
  return {
    id: "rule-1",
    name: "Westfield as Insurance",
    priority: 100,
    isActive: true,
    appliesTo: "both",
    bankAccountId: null,
    matchMode: "all",
    conditions: [{ field: "description", op: "contains", value: "westfield" }],
    setAccountId: INSURANCE,
    setMemo: null,
    autoPost: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

function txn(over: Partial<MatchableTxn> = {}): MatchableTxn {
  return {
    bankAccountId: REGISTER,
    description: "OH WESTFIELD INS SIGNATURES",
    amountCents: -64067,
    ...over,
  };
}

describe("matchRules — text operators", () => {
  it("contains is case- and whitespace-insensitive", () => {
    expect(matchRules(txn(), [rule()])?.accountId).toBe(INSURANCE);
    expect(
      matchRules(txn({ description: "oh   westfield   ins" }), [rule()]),
    ).not.toBeNull();
  });

  it("doesnt_contain inverts", () => {
    const r = rule({
      conditions: [{ field: "description", op: "doesnt_contain", value: "westfield" }],
    });
    expect(matchRules(txn(), [r])).toBeNull();
    expect(matchRules(txn({ description: "INTUIT" }), [r])).not.toBeNull();
  });

  it("is requires the whole description", () => {
    const r = rule({
      conditions: [{ field: "description", op: "is", value: "Intuit" }],
    });
    expect(matchRules(txn({ description: "INTUIT" }), [r])).not.toBeNull();
    expect(matchRules(txn({ description: "INTUIT PAYMENT" }), [r])).toBeNull();
  });

  it("starts_with anchors to the front", () => {
    const r = rule({
      conditions: [{ field: "description", op: "starts_with", value: "oh west" }],
    });
    expect(matchRules(txn(), [r])).not.toBeNull();
    expect(matchRules(txn({ description: "WESTFIELD OH" }), [r])).toBeNull();
  });
});

describe("matchRules — amount operators", () => {
  const gt = rule({
    conditions: [{ field: "amount", op: "gt", value: "500.00" }],
  });

  it("compares magnitude, so direction is left to appliesTo", () => {
    expect(matchRules(txn({ amountCents: -64067 }), [gt])).not.toBeNull();
    expect(matchRules(txn({ amountCents: 64067 }), [gt])).not.toBeNull();
    expect(matchRules(txn({ amountCents: -100 }), [gt])).toBeNull();
  });

  it("lt and eq", () => {
    const lt = rule({
      conditions: [{ field: "amount", op: "lt", value: "10" }],
    });
    expect(matchRules(txn({ amountCents: -800 }), [lt])).not.toBeNull();
    expect(matchRules(txn({ amountCents: -1000 }), [lt])).toBeNull();

    const eq = rule({
      conditions: [{ field: "amount", op: "eq", value: "8.00" }],
    });
    expect(matchRules(txn({ amountCents: -800 }), [eq])).not.toBeNull();
    expect(matchRules(txn({ amountCents: -801 }), [eq])).toBeNull();
  });

  it("accepts the money formats people actually type", () => {
    const r = rule({
      conditions: [{ field: "amount", op: "eq", value: "$1,250.00" }],
    });
    expect(matchRules(txn({ amountCents: -125000 }), [r])).not.toBeNull();
  });
});

describe("matchRules — scoping", () => {
  it("money_in and money_out scope by sign, and never claim zero", () => {
    const inbound = rule({ appliesTo: "money_in" });
    const outbound = rule({ appliesTo: "money_out" });
    expect(matchRules(txn({ amountCents: 5000 }), [inbound])).not.toBeNull();
    expect(matchRules(txn({ amountCents: -5000 }), [inbound])).toBeNull();
    expect(matchRules(txn({ amountCents: -5000 }), [outbound])).not.toBeNull();
    expect(matchRules(txn({ amountCents: 5000 }), [outbound])).toBeNull();
    expect(matchRules(txn({ amountCents: 0 }), [inbound])).toBeNull();
    expect(matchRules(txn({ amountCents: 0 }), [outbound])).toBeNull();
  });

  it("a register-scoped rule ignores other registers; null means all", () => {
    const scoped = rule({ bankAccountId: OTHER_REGISTER });
    expect(matchRules(txn(), [scoped])).toBeNull();
    expect(matchRules(txn({ bankAccountId: OTHER_REGISTER }), [scoped])).not.toBeNull();
    expect(matchRules(txn(), [rule({ bankAccountId: null })])).not.toBeNull();
  });

  it("inactive rules never match", () => {
    expect(matchRules(txn(), [rule({ isActive: false })])).toBeNull();
  });
});

describe("matchRules — match mode", () => {
  const conditions = [
    { field: "description" as const, op: "contains" as const, value: "westfield" },
    { field: "amount" as const, op: "gt" as const, value: "10000.00" },
  ];

  it("all requires every condition", () => {
    expect(matchRules(txn(), [rule({ matchMode: "all", conditions })])).toBeNull();
  });

  it("any requires only one", () => {
    expect(matchRules(txn(), [rule({ matchMode: "any", conditions })])).not.toBeNull();
  });
});

describe("matchRules — ordering", () => {
  it("first match wins by priority", () => {
    const low = rule({ id: "a", priority: 10, setAccountId: UTILITIES });
    const high = rule({ id: "b", priority: 20, setAccountId: INSURANCE });
    expect(matchRules(txn(), [high, low])?.accountId).toBe(UTILITIES);
  });

  it("ties break by created date, then id — stable on every machine", () => {
    const same = new Date("2026-01-01T00:00:00Z");
    const a = rule({ id: "b-second", createdAt: same, setAccountId: UTILITIES });
    const b = rule({ id: "a-first", createdAt: same, setAccountId: INSURANCE });
    expect(matchRules(txn(), [a, b])?.accountId).toBe(INSURANCE);
    expect(sortRules([a, b]).map((r) => r.id)).toEqual(["a-first", "b-second"]);

    const older = rule({ id: "z", createdAt: new Date("2025-01-01"), setAccountId: UTILITIES });
    expect(matchRules(txn(), [b, older])?.accountId).toBe(UTILITIES);
  });

  it("carries the memo and auto-post flag of the winner", () => {
    const r = rule({ setMemo: "Monthly premium", autoPost: true });
    const match = matchRules(txn(), [r]);
    expect(match?.memo).toBe("Monthly premium");
    expect(match?.autoPost).toBe(true);
    expect(match?.ruleName).toBe("Westfield as Insurance");
  });
});

describe("matchRules — malformed rules", () => {
  it("a rule with no conditions never matches (it would match everything)", () => {
    expect(matchRules(txn(), [rule({ conditions: [] })])).toBeNull();
  });

  it("unparseable conditions are skipped, not thrown on, and do not block others", () => {
    const broken = rule({ id: "broken", priority: 1, conditions: { nope: true } });
    const good = rule({ id: "good", priority: 2 });
    expect(() => matchRules(txn(), [broken])).not.toThrow();
    expect(matchRules(txn(), [broken, good])?.ruleId).toBe("good");
  });

  it("an amount condition that is not money is rejected at parse time", () => {
    expect(
      parseConditions([{ field: "amount", op: "gt", value: "fifty" }]),
    ).toBeNull();
    expect(
      parseConditions([{ field: "amount", op: "gt", value: "50" }]),
    ).not.toBeNull();
  });

  it("a text operator on amount is rejected", () => {
    expect(
      parseConditions([{ field: "amount", op: "contains", value: "50" }]),
    ).toBeNull();
  });
});

describe("describeConditions", () => {
  it("reads as a sentence, joined by the match mode", () => {
    expect(
      describeConditions(
        [
          { field: "description", op: "contains", value: "Westfield" },
          { field: "amount", op: "gt", value: "500" },
        ],
        "all",
      ),
    ).toBe('Description contains "Westfield" and Amount is more than "500"');
    expect(
      describeConditions([{ field: "description", op: "is", value: "Intuit" }], "any"),
    ).toBe('Description is "Intuit"');
  });

  it("says so rather than throwing on a broken rule", () => {
    expect(describeConditions("nonsense", "all")).toBe("Invalid conditions");
  });
});

describe("commonDescriptionPhrase", () => {
  it("finds the longest shared run of words", () => {
    expect(
      commonDescriptionPhrase([
        "OH WESTFIELD INS SIGNATURES",
        "Westfield Ins 07/06",
        "oh westfield ins",
      ]),
    ).toBe("westfield ins");
  });

  it("keeps a whole multi-word payee", () => {
    expect(
      commonDescriptionPhrase([
        "CITY OF MOUNT VERNON 07/15",
        "City of Mount Vernon",
        "CITY OF MOUNT VERNON WATER",
      ]),
    ).toBe("city of mount vernon");
  });

  it("keeps a phrase whose words are individually generic", () => {
    expect(
      commonDescriptionPhrase([
        "Account Maintenance Fee",
        "ACCOUNT MAINTENANCE FEE",
        "account maintenance fee 08/10",
      ]),
    ).toBe("account maintenance fee");
  });

  it("refuses a lone generic word — 'always code Deposit to X' is a trap", () => {
    expect(
      commonDescriptionPhrase(["Deposit", "DEPOSIT 07/15", "deposit"]),
    ).toBeNull();
    expect(
      commonDescriptionPhrase(["ACH Payment", "Payment ACH", "payment"]),
    ).toBeNull();
  });

  it("refuses when nothing meaningful is shared", () => {
    expect(commonDescriptionPhrase(["Intuit", "Westfield", "Kroger"])).toBeNull();
    expect(commonDescriptionPhrase([])).toBeNull();
    expect(commonDescriptionPhrase(["Intuit", ""])).toBeNull();
  });

  it("will not build a rule out of digits alone", () => {
    expect(commonDescriptionPhrase(["07/15 1234", "07/15 9999"])).toBeNull();
  });

  it("is not fooled by a shared word that is not contiguous", () => {
    // "ins" appears in both but only "westfield" is the shared run here.
    expect(
      commonDescriptionPhrase(["WESTFIELD PREMIUM", "WESTFIELD MONTHLY"]),
    ).toBe("westfield");
  });
});

describe("suggestedRuleName", () => {
  it("states the mapping, so the list reads as decisions", () => {
    expect(titleCasePhrase("westfield ins")).toBe("Westfield Ins");
    expect(suggestedRuleName("westfield ins", "Insurance")).toBe(
      "(Suggested) Westfield Ins as Insurance",
    );
  });
});
