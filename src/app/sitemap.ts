import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

/**
 * The public funnel only.
 *
 * Everything under /dashboard, /admin, /api and /s is either behind auth or
 * carries its own credential in the URL, and robots.ts already disallows them.
 * A sitemap is an invitation to crawl, so it lists exactly the pages we want
 * indexed and nothing else — adding a page here is a deliberate act.
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
  ];
}
