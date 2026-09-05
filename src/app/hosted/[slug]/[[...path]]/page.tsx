import { publicSiteMetadata, renderPublicSite } from "@/components/site/public-route";

/**
 * The same page as `/sites/[slug]`, reached through a site's free address:
 * `src/proxy.ts` rewrites `<slug>.<SITE_DOMAIN>/<path>` here. Links render
 * root-relative because, to the visitor, the site IS the host. Reachable at
 * `/hosted/<slug>` on the platform host too, where those links would point
 * at the platform — harmless, and not an address anyone is given.
 */
export const revalidate = 300;

type Params = Promise<{ slug: string; path?: string[] }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug, path } = await params;
  return publicSiteMetadata({ by: "slug", slug }, path);
}

export default async function HostedSitePage({ params }: { params: Params }) {
  const { slug, path } = await params;
  return renderPublicSite({ by: "slug", slug }, path, "host");
}
