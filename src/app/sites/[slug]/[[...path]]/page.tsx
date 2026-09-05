import { publicSiteMetadata, renderPublicSite } from "@/components/site/public-route";

/**
 * A tenant's public website, on the platform host: `/sites/<slug>/<path>`.
 *
 * Cached and regenerated at most every five minutes, and on demand the
 * moment the owner publishes (`revalidatePath` in the Marketing actions) —
 * so a stranger's visit costs a cache hit, not a database round trip per
 * page. Nothing here reads a header, a cookie or a search param, which is
 * what keeps it cacheable; the draft preview, which needs a session, is a
 * separate dynamic route.
 */
export const revalidate = 300;

type Params = Promise<{ slug: string; path?: string[] }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug, path } = await params;
  return publicSiteMetadata({ by: "slug", slug }, path);
}

export default async function PublicSitePage({ params }: { params: Params }) {
  const { slug, path } = await params;
  return renderPublicSite({ by: "slug", slug }, path, "path");
}
