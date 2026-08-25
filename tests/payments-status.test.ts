import { describe, expect, it } from "vitest";
import {
  describePaymentAccount,
  describeRequirements,
  requirementLabel,
  toRequirementList,
  toStatusDetailList,
  type PaymentAccountFacts,
  type RequirementFact,
} from "../src/lib/payments/status";

/**
 * The payments settings screen, without a database or Stripe.
 *
 * **THE STATE WORTH TESTING IS THE MIDDLE ONE.** Not connected and ready are
 * both easy and both rare; a real farm sits in "Stripe still needs something"
 * for a day or two, and that is the screen that decides whether it finishes the
 * form or rings us up. See ADR 0015.
 *
 * Every requirement key used here was read off a real Accounts v2 test account
 * via `scripts/stripe-connect-probe.ts`, not translated from v1.
 */

const CARD = "card_payments";
const PAYOUTS = "stripe_balance.payouts";

const need = (
  description: string,
  over: Partial<RequirementFact> = {},
): RequirementFact => ({
  description,
  awaitingActionFrom: "user",
  deadline: "currently_due",
  restricts: [CARD, PAYOUTS],
  errors: [],
  ...over,
});

const facts = (over: Partial<PaymentAccountFacts>): PaymentAccountFacts => ({
  cardPaymentsStatus: "restricted",
  statusDetails: [],
  requirements: [],
  requirementsDueBy: null,
  closedAt: null,
  ...over,
});

