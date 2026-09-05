import { notFound } from "next/navigation";
import { withTenant } from "@/db";
import { resolveTenantContext } from "@/lib/auth";
import { loadSiteDrafts, lookupSiteBySlug } from "@/lib/sites/read";
import { pagePathFromSegments } from "@/lib/sites/slug";
import { LiveDraft } from "@/components/site/live-draft";
import { SitePage } from "@/components/site/site-page";

/**
 * The draft, for the people who work here. Dynamic on purpose (a session is
 * read), never indexed, and 404 rather than 403 for a site that is not this
 * tenant's — a signed-in stranger learns nothing about whether the address
 * exists.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Draft preview",
  robots: { index: false, follow: false, nocache: true },
};

export default async function DraftSitePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; path?: string[] }>;
  searchParams: Promise<{ live?: string }>;
}) {
  const { slug, path } = await params;
  // `?live=1` is the editor's frame: the same page, redrawn as the owner types (slice 13).
  const live = (await searchParams).live === "1";
  const ctx = await resolveTenantContext();
  if (!ctx) notFound();
  const hit = await lookupSiteBySlug(slug);
  if (!hit || hit.tenantId !== ctx.tenant.id) notFound();
  const drafts = await withTenant(
    ctx.tenant.id,
    (tx) => loadSiteDrafts(tx, ctx.tenant.id),
    { role: ctx.role },
  );
  if (!drafts) notFound();
  const page = drafts.view.pages.find((p) => p.path === pagePathFromSegments(path));
  if (!page) notFound();
  const banner = (
    <div className="bg-amber-100 px-6 py-2 text-center text-sm text-amber-900">
      Draft preview. Only people signed in to {ctx.tenant.name} can see this;
      publish it from Marketing to put it on the internet.
    </div>
  );
  if (live) return <LiveDraft site={drafts.view} page={page} banner={banner} />;
  return <SitePage site={drafts.view} page={page} mode="draft" banner={banner} />;
}
