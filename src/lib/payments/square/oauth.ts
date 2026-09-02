import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Square's OAuth: the authorization-code flow with a client secret.
 *
 * **Pure apart from `fetch`**, and it takes its configuration as an argument
 * rather than reading the environment, so the parts that are wrong in a way a
 * test can catch — the URL, the token parsing, the refresh window, the error
 * English — run without a server.
 *
 * **NO PKCE, DELIBERATELY, and the reason is the refresh token.** Square offers
 * PKCE, and the mail flow uses it against Stalwart. But a Square refresh token
 * obtained through PKCE is single-use and expires after 90 days, while one from
 * the code flow does not expire at all. A farm that connects Square once and
 * sells at a market every Saturday for three years should never be asked to
 * sign in again; the code flow gives that, and the code-interception risk PKCE
 * guards against is already covered here by the client secret Square demands at
 * exchange time and by the state cookie that binds the callback to the browser
 * that started it. ADR 0017 records the trade.
 */

/**
 * Everything the four payment slices need, asked for ONCE. Square's permission
 * form lists them all and a farm consents once; adding a scope later means
 * sending every connected farm back through the form, which is a real chore for
 * a real person, so the roadmap's scopes are requested up front:
 *
 *   MERCHANT_PROFILE_READ         who they are, which locations exist
 *   PAYMENTS_READ / PAYMENTS_WRITE the payment that a sale becomes; Terminal
 *                                 checkouts need WRITE
 *   ORDERS_READ / ORDERS_WRITE     the itemised cart a Terminal can display, and
 *                                 the order a Square-app payment created
 *   PAYOUTS_READ                  settlements and fees, for the books
 *   DEVICE_CREDENTIAL_MANAGEMENT  pairing a Square Terminal
 */
export const SQUARE_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "PAYMENTS_READ",
  "PAYMENTS_WRITE",
  "ORDERS_READ",
  "ORDERS_WRITE",
  "PAYOUTS_READ",
  "DEVICE_CREDENTIAL_MANAGEMENT",
] as const;

export interface SquareOauthConfig {
  baseUrl: string;
  applicationId: string;
  applicationSecret: string;
}

/** Opaque value tying a callback back to the request that started it — CSRF defence. */
export function createSquareState(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * `session=false` makes Square ask WHO is connecting even when a Square session
 * is already open in the browser. This screen decides whose bank a company's
 * card takings land in; the one extra login is the right price for never
 * binding a company to whichever Square account happened to be signed in.
 * (Square documents that the flag has no effect in the sandbox.)
 */
export function buildSquareAuthorizeUrl(
  config: Pick<SquareOauthConfig, "baseUrl" | "applicationId">,
  input: { state: string; scopes?: readonly string[] },
): string {
  const url = new URL("/oauth2/authorize", config.baseUrl);
  url.searchParams.set("client_id", config.applicationId);
  url.searchParams.set("scope", (input.scopes ?? SQUARE_SCOPES).join(" "));
  url.searchParams.set("session", "false");
  url.searchParams.set("state", input.state);
  return url.toString();
}

const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  merchant_id: z.string().min(1),
  expires_at: z.string().optional(),
  refresh_token: z.string().optional(),
  short_lived: z.boolean().optional(),
  token_type: z.string().optional(),
});

export interface SquareTokenSet {
  accessToken: string;
  /**
   * Null when Square did not send one. On a REFRESH through the code flow
   * Square returns the same refresh token it was given, so callers treat null
   * as "keep what you have" — the mail flow's rule, for the same reason.
   */
  refreshToken: string | null;
  /** Absolute. Square sends `expires_at` as RFC 3339, thirty days out. */
  expiresAt: Date | null;
  /** Which Square account the token acts for. An identifier, not a secret. */
  merchantId: string;
}

export function parseSquareTokenResponse(payload: unknown): SquareTokenSet | null {
  const parsed = TokenResponseSchema.safeParse(payload);
  if (!parsed.success) return null;
  const r = parsed.data;
  const expiresAt = r.expires_at ? new Date(r.expires_at) : null;
  return {
    accessToken: r.access_token,
    refreshToken:
      r.refresh_token && r.refresh_token.length > 0 ? r.refresh_token : null,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
    merchantId: r.merchant_id,
  };
}

export type SquareFlowResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; needsReauth?: boolean };

/**
 * Square reports OAuth failures in two shapes, depending on the endpoint and
 * the API version: RFC 6749's `error` / `error_description`, and Square's own
 * `errors[{ category, code, detail }]` envelope. Both are read; whichever is
 * present wins.
 */
