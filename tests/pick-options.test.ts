import { describe, expect, it } from "vitest";
import {
  accountOptions,
  partyOptions,
  saveBlocker,
  unpickableSentence,
} from "../src/modules/accounting/lib/pick-options";

/**
 * **THE OPTIONS AN EDIT DIALOG OFFERS FOR A VALUE THAT MAY NO LONGER BE
 * PICKED, AND THE SENTENCE THAT BLOCKS THE SAVE.** Pure. The rule is
 * `dimensionTypesFrom`'s `keepIds` rule applied to parties and accounts: never
 * offer a dead value to anyone who does not already hold it; offer it back,
 * marked, to the one record that does — and mark it only when the SERVER would
 * refuse it, so the screen and the server agree exactly.
 */

const party = (id: string, name: string, isActive = true) => ({ id, name, isActive });
const account = (
  id: string,
  code: string,
  name: string,
  isActive = true,
  subtype: string | null = null,
  accountType = "expense",
) => ({ id, code, name, isActive, subtype, accountType });

describe("partyOptions", () => {
  it("NEVER OFFERS AN INACTIVE PARTY when nothing holds it", () => {
    // Creating: `keepId` absent. A deactivated supplier must not be pickable
    // for a new template, because the save would be refused with
    // VENDOR_INACTIVE and the screen would have invited the mistake.
    const out = partyOptions([party("v1", "Acme"), party("v2", "Gone Ltd", false)]);
    expect(out).toEqual([{ id: "v1", name: "Acme" }]);
  });

  it("offers the HELD inactive party back, MARKED — and only that one", () => {
    // Editing a template that names v2. The old name must be visible (the
    // alternative is an empty trigger), and the mark is what lets the dialog
    // block the save and say why. v3 is inactive too and is not offered:
    // being held by this record is the whole condition.
    const out = partyOptions(
      [party("v1", "Acme"), party("v2", "Gone Ltd", false), party("v3", "Also gone", false)],
      "v2",
    );
    expect(out).toEqual([
      { id: "v1", name: "Acme" },
      { id: "v2", name: "Gone Ltd (inactive)", unpickable: "inactive" },
    ]);
  });

  it("an ACTIVE held party is offered exactly like any other — no mark", () => {
    const out = partyOptions([party("v1", "Acme")], "v1");
    expect(out).toEqual([{ id: "v1", name: "Acme" }]);
  });

  it("a null keepId (journal: no party) is the same as none", () => {
    const out = partyOptions([party("v2", "Gone Ltd", false)], null);
    expect(out).toEqual([]);
  });
});

describe("accountOptions", () => {
  const codable = (a: { subtype: string | null }) => a.subtype !== "bank";
  const income = (a: { accountType: string }) => a.accountType === "income";
  const list = [
    account("a1", "6700", "Repairs"),
    account("a2", "1000", "Checking", true, "bank"),
    account("a3", "6800", "Old Repairs", false),
  ];

  it("offers only active AND offered accounts when nothing is held", () => {
    expect(accountOptions(list, { offer: codable })).toEqual([
      { id: "a1", code: "6700", name: "Repairs" },
    ]);
  });

  it("offers a held INACTIVE account back marked inactive", () => {
    // The stored line still names a3. Blank would hide that; this shows it.
    const out = accountOptions(list, { offer: codable }, ["a3"]);
    expect(out).toEqual([
      { id: "a1", code: "6700", name: "Repairs" },
      { id: "a3", code: "6800", name: "Old Repairs (inactive)", unpickable: "inactive" },
    ]);
  });

  it("offers a held UNPICKABLE account back marked 'cannot be chosen' — a different ask", () => {
    /**
     * The #340 case: an invoice line coded to a bank register, which nobody
     * may pick by hand. The account is perfectly active — reactivating is not
     * the fix, re-picking is — so the mark says so, and `unpickableSentence`
     * below turns the two marks into two different sentences.
     */
    const out = accountOptions(list, { offer: codable }, ["a2"]);
    expect(out).toEqual([
      { id: "a1", code: "6700", name: "Repairs" },
      { id: "a2", code: "1000", name: "Checking (cannot be chosen)", unpickable: "not_codable" },
    ]);
  });

  it("OFFER AND ACCEPT ARE TWO RULES: a held account the picker would not offer but the server accepts is offered back PLAIN", () => {
    /**
     * Invoice lines: the picker offers income only, the server's floor is
     * codable — a deposit to Unearned Revenue is a valid invoice line. A
     * template that already names one must not be marked "(cannot be chosen)"
     * and have its save blocked; the server would take that save. Found by the
     * adversarial pass: the first cut marked anything the picker would not
     * offer, which was stricter than the server for exactly this kind.
     */
    const unearned = account("a5", "2400", "Unearned Revenue", true, null, "liability");
    const sales = account("a6", "4000", "Sales", true, null, "income");
    const out = accountOptions([sales, unearned, list[1]], { offer: income, accept: codable }, [
      "a5",
      "a2",
    ]);
    expect(out).toEqual([
      { id: "a6", code: "4000", name: "Sales" },
      // held, not offered to a new pick, but accepted: plain, no mark
      { id: "a5", code: "2400", name: "Unearned Revenue" },
      // held and refused by the server: marked
      { id: "a2", code: "1000", name: "Checking (cannot be chosen)", unpickable: "not_codable" },
    ]);
    // And NOT offered to a template that does not hold it.
    expect(accountOptions([sales, unearned], { offer: income, accept: codable })).toEqual([
      { id: "a6", code: "4000", name: "Sales" },
    ]);
  });

  it("an inactive account that is ALSO unpickable is marked inactive first", () => {
    // "Inactive" is the state somebody sees on the chart of accounts, and its
    // sentence still ends in "pick another". Either mark blocks the save.
    const out = accountOptions(
      [account("a4", "1010", "Old Savings", false, "bank")],
      { offer: codable },
      ["a4"],
    );
    expect(out[0].unpickable).toBe("inactive");
  });

  it("a held id that is ACTIVE and offered carries no mark", () => {
    expect(accountOptions(list, { offer: codable }, ["a1"])).toEqual([
      { id: "a1", code: "6700", name: "Repairs" },
    ]);
  });

  it("keeps input order, so the page's ORDER BY code survives", () => {
    const out = accountOptions(
      [account("b", "2000", "B"), account("a", "1000", "A")],
      { offer: () => true },
    );
    expect(out.map((o) => o.code)).toEqual(["2000", "1000"]);
  });
});

