import type { MetadataRoute } from "next";

/**
 * The first robots.txt in the app, added for share links.
 *
 * A share URL contains its own credential, so it must never end up in a search
 * index — and crawlers reach URLs that were only ever pasted into a chat or an
 * email. The `/s/` rule is the point of this file.
 *
 * Note what is NOT disallowed: the marketing pages and /health-check are the
 * public funnel and must stay crawlable. Blanket-disallowing everything here
 * would quietly de-index the lead generator.
 *
 * robots.txt is a request, not a control. The real protections are the
 * unguessable token, the expiry, and `X-Robots-Tag: noindex` on the pages
 * themselves; this just keeps well-behaved crawlers away.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: ["/s/", "/dashboard/", "/admin/", "/api/"],
      },
    ],
  };
}