describe("describePaymentAccount", () => {
  it("no row is not a state — it is the absence of one", () => {
    const view = describePaymentAccount(null);
    expect(view.state).toBe("not_connected");
    expect(view.action).toBe("connect");
    expect(view.outstanding).toEqual([]);
  });

  it("undefined is the same as null", () => {
    expect(describePaymentAccount(undefined).state).toBe("not_connected");
  });

  it("a fresh account asks for what Stripe wants and offers the way in", () => {
    const view = describePaymentAccount(
      facts({ requirements: [need("external_account")] }),
    );
    expect(view.state).toBe("needs_information");
    expect(view.action).toBe("continue");
    expect(view.outstanding).toEqual(["A bank account for Stripe to pay into"]);
  });

  it("WHO IS HOLDING IT UP IS READ, NOT GUESSED", () => {
    /**
     * The trap v1 made you derive from `details_submitted`. A farm that has
     * filled everything in sits at `restricted` with every remaining
     * requirement `awaiting_action_from: stripe` — and a screen that listed
     * those as a to-do would invent homework for somebody who has none.
     */
    const view = describePaymentAccount(
      facts({
        requirements: [
          need("representative.documents.primary_verification", {
            awaitingActionFrom: "stripe",
          }),
        ],
        statusDetails: [
          { code: "requirements_pending_verification", resolution: "no_resolution" },
        ],
      }),
    );
    expect(view.state).toBe("reviewing");
    expect(view.tone).toBe("pending");
    expect(view.outstanding).toEqual([]);
    expect(view.action).toBe("manage");
    expect(view.detail).toContain("verifying");
  });

  it("A BRAND NEW ACCOUNT IS NOT LATE, even though v2 calls everything past_due", () => {
    /**
     * The rule this replaced — warn when a requirement is `past_due` — was
     * written first and driving it killed it. In v2 a thirty-second-old account
     * has EVERY requirement `past_due`, because nothing has been provided yet,
     * so the badge went amber immediately and said the same thing forever. A
     * tone that is always on carries no information.
     *
     * Stripe putting an actual DATE on it is what separates "here is the list"
     * from "you are running out of time".
     */
    const fresh = describePaymentAccount(
      facts({
        requirements: [need("configuration.merchant.mcc", { deadline: "past_due" })],
      }),
    );
    expect(fresh.state).toBe("needs_information");
    expect(fresh.tone).toBe("pending");
    expect(fresh.detail).not.toContain("deadline");

    const clockRunning = describePaymentAccount(
      facts({
        requirements: [need("configuration.merchant.mcc", { deadline: "past_due" })],
        requirementsDueBy: new Date("2026-09-03T00:00:00Z"),
      }),
    );
    expect(clockRunning.tone).toBe("warn");
    expect(clockRunning.detail).toContain("deadline");
  });

  it("CARDS WORKING IS NOT MONEY ARRIVING", () => {
    /**
     * v2 has no `payouts_enabled`, so the distinction lives in what a
     * requirement RESTRICTS. A missing bank account holds
     * `stripe_balance.payouts` and leaves `card_payments` alone: the farm takes
     * money all month and none of it reaches the bank. Calling that "ready" is
     * how they find out a fortnight later.
     */
    const view = describePaymentAccount(
      facts({
        cardPaymentsStatus: "active",
        requirements: [need("external_account", { restricts: [PAYOUTS] })],
      }),
    );
    expect(view.state).toBe("payouts_held");
    expect(view.tone).toBe("warn");
    expect(view.action).toBe("continue");
    expect(view.detail).toContain("holding the money");
    expect(view.outstanding).toEqual(["A bank account for Stripe to pay into"]);
  });

  it("active with nothing outstanding is ready", () => {
    const view = describePaymentAccount(facts({ cardPaymentsStatus: "active" }));
    expect(view.state).toBe("ready");
    expect(view.tone).toBe("ok");
    expect(view.action).toBe("manage");
  });

  it("active with a future ask still says so without alarming", () => {
    const view = describePaymentAccount(
      facts({
        cardPaymentsStatus: "active",
        requirements: [
          need("identity.business_details.id_numbers", {
            deadline: "eventually_due",
            restricts: [CARD],
          }),
        ],
      }),
    );
    expect(view.state).toBe("ready");
    expect(view.outstanding).toEqual(["The business tax ID (EIN)"]);
    expect(view.detail).toContain("nothing stops until then");
  });

  it("a requirement Stripe owns never blocks the ready state", () => {
    const view = describePaymentAccount(
      facts({
        cardPaymentsStatus: "active",
        requirements: [
          need("external_account", {
            restricts: [PAYOUTS],
            awaitingActionFrom: "stripe",
          }),
        ],
      }),
    );
    expect(view.state).toBe("ready");
    expect(view.outstanding).toEqual([]);
  });

  it("CLOSED WINS OVER EVERY OTHER FLAG", () => {
    /**
     * A farm that disconnects us can leave a row saying `active`, because the
     * last event that described the account was true when it arrived. Reading
     * the status first would show a green badge over an account we can no
     * longer touch.
     */
    const view = describePaymentAccount(
      facts({
        cardPaymentsStatus: "active",
        closedAt: new Date("2026-08-24T12:00:00Z"),
      }),
    );
    expect(view.state).toBe("closed");
    expect(view.action).toBe("connect");
  });

  it("unsupported is a dead end and says so rather than offering a form", () => {
    const view = describePaymentAccount(
      facts({
        cardPaymentsStatus: "unsupported",
        statusDetails: [
          { code: "unsupported_country", resolution: "no_resolution" },
        ],
        requirements: [need("identity.entity_type")],
      }),
    );
    expect(view.state).toBe("unsupported");
    expect(view.action).toBe("manage");
    // No "continue setup" button and no to-do list: there is nothing the farm
    // could type that would change the answer.
    expect(view.outstanding).toEqual([]);
    expect(view.detail).toContain("country");
  });

  it("contact_stripe is named, because waiting will not fix it", () => {
    const view = describePaymentAccount(
      facts({
        statusDetails: [{ code: "restricted_other", resolution: "contact_stripe" }],
      }),
    );
    expect(view.state).toBe("reviewing");
    expect(view.detail).toContain("Contact Stripe support");
  });

  it("null status is not restricted — Stripe has simply not said", () => {
    const view = describePaymentAccount(facts({ cardPaymentsStatus: null }));
    expect(view.state).toBe("reviewing");
    expect(view.detail).toContain("nothing is waiting on you");
  });
});

