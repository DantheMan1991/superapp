import { describe, expect, it } from "vitest";
import { validateSuggestions } from "../src/modules/accounting/ai/validate";
import {
  PERSONAL_CODE,
  PERSONAL_INSTRUCTION,
  buildSuggestUserTurn,
} from "../src/modules/accounting/ai/prompt";
import {
  matchRules,
  type MatchableRule,
} from "../src/modules/accounting/banking/rules-match";
import {
  commonExcludePhrases,
  suggestedRuleName,
} from "../src/modules/accounting/banking/rules-learn";

/**
 * The pure half of the personal register (ADR 0034): what the model may say,
 * what the validator lets through, what an exclude rule matches to, and how
 * set-aside rows turn into a proposed rule. The database half is in
 * `banking-personal-db.test.ts`.
 */

const ACCOUNTS = new Map([["6000", { id: "id-6000", isActive: true }]]);
const BATCH = new Set(["t1", "t2"]);

describe("the model may answer PERSONAL, but only where it was offered", () => {
  const raw = {
    suggestions: [
      { transactionId: "t1", accountCode: PERSONAL_CODE, confidence: 0.93, reason: "groceries" },
      { transactionId: "t2", accountCode: "6000", confidence: 0.8 },
    ],
  };

  it("on a personal register PERSONAL becomes a suggestion with no account", () => {
    const out = validateSuggestions(raw, BATCH, ACCOUNTS, "m", "t", { allowPersonal: true });
    expect(out.get("t1")).toMatchObject({
      accountId: null,
      accountCode: PERSONAL_CODE,
      personal: true,
      confidence: 0.93,
      reason: "groceries",
    });
    // The ordinary code beside it still maps as before.
    expect(out.get("t2")).toMatchObject({ accountId: "id-6000", accountCode: "6000" });
    expect(out.get("t2")).not.toHaveProperty("personal");
  });

  it("on a business register PERSONAL is dropped like any code that is not in the chart", () => {
    const out = validateSuggestions(raw, BATCH, ACCOUNTS, "m", "t");
    expect(out.has("t1")).toBe(false);
    expect(out.get("t2")?.accountId).toBe("id-6000");
  });
});

describe("the prompt for a personal register", () => {
  const coa = [{ code: "6000", name: "Advertising", accountType: "expense", subtype: "operating_expense" }];
  const history = [{ description: "KROGER #412", code: PERSONAL_CODE }];
  const batch = [{ id: "t1", txnDate: "2026-01-05", amountCents: -4200, description: "KROGER #412" }];

  it("leads with the inverted prior and puts PERSONAL in the chart", () => {
    const turn = buildSuggestUserTurn(coa, history, batch, { personal: true });
    expect(turn.startsWith(PERSONAL_INSTRUCTION)).toBe(true);
    expect(turn).toContain(`${PERSONAL_CODE} | Not the business's`);
    expect(turn).toContain(`"KROGER #412" -> ${PERSONAL_CODE}`);
  });

  it("says nothing of the kind for a business register", () => {
    const turn = buildSuggestUserTurn(coa, [], batch);
    expect(turn).not.toContain(PERSONAL_CODE);
    expect(turn.startsWith("CHART OF ACCOUNTS")).toBe(true);
  });
});

describe("an exclude rule", () => {
  const base = {
    priority: 100,
    isActive: true,
    appliesTo: "both" as const,
    bankAccountId: null,
    matchMode: "all" as const,
    setVendorId: null,
    setMemo: null,
    autoPost: false,
    createdAt: new Date("2026-01-01"),
  };
  const exclude: MatchableRule = {
    ...base,
    id: "r-personal",
    name: "Kroger is personal",
    conditions: [{ field: "description", op: "contains", value: "kroger" }],
    action: "exclude",
    setAccountId: null,
  };
  const categorize: MatchableRule = {
    ...base,
    id: "r-feed",
    name: "Kroger as feed",
    priority: 200,
    conditions: [{ field: "description", op: "contains", value: "kroger" }],
    // No `action`: the shape every rule had before the column, which means categorize.
    setAccountId: "id-6000",
  };
  const txn = { bankAccountId: "b1", description: "KROGER #412", amountCents: -4200 };

  it("matches to a set-aside with no account, and an old-shaped rule still categorizes", () => {
    expect(matchRules(txn, [exclude])).toMatchObject({
      ruleId: "r-personal",
      action: "exclude",
      accountId: null,
    });
    expect(matchRules(txn, [categorize])).toMatchObject({
      ruleId: "r-feed",
      action: "categorize",
      accountId: "id-6000",
    });
  });

  it("wins or loses on priority like any other rule", () => {
    expect(matchRules(txn, [categorize, exclude])?.ruleId).toBe("r-personal");
    expect(matchRules(txn, [{ ...exclude, priority: 300 }, categorize])?.ruleId).toBe("r-feed");
  });
});

describe("what set-aside rows propose", () => {
  it("groups by the leading merchant word and proposes the run the group shares", () => {
    expect(
      commonExcludePhrases(["KROGER #412", "KROGER FUEL 9", "KROGER #412", "NETFLIX.COM"]),
    ).toEqual(["kroger"]);
    // A three-letter word is skipped as the key, but still part of the phrase.
    expect(
      commonExcludePhrases(["CVS PHARMACY 1", "CVS PHARMACY 2", "CVS PHARMACY 3"]),
    ).toEqual(["cvs pharmacy"]);
  });

  it("proposes nothing below the threshold, or for descriptions with no usable word", () => {
    expect(commonExcludePhrases(["NETFLIX.COM", "NETFLIX.COM"])).toEqual([]);
    expect(commonExcludePhrases(["PAYMENT 1234", "PAYMENT 5678", "PAYMENT 9012"])).toEqual([]);
    expect(commonExcludePhrases([])).toEqual([]);
  });

  it("returns several groups, sorted, and names the rule after the word", () => {
    const phrases = commonExcludePhrases(
      ["NETFLIX.COM", "NETFLIX.COM", "NETFLIX.COM", "KROGER #1", "KROGER #2", "KROGER #3"],
      3,
    );
    expect(phrases).toEqual(["kroger", "netflix com"]);
    expect(suggestedRuleName("netflix com", "personal")).toBe("(Suggested) Netflix Com as personal");
  });
});
