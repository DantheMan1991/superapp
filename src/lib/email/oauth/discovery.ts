/**
 * OpenID Connect discovery.
 *
 * Endpoints are discovered rather than hardcoded, for two reasons. It works
 * against any Stalwart instance without configuration drift between
 * environments — and it is the same shape Google and Microsoft need, so the
 * connector work that was deferred slots into this file rather than beside it.
 *
 * Pure apart from one fetch, and free of `server-only` so the parsing and the
 * rebasing are testable without a server.
 */

export interface OidcConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string | null;
  registrationEndpoint: string | null;
  scopesSupported: string[];
  supportsPkceS256: boolean;
  supportsRefreshToken: boolean;
}

export type DiscoveryResult =
  | { ok: true; data: OidcConfig }
  | { ok: false; message: string };

/** The scope that grants mail access, and nothing else. */
export const SCOPE_MAIL = "urn:ietf:params:oauth:scope:mail";
/** Required for a refresh token; without it the connection dies at first expiry. */
export const SCOPE_OFFLINE = "offline_access";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Move a discovered URL onto the host we are actually talking to.
 *
 * Necessary because Stalwart builds every advertised URL from its CONFIGURED
 * hostname rather than the request's Host header — verified against a live
 * instance. Locally that hostname does not resolve, so a client that followed
 * discovery literally would send the user's browser to a dead name.
 *
 * In production the hostname is real and this is a no-op. It also happens to
 * be what any deployment behind a reverse proxy needs.
 *
 * Only the origin is replaced. Paths come from the server, because guessing
 * them is exactly what discovery exists to avoid.
 */
export function rebaseOnto(baseUrl: string, discovered: string): string {
  try {
    const base = new URL(baseUrl);
    const target = new URL(discovered);
    if (target.host === base.host && target.protocol === base.protocol) {
      return discovered;
    }
    return `${base.protocol}//${base.host}${target.pathname}${target.search}`;
  } catch {
    return discovered;
  }
}

export function parseOidcConfig(
  payload: unknown,
  baseUrl: string,
): OidcConfig | null {
  const r = asRecord(payload);
  if (!r) return null;

  const authorization = r.authorization_endpoint;
  const token = r.token_endpoint;
  // Without these two there is no flow to run, so a partial config is a
  // failure rather than something to paper over with defaults.
  if (typeof authorization !== "string" || typeof token !== "string") {
    return null;
  }

  const grants = asStringArray(r.grant_types_supported);
  const challenges = asStringArray(r.code_challenge_methods_supported);

  return {
    issuer: typeof r.issuer === "string" ? r.issuer : "",
    authorizationEndpoint: rebaseOnto(baseUrl, authorization),
    tokenEndpoint: rebaseOnto(baseUrl, token),
    userinfoEndpoint:
      typeof r.userinfo_endpoint === "string"
        ? rebaseOnto(baseUrl, r.userinfo_endpoint)
        : null,
    registrationEndpoint:
      typeof r.registration_endpoint === "string"
        ? rebaseOnto(baseUrl, r.registration_endpoint)
        : null,
    scopesSupported: asStringArray(r.scopes_supported),
    supportsPkceS256: challenges.includes("S256"),
    // No refresh grant means the connection dies at the first expiry and the
    // person is asked to reconnect forever. Worth knowing up front.
    supportsRefreshToken: grants.includes("refresh_token"),
  };
}

/** Discovery documents change rarely; refetching one per request is waste. */
const cache = new Map<string, { at: number; config: OidcConfig }>();
const CACHE_MS = 10 * 60 * 1000;

export async function discoverOidc(
  baseUrl: string,
  opts: { force?: boolean } = {},
): Promise<DiscoveryResult> {
  const cached = cache.get(baseUrl);
  if (!opts.force && cached && Date.now() - cached.at < CACHE_MS) {
    return { ok: true, data: cached.config };
  }

  const url = `${baseUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch {
    return { ok: false, message: "Couldn't reach the mail server." };
  }

  if (!response.ok) {
    return {
      ok: false,
      message: `The mail server didn't offer a sign-in configuration (${response.status}).`,
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, message: "The mail server's configuration wasn't valid JSON." };
  }

  const config = parseOidcConfig(payload, baseUrl);
  if (!config) {
    return {
      ok: false,
      message: "The mail server's sign-in configuration is missing required endpoints.",
    };
  }

  cache.set(baseUrl, { at: Date.now(), config });
  return { ok: true, data: config };
}

/** Test seam — discovery is cached process-wide and would leak between cases. */
export function clearDiscoveryCache(): void {
  cache.clear();
}
