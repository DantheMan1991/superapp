import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { listSiteImages } from "@/lib/sites/read";
import { listSites } from "@/modules/marketing/site-ops";
import { findPostById } from "@/modules/marketing/post-ops";
import { toPostView } from "@/modules/marketing/post-actions";
import { PageHeader } from "@/components/app/page-header";
import { PostEditor } from "@/modules/marketing/components/post-editor";

export const dynamic = "force-dynamic";

/**
 * One post (slice S1).
 *
 * **WHICH PHOTOS THIS BRAND MAY USE.** A library belongs to a WEBSITE
 * (`site_images`, ADR 0023), and a channel belongs to a website or to the
 * business (ADR 0047) — so a brand with a site offers that site's photos, and
 * the business's own accounts offer every site's, because those are all the
 * business's pictures and there is no separate place for them to live. A
 * business with no website at all has no photos to offer, and the screen says
 * where they come from rather than showing an empty box.
 */
export default async function SocialPostPage({
  params,
}: {
  params: Promise<{ postId: string }>;
}) {
  const { postId } = await params;
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "marketing");

  const loaded = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const found = await findPostById(tx, ctx.tenant.id, postId);
      if (!found) return null;
      const sites = await listSites(tx, ctx.tenant.id);
      // The brand's own site, or — for a business-level account — all of them.
      const from = found.channel.siteId
        ? sites.filter((s) => s.id === found.channel.siteId)
        : sites;
      const images = (
        await Promise.all(from.map((s) => listSiteImages(tx, ctx.tenant.id, s.id)))
      ).flat();
      return { found, images, siteId: found.channel.siteId };
    },
    { role: ctx.role },
  );
  // A post id that is not this tenant's is simply absent under RLS, so this is
  // the same 404 as one that never existed — no separate "not yours" answer.
  if (!loaded) notFound();

  const view = await toPostView(loaded.found);
  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/m/marketing/social"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" /> Back to social
      </Link>
      <PageHeader
        title="A post"
        description="Write it, put a picture on it, and say when it goes out."
      />
      <PostEditor
        post={view}
        library={loaded.images.map((i) => ({ id: i.id, width: i.width, height: i.height }))}
        photosHref={
          loaded.siteId
            ? `/dashboard/m/marketing/website/photos?site=${loaded.siteId}`
            : null
        }
        timezone={ctx.tenant.timezone}
        canWrite={ctx.role === "owner"}
      />
    </div>
  );
}
