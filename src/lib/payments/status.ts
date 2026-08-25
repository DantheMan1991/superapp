/**
 * **WHAT A FARM ACTUALLY READS ON THE PAYMENTS SCREEN.** Pure — no database, no
 * Stripe client, no `server-only` — because this is the part that is wrong in a
 * way a test can catch, and because the state it renders is the one nobody
 * designs.
 *
 * Onboarding a Stripe connected account is not a click. Stripe asks for a tax
 * ID, a bank account and often a photo of somebody's driving licence, and then
 * reviews what it was given. **A real farm sits in "needs information" for a day
 * or two**, and if the screen answers that with a spinner or a bare
 * `representative.given_name` then the farm calls us instead of finishing the
 * form.
 *
 * So the job here is: turn Stripe's verdicts into one honest sentence, and turn
 * Stripe's field NAMES into English.
 *
 * **THIS IS ACCOUNTS V2 VOCABULARY** (`/v2/core/accounts`), not v1's. Every key
 * below was read off a real test-mode account rather than copied from v1 —
 * `representative.*` where v1 said `individual.*`, `identity.entity_type` where
 * v1 said `business_type`, `defaults.profile.*` where v1 said
 * `business_profile.*`. See `scripts/stripe-connect-probe.ts`, which is how.
 *
 * See docs/decisions/0015-a-connected-account-belongs-to-a-company.md.
 */

/**
 * The states a company's ability to take a card can be in. Ordered by how far
 * along it is, which is also the order the screen's copy walks through.
 */
export type PaymentAccountState =
  /** No connected account at all. Nothing has been asked of anybody yet. */
  | "not_connected"
  /** Stripe is waiting on the farm. The Account Link is the way back in. */
  | "needs_information"
  /** The farm has done its part; Stripe has not finished. The day-or-two state. */
  | "reviewing"
  /** Cards work, but something is holding the money before it reaches the bank. */
  | "payouts_held"
  /** `card_payments` is active and nothing is outstanding. */
  | "ready"
  /** Stripe will never enable this one — wrong country, wrong entity type. */
  | "unsupported"
  /** Closed, or the farm revoked us from its own dashboard. */
  | "closed";

/** One `requirements.entries[]` row, trimmed to what a screen needs. */
export type RequirementFact = {
  /**
   * Stripe's MACHINE key, despite being called `description` in their API —
   * `external_account`, `representative.given_name`.
   */
  description: string;
  /** `user` = the farm has to do something. `stripe` = Stripe is working. */
  awaitingActionFrom: "user" | "stripe";
  /** `currently_due` | `eventually_due` | `past_due`. */
  deadline?: string | null;
  /**
   * Which capabilities this holds up. **The half that keeps "payouts on hold"
   * expressible**: a bank account restricts `stripe_balance.payouts` and not
   * `card_payments`, so a farm can be taking cards with nothing reaching the
   * bank — which v2 has no boolean for and v1 did.
   */
  restricts?: string[] | null;
  /** Human-readable, and present only when something submitted was rejected. */
  errors?: string[] | null;
};

/** One `capabilities.card_payments.status_details[]` row. */
export type StatusDetailFact = {
  code: string;
  /** `provide_info` | `contact_stripe` | `no_resolution`. */
  resolution: string;
};

/**
 * The subset of the row this file needs. A plain shape rather than the drizzle
 * type, so the tests do not need a database to construct one.
 */
export type PaymentAccountFacts = {
  /** `active` | `pending` | `restricted` | `unsupported`, or null before the first sync. */
  cardPaymentsStatus: string | null;
  statusDetails: StatusDetailFact[];
  requirements: RequirementFact[];
  /**
   * When Stripe actually stops accepting charges, if it has said. **Null is the
   * normal case and is not reassuring** — it means Stripe has listed what it
   * wants without putting a clock on it.
   */
  requirementsDueBy: Date | null;
  closedAt: Date | null;
};

export type PaymentAccountView = {
  state: PaymentAccountState;
  /** Badge text. Says what is true, never what we hope. */
  label: string;
  /** Which of the app's status tones the badge takes. */
  tone: "ok" | "pending" | "warn" | "idle";
  /** One sentence, addressed to the person who has to do something about it. */
  detail: string;
  /**
   * What Stripe is waiting on the FARM for, in English, deduplicated and
   * past-due first. Empty is meaningful: Stripe is working rather than waiting.
   */
  outstanding: string[];
  /** What the button on the card should offer, if anything. */
  action: "connect" | "continue" | "manage" | null;
};

const PAYOUTS_CAPABILITY = "stripe_balance.payouts";

