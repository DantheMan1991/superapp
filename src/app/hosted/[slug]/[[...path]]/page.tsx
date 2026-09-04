import {
  publicSiteMetadata,
  renderPublicSite,
  type PublicParams,
} from "@/components/site/public-route";

/**
 * The same page as `/sites/[slug]`, reached through a site's own hostname:
 * `src/proxy.ts` rewrites `<slug>.<SITE_DOMAIN>/<path>` here. Links render
 * root-relative because, to the visitor, the site IS the host. Reachable at
 * `/hosted/<slug>` on the platform host too, where those links would point
 * at the platform — harmless, and not an address anyone is given.
 */
export const revalidate = 300;

export async function generateMetadata({ params }: { params: PublicParams }) {
  return publicSiteMetadata(params);
}

export default async function HostedSitePage({ params }: { params: PublicParams }) {
  return renderPublicSite(params, "host");
}
