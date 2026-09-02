import type { PaymentAccountView, StatusDetailFact } from "../status";
import type { SquareLocation, SquareMerchant } from "./api";

/**
 * **WHAT A FARM READS ABOUT ITS SQUARE CONNECTION.** Pure, like the Stripe
 * half in `../status.ts`, and much shorter — because Square has no KYC
 * requirements list for us to translate. The farm's account was activated (or
 * not) long before it met Yosher; the API reports the verdict and this file
 * turns it into one honest sentence.
 *
 * The verdict is read off two objects: the MERCHANT (`ACTIVE`/`INACTIVE`) and
 * its LOCATIONS, each of which either carries `CREDIT_CARD_PROCESSING` or does
 * not. A Square account with no card-capable active location cannot take a
 * card anywhere, whatever else is true of it.
 */

/** `CREDIT_CARD_PROCESSING` on a location is Square's "this place can take a card". */
export const CARD_CAPABILITY = "CREDIT_CARD_PROCESSING";

/** `status_details[].code` values this side writes. Ours, not Square's. */
export const TOKEN_REJECTED_CODE = "token_rejected";
export const NOT_ACTIVATED_CODE = "card_processing_not_activated";
export const MERCHANT_INACTIVE_CODE = "merchant_inactive";

/** One Square location, trimmed to what a screen and a till need. */
export type SquareLocationFact = {
  id: string;
  name: string;
  /** `ACTIVE` | `INACTIVE`, Square's word. */
  status: string;
  /** `PHYSICAL` | `MOBILE` — a farm store versus a stall. */
  type: string;
  canTakeCards: boolean;
};

export function toSquareLocationFacts(
  locations: SquareLocation[],
): SquareLocationFact[] {
  return locations.map((l) => ({
    id: l.id,
    name: l.name ?? "Unnamed location",
    status: l.status ?? "UNKNOWN",
    type: l.type ?? "PHYSICAL",
    canTakeCards: (l.capabilities ?? []).includes(CARD_CAPABILITY),
  }));
}

/** Read the `square_locations` jsonb column back into facts, dropping anything malformed. */
export function toSquareLocationList(value: unknown): SquareLocationFact[] {
  if (!Array.isArray(value)) return [];
  const out: SquareLocationFact[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.name !== "string") continue;
    out.push({
      id: r.id,
      name: r.name,
      status: typeof r.status === "string" ? r.status : "UNKNOWN",
      type: typeof r.type === "string" ? r.type : "PHYSICAL",
      canTakeCards: r.canTakeCards === true,
    });
  }
  return out;
}

/**
 * Flatten a merchant and its locations into the columns `payment_accounts`
 * shares with the Stripe side. `card_payments_status` keeps Stripe's vocabulary
 * — `active` is the only value the till will ever treat as yes — so that the
 * ONE fact the till asks has one column regardless of provider.
 */
export function projectSquareAccount(
  merchant: SquareMerchant,
  locations: SquareLocation[],
) {
  const facts = toSquareLocationFacts(locations);
  const inactive = merchant.status === "INACTIVE";
  const cardCapable = facts.some((l) => l.canTakeCards && l.status === "ACTIVE");
  const active = !inactive && cardCapable;

  const statusDetails: StatusDetailFact[] = active
    ? []
    : [
        {
          code: inactive ? MERCHANT_INACTIVE_CODE : NOT_ACTIVATED_CODE,
          resolution: "contact_square",
        },
      ];

  return {
    cardPaymentsStatus: active ? "active" : "restricted",
    statusDetails,
    squareLocations: facts,
    /**
     * Where a charge from the till will be made until a later slice lets the
     * farm pick per channel. Square's `main_location_id` when it says; else the
     * first active location, so a merchant with the field unset still has one.
     */
    squareMainLocationId:
      merchant.main_location_id ??
      facts.find((l) => l.status === "ACTIVE")?.id ??
      facts[0]?.id ??
      null,
    displayName: merchant.business_name ?? null,
    country: merchant.country ?? null,
    defaultCurrency: merchant.currency ?? null,
  };
}

/** The subset of the row this file needs; a plain shape so tests need no database. */
export type SquareAccountFacts = {
  cardPaymentsStatus: string | null;
  statusDetails: StatusDetailFact[];
  locations: SquareLocationFact[];
  closedAt: Date | null;
};

const NOT_ACTIVATED_SENTENCE =
  "Square hasn't switched on card processing for this account yet. Finish activation in your Square dashboard, then check again.";
const INACTIVE_SENTENCE =
  "Square has this account marked inactive. Sort it out in your Square dashboard, then check again.";

/**
 * **NULL IS NOT A STATE, IT IS THE ABSENCE OF ONE** — the Stripe side's rule,
 * kept. A company with no row has never connected; a company whose token Square
 * has rejected has, and telling the two apart is what the "reconnect" state is
 * for.
 */
export function describeSquareAccount(
  account: SquareAccountFacts | null | undefined,
): PaymentAccountView {
  if (!account) {
    return {
      state: "not_connected",
      label: "Not connected",
      tone: "idle",
      detail:
        "Connect the Square account this business already takes cards with. Yosher never sees a card number and never holds your money.",
      outstanding: [],
      action: "connect",
    };
  }

  if (account.closedAt) {
    return {
      state: "closed",
      label: "Disconnected",
      tone: "idle",
      detail:
        "Square no longer lets Yosher act for this account. Connect it again to take cards from the till.",
      outstanding: [],
      action: "connect",
    };
  }

  if (account.statusDetails.some((d) => d.code === TOKEN_REJECTED_CODE)) {
    return {
      state: "needs_reconnect",
      label: "Needs reconnecting",
      tone: "warn",
      detail:
        "Square stopped accepting Yosher's access to this account. Nothing is lost — connect again and it picks up where it was.",
      outstanding: [],
      action: "reconnect",
    };
  }

  if (account.cardPaymentsStatus === "active") {
    const cardLocations = account.locations.filter(
      (l) => l.canTakeCards && l.status === "ACTIVE",
    ).length;
    return {
      state: "ready",
      label: "Connected",
      tone: "ok",
      detail:
        cardLocations > 1
          ? `Square is connected and ${cardLocations} of this account's locations can take a card.`
          : "Square is connected and this account can take a card.",
      outstanding: [],
      action: "manage",
    };
  }

  if (account.cardPaymentsStatus === null) {
    return {
      state: "reviewing",
      label: "Checking with Square",
      tone: "pending",
      detail:
        "Connected. Square hasn't confirmed card processing yet — this refreshes each time you open the page.",
      outstanding: [],
      action: "manage",
    };
  }

  const inactive = account.statusDetails.some(
    (d) => d.code === MERCHANT_INACTIVE_CODE,
  );
  return {
    state: "needs_information",
    label: "Square isn't ready",
    tone: "warn",
    detail: "Square is connected, but it won't take a card for this account yet.",
    outstanding: [inactive ? INACTIVE_SENTENCE : NOT_ACTIVATED_SENTENCE],
    action: "manage",
  };
}