describe("describeRequirements", () => {
  it("three requirements that are one errand read as one line", () => {
    /**
     * `representative.date_of_birth.day`, `.month` and `.year` are three keys
     * and one thing to go and do. A list saying "date of birth" three times
     * reads as a broken screen.
     */
    expect(
      describeRequirements([
        need("representative.date_of_birth.day"),
        need("representative.date_of_birth.month"),
        need("representative.date_of_birth.year"),
      ]),
    ).toEqual(["The owner's date of birth"]);
  });

  it("PAST DUE FIRST — it is the half with a deadline behind it", () => {
    expect(
      describeRequirements([
        need("configuration.merchant.mcc", { deadline: "eventually_due" }),
        need("external_account", { deadline: "past_due" }),
      ]),
    ).toEqual([
      "A bank account for Stripe to pay into",
      "What kind of business this is",
    ]);
  });

  it("A REJECTION OUTRANKS A BLANK, and carries Stripe's own words", () => {
    /**
     * `errors[].description` is the one place v2 hands us real English, and it
     * only appears once something already sent has been rejected — which is
     * both more urgent and more confusing than an empty field.
     */
    expect(
      describeRequirements([
        need("external_account", { deadline: "past_due" }),
        need("representative.documents.primary_verification", {
          errors: ["The uploaded image is too blurry to read."],
        }),
      ]),
    ).toEqual([
      "A photo of the owner's ID — a licence or passport — The uploaded image is too blurry to read.",
      "A bank account for Stripe to pay into",
    ]);
  });

  it("the same field blank and rejected appears once, with the reason", () => {
    expect(
      describeRequirements([
        need("representative.address"),
        need("representative.address", { errors: ["We could not verify it."] }),
      ]),
    ).toEqual(["The owner's home address — We could not verify it."]);
  });

  it("an address spread over four keys is one line, whatever the prefix", () => {
    expect(
      describeRequirements([
        need("identity.individual.address.line1"),
        need("identity.individual.address.city"),
        need("identity.individual.address.state"),
        need("identity.individual.address.postal_code"),
      ]),
    ).toEqual(["The owner's home address"]);
  });

  it("no requirements is a meaningful answer, not an empty screen", () => {
    expect(describeRequirements()).toEqual([]);
    expect(describeRequirements([])).toEqual([]);
  });
});

