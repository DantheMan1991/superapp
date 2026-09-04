import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublishedSite } from "@/lib/sites/read";
import { pagePathFromSegments, type SiteMode } from "@/lib/sites/slug";
import { SitePage } from "./site-page";

/**
 * The public routes share one body. Two route files exist only because a
 * page's LINKS depend on how it was reached — `/sites/<slug>` on the platform
 * host, or root-relative on the site's own hostname — and that has to be
 * static per route for the cache to hold it.
 */
export type PublicParams = Promise<{ slug: string; path?: string[] }>;

export async function publicSiteMetadata(
  params: PublicParams,
): Promise<Metadata> {
  const { slug, path } = await params;
  const site = await loadPublishedSite(slug);
  if (!site) return { robots: { index: false, follow: false } };
  const page = site.pages.find((p) => p.path === pagePathFromSegments(path));
  if (!page) return { robots: { index: false, follow: false } };
  const description = page.content.description || site.brand.tagline || undefined;
  return {
    // `absolute`: the root layout's "%s · Yosher" template is the platform's
    // name, and a customer's site must not carry it.
    title: { absolute: page.path === "/" ? site.title : `${page.title} · ${site.title}` },
    description,
    openGraph: { title: site.title, description, type: "website" },
    robots: { index: true, follow: true },
  };
}

export async function renderPublicSite(params: PublicParams, mode: SiteMode) {
  const { slug, path } = await params;
  const site = await loadPublishedSite(slug);
  if (!site) notFound();
  const page = site.pages.find((p) => p.path === pagePathFromSegments(path));
  if (!page) notFound();
  return <SitePage site={site} page={page} mode={mode} />;
}
