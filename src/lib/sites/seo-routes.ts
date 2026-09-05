import "server-only";
import { loadPublishedSite, loadPublishedSiteByDomain, type PublicSite } from "./read";
import { pageUrl, robotsText, siteBaseUrl, sitemapXml } from "./seo";
import { classifyHost, platformHostsFromEnv, siteDomainFromEnv } from "./slug";

/**
 * robots.txt and sitemap.xml for one site (slice 11). A crawler asks the
 * HOST for them, so on a site host or a connected domain the proxy rewrites
 * `/robots.txt` and `/sitemap.xml` here; on the platform host they are
 * reachable as `/sites/<slug>/robots.txt` and list the platform-path
 * addresses. A published site only; anything else is a 404, which robots
 * read as "no rules" and which says nothing about which addresses exist.
 *
 * The addresses listed are the ones the request came in by, except that a
 * connected domain is the canonical one wherever the page was reached, so
 * a sitemap fetched at the free address still points search engines at the
 * domain, as the pages' `canonical` does.
 */
export type SiteSource = { by: "slug"; slug: string } | { by: "domain"; host: string };

function load(source: SiteSource): Promise<PublicSite | null> {
  return source.by === "slug" ? loadPublishedSite(source.slug) : loadPublishedSiteByDomain(source.host);
}

/** The origin the visitor used, through Vercel's proxy headers, else the request's own. */
function originOf(req: Request): string {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

function baseFor(req: Request, site: PublicSite): string {
  if (site.customHost) return `https://${site.customHost}`;
  const origin = originOf(req);
  const kind = classifyHost(new URL(origin).host, {
    siteDomain: siteDomainFromEnv(process.env),
    platformHosts: platformHostsFromEnv(process.env),
  });
  return siteBaseUrl(origin, kind, site.slug);
}

const notFound = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });

export async function robotsResponse(source: SiteSource, req: Request): Promise<Response> {
  const site = await load(source);
  if (!site) return notFound();
  return new Response(robotsText(`${baseFor(req, site)}/sitemap.xml`), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600" },
  });
}

export async function sitemapResponse(source: SiteSource, req: Request): Promise<Response> {
  const site = await load(source);
  if (!site) return notFound();
  const base = baseFor(req, site);
  const lastmod = site.publishedAt?.toISOString();
  const entries = [...site.pages]
    .sort((a, b) => a.navOrder - b.navOrder)
    .map((p) => ({ loc: pageUrl(base, p.path), lastmod }));
  return new Response(sitemapXml(entries), {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300, s-maxage=3600" },
  });
}
