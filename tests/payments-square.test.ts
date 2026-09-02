import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSquareAuthorizeUrl,
  describeSquareOauthError,
  needsSquareRefresh,
  parseSquareTokenResponse,
  readSquareError,
  SQUARE_REFRESH_WINDOW_MS,
  SQUARE_SCOPES,
} from "../src/lib/payments/square/oauth";
import {
  squareSignature,
  verifySquareSignature,
} from "../src/lib/payments/square/signature";
import {
  CARD_CAPABILITY,
  describeSquareAccount,
  MERCHANT_INACTIVE_CODE,
  NOT_ACTIVATED_CODE,
  projectSquareAccount,
  TOKEN_REJECTED_CODE,
  toSquareLocationList,
  type SquareLocationFact,
} from "../src/lib/payments/square/status";

/**
 * The Square half of the payments settings screen, without a database or
 * Square. Three things are wrong in a way a test can catch: the webhook
 * signature (the one thing between the internet and a write), the verdict
 * derived from a merchant and its locations, and the English a farm reads.
 * See ADR 0017.
 */

const DAY = 24 * 60 * 60 * 1000;

describe("square webhook signature", () => {
  const key = "sig-key-from-the-developer-console";
  const url = "https://yosherapp.com/api/webhooks/square";
  const body = JSON.stringify({
    merchant_id: "MLABC123",
    type: "oauth.authorization.revoked",
  });
  const good = createHmac("sha256", key).update(url + body).digest("base64");

  it("is HMAC-SHA256 over the notification URL followed by the raw body, base64", () => {
    expect(squareSignature(key, url, body)).toBe(good);
  });

  it("accepts the genuine header", () => {
    expect(
      verifySquareSignature({
        body,
        signatureHeader: good,
        signatureKey: key,
        notificationUrl: url,
      }),
    ).toBe(true);
  });

  it("rejects a tampered body, a different URL, the wrong key, and no header", () => {
    expect(
      verifySquareSignature({
        body: body.replace("MLABC123", "MLXYZ999"),
        signatureHeader: good,
        signatureKey: key,
        notificationUrl: url,
      }),
    ).toBe(false);
    // The URL is part of the input on purpose: a notification replayed at
    // another endpoint must not verify.
    expect(
      verifySquareSignature({
        body,
        signatureHeader: good,
        signatureKey: key,
        notificationUrl: url + "/",
      }),
    ).toBe(false);
    expect(
      verifySquareSignature({
        body,
        signatureHeader: good,
        signatureKey: "another-key",
        notificationUrl: url,
      }),
    ).toBe(false);
    expect(
      verifySquareSignature({
        body,
        signatureHeader: null,
        signatureKey: key,
        notificationUrl: url,
      }),
    ).toBe(false);
    // A header of the wrong length is simply wrong, not an exception.
    expect(
      verifySquareSignature({
        body,
        signatureHeader: "short",
        signatureKey: key,
        notificationUrl: url,
      }),
    ).toBe(false);
  });
});

