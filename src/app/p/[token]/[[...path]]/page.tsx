import { headers } from "next/headers";
import { withTenant } from "@/db";
import { hashIp } from "@/lib/public-token";
import { countPreviewView, GENERIC_GONE, resolvePreview } from "@/lib/sites/previews";
import { loadSiteDrafts } from "@/lib/sites/read";
import { pagePathFromSegments } from "@/lib/sites/slug";
import { SitePage } from "@/components/site/site-page";

/**
 * AN UNPUBLISHED SITE, SHOWN TO SOMEBODY WHO CANNOT SIGN IN (ADR 0046).
 *
 * The point of the website tool is handing a business its site; until this
 * existed the only way to show one was to publish it, because
 * `/sites/<slug>/draft` demands a member of that tenant. This is the link an
 * agency sends a client before anything is on the internet.
 *
 * PUBLIC, no auth. Every protection is in `resolvePreview`, and every failure
 * — unknown token, revoked, expired, malformed, a page that is not on the
 * site — renders THE SAME PAGE WITH THE SAME WORDS. A visitor holding a dud
 * token learns nothing about whether it was ever real, which is the same rule
 * `/s/[token]` keeps for documents.
 *
 * Never indexed. A draft on a public URL that a crawler found would be the
 * whole feature backwards.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Preview",
  robots: { index: false, follow: false, nocache: true },
};

function Gone() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-semibold">{GENERIC_GONE}</h1>
      <p className="text-sm text-muted-foreground">
        Ask whoever sent it to you for a new one.
      </p>
    </main>
  );
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

export default async function SitePreviewPage({
  params,
}: {
  params: Promise<{ token: string; path?: string[] }>;
}) {
  const { token, path } = await params;
  const hit = await resolvePreview(token, hashIp(await clientIp()));
  if (!hit.ok) return <Gone />;

  // Everything the visitor sees is read in the tenant's own context as
  // `staff`, exactly as the public site read is. The system hop above did the
  // token → tenant step and nothing else.
  const drafts = await withTenant(
    hit.tenantId,
    (tx) => loadSiteDrafts(tx, hit.tenantId, hit.siteId),
    { role: "staff" },
  );
  if (!drafts) return <Gone />;

  const page = drafts.view.pages.find((p) => p.path === pagePathFromSegments(path));
  // A page that is not on this site answers exactly as a dud token does.
  if (!page) return <Gone />;

  // Not awaited: a counter that fails must never cost somebody the page they
  // came for, and the owner's "have they looked yet?" is worth less than that.
  void countPreviewView(hit.previewId);

  const banner = (
    <div key="banner" className="bg-amber-100 px-6 py-2 text-center text-sm text-amber-900">
      A preview of a website that is not published yet. Only people with this
      link can see it.
    </div>
  );
  // `mode="preview"` with the TOKEN as the link key: every in-site link, and
  // every image, map and logo address, is then built as `/p/<token>/…`.
  // `draft` here would point the whole nav at `/sites/<slug>/draft`, the
  // members-only route the person holding this link cannot reach.
  return (
    <SitePage
      site={drafts.view}
      page={page}
      mode="preview"
      linkKey={token}
      banner={banner}
    />
  );
}
