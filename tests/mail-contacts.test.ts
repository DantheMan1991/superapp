import { describe, expect, it } from "vitest";
import { parseContactCard } from "@/lib/email/jmap/parse";
import {
  excludeChosen,
  rankContacts,
  type ContactSuggestion,
} from "@/modules/email/contacts/rank";
import {
  formatRecipient,
  lastFragment,
} from "@/modules/email/components/recipient-input";

/**
 * Recipient autocomplete.
 *
 * TWO HALVES, and the first is the one a spec could have got wrong for us.
 * `urn:ietf:params:jmap:contacts` is a DRAFT that changed object models
 * mid-flight — the old one has `Contact` with `emails: [{type, value}]`, the
 * current one has `ContactCard` following JSContact with
 * `emails: {key: {address}}`. A parser written from the wrong one finds no
 * addresses at all and reports an empty address book. The fixture below is
 * copied verbatim from `npm run mail:probe-contacts`, off a card the probe
 * created and read back, so it is what the server actually stores rather than
 * what the draft reads like.
 *
 * The second half is ranking, which is the kind of logic that gets quietly
 * wrong and never noticed, because a slightly bad suggestion list still looks
 * like a suggestion list.
 */

/** Verbatim from the probe. Do not tidy — that is the point of a fixture. */
const LIVE_CARD = {
  version: "1.0",
  "@type": "Card",
  name: {
    full: "Aoife Ó Braonáin",
    components: [
      { kind: "given", value: "Aoife" },
      { kind: "surname", value: "Ó Braonáin" },
    ],
    isOrdered: true,
  },
  organizations: { o1: { name: "Probe Construction Ltd" } },
  emails: {
    work: { address: "aoife@probe.example", contexts: { work: true } },
    personal: { address: "aoife.home@probe.example" },
  },
  id: "b",
  addressBookIds: { b: true },
};

describe("parseContactCard — against what the server really stores", () => {
  it("reads a live card", () => {
    const parsed = parseContactCard(LIVE_CARD);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      id: "b",
      name: "Aoife Ó Braonáin",
      email: "aoife@probe.example",
      organization: "Probe Construction Ltd",
    });
  });

  it("makes ONE ENTRY PER ADDRESS, not per person", () => {
    // Somebody with a work and a personal address is two rows in an
    // autocomplete: picking "which Aoife" from a single row is a decision the
    // list cannot express.
    const emails = parseContactCard(LIVE_CARD).map((c) => c.email);
    expect(emails).toEqual(["aoife@probe.example", "aoife.home@probe.example"]);
  });

  it("prefers the server-computed name.full over assembling components", () => {
    // Component order is locale-dependent, so assembling by hand renames
    // people. The probe confirmed the server computes `full`.
    expect(parseContactCard(LIVE_CARD)[0].name).toBe("Aoife Ó Braonáin");
  });

  it("falls back to the components when full is absent, since it is optional", () => {
    const [contact] = parseContactCard({
      id: "x",
      name: {
        components: [
          { kind: "given", value: "Dan" },
          { kind: "surname", value: "Houser" },
        ],
      },
      emails: { work: { address: "dan@example.com" } },
    });
    expect(contact.name).toBe("Dan Houser");
  });

  it("would find NOTHING in the old draft's shape, which is why the probe ran", () => {
    // `emails: [{ type, value }]` is the superseded model. Returning nothing is
    // correct — inventing an address from an unrecognized shape is how a
    // composer offers a recipient it cannot actually send to.
    expect(
      parseContactCard({
        id: "x",
        firstName: "Dan",
        emails: [{ type: "work", value: "dan@example.com" }],
      }),
    ).toEqual([]);
  });

  it("never throws and never invents", () => {
    for (const bad of [null, undefined, 42, "card", {}, { id: "x" }, { id: "" }]) {
      expect(() => parseContactCard(bad)).not.toThrow();
      expect(parseContactCard(bad)).toEqual([]);
    }
    // A card with an address-less email entry yields nothing rather than a row
    // the composer would offer and then fail to send to.
    expect(parseContactCard({ id: "x", emails: { work: {} } })).toEqual([]);
  });

  it("does not offer one address twice from a single card", () => {
    const parsed = parseContactCard({
      id: "x",
      emails: {
        work: { address: "dan@example.com" },
        other: { address: "Dan@Example.com" },
      },
    });
    expect(parsed).toHaveLength(1);
  });
});

function suggestion(over: Partial<ContactSuggestion>): ContactSuggestion {
  return {
    email: "someone@example.com",
    name: "",
    sublabel: "",
    origin: "directory",
    ...over,
  };
}

