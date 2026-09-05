import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublishedSite, loadPublishedSiteByDomain, type PublicSite } from "@/lib/sites/read";
import { pagePathFromSegments, type SiteMode } from "@/lib/sites/slug";
import { SitePage } from "./site-page";

/**
 * The public routes share one body. Three route files exist only because a
 * page's LINKS depend on how it was reached — `/sites/<slug>` on the platform
 * host, root-relative on the site's free address, root-relative on a domain
 * the business connected — and that has to be static per route for the
 * cache to hold it.
 */
export type SiteSource = { by: "slug"; slug: string } | { by: "domain"; host: string };

function load(source: SiteSource): Promise<PublicSite | null> {
  return source.by === "slug"
    ? loadPublishedSite(source.slug)
    : loadPublishedSiteByDomain(source.host);
}

export async function publicSiteMetadata(
  source: SiteSource,
  segments: string[] | undefined,
): Promise<Metadata> {
  const site = await load(source);
  if (!site) return { robots: { index: false, follow: false } };
  const pagePath = pagePathFromSegments(segments);
  const page = site.pages.find((p) => p.path === pagePath);
  if (!page) return { robots: { index: false, follow: false } };
  const description = page.content.description || site.brand.tagline || undefined;
  return {
    // `absolute`: the root layout's "%s · Yosher" template is the platform's
    // name, and a customer's site must not carry it.
    title: { absolute: page.path === "/" ? site.title : `${page.title} · ${site.title}` },
    description,
    openGraph: { title: site.title, description, type: "website" },
    robots: { index: true, follow: true },
    // Whichever address the page was reached by, the business's own domain
    // is the one search engines should keep, once it is live.
    ...(site.customHost
      ? { alternates: { canonical: `https://${site.customHost}${pagePath === "/" ? "/" : pagePath}` } }
      : {}),
  };
}

export async function renderPublicSite(
  source: SiteSource,
  segments: string[] | undefined,
  mode: SiteMode,
) {
  const site = await load(source);
  if (!site) notFound();
  const page = site.pages.find((p) => p.path === pagePathFromSegments(segments));
  if (!page) notFound();
  return <SitePage site={site} page={page} mode={mode} />;
}
