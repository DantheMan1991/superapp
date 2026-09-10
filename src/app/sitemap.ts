import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";
import { listVerticals } from "@/lib/verticals";

/**
 * The public funnel only.
 *
 * Everything under /dashboard, /admin, /api and /s is either behind auth or
 * carries its own credential in the URL, and robots.ts already disallows them.
 * A sitemap is an invitation to crawl, so it lists exactly the pages we want
 * indexed and nothing else — adding a page here is a deliberate act.
 *
 * The industry pages are the one exception to "deliberate act", and it is a
 * deliberate exception: they come from the registry, so a new industry is
 * crawlable the day its data file lands. A vertical page nobody submitted is
 * the whole reason it exists.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE.url, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE.url}/about`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE.url}/contact`, changeFrequency: "yearly", priority: 0.7 },
    {
      url: `${SITE.url}/health-check`,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    { url: `${SITE.url}/for`, changeFrequency: "monthly", priority: 0.8 },
    ...listVerticals().map((vertical) => ({
      url: `${SITE.url}/for/${vertical.slug}`,
      changeFrequency: "monthly" as const,
      // Level with the health check: for a visitor who searched their own
      // trade, this is the page that answers them.
      priority: 0.9,
    })),
  ];
}