describe("unpickableSentence", () => {
  it("names the party and the way out", () => {
    expect(unpickableSentence("supplier", "inactive")).toBe(
      "That supplier is inactive. Pick another, or reactivate them first.",
    );
    expect(unpickableSentence("customer", "inactive")).toBe(
      "That customer is inactive. Pick another, or reactivate them first.",
    );
  });

  it("names the LINE for an account; offers reactivation for an inactive one and NOT for one that cannot be chosen", () => {
    // The two marks are different asks, and the sentences must say so — an
    // account can be reactivated from the chart of accounts, a bank register
    // can only be re-picked.
    expect(unpickableSentence("account", "inactive", 2)).toBe(
      "Line 2's account is inactive. Pick another, or reactivate it first.",
    );
    expect(unpickableSentence("account", "not_codable", 1)).toBe(
      "Line 1's account can no longer be chosen by hand. Pick another.",
    );
    // A bill template has one line and its dialog one account: no line number.
    expect(unpickableSentence("account", "not_codable")).toBe(
      "The account can no longer be chosen by hand. Pick another.",
    );
  });
});

describe("saveBlocker", () => {
  const vendors = [
    { id: "v1", name: "Acme" },
    { id: "v2", name: "Gone Ltd (inactive)", unpickable: "inactive" as const },
  ];
  const customers = [
    { id: "c1", name: "Millbrook" },
    { id: "c2", name: "Closed Café (inactive)", unpickable: "inactive" as const },
  ];
  const accounts = [
    { id: "a1", code: "6700", name: "Repairs" },
    { id: "a2", code: "1000", name: "Checking (cannot be chosen)", unpickable: "not_codable" as const },
    { id: "a3", code: "6800", name: "Old Repairs (inactive)", unpickable: "inactive" as const },
  ];

  it("BILL: the supplier first, then the one account, no line number", () => {
    expect(
      saveBlocker({ kind: "bill", vendors, vendorId: "v2", accounts, accountId: "a2" }),
    ).toBe("That supplier is inactive. Pick another, or reactivate them first.");
    expect(
      saveBlocker({ kind: "bill", vendors, vendorId: "v1", accounts, accountId: "a2" }),
    ).toBe("The account can no longer be chosen by hand. Pick another.");
    // An uncoded bill line ("" — AI can code it later) is not a kept value.
    expect(
      saveBlocker({ kind: "bill", vendors, vendorId: "v1", accounts, accountId: "" }),
    ).toBeNull();
  });

  it("INVOICE: the customer first, then lines in display order", () => {
    expect(
      saveBlocker({
        kind: "invoice",
        customers,
        customerId: "c2",
        accounts,
        lines: [{ line: 1, accountId: "a2" }],
      }),
    ).toBe("That customer is inactive. Pick another, or reactivate them first.");
    expect(
      saveBlocker({
        kind: "invoice",
        customers,
        customerId: "c1",
        accounts,
        lines: [
          { line: 1, accountId: "a1" },
          { line: 2, accountId: "a3" },
        ],
      }),
    ).toBe("Line 2's account is inactive. Pick another, or reactivate it first.");
  });

  it("JOURNAL: lines only, and the DISPLAYED number survives a discarded row", () => {
    /**
     * The dialog discards a journal row with no amount at save, and passes
     * only the rows it will submit — a row about to be dropped must not hold
     * the save hostage. But the number in the sentence is the one the person
     * sees, so a gap in the numbering is expected here.
     */
    expect(
      saveBlocker({
        kind: "journal",
        accounts,
        lines: [
          { line: 1, accountId: "a1" },
          { line: 3, accountId: "a2" },
        ],
      }),
    ).toBe("Line 3's account can no longer be chosen by hand. Pick another.");
  });

  it("is null when every selected value is pickable", () => {
    expect(
      saveBlocker({
        kind: "journal",
        accounts,
        lines: [
          { line: 1, accountId: "a1" },
          { line: 2, accountId: "a1" },
        ],
      }),
    ).toBeNull();
  });
});