/**
 * **NULL IS NOT A STATE, IT IS THE ABSENCE OF ONE.** A tenant with no row has
 * never been asked for anything; a tenant whose row says `restricted` has.
 * Collapsing the two would tell a farm mid-review to start over.
 */
export function describePaymentAccount(
  account: PaymentAccountFacts | null | undefined,
): PaymentAccountView {
  if (!account) {
    return {
      state: "not_connected",
      label: "Not connected",
      tone: "idle",
      detail:
        "Connect a Stripe account and card payments go straight to your own bank. Stripe asks for your business details and a bank account; it takes about ten minutes.",
      outstanding: [],
      action: "connect",
    };
  }

  /**
   * **CLOSED WINS OVER EVERY OTHER FLAG.** A farm that revokes us can leave a
   * row saying `active`, because the last event that described the account was
   * true when it arrived. Reading the status first would show a green badge
   * over an account we can no longer touch.
   */
  if (account.closedAt) {
    return {
      state: "closed",
      label: "Disconnected",
      tone: "warn",
      detail:
        "This Stripe account is no longer connected to Yosher, so no new card payments can be taken on it. Setting it up again starts a new one — past payouts and records stay in Stripe either way.",
      outstanding: [],
      action: "connect",
    };
  }

  // Only what the FARM can act on. A requirement Stripe is chewing on is not a
  // to-do list item, and putting it in one is how a screen invents homework.
  const userFacing = account.requirements.filter(
    (r) => r.awaitingActionFrom === "user",
  );
  const outstanding = describeRequirements(userFacing);

  if (account.cardPaymentsStatus === "unsupported") {
    return {
      state: "unsupported",
      label: "Not available",
      tone: "warn",
      detail: unsupportedSentence(account.statusDetails),
      outstanding: [],
      action: "manage",
    };
  }

  if (account.cardPaymentsStatus === "active") {
    /**
     * **CARDS WORKING IS NOT MONEY ARRIVING.** v2 has no `payouts_enabled`, so
     * the distinction lives in what a requirement RESTRICTS: a missing bank
     * account holds `stripe_balance.payouts` and leaves `card_payments` alone.
     * Calling that "ready" is how a farm finds out about a hold a fortnight
     * later, having taken money all month.
     */
    const holdsPayouts = userFacing.some((r) =>
      (r.restricts ?? []).includes(PAYOUTS_CAPABILITY),
    );
    if (holdsPayouts) {
      return {
        state: "payouts_held",
        label: "Payouts on hold",
        tone: "warn",
        detail:
          "Card payments work, but Stripe is holding the money until it has what is listed below. Nothing reaches the bank in the meantime.",
        outstanding,
        action: "continue",
      };
    }
    return {
      state: "ready",
      label: "Ready to take payments",
      tone: "ok",
      detail: outstanding.length
        ? "Card payments and payouts are both working. Stripe wants the details below at some point — nothing stops until then."
        : "Card payments and payouts are both working. Money from a card goes to your own bank account.",
      outstanding,
      action: "manage",
    };
  }

  /**
   * Not active, not unsupported, not closed. **The split that matters is who is
   * holding it up**, and v2 answers it directly with `awaiting_action_from` —
   * so this is read rather than guessed from whether a form was submitted.
   */
  if (outstanding.length > 0) {
    return {
      state: "needs_information",
      label: "Needs information",
      /**
       * **AMBER MEANS A CLOCK IS RUNNING, NOT "SOMETHING IS MISSING".**
       *
       * The obvious rule — warn when a requirement is `past_due` — was written
       * first and driving it killed it: in v2 a BRAND NEW account has every
       * requirement `past_due`, because nothing has been provided yet. A farm
       * that clicked Connect thirty seconds ago saw an amber badge, so by the
       * time it was genuinely late the badge said exactly what it had always
       * said. A tone that is always on carries no information.
       *
       * Stripe putting an actual DATE on it is the signal that separates
       * "here is the list" from "you are running out of time", and it is why
       * the deadline status and the deadline time are two columns.
       */
      tone: account.requirementsDueBy ? "warn" : "pending",
      detail: account.requirementsDueBy
        ? "Stripe has put a deadline on this one. Send it what is listed below before the date shown, or it stops accepting payments on this account."
        : "Stripe needs the details below before this company can take a card. Pick up where you left off — Stripe saves what you have already entered.",
      outstanding,
      action: "continue",
    };
  }

  return {
    state: "reviewing",
    label: "Stripe is reviewing",
    tone: "pending",
    detail: reviewSentence(account.statusDetails),
    outstanding: [],
    action: "manage",
  };
}

/**
 * Nothing is being asked of the farm, so the only useful thing to say is why it
 * is not finished yet and whether waiting will fix it.
 */
