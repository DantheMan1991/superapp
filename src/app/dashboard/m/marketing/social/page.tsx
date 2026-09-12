import Link from "next/link";
import { Building2, Globe, Share2 } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { BUSINESS_BRAND_KEY, chooseBrand, listBrands } from "@/lib/social/brands";
import { todayInTimezone } from "@/lib/timezone";
import { listChannels } from "@/modules/marketing/social-ops";
import { listPostsFor } from "@/modules/marketing/post-ops";
import { toPostView } from "@/modules/marketing/post-actions";
import { listSites } from "@/modules/marketing/site-ops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { MarketingStrip } from "@/modules/marketing/components/marketing-strip";
import { PostsPanel } from "@/modules/marketing/components/posts-panel";

export const dynamic = "force-dynamic";

/**
 * Social: what this brand is posting, and when (slice S1).
 *
 * THE DAILY SCREEN, which is why it took `/social` from the accounts in S1 —
 * where the accounts ARE is written down once; what to post is the work. The
 * accounts moved one segment deeper.
 *
 * Nothing here posts. A scheduled post becomes a Work item at its time
 * (`post-reminders.ts`), and the owner copies the words, saves the picture and
 * posts it themselves.
 */
export default async function SocialPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "marketing");
  const asked = (await searchParams).brand ?? "";

  const { sites, channels } = await withTenant(
    ctx.tenant.id,
    async (tx) => ({
      sites: await listSites(tx, ctx.tenant.id),
      channels: await listChannels(tx, ctx.tenant.id),
    }),
    { role: ctx.role },
  );

  const brands = listBrands(sites, ctx.tenant.name, channels.some((c) => c.siteId === null));
  const { brand, showList } = chooseBrand(brands, asked);
  const canWrite = ctx.role === "owner";

  if (showList || !brand) {
    return (
      <div className="space-y-6">
        <MarketingStrip />
        <PageHeader
          icon={<Share2 />}
          title="Social"
          description="Each brand posts on its own accounts, in its own voice."
        />
        <Panel>
          <ul className="divide-y divide-divider">
            {brands.map((b) => (
              <li key={b.key}>
                {/* The row is the link (design-system.md, 2026-09-06). */}
                <Link
                  href={`/dashboard/m/marketing/social?brand=${b.key}`}
                  className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-module-accent/10 text-module-accent">
                      {b.siteId ? <Globe className="size-4" /> : <Building2 className="size-4" />}
                    </span>
                    <span className="block truncate font-medium">{b.name}</span>
                  </span>
                  <Badge variant="secondary">
                    {channels.filter((c) => c.siteId === b.siteId).length}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    );
  }

  const posts = await withTenant(
    ctx.tenant.id,
    (tx) => listPostsFor(tx, ctx.tenant.id, brand.siteId),
    { role: ctx.role },
  );
  const views = await Promise.all(posts.map(toPostView));
  // Only ACTIVE accounts are offered for a new post: a paused one is set aside
  // on purpose, and offering it here would be the pause meaning nothing.
  const mine = channels.filter((c) => c.siteId === brand.siteId && c.status === "active");
  const accountsHref = `/dashboard/m/marketing/social/accounts${
    brands.length > 1 ? `?brand=${brand.key}` : ""
  }`;

  return (
    <div className="space-y-6">
      <MarketingStrip />
      <PageHeader
        icon={<Share2 />}
        title="Social"
        description={
          brands.length > 1
            ? `What ${brand.name} is posting, and when.`
            : "What you are posting, and when."
        }
        actions={
          <Button asChild variant="outline">
            <Link href={accountsHref}>Accounts</Link>
          </Button>
        }
      />
      {brands.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Brand</span>
          {brands.map((b) => (
            <Link
              key={b.key}
              href={`/dashboard/m/marketing/social?brand=${b.key}`}
              className={
                b.key === brand.key
                  ? "rounded-full bg-module-accent/10 px-3 py-1 font-medium text-module-accent"
                  : "rounded-full px-3 py-1 text-muted-foreground hover:bg-muted/50"
              }
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}
      <PostsPanel
        posts={views}
        channels={mine.map((c) => ({
          id: c.id,
          network: c.network,
          handle: c.handle,
          label: c.label,
        }))}
        today={todayInTimezone(ctx.tenant.timezone)}
        timezone={ctx.tenant.timezone}
        canWrite={canWrite}
      />
      <p className="max-w-prose text-sm text-muted-foreground">
        {brand.key === BUSINESS_BRAND_KEY
          ? "These posts go out on the business's own accounts rather than any one website's."
          : "Yosher reminds you when a scheduled post is due, in What needs you."}{" "}
        It cannot post for you yet — copy the words, save the picture, post it, then mark it posted.
      </p>
    </div>
  );
}
