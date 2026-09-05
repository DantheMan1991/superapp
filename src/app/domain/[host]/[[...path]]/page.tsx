import { notFound } from "next/navigation";
import { publicSiteMetadata, renderPublicSite } from "@/components/site/public-route";
import { DOMAIN_RE } from "@/lib/sites/domains";

/**
 * A tenant's public website, reached through a domain the business
 * connected: `src/proxy.ts` rewrites every request for a hostname that is
 * not the platform's own here, and the page resolves the host to a site
 * through the one trusted lookup — or answers 404, which is what a hostname
 * nobody connected deserves. Links render root-relative, as on the free
 * address. Cached like the other public routes.
 */
export const revalidate = 300;

type Params = Promise<{ host: string; path?: string[] }>;

function hostOf(raw: string): string | null {
  const host = decodeURIComponent(raw).toLowerCase();
  return DOMAIN_RE.test(host) ? host : null;
}

export async function generateMetadata({ params }: { params: Params }) {
  const { host: raw, path } = await params;
  const host = hostOf(raw);
  if (!host) return { robots: { index: false, follow: false } };
  return publicSiteMetadata({ by: "domain", host }, path);
}

export default async function DomainSitePage({ params }: { params: Params }) {
  const { host: raw, path } = await params;
  const host = hostOf(raw);
  if (!host) notFound();
  return renderPublicSite({ by: "domain", host }, path, "host");
}