function reviewSentence(details: StatusDetailFact[]): string {
  if (details.some((d) => d.resolution === "contact_stripe")) {
    return "Stripe needs to look at this account itself. Contact Stripe support from your own dashboard — only they can move it along.";
  }
  if (details.some((d) => d.code === "requirements_pending_verification")) {
    return "Stripe is verifying what was sent. It usually takes a day or two, and this page updates itself when it finishes.";
  }
  if (details.some((d) => d.code === "determining_status")) {
    return "Stripe is still working out what else it needs. Check back in a few minutes.";
  }
  return "Everything Stripe asked for has been sent, and nothing is waiting on you. It usually confirms within a day or two, and this page updates itself when it does.";
}

function unsupportedSentence(details: StatusDetailFact[]): string {
  if (details.some((d) => d.code === "unsupported_country")) {
    return "Stripe does not support card payments for businesses in this country yet. Nothing here will change that — get in touch and we will look at the options.";
  }
  if (details.some((d) => d.code === "unsupported_business")) {
    return "Stripe does not accept card payments for this kind of business. Contact Stripe support from your own dashboard if you think that is wrong.";
  }
  if (details.some((d) => d.code === "unsupported_entity_type")) {
    return "Stripe does not support card payments for this type of legal entity. Get in touch and we will look at the options.";
  }
  return "Stripe will not enable card payments on this account. Its own dashboard has the detail.";
}

/**
 * **PAST DUE FIRST, THEN DEDUPLICATED.** `representative.date_of_birth.day`,
 * `.month` and `.year` are three requirements and one thing to go and do; a
 * list that said "date of birth" three times would read as a broken screen.
 *
 * An entry carrying an ERROR is promoted above everything: Stripe rejected
 * something already sent, which is both more urgent and more confusing than a
 * blank field, and it is the only case where Stripe hands us real English.
 */
