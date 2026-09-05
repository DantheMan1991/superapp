import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  loadPublishedSite,
  loadPublishedSiteByDomain,
  lookupSiteByPreviousSlug,
  type PublicSite,
} from "@/lib/sites/read";
import { shareFacts, shareKey, siteBaseUrlFor } from "@/lib/sites/seo";
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

/**
 * An address the site used to have sends people on to the one it has now
 * (slice 11b), for the same page and the same kind of address. A current
 * slug always wins, so this runs only when nothing is at the address.
 */
async function sendOnIfMoved(source: SiteSource, segments: string[] | undefined, mode: SiteMode): Promise<void> {
  if (source.by !== "slug") return;
  const moved = await lookupSiteByPreviousSlug(source.slug);
  if (!moved || moved.status !== "published") return;
  const pagePath = pagePathFromSegments(segments);
  const base = siteBaseUrlFor({ slug: moved.slug, customHost: null }, mode, process.env);
  permanentRedirect(pagePath === "/" ? `${base}/` : `${base}${pagePath}`);
}

/** The share image's absolute address for this page, or none for a page that is not there. */
function shareImageFor(site: PublicSite, page: PublicSite["pages"][number], mode: SiteMode) {
  const base = siteBaseUrlFor(site, mode, process.env);
  const key = shareKey(shareFacts(site, page, base));
  return { url: `${base}/share/${key}`, width: 1200, height: 630, alt: page.path === "/" ? site.title : page.title };
}

/** The icon routes for this mode: the tab's, the home screen's. */
function iconsFor(mode: SiteMode, slug: string): Metadata["icons"] {
  const base = mode === "path" ? `/sites/${slug}/icon` : "/icon";
  return { icon: [{ url: `${base}/32`, sizes: "32x32", type: "image/png" }], apple: [{ url: `${base}/180`, sizes: "180x180" }] };
}

export async function publicSiteMetadata(
  source: SiteSource,
  segments: string[] | undefined,
  mode: SiteMode,
): Promise<Metadata> {
  const site = await load(source);
  if (!site) {
    await sendOnIfMoved(source, segments, mode);
    return { robots: { index: false, follow: false } };
  }
  const pagePath = pagePathFromSegments(segments);
  const page = site.pages.find((p) => p.path === pagePath);
  if (!page) return { robots: { index: false, follow: false } };
  const description = page.content.description || site.brand.tagline || undefined;
  const image = shareImageFor(site, page, mode);
  return {
    // `absolute`: the root layout's "%s · Yosher" template is the platform's
    // name, and a customer's site must not carry it.
    title: { absolute: page.path === "/" ? site.title : `${page.title} · ${site.title}` },
    description,
    openGraph: {
      title: page.path === "/" ? site.title : `${page.title} · ${site.title}`,
      description,
      type: "website",
      siteName: site.title,
      images: [image],
    },
    twitter: { card: "summary_large_image", title: image.alt, description, images: [image.url] },
    robots: { index: true, follow: true },
    icons: iconsFor(mode, site.slug),
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
  if (!site) {
    await sendOnIfMoved(source, segments, mode);
    notFound();
  }
  const page = site.pages.find((p) => p.path === pagePathFromSegments(segments));
  if (!page) notFound();
  return <SitePage site={site} page={page} mode={mode} />;
}
