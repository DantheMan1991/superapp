import type { HostKind } from "./slug";

/**
 * What search engines and browsers ask a site for besides its pages —
 * pure: robots, the sitemap, the structured data, the icon's sizes. The
 * routes and the renderer hand these an origin and get text back.
 */

/** The picture sizes a browser asks for: the tab, the home screen, the install. */
export const ICON_SIZES = [32, 180, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

export function iconSizeFrom(param: string): IconSize | null {
  const n = Number(param);
  return (ICON_SIZES as readonly number[]).includes(n) ? (n as IconSize) : null;
}

/**
 * Where the site lives for the request that reached it: root of the host on
 * a site host or a connected domain, `/sites/<slug>` on the platform.
 */
export function siteBaseUrl(origin: string, kind: HostKind, slug: string): string {
  const root = origin.replace(/\/+$/, "");
  return kind.kind === "platform" ? `${root}/sites/${slug}` : root;
}

export function robotsText(sitemapUrl: string): string {
  return ["User-agent: *", "Allow: /", "Disallow: /api/", `Sitemap: ${sitemapUrl}`, ""].join("\n");
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface SitemapEntry {
  loc: string;
  /** ISO 8601, or nothing. */
  lastmod?: string;
}

export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const urls = entries
    .map(
      (e) =>
        `  <url><loc>${escapeXml(e.loc)}</loc>${e.lastmod ? `<lastmod>${escapeXml(e.lastmod)}</lastmod>` : ""}</url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** A page's address under a base: the home page is the base itself. */
export function pageUrl(base: string, path: string): string {
  return path === "/" ? `${base}/` : `${base}${path}`;
}

export interface BusinessFacts {
  name: string;
  description: string;
  url: string;
  phone: string;
  email: string;
  /** Free text with line breaks. */
  address: string;
  pin: { lat: number; lng: number } | null;
  logoUrl: string | null;
  /** Profiles elsewhere. */
  sameAs: readonly string[];
}

/**
 * The home page's structured data: a LocalBusiness, saying only what the
 * settings say. Nothing is invented for a field the business left blank;
 * a blank field is left out rather than filled with a placeholder a
 * search engine would show.
 */
export function localBusinessJsonLd(facts: BusinessFacts): Record<string, unknown> {
  const out: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: facts.name,
    url: facts.url,
  };
  if (facts.description) out.description = facts.description;
  if (facts.phone) out.telephone = facts.phone;
  if (facts.email) out.email = facts.email;
  const address = facts.address.trim();
  if (address) out.address = address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(", ");
  if (facts.pin) out.geo = { "@type": "GeoCoordinates", latitude: facts.pin.lat, longitude: facts.pin.lng };
  if (facts.logoUrl) {
    out.logo = facts.logoUrl;
    out.image = facts.logoUrl;
  }
  if (facts.sameAs.length > 0) out.sameAs = [...facts.sameAs];
  return out;
}

/** JSON for a `<script type="application/ld+json">`: `<` escaped so a name cannot close the tag. */
export function jsonLdText(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** A short stable name for a picture that changes when its ingredients do (FNV-1a, 32 bits). */
export function hash32(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Where the site lives, as an absolute address, for what has to be absolute
 * (structured data, the share image): the connected domain when there is
 * one — the canonical, wherever the page was reached — else the free
 * address for a host, else the platform path.
 */
export function siteBaseUrlFor(
  site: { slug: string; customHost: string | null },
  mode: "path" | "host" | "draft",
  env: { NEXT_PUBLIC_APP_URL?: string; SITE_DOMAIN?: string; NODE_ENV?: string },
): string {
  if (site.customHost) return `https://${site.customHost}`;
  const app = (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const domain = env.SITE_DOMAIN?.trim() || (env.NODE_ENV === "development" ? "localhost" : "");
  if (mode === "host" && domain) {
    const url = new URL(app);
    return `${url.protocol}//${site.slug}.${domain}${url.port ? `:${url.port}` : ""}`;
  }
  return `${app}/sites/${site.slug}`;
}

/** The share image's ingredients: the words on it, the colour behind them, the mark in the corner. */
export interface ShareFacts {
  title: string;
  subtitle: string;
  host: string;
  colour: string;
  logoPathname: string | null;
}

/** What a page's share image says: the page's title over the site's, or the site's over its tagline on the home page. */
export function shareFacts(
  site: { title: string; brand: { tagline: string; primaryColor: string | null; logo: { pathname: string } | null } },
  page: { path: string; title: string },
  base: string,
): ShareFacts {
  const home = page.path === "/";
  return {
    title: home ? site.title : page.title,
    subtitle: home ? site.brand.tagline : site.title,
    host: base.replace(/^https?:\/\//, "").replace(/\/+$/, ""),
    colour: site.brand.primaryColor ?? "#1f2937",
    logoPathname: site.brand.logo?.pathname ?? null,
  };
}

/** The picture's name: its ingredients hashed, so a retitled page or a new colour is a new address. */
export function shareKey(facts: ShareFacts): string {
  return hash32([facts.title, facts.subtitle, facts.host, facts.colour, facts.logoPathname ?? ""].join("|"));
}
