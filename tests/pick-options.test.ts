import { describe, expect, it } from "vitest";
import {
  accountOptions,
  partyOptions,
  unpickableSentence,
} from "../src/modules/accounting/lib/pick-options";

/**
 * **THE OPTIONS AN EDIT DIALOG OFFERS FOR A VALUE THAT MAY NO LONGER BE
 * PICKED.** Pure. The rule is `dimensionTypesFrom`'s `keepIds` rule applied to
 * parties and accounts: never offer a dead value to anyone who does not
 * already hold it; offer it back, marked, to the one record that does.
 */

const party = (id: string, name: string, isActive = true) => ({ id, name, isActive });
const account = (
  id: string,
  code: string,
  name: string,
  isActive = true,
  subtype: string | null = null,
) => ({ id, code, name, isActive, subtype });

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
  const list = [
    account("a1", "6700", "Repairs"),
    account("a2", "1000", "Checking", true, "bank"),
    account("a3", "6800", "Old Repairs", false),
  ];

  it("offers only active AND pickable accounts when nothing is held", () => {
    expect(accountOptions(list, codable)).toEqual([
      { id: "a1", code: "6700", name: "Repairs" },
    ]);
  });

  it("offers a held INACTIVE account back marked inactive", () => {
    // The stored line still names a3. Blank would hide that; this shows it.
    const out = accountOptions(list, codable, ["a3"]);
    expect(out).toEqual([
      { id: "a1", code: "6700", name: "Repairs" },
      { id: "a3", code: "6800", name: "Old Repairs (inactive)", unpickable: "inactive" },
    ]);
  });

  it("offers a held UNPICKABLE account back marked 'cannot be chosen' — a different ask", () => {
    /**
     * The #340 case: a bill line coded to a bank register, which nobody may
     * pick by hand. The account is perfectly active — reactivating is not the
     * fix, re-picking is — so the mark says so, and `unpickableSentence`
     * below turns the two marks into two different sentences.
     */
    const out = accountOptions(list, codable, ["a2"]);
    expect(out).toEqual([
      { id: "a1", code: "6700", name: "Repairs" },
      { id: "a2", code: "1000", name: "Checking (cannot be chosen)", unpickable: "not_codable" },
    ]);
  });

  it("an inactive account that is ALSO unpickable is marked inactive first", () => {
    // Reactivating would not make it pickable, but "inactive" is the state
    // somebody sees on the chart of accounts, and the sentence for it still
    // ends in "pick another". Either mark blocks the save.
    const out = accountOptions(
      [account("a4", "1010", "Old Savings", false, "bank")],
      codable,
      ["a4"],
    );
    expect(out[0].unpickable).toBe("inactive");
  });

  it("a held id that is ACTIVE and pickable carries no mark", () => {
    expect(accountOptions(list, codable, ["a1"])).toEqual([
      { id: "a1", code: "6700", name: "Repairs" },
    ]);
  });

  it("keeps input order, so the page's ORDER BY code survives", () => {
    const out = accountOptions(
      [account("b", "2000", "B"), account("a", "1000", "A")],
      () => true,
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

  it("names the LINE for an account, and does not offer reactivation for one that cannot be chosen", () => {
    expect(unpickableSentence("account", "inactive", 2)).toBe(
      "Line 2's account is inactive. Pick another.",
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