const ErrorEnvelopeSchema = z.object({
  errors: z
    .array(
      z.object({
        category: z.string().optional(),
        code: z.string().optional(),
        detail: z.string().optional(),
      }),
    )
    .optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export function readSquareError(
  payload: unknown,
): { code: string; detail: string | null } | null {
  const parsed = ErrorEnvelopeSchema.safeParse(payload);
  if (!parsed.success) return null;
  const first = parsed.data.errors?.[0];
  if (first?.code) return { code: first.code, detail: first.detail ?? null };
  if (parsed.data.error) {
    return {
      code: parsed.data.error,
      detail: parsed.data.error_description ?? null,
    };
  }
  return null;
}

/**
 * The grant is gone and only the owner connecting again brings it back. Every
 * other failure is worth retrying; these are not.
 */
const REAUTH_CODES = new Set([
  "invalid_grant",
  "UNAUTHORIZED",
  "ACCESS_TOKEN_REVOKED",
  "ACCESS_TOKEN_EXPIRED",
]);

/** OAuth error codes are terse; these are what a person can act on. */
export function describeSquareOauthError(
  code: string,
  detail?: string | null,
): string {
  switch (code) {
    case "invalid_grant":
    case "ACCESS_TOKEN_REVOKED":
    case "UNAUTHORIZED":
      return "Square no longer accepts that authorization. Connect Square again.";
    case "ACCESS_TOKEN_EXPIRED":
      return "Square's authorization has expired. Connect Square again.";
    case "invalid_client":
    case "CLIENT_DISABLED":
      return "Yosher isn't registered with Square correctly — that is ours to fix, not yours. Get in touch and we will sort it.";
    case "access_denied":
      return "Square access was declined, so nothing was connected.";
    case "invalid_scope":
    case "INSUFFICIENT_SCOPES":
      return "Square didn't grant everything the till needs. Connect Square again and accept the whole list.";
    default:
      return detail && detail.length > 0
        ? `Square refused the connection: ${detail.slice(0, 200)}`
        : `Square refused the connection (${code}).`;
  }
}

async function postOauth(
  config: SquareOauthConfig,
  path: "/oauth2/token" | "/oauth2/revoke",
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<SquareFlowResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(new URL(path, config.baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "Couldn't reach Square. Try again in a moment." };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A body that is not JSON is only a problem if the status said success.
    if (response.ok) {
      return { ok: false, message: "Square's reply wasn't valid JSON." };
    }
  }

  const error = readSquareError(payload);
  if (error) {
    return {
      ok: false,
      message: describeSquareOauthError(error.code, error.detail),
      needsReauth: REAUTH_CODES.has(error.code),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      message: `Square refused the request (${response.status}).`,
      // A 401 with no readable body is still a dead grant.
      needsReauth: response.status === 401,
    };
  }
  return { ok: true, data: payload };
}

function toTokens(
  result: SquareFlowResult<unknown>,
): SquareFlowResult<SquareTokenSet> {
  if (!result.ok) return result;
  const tokens = parseSquareTokenResponse(result.data);
  if (!tokens) {
    return { ok: false, message: "Square didn't return an access token." };
  }
  return { ok: true, data: tokens };
}

/** Trade the authorization code the callback received for the farm's tokens. */
export async function exchangeSquareCode(
  config: SquareOauthConfig,
  code: string,
): Promise<SquareFlowResult<SquareTokenSet>> {
  return toTokens(
    await postOauth(config, "/oauth2/token", {
      client_id: config.applicationId,
      client_secret: config.applicationSecret,
      grant_type: "authorization_code",
      code,
    }),
  );
}

/**
 * A fresh access token. Square's own guidance is to renew "every 7 days or
 * less" against a 30-day expiry, which is what `needsSquareRefresh` encodes.
 */
export async function refreshSquareToken(
  config: SquareOauthConfig,
  refreshToken: string,
): Promise<SquareFlowResult<SquareTokenSet>> {
  return toTokens(
    await postOauth(config, "/oauth2/token", {
      client_id: config.applicationId,
      client_secret: config.applicationSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  );
}

/**
 * Sever the authorization for one merchant — every token this application
 * holds for it, at once. Authenticated with the APPLICATION secret rather than
 * the merchant's token, which is what lets it work on a token that has already
 * expired.
 */
export async function revokeSquareToken(
  config: SquareOauthConfig,
  merchantId: string,
): Promise<SquareFlowResult<true>> {
  const result = await postOauth(
    config,
    "/oauth2/revoke",
    { client_id: config.applicationId, merchant_id: merchantId },
    { Authorization: `Client ${config.applicationSecret}` },
  );
  if (!result.ok) return result;
  const parsed = z
    .object({ success: z.boolean().optional() })
    .safeParse(result.data);
  if (!parsed.success || parsed.data.success === false) {
    return { ok: false, message: "Square did not confirm the disconnection." };
  }
  return { ok: true, data: true };
}

/**
 * Renew inside the last week of a token's life. Square asks for "7 days or
 * less" and a token that dies mid-market is a customer holding a card while a
 * screen says try again — so this errs early, and an unknown expiry counts as
 * due now.
 */
export const SQUARE_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function needsSquareRefresh(
  expiresAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return true;
  return expiresAt.getTime() - now.getTime() <= SQUARE_REFRESH_WINDOW_MS;
}
