import { createHash, randomBytes } from "node:crypto";
import type { OidcConfig } from "./discovery";
import { SCOPE_MAIL, SCOPE_OFFLINE } from "./discovery";

/**
 * The authorization-code flow, with PKCE.
 *
 * This is the piece that makes an inbox possible without storing anyone's
 * password. The person authorizes Yosher on their own mail server, we receive
 * a code, and we trade it for tokens. The password never passes through here,
 * and they can revoke us from the server without involving us at all.
 *
 * PKCE is used even though this is a confidential client with a secret. The
 * cost is one hash; the protection is against an authorization code being
 * intercepted at the redirect — through browser history, a proxy log, or a
 * referrer header — and replayed by somebody who never had the secret.
 */

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Absolute, computed from expires_in at the moment of the response. */
  expiresAt: Date | null;
  scope: string[];
}

export type FlowResult<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; needsReauth?: boolean };

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/**
 * A verifier and its S256 challenge.
 *
 * The verifier is held by us and never leaves the server; only the hash goes
 * out in the redirect. At exchange time we present the verifier, proving we are
 * the same party that started the flow.
 */
export function createPkcePair(): PkcePair {
  // 32 random bytes → 43 base64url characters, inside RFC 7636's 43–128 range.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Opaque value tying a callback back to the request that started it — CSRF defence. */
export function createState(): string {
  return randomBytes(24).toString("base64url");
}

export interface AuthorizeInput {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  /** Defaults to mail + offline_access: the least that yields a durable connection. */
  scopes?: string[];
}

export function buildAuthorizeUrl(
  config: OidcConfig,
  input: AuthorizeInput,
): string {
  const scopes = input.scopes ?? [SCOPE_MAIL, SCOPE_OFFLINE];
  const url = new URL(config.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", input.state);
  if (config.supportsPkceS256) {
    url.searchParams.set("code_challenge", input.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }
  return url.toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Read a token response.
 *
 * `expires_in` is relative and the response is the only moment we know what it
 * is relative TO, so it is resolved to an absolute time here rather than
 * stored as a duration and misinterpreted later.
 *
 * A response with no access token is a failure however cheerful its status
 * code — some servers return 200 with an `error` body.
 */
export function parseTokenResponse(
  payload: unknown,
  now: Date = new Date(),
): TokenSet | null {
  const r = asRecord(payload);
  if (!r) return null;

  const accessToken = r.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;

  const expiresIn = typeof r.expires_in === "number" ? r.expires_in : null;

  return {
    accessToken,
    refreshToken:
      typeof r.refresh_token === "string" && r.refresh_token.length > 0
        ? r.refresh_token
        : null,
    expiresAt:
      expiresIn === null ? null : new Date(now.getTime() + expiresIn * 1000),
    scope: typeof r.scope === "string" ? r.scope.split(/\s+/).filter(Boolean) : [],
  };
}

/** OAuth error codes are terse; these are what a person can act on. */
export function describeOauthError(code: string, description?: string): string {
  switch (code) {
    case "invalid_grant":
      return "That authorization has expired or already been used. Try connecting again.";
    case "invalid_client":
      return "This app isn't registered with the mail server correctly.";
    case "access_denied":
      return "The mailbox owner declined the request.";
    case "invalid_scope":
      return "The mail server doesn't offer the access this needs.";
    case "unsupported_grant_type":
      return "The mail server doesn't support this way of signing in.";
    default:
      return description && description.length > 0
        ? `The mail server refused the sign-in: ${description.slice(0, 200)}`
        : `The mail server refused the sign-in (${code}).`;
  }
}

async function postToken(
  config: OidcConfig,
  body: Record<string, string>,
): Promise<FlowResult<TokenSet>> {
  let response: Response;
  try {
    response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "Couldn't reach the mail server." };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: "The mail server's sign-in reply wasn't valid JSON." };
  }

  const r = asRecord(payload);
  const errorCode = typeof r?.error === "string" ? r.error : null;
  if (errorCode) {
    const description =
      typeof r?.error_description === "string" ? r.error_description : undefined;
    return {
      ok: false,
      message: describeOauthError(errorCode, description),
      // invalid_grant means this refresh token will never work again — the
      // only cure is the person reconnecting, so say so rather than retrying.
      needsReauth: errorCode === "invalid_grant",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `The mail server refused the sign-in (${response.status}).`,
    };
  }

  const tokens = parseTokenResponse(payload);
  if (!tokens) {
    return { ok: false, message: "The mail server didn't return an access token." };
  }
  return { ok: true, data: tokens };
}

export async function exchangeCode(
  config: OidcConfig,
  input: {
    code: string;
    clientId: string;
    clientSecret?: string;
    redirectUri: string;
    verifier: string;
  },
): Promise<FlowResult<TokenSet>> {
  return postToken(config, {
    grant_type: "authorization_code",
    code: input.code,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
  });
}

/**
 * Trade a refresh token for a fresh access token.
 *
 * Servers may or may not rotate the refresh token. When one comes back it
 * REPLACES the stored one; when it does not, the existing one stays valid.
 * Overwriting with null on a non-rotating server would break the connection at
 * the next expiry, which is a bug that takes an hour to appear and a day to
 * find — so callers must treat a null refreshToken as "keep what you have".
 */
export async function refreshAccessToken(
  config: OidcConfig,
  input: { refreshToken: string; clientId: string; clientSecret?: string },
): Promise<FlowResult<TokenSet>> {
  return postToken(config, {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    ...(input.clientSecret ? { client_secret: input.clientSecret } : {}),
  });
}

/** Refresh a little early — a token that expires mid-request is a failed request. */
export const REFRESH_SKEW_MS = 60_000;

export function needsRefresh(expiresAt: Date | null, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() - now.getTime() <= REFRESH_SKEW_MS;
}
