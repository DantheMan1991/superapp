/**
 * The site's address — pure and dependency-free, because `src/proxy.ts`
 * imports `hostToSiteSlug` and the proxy runs before anything else on every
 * request, in a runtime that must not pull in the database or React.
 *
 * A slug is one hostname label: `oak-row` in `oak-row.yosher.site`. That is
 * why the shape is DNS's (letters, digits, hyphens, no hyphen at either end)
 * and why the reserved list holds the labels the platform itself uses or
 * that would confuse a browser or a mail server.
 */

export const SITE_SLUG_MIN = 3;
export const SITE_SLUG_MAX = 40;

/** The same expression the `sites.slug` CHECK enforces. */
export const SITE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const RESERVED_SITE_SLUGS: ReadonlySet<string> = new Set([
  "www",
  "app",
  "api",
  "admin",
  "dashboard",
  "sign-in",
  "sign-up",
  "onboarding",
  "s",
  "sites",
  "hosted",
  "health-check",
  "help",
  "docs",
  "blog",
  "static",
  "assets",
  "cdn",
  "mail",
  "m",
  "in",
  "jmap",
  "bounce",
  "smtp",
  "imap",
  "pop",
  "pop3",
  "ftp",
  "mx",
  "ns",
  "ns1",
  "ns2",
  "autoconfig",
  "autodiscover",
  "yosher",
  "yosherapp",
  "support",
  "status",
  "test",
  "demo",
  "root",
  "localhost",
]);

/** Page paths the platform's routes shadow under `/sites/<slug>/…`. */
export const RESERVED_PAGE_PATHS: ReadonlySet<string> = new Set(["/draft", "/logo"]);

export type SlugCheck =
  | { ok: true; slug: string }
  | { ok: false; reason: "empty" | "short" | "long" | "shape" | "reserved" };

/**
 * "Oak Row Farm Co." → `oak-row-farm-co`; " Hilltop_Farm " → `hilltop-farm`.
 * Returns the reason when the result cannot be an address, so a screen can
 * say which rule was hit rather than "invalid".
 */
export function normalizeSiteSlug(input: string): SlugCheck {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug === "") return { ok: false, reason: "empty" };
  if (slug.length < SITE_SLUG_MIN) return { ok: false, reason: "short" };
  if (slug.length > SITE_SLUG_MAX) return { ok: false, reason: "long" };
  if (!SITE_SLUG_RE.test(slug)) return { ok: false, reason: "shape" };
  if (RESERVED_SITE_SLUGS.has(slug)) return { ok: false, reason: "reserved" };
  return { ok: true, slug };
}

export function slugReasonMessage(reason: Exclude<SlugCheck, { ok: true }>["reason"]): string {
  switch (reason) {
    case "empty":
      return "Give the site an address.";
    case "short":
      return `An address needs at least ${SITE_SLUG_MIN} characters.`;
    case "long":
      return `An address can be at most ${SITE_SLUG_MAX} characters.`;
    case "shape":
      return "Use letters, numbers and hyphens only.";
    case "reserved":
      return "That address is set aside. Choose another.";
  }
}

/**
 * The hostname label that names a site, or null when the request is for
 * the platform itself. `siteDomain` is `SITE_DOMAIN` (`yosher.site`),
 * compared without ports: `oak-row.localhost:3000` → `oak-row` when the site
 * domain is `localhost`, which is how a laptop tries host routing at all.
 *
 * Only ONE label is accepted. `a.b.yosher.site` is not a site, and neither is
 * the site domain's own apex or its `www`.
 */
export function hostToSiteSlug(host: string, siteDomain: string | null): string | null {
  if (!siteDomain) return null;
  const bare = host.toLowerCase().split(":")[0] ?? "";
  const domain = siteDomain.toLowerCase().split(":")[0] ?? "";
  if (bare === "" || domain === "" || !bare.endsWith(`.${domain}`)) return null;
  const label = bare.slice(0, -(domain.length + 1));
  if (label.includes(".") || label === "www") return null;
  if (!SITE_SLUG_RE.test(label) || RESERVED_SITE_SLUGS.has(label)) return null;
  return label;
}

/**
 * The domain free addresses hang off: `SITE_DOMAIN` in the environment
 * (`yosher.site` once one is bought and put on Vercel's nameservers). On a
 * laptop it defaults to `localhost`, because Chrome resolves
 * `anything.localhost` to the loopback address with no hosts-file edit — the
 * only way to try host routing without owning a domain. In production there
 * is NO default: an unset variable means host routing is off and every site
 * is reachable at `/sites/<slug>` on the platform host only.
 */
export function siteDomainFromEnv(
  env: { SITE_DOMAIN?: string; NODE_ENV?: string },
): string | null {
  const configured = env.SITE_DOMAIN?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "development" ? "localhost" : null;
}

/** How a rendered page is being reached, which decides what its links look like. */
export type SiteMode = "host" | "path" | "draft";

/** The prefix every in-site link carries in the given mode. */
export function siteBasePath(mode: SiteMode, slug: string): string {
  switch (mode) {
    case "host":
      return "";
    case "path":
      return `/sites/${slug}`;
    case "draft":
      return `/sites/${slug}/draft`;
  }
}

/** A link to a page path (`/`, `/about`) from wherever the site is being read. */
export function siteHref(mode: SiteMode, slug: string, path: string): string {
  const base = siteBasePath(mode, slug);
  if (path === "/" || path === "") return base === "" ? "/" : base;
  return `${base}${path}`;
}

/** `["about", "team"]` from the router → `/about/team`; nothing → `/`. */
export function pagePathFromSegments(segments: string[] | undefined): string {
  if (!segments || segments.length === 0) return "/";
  return `/${segments.join("/")}`;
}
