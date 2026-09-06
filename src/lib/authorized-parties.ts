/**
 * The origins a Clerk session may come from — `authorizedParties` for
 * `clerkMiddleware`, derived from the environment rather than typed in.
 *
 * Clerk's production checklist asks for this list: a session token carries
 * the origin that created it (`azp`), and without an allowlist a token minted
 * on one host is honoured on every host that shares the cookie domain. The
 * platform serves customers' marketing sites on subdomains of its own domain
 * (`<slug>.<SITE_DOMAIN>`, ADR 0020), which is precisely the shape the check
 * exists for.
 *
 * It applies ONLY to a production instance (`pk_live_`). The development
 * instance is what laptops and Vercel previews sign in with, on hostnames
 * nobody can list in advance; an allowlist there would lock out exactly the
 * people it cannot enumerate and protect nothing that matters.
 *
 * Pure: the proxy reads the environment per request and hands it in.
 */

export interface AuthorizedPartiesEnv {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_APP_URL?: string;
  /** Vercel sets these on every deployment: the unique URL and the branch alias. */
  VERCEL_URL?: string;
  VERCEL_BRANCH_URL?: string;
  /** So `process.env` can be handed in as-is; only the keys above are read. */
  [key: string]: string | undefined;
}

/**
 * `https://yosherapp.com` and `https://www.yosherapp.com` are one product to
 * a person and two origins to a token. Whichever one is configured, allow the
 * other, so a www redirect that lands after sign-in does not read as an
 * attack. Only an apex (one dot) or a www host has a twin; ports, deeper
 * subdomains and single-label hosts such as localhost do not.
 */
function withWwwTwin(origin: string): string[] {
  const url = new URL(origin);
  if (url.port) return [origin];
  const twin = new URL(origin);
  if (url.hostname.startsWith("www.")) {
    twin.hostname = url.hostname.slice(4);
  } else if (url.hostname.split(".").length === 2) {
    twin.hostname = `www.${url.hostname}`;
  } else {
    return [origin];
  }
  return [origin, twin.origin];
}

function originOf(raw: string | undefined, assumeHttps = false): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme =
    assumeHttps && !/^https?:\/\//i.test(value) ? `https://${value}` : value;
  try {
    return new URL(withScheme).origin;
  } catch {
    // A malformed URL is a deploy mistake somebody will notice; it must not
    // take sign-in down by producing a list that matches nothing.
    return null;
  }
}

/**
 * `undefined` means "do not check" — the value clerkMiddleware treats as the
 * default. Returned for a development instance, for a missing key, and when
 * nothing usable is configured, because an empty allowlist would deny
 * everyone.
 */
export function authorizedPartiesFromEnv(
  env: AuthorizedPartiesEnv,
): string[] | undefined {
  if (!env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith("pk_live_")) {
    return undefined;
  }
  const parties = new Set<string>();
  const app = originOf(env.NEXT_PUBLIC_APP_URL);
  if (app) for (const origin of withWwwTwin(app)) parties.add(origin);
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    const origin = originOf(host, true);
    if (origin) parties.add(origin);
  }
  return parties.size > 0 ? [...parties] : undefined;
}