describe("rankContacts", () => {
  it("puts somebody you have written to ahead of a directory entry", () => {
    // THE RULE THAT MATTERS. Correspondence is by far the strongest signal an
    // autocomplete has, and getting it wrong is what makes a recipient box feel
    // stupid — three letters and you are offered a supplier from 2019 ahead of
    // the person you emailed this morning.
    const ranked = rankContacts(
      [
        suggestion({ email: "dana@directory.example", origin: "directory" }),
        suggestion({ email: "danb@recent.example", origin: "recent" }),
        suggestion({ email: "danc@records.example", origin: "records" }),
      ],
      "dan",
      10,
    );
    expect(ranked.map((r) => r.origin)).toEqual(["recent", "records", "directory"]);
  });

  it("puts an exact address above everything, whatever its source", () => {
    const ranked = rankContacts(
      [
        suggestion({ email: "dan@recent.example", origin: "recent" }),
        suggestion({ email: "exact@directory.example", origin: "directory" }),
      ],
      "exact@directory.example",
      10,
    );
    expect(ranked[0].email).toBe("exact@directory.example");
  });

  it("matches a surname, not just the first name", () => {
    // People search by surname at least as often as by forename.
    const ranked = rankContacts(
      [suggestion({ email: "a@x.example", name: "Aoife Ó Braonáin" })],
      "Braon",
      10,
    );
    expect(ranked).toHaveLength(1);
  });

  it("deduplicates one address across sources", () => {
    const ranked = rankContacts(
      [
        suggestion({ email: "acme@example.com", origin: "recent", sublabel: "Emailed today" }),
        suggestion({ email: "ACME@example.com", origin: "records", name: "Acme Ltd", sublabel: "Customer" }),
      ],
      "acme",
      10,
    );
    expect(ranked).toHaveLength(1);
  });

  it("collapses the same address contributed by TWO record sources", () => {
    // Accounting and CRM both read `party_contact_points` since 0075, so a
    // customer who is also a CRM record is contributed twice with the same
    // address and the same origin. The composer must show one row, and it must
    // show the accounting sublabel — the registry lists that extension first,
    // and "Customer" is the more useful of the two true answers about a
    // business address.
    //
    // Worth pinning rather than assuming: the dossier previously recorded this
    // as a visible duplicate awaiting the contract slice. It never was one.
    // What the overlap actually decides is the SUBLABEL, and it decides it by
    // registry order rather than by which query finished first.
    const ranked = rankContacts(
      [
        suggestion({
          email: "info@probe.example",
          origin: "records",
          name: "Probe Construction",
          sublabel: "Customer",
        }),
        suggestion({
          email: "info@probe.example",
          origin: "records",
          name: "Probe Construction",
          sublabel: "Company · billing",
        }),
      ],
      "probe",
      10,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].sublabel).toBe("Customer");
  });

  it("keeps the NAME from whichever source has one", () => {
    // A recent correspondent is often a bare address, while the customer record
    // for the same address carries the business's real name. Showing
    // "acme@example.com" when we know it is Acme Ltd is worse than either
    // source alone.
    const [merged] = rankContacts(
      [
        suggestion({ email: "acme@example.com", origin: "recent", name: "", sublabel: "Emailed today" }),
        suggestion({ email: "acme@example.com", origin: "records", name: "Acme Ltd", sublabel: "Customer" }),
      ],
      "acme",
      10,
    );
    expect(merged.name).toBe("Acme Ltd");
    // The sublabel follows the name, so the row cannot read "Acme Ltd ·
    // emailed today" with the name taken from somewhere else.
    expect(merged.sublabel).toBe("Customer");
    // The better ORIGIN still wins the slot.
    expect(merged.origin).toBe("recent");
  });

  it("drops a suggestion that does not match the query at all", () => {
    // Sources are asked with the same query, so anything scoring zero came back
    // on a looser rule than ours and would read as noise.
    const ranked = rankContacts(
      [suggestion({ email: "nothing@else.example", name: "Somebody" })],
      "zzz",
      10,
    );
    expect(ranked).toEqual([]);
  });

  it("is stable when scores tie, so the list does not reshuffle", () => {
    const input = [
      suggestion({ email: "b@dan.example", origin: "recent" }),
      suggestion({ email: "a@dan.example", origin: "recent" }),
    ];
    const first = rankContacts(input, "dan", 10).map((r) => r.email);
    const second = rankContacts([...input].reverse(), "dan", 10).map((r) => r.email);
    expect(first).toEqual(second);
  });

  it("honours the limit", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      suggestion({ email: `dan${i}@example.com` }),
    );
    expect(rankContacts(many, "dan", 8)).toHaveLength(8);
  });

  it("skips an entry with no address, which cannot be picked", () => {
    expect(rankContacts([suggestion({ email: "  " })], "dan", 10)).toEqual([]);
  });
});

describe("excludeChosen", () => {
  it("does not offer somebody already in a recipient field", () => {
    const left = excludeChosen(
      [suggestion({ email: "dan@example.com" }), suggestion({ email: "other@example.com" })],
      ["Dan <DAN@example.com>".replace(/.*<|>/g, "")],
    );
    expect(left.map((s) => s.email)).toEqual(["other@example.com"]);
  });

  it("ignores blanks in the chosen list", () => {
    const all = [suggestion({ email: "dan@example.com" })];
    expect(excludeChosen(all, ["", "   "])).toHaveLength(1);
  });
});

describe("the text field the suggestions edit", () => {
  it("takes only what is after the last comma", () => {
    // Suggestions replace the LAST FRAGMENT, which is what leaves everything
    // already typed untouched.
    expect(lastFragment("a@x.com, b@y.com, dan")).toBe(" dan");
    expect(lastFragment("dan")).toBe("dan");
    expect(lastFragment("")).toBe("");
  });

  it("formats a picked suggestion the way the parser reads it back", () => {
    expect(formatRecipient({ name: "Dan Houser", email: "dan@x.com" })).toBe(
      "Dan Houser <dan@x.com>",
    );
    expect(formatRecipient({ name: "", email: "dan@x.com" })).toBe("dan@x.com");
  });

  it("quotes a name containing a comma, or one person becomes two", () => {
    expect(formatRecipient({ name: "Houser, Dan", email: "dan@x.com" })).toBe(
      '"Houser, Dan" <dan@x.com>',
    );
  });
});