export function describeRequirements(
  entries: readonly RequirementFact[] = [],
): string[] {
  const rank = (e: RequirementFact) =>
    (e.errors?.length ? 0 : 2) + (e.deadline === "past_due" ? 0 : 1);
  const sorted = [...entries]
    .map((e, i) => ({ e, i }))
    // Stable: equal ranks keep Stripe's own order, which groups related fields.
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map(({ e }) => e);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of sorted) {
    const base = requirementLabel(entry.description);
    if (!base) continue;
    const error = entry.errors?.find((m) => m && m.trim().length > 0);
    const label = error ? `${base} — ${error.trim()}` : base;
    if (seen.has(label)) continue;
    // An entry that has an error supersedes the same field without one.
    if (error) {
      const plain = out.indexOf(base);
      if (plain !== -1) {
        out.splice(plain, 1);
        seen.delete(base);
      }
    } else if (seen.has(base) || out.some((l) => l.startsWith(`${base} — `))) {
      continue;
    }
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * A person-scoped requirement can carry the person's Stripe id in the key:
 * `person_1PabcXYZ.given_name`. Strip it — the id is meaningless to a farmer,
 * and leaving it in means every such key falls through to the raw fallback.
 */
function stripPersonPrefix(key: string): string {
  return key
    .replace(/^(?:persons|owners|directors|executives)\./, "")
    .replace(/^person_[A-Za-z0-9]+\./, "");
}

/**
 * **EVERY KEY HERE WAS READ OFF A REAL v2 ACCOUNT**, not translated from v1.
 * `scripts/stripe-connect-probe.ts create` prints the current list; if Stripe
 * changes the vocabulary, that is how you find out rather than by guessing.
 */
const LABELS: Record<string, string> = {
  // The two that actually stop a market day.
  external_account: "A bank account for Stripe to pay into",
  "identity.attestations.terms_of_service.account.date":
    "Accepting Stripe's terms of service",
  "identity.attestations.terms_of_service.account.ip":
    "Accepting Stripe's terms of service",

  // The business.
  "identity.entity_type":
    "Whether this is a sole trader, an LLC or a corporation",
  "identity.country": "Which country the business is registered in",
  "identity.business_details.registered_name": "The registered business name",
  "identity.business_details.doing_business_as": "The trading name",
  "identity.business_details.id_numbers": "The business tax ID (EIN)",
  "identity.business_details.phone": "A phone number for the business",
  "identity.business_details.address": "The business address",
  "identity.business_details.registration_date":
    "When the business was registered",
  "identity.business_details.structure": "How the business is structured",
  "identity.business_details.documents.company_license":
    "A copy of the business licence",
  "identity.business_details.documents.company_registration_verification":
    "A document proving the business is registered",
  "identity.attestations.ownership_declaration": "Confirming who owns the business",
  "identity.attestations.persons_provided": "Confirming who is involved in the business",
  "configuration.merchant.mcc": "What kind of business this is",
  "configuration.merchant.statement_descriptor.descriptor":
    "What shows on a customer's card statement",
  "configuration.merchant.support.phone": "A phone number customers can call",
  "configuration.merchant.support.email": "An email address customers can write to",
  "configuration.merchant.support.address": "An address customers can write to",
  "configuration.merchant.support.url": "A support page customers can visit",
  "defaults.profile.business_url": "A website for the business",
  "defaults.profile.product_description": "A description of what you sell",
  "defaults.profile.mcc": "What kind of business this is",
  "defaults.currency": "Which currency you take payment in",

  // The person Stripe holds responsible. v2 calls them the representative.
  "representative.given_name": "The owner's name",
  "representative.surname": "The owner's name",
  "representative.email": "The owner's email address",
  "representative.phone": "The owner's phone number",
  "representative.date_of_birth.day": "The owner's date of birth",
  "representative.date_of_birth.month": "The owner's date of birth",
  "representative.date_of_birth.year": "The owner's date of birth",
  "representative.id_numbers": "The owner's Social Security number",
  "representative.address": "The owner's home address",
  "representative.relationship.title": "The owner's job title",
  "representative.relationship.executive": "Whether the owner runs the business",
  "representative.relationship.owner": "Whether this person owns the business",
  "representative.relationship.percent_ownership":
    "How much of the business this person owns",
  "representative.documents.primary_verification":
    "A photo of the owner's ID — a licence or passport",
  "representative.documents.secondary_verification":
    "A second document showing the owner's address — a bill or a statement",
  "representative.political_exposure": "Whether the owner holds a public office",

  // Same fields when Stripe scopes them to a named person rather than to the
  // account's representative. Reached after stripPersonPrefix.
  given_name: "That person's name",
  surname: "That person's name",
  email: "That person's email address",
  phone: "That person's phone number",
  "date_of_birth.day": "That person's date of birth",
  "date_of_birth.month": "That person's date of birth",
  "date_of_birth.year": "That person's date of birth",
  id_numbers: "That person's Social Security number",
  address: "That person's home address",
  "relationship.title": "That person's job title",
  "documents.primary_verification":
    "A photo of that person's ID — a licence or passport",
  "documents.secondary_verification":
    "A second document showing that person's address",
};

/**
 * One Stripe requirement key, in English.
 *
 * **THE FALLBACK KEEPS THE KEY READABLE RATHER THAN HIDING IT.** Stripe adds
 * requirements without telling us, and a screen that silently dropped an
 * unrecognised one would leave a farm stuck on something the page swore was
 * finished. A prettified `configuration.merchant.foo` is worse copy than a
 * hand-written label and infinitely better than nothing.
 */
export function requirementLabel(rawKey: string): string {
  const key = rawKey.trim();
  if (!key) return "";
  const mapped = LABELS[key] ?? LABELS[stripPersonPrefix(key)];
  if (mapped) return mapped;
  return prettifyKey(stripPersonPrefix(key));
}

function prettifyKey(key: string): string {
  const words = key
    .replace(/^(?:identity|configuration\.merchant|defaults|representative)\./, "")
    .replace(/^(?:business_details|profile|attestations|documents)\./, "")
    .replace(/[._]+/g, " ")
    .trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * **A JSONB COLUMN IS `unknown` UNTIL SOMETHING CHECKS IT.** Drizzle types
 * `jsonb` as `unknown`, and these values arrive from Stripe rather than from
 * us. Anything malformed is dropped rather than rendered as `[object Object]`.
 */
export function toRequirementList(value: unknown): RequirementFact[] {
  if (!Array.isArray(value)) return [];
  const out: RequirementFact[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.description !== "string" || !r.description) continue;
    out.push({
      description: r.description,
      // Anything that is not literally "user" is treated as Stripe's problem,
      // so a shape we do not recognise never invents homework for the farm.
      awaitingActionFrom: r.awaitingActionFrom === "user" ? "user" : "stripe",
      deadline: typeof r.deadline === "string" ? r.deadline : null,
      restricts: toStringArray(r.restricts),
      errors: toStringArray(r.errors),
    });
  }
  return out;
}

export function toStatusDetailList(value: unknown): StatusDetailFact[] {
  if (!Array.isArray(value)) return [];
  const out: StatusDetailFact[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.code !== "string" || !r.code) continue;
    out.push({
      code: r.code,
      resolution: typeof r.resolution === "string" ? r.resolution : "",
    });
  }
  return out;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}
