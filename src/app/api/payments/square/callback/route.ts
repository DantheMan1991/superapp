import { NextResponse } from "next/server";
import { resolveTenantContext } from "@/lib/auth";
import {
  connectSquareAccount,
  SquareError,
} from "@/lib/payments/square/accounts";
import {
  fetchSquareLocations,
  fetchSquareMerchant,
} from "@/lib/payments/square/api";
import { squareConfig } from "@/lib/payments/square/config";
import { exchangeSquareCode } from "@/lib/payments/square/oauth";
import { takePendingSquare } from "@/lib/payments/square/pending";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where Square sends the owner back.
 *
 * Everything arriving here is attacker-supplied — the code, the state, the
 * error — so nothing is trusted until the state matches a pending
 * authorization this browser started. The order of checks is the security of
 * the flow, and it is the mail callback's order:
 *
 *   1. consume the pending cookie (single-use, so a replay finds nothing)
 *   2. compare state (CSRF: proves this callback belongs to that request)
 *   3. confirm the signed-in OWNER is still the tenant that started it
 *   4. only then exchange the code, presenting the application secret
 *   5. read the merchant back with the new token — proof it works, and proof of
 *      WHICH Square account was authorised — before anything is stored
 *
 * Failures redirect to the payments page with a short reason CODE, never a
 * sentence: a person arrives here in a browser, and a query string is a log
 * line (security.md §4 — nothing sensitive in URLs). The page owns the English.
 */
export type SquareCallbackReason =
  | "declined"
  | "expired"
  | "incomplete"
  | "mismatch"
  | "wrong_tenant"
  | "not_configured"
  | "exchange"
  | "square_read"
  | "already_connected"
  | "save";

function back(returnTo: string, params: Record<string, string>): Response {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  // returnTo is joined against our own origin, so a value smuggled into the
  // cookie cannot turn this into an open redirect.
  const target = new URL(
    returnTo.startsWith("/") ? returnTo : "/dashboard/settings/payments",
    base,
  );
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target.toString());
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const pending = await takePendingSquare();
  const returnTo = pending?.returnTo ?? "/dashboard/settings/payments";
  const fail = (reason: SquareCallbackReason) =>
    back(returnTo, { square: "failed", reason });

  // Square reports a refusal here rather than sending a code.
  if (url.searchParams.get("error")) return fail("declined");
  if (!pending) return fail("expired");

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return fail("incomplete");
  // Someone is replaying or forging a callback. Say nothing specific.
  if (state !== pending.state) return fail("mismatch");

  const ctx = await resolveTenantContext();
  if (!ctx || ctx.tenant.id !== pending.tenantId || ctx.role !== "owner") {
    // Switched organizations mid-flow, signed out, or the cookie belongs to
    // another context. Either way this connection would land in the wrong place.
    return fail("wrong_tenant");
  }

  const config = squareConfig();
  if (!config) return fail("not_configured");

  const tokens = await exchangeSquareCode(config, code);
  if (!tokens.ok) {
    console.error("square code exchange failed", tokens.message);
    return fail("exchange");
  }

  /**
   * Prove the token opens the account before recording a connection. Storing
   * one that turns out not to work produces a company that looks connected and
   * fails at a stall — worse than a failure here. The merchant read is also the
   * only trustworthy answer to WHICH account was authorised: the token response
   * says, but the API is the source of truth, and the two must agree.
   */
  const merchant = await fetchSquareMerchant(config, tokens.data.accessToken);
  if (!merchant.ok) {
    console.error("square merchant read failed", merchant.message);
    return fail("square_read");
  }
  if (merchant.data.id !== tokens.data.merchantId) {
    console.error(
      "square merchant mismatch",
      merchant.data.id,
      tokens.data.merchantId,
    );
    return fail("square_read");
  }
  const locations = await fetchSquareLocations(config, tokens.data.accessToken);
  if (!locations.ok) {
    console.error("square locations read failed", locations.message);
    return fail("square_read");
  }

  try {
    await connectSquareAccount({
      tenantId: pending.tenantId,
      entityId: pending.entityId,
      tokens: tokens.data,
      merchant: merchant.data,
      locations: locations.data,
      actorClerkUserId: ctx.userId,
    });
  } catch (err) {
    if (err instanceof SquareError && err.code === "ALREADY_CONNECTED") {
      return fail("already_connected");
    }
    console.error("square connect save failed", err);
    return fail("save");
  }

  return back(returnTo, { square: "connected" });
}