describe("square oauth", () => {
  it("builds the authorize URL with every scope, a forced login and the state", () => {
    const url = new URL(
      buildSquareAuthorizeUrl(
        { baseUrl: "https://connect.squareupsandbox.com", applicationId: "sq0idp-abc" },
        { state: "state-123" },
      ),
    );
    expect(url.origin).toBe("https://connect.squareupsandbox.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe("sq0idp-abc");
    expect(url.searchParams.get("scope")).toBe(SQUARE_SCOPES.join(" "));
    expect(url.searchParams.get("session")).toBe("false");
    expect(url.searchParams.get("state")).toBe("state-123");
  });

  it("asks for what every payment slice needs, once", () => {
    for (const scope of [
      "MERCHANT_PROFILE_READ",
      "PAYMENTS_WRITE",
      "PAYOUTS_READ",
      "ORDERS_WRITE",
      "DEVICE_CREDENTIAL_MANAGEMENT",
    ]) {
      expect(SQUARE_SCOPES).toContain(scope);
    }
  });

  it("parses a token response into absolute times and keeps the merchant id", () => {
    const tokens = parseSquareTokenResponse({
      access_token: "EAAA-access",
      token_type: "bearer",
      expires_at: "2026-10-02T12:00:00Z",
      merchant_id: "MLABC123",
      refresh_token: "EQAA-refresh",
      short_lived: false,
    });
    expect(tokens).not.toBeNull();
    expect(tokens?.accessToken).toBe("EAAA-access");
    expect(tokens?.refreshToken).toBe("EQAA-refresh");
    expect(tokens?.merchantId).toBe("MLABC123");
    expect(tokens?.expiresAt?.toISOString()).toBe("2026-10-02T12:00:00.000Z");
  });

  it("refuses a response with no access token or no merchant, and shrugs at a bad date", () => {
    expect(parseSquareTokenResponse({ merchant_id: "M" })).toBeNull();
    expect(parseSquareTokenResponse({ access_token: "x" })).toBeNull();
    expect(parseSquareTokenResponse("nope")).toBeNull();
    const odd = parseSquareTokenResponse({
      access_token: "x",
      merchant_id: "M",
      expires_at: "not a date",
      refresh_token: "",
    });
    expect(odd?.expiresAt).toBeNull();
    // An empty refresh token is "none sent", which callers read as keep-what-you-have.
    expect(odd?.refreshToken).toBeNull();
  });

  it("reads both error shapes Square uses", () => {
    expect(
      readSquareError({
        errors: [{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED", detail: "nope" }],
      }),
    ).toEqual({ code: "UNAUTHORIZED", detail: "nope" });
    expect(
      readSquareError({ error: "invalid_grant", error_description: "used" }),
    ).toEqual({ code: "invalid_grant", detail: "used" });
    expect(readSquareError({ access_token: "fine" })).toBeNull();
    expect(readSquareError(null)).toBeNull();
  });

  it("turns codes into sentences a person can act on", () => {
    expect(describeSquareOauthError("access_denied")).toMatch(/declined/);
    expect(describeSquareOauthError("invalid_client")).toMatch(/ours to fix/);
    expect(describeSquareOauthError("ACCESS_TOKEN_REVOKED")).toMatch(/Connect Square again/);
    expect(describeSquareOauthError("SOMETHING_NEW", "the detail")).toMatch(/the detail/);
    expect(describeSquareOauthError("SOMETHING_NEW")).toMatch(/SOMETHING_NEW/);
  });

  it("refreshes inside the last week, and treats an unknown expiry as due now", () => {
    const now = new Date("2026-09-02T12:00:00Z");
    expect(needsSquareRefresh(null, now)).toBe(true);
    expect(needsSquareRefresh(new Date(now.getTime() + 10 * DAY), now)).toBe(false);
    expect(needsSquareRefresh(new Date(now.getTime() + 6 * DAY), now)).toBe(true);
    expect(needsSquareRefresh(new Date(now.getTime() + SQUARE_REFRESH_WINDOW_MS), now)).toBe(true);
    expect(needsSquareRefresh(new Date(now.getTime() - DAY), now)).toBe(true);
  });
});

const merchant = (over: Record<string, unknown> = {}) => ({
  id: "MLABC123",
  business_name: "Oak Row Farm",
  country: "US",
  currency: "USD",
  status: "ACTIVE",
  main_location_id: null,
  ...over,
});

const location = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: `Location ${id}`,
  status: "ACTIVE",
  type: "MOBILE",
  capabilities: [CARD_CAPABILITY],
  ...over,
});

describe("projectSquareAccount", () => {
  it("is active when an active location can process cards", () => {
    const projected = projectSquareAccount(merchant(), [location("L1")]);
    expect(projected.cardPaymentsStatus).toBe("active");
    expect(projected.statusDetails).toEqual([]);
    expect(projected.displayName).toBe("Oak Row Farm");
    expect(projected.country).toBe("US");
    expect(projected.defaultCurrency).toBe("USD");
    expect(projected.squareLocations).toEqual([
      { id: "L1", name: "Location L1", status: "ACTIVE", type: "MOBILE", canTakeCards: true },
    ]);
  });

  it("is restricted, and says why, when no active location processes cards", () => {
    const noCards = projectSquareAccount(merchant(), [location("L1", { capabilities: [] })]);
    expect(noCards.cardPaymentsStatus).toBe("restricted");
    expect(noCards.statusDetails).toEqual([
      { code: NOT_ACTIVATED_CODE, resolution: "contact_square" },
    ]);

    // A card-capable location that is INACTIVE does not count.
    const inactiveLocation = projectSquareAccount(merchant(), [
      location("L1", { status: "INACTIVE" }),
    ]);
    expect(inactiveLocation.cardPaymentsStatus).toBe("restricted");

    const inactiveMerchant = projectSquareAccount(merchant({ status: "INACTIVE" }), [
      location("L1"),
    ]);
    expect(inactiveMerchant.cardPaymentsStatus).toBe("restricted");
    expect(inactiveMerchant.statusDetails[0]?.code).toBe(MERCHANT_INACTIVE_CODE);
  });

  it("takes Square's main location, else the first active one, else the first", () => {
    expect(
      projectSquareAccount(merchant({ main_location_id: "L2" }), [location("L1"), location("L2")])
        .squareMainLocationId,
    ).toBe("L2");
    expect(
      projectSquareAccount(merchant(), [location("L1", { status: "INACTIVE" }), location("L2")])
        .squareMainLocationId,
    ).toBe("L2");
    expect(
      projectSquareAccount(merchant(), [location("L1", { status: "INACTIVE" })])
        .squareMainLocationId,
    ).toBe("L1");
    expect(projectSquareAccount(merchant(), []).squareMainLocationId).toBeNull();
  });

  it("fills in what Square leaves out rather than storing undefined", () => {
    const projected = projectSquareAccount(merchant({ business_name: null }), [
      { id: "L9" },
    ]);
    expect(projected.displayName).toBeNull();
    expect(projected.squareLocations[0]).toEqual({
      id: "L9",
      name: "Unnamed location",
      status: "UNKNOWN",
      type: "PHYSICAL",
      canTakeCards: false,
    });
  });
});

const fact = (over: Partial<SquareLocationFact> = {}): SquareLocationFact => ({
  id: "L1",
  name: "Stall",
  status: "ACTIVE",
  type: "MOBILE",
  canTakeCards: true,
  ...over,
});

describe("describeSquareAccount", () => {
  it("null is the absence of a state: not connected, offer to connect", () => {
    const view = describeSquareAccount(null);
    expect(view.state).toBe("not_connected");
    expect(view.action).toBe("connect");
    expect(view.tone).toBe("idle");
  });

  it("a closed connection offers to connect again", () => {
    const view = describeSquareAccount({
      cardPaymentsStatus: "active",
      statusDetails: [],
      locations: [fact()],
      closedAt: new Date(),
    });
    expect(view.state).toBe("closed");
    expect(view.action).toBe("connect");
  });

  it("a rejected token is its own state, distinct from closed and from a form to finish", () => {
    const view = describeSquareAccount({
      cardPaymentsStatus: "restricted",
      statusDetails: [{ code: TOKEN_REJECTED_CODE, resolution: "reconnect" }],
      locations: [fact()],
      closedAt: null,
    });
    expect(view.state).toBe("needs_reconnect");
    expect(view.action).toBe("reconnect");
    expect(view.tone).toBe("warn");
    expect(view.outstanding).toEqual([]);
  });

  it("active is ready, and counts the locations that can take a card", () => {
    const one = describeSquareAccount({
      cardPaymentsStatus: "active",
      statusDetails: [],
      locations: [fact()],
      closedAt: null,
    });
    expect(one.state).toBe("ready");
    expect(one.tone).toBe("ok");
    expect(one.action).toBe("manage");
    expect(one.detail).toMatch(/this account can take a card/);

    const two = describeSquareAccount({
      cardPaymentsStatus: "active",
      statusDetails: [],
      locations: [fact(), fact({ id: "L2", name: "Farm store", type: "PHYSICAL" }), fact({ id: "L3", canTakeCards: false })],
      closedAt: null,
    });
    expect(two.detail).toMatch(/2 of this account's locations/);
  });

  it("restricted names the reason in the farm's to-do list", () => {
    const notActivated = describeSquareAccount({
      cardPaymentsStatus: "restricted",
      statusDetails: [{ code: NOT_ACTIVATED_CODE, resolution: "contact_square" }],
      locations: [fact({ canTakeCards: false })],
      closedAt: null,
    });
    expect(notActivated.state).toBe("needs_information");
    expect(notActivated.outstanding).toHaveLength(1);
    expect(notActivated.outstanding[0]).toMatch(/activation/);
    expect(notActivated.action).toBe("manage");

    const inactive = describeSquareAccount({
      cardPaymentsStatus: "restricted",
      statusDetails: [{ code: MERCHANT_INACTIVE_CODE, resolution: "contact_square" }],
      locations: [fact()],
      closedAt: null,
    });
    expect(inactive.outstanding[0]).toMatch(/inactive/);
  });

  it("no verdict yet is 'checking', not 'ready' and not 'broken'", () => {
    const view = describeSquareAccount({
      cardPaymentsStatus: null,
      statusDetails: [],
      locations: [],
      closedAt: null,
    });
    expect(view.state).toBe("reviewing");
    expect(view.tone).toBe("pending");
  });
});

describe("toSquareLocationList", () => {
  it("reads the jsonb projection back and drops anything malformed", () => {
    expect(
      toSquareLocationList([
        { id: "L1", name: "Stall", status: "ACTIVE", type: "MOBILE", canTakeCards: true },
        { id: "L2", name: "Store" },
        { name: "no id" },
        "junk",
        null,
      ]),
    ).toEqual([
      { id: "L1", name: "Stall", status: "ACTIVE", type: "MOBILE", canTakeCards: true },
      { id: "L2", name: "Store", status: "UNKNOWN", type: "PHYSICAL", canTakeCards: false },
    ]);
    expect(toSquareLocationList(null)).toEqual([]);
    expect(toSquareLocationList({})).toEqual([]);
  });
});