describe("requirementLabel", () => {
  it("translates the v2 keys a real account actually returned", () => {
    // Every one of these came off `stripe-connect-probe.ts` against a live
    // test-mode account.
    expect(requirementLabel("external_account")).toBe(
      "A bank account for Stripe to pay into",
    );
    expect(requirementLabel("configuration.merchant.mcc")).toBe(
      "What kind of business this is",
    );
    expect(
      requirementLabel("configuration.merchant.statement_descriptor.descriptor"),
    ).toBe("What shows on a customer's card statement");
    expect(requirementLabel("defaults.profile.product_description")).toBe(
      "A description of what you sell",
    );
    expect(requirementLabel("defaults.profile.business_url")).toBe(
      "A website for the business",
    );
    expect(
      requirementLabel("identity.attestations.terms_of_service.account.date"),
    ).toBe("Accepting Stripe's terms of service");
    expect(requirementLabel("identity.entity_type")).toBe(
      "Whether this is a sole trader, an LLC or a corporation",
    );
  });

  it("THE SAME QUESTION UNDER THREE PREFIXES IS ONE ANSWER", () => {
    /**
     * The defect that only a real screen found. One account returned
     * `representative.given_name` when it was created and
     * `identity.individual.given_name` a few hours later, once Stripe had
     * decided its entity type — so a table keyed on the full path answered the
     * first and rendered "Individual given name" for the second.
     */
    for (const key of [
      "representative.given_name",
      "identity.individual.given_name",
      "individual.given_name",
    ]) {
      expect(requirementLabel(key)).toBe("The owner's name");
    }
    expect(requirementLabel("identity.individual.id_numbers.us_ssn_last_4")).toBe(
      "The last four digits of the owner's Social Security number",
    );
    expect(requirementLabel("identity.individual.address.postal_code")).toBe(
      "The owner's home address",
    );
    expect(requirementLabel("identity.individual.date_of_birth.day")).toBe(
      "The owner's date of birth",
    );
  });

  it("a NAMED person is not 'the owner'", () => {
    /**
     * `person_1Pabc.given_name` is somebody Stripe asked about separately — a
     * beneficial owner or a director — and calling them "the owner" on a screen
     * listing several of them would be wrong.
     */
    expect(requirementLabel("person_1PabcXYZ.given_name")).toBe(
      "That person's name",
    );
    expect(requirementLabel("persons.person_1PabcXYZ.date_of_birth.year")).toBe(
      "That person's date of birth",
    );
    expect(
      requirementLabel("owners.person_1PabcXYZ.documents.primary_verification"),
    ).toBe("A photo of that person's ID — a licence or passport");
  });

  it("KEEPS AN UNKNOWN REQUIREMENT VISIBLE RATHER THAN DROPPING IT", () => {
    /**
     * Stripe adds requirements without telling us. A screen that silently
     * dropped an unrecognised one would leave a farm stuck on something the
     * page swore was finished — so the fallback prettifies the key instead.
     */
    expect(requirementLabel("configuration.merchant.brand_new_thing")).toBe(
      "Brand new thing",
    );
    expect(requirementLabel("identity.individual.brand_new_thing")).toBe(
      "Brand new thing",
    );
    expect(requirementLabel("some_brand_new_field")).toBe("Some brand new field");
  });

  it("an empty key contributes nothing", () => {
    expect(requirementLabel("")).toBe("");
    expect(requirementLabel("   ")).toBe("");
    expect(
      describeRequirements([need(""), need("external_account")]),
    ).toEqual(["A bank account for Stripe to pay into"]);
  });
});

describe("reading a jsonb column", () => {
  it("a jsonb column is unknown until something checks it", () => {
    expect(toRequirementList(null)).toEqual([]);
    expect(toRequirementList(undefined)).toEqual([]);
    expect(toRequirementList("external_account")).toEqual([]);
    expect(toRequirementList({ entries: [] })).toEqual([]);
    expect(toStatusDetailList(null)).toEqual([]);
    expect(toStatusDetailList([{ resolution: "provide_info" }])).toEqual([]);
  });

  it("a shape we do not recognise NEVER invents homework for the farm", () => {
    /**
     * `awaitingActionFrom` decides whether something lands on a farmer's to-do
     * list. Anything that is not literally "user" is treated as Stripe's
     * problem, so a malformed row is quiet rather than alarming.
     */
    expect(
      toRequirementList([{ description: "external_account", awaitingActionFrom: "?" }]),
    ).toEqual([
      {
        description: "external_account",
        awaitingActionFrom: "stripe",
        deadline: null,
        restricts: [],
        errors: [],
      },
    ]);
  });

  it("drops entries with no key, and non-strings inside the lists", () => {
    expect(
      toRequirementList([
        { awaitingActionFrom: "user" },
        null,
        "external_account",
        {
          description: "external_account",
          awaitingActionFrom: "user",
          deadline: "past_due",
          restricts: ["stripe_balance.payouts", 7, null],
          errors: ["", "Bad account number.", 3],
        },
      ]),
    ).toEqual([
      {
        description: "external_account",
        awaitingActionFrom: "user",
        deadline: "past_due",
        restricts: ["stripe_balance.payouts"],
        errors: ["Bad account number."],
      },
    ]);
  });
});
