import Link from "next/link";
import { Building2, Globe, Share2 } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { readSiteSettings } from "@/lib/sites/schema";
import { BUSINESS_BRAND_KEY, chooseBrand, listBrands } from "@/lib/social/brands";
import { channelTitle } from "@/lib/social/channels";
import { listChannels } from "@/modules/marketing/social-ops";
import { listSites } from "@/modules/marketing/site-ops";
import { toChannelView } from "@/modules/marketing/social-actions";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { ChannelsPanel } from "@/modules/marketing/components/channels-panel";
import { MarketingStrip } from "@/modules/marketing/components/marketing-strip";
import type { SocialNetwork } from "@/lib/sites/links";

export const dynamic = "force-dynamic";

/**
 * Social: the accounts a brand posts to (slice S0, ADR 0047).
 *
 * **Everything here is scoped to a BRAND**, which is one of the business's
 * websites or the business itself. One website and nothing shared means one
 * brand, and this screen then reads like the single-account tool every client
 * but the operator tenant needs.
 *
 * Nothing on this screen talks to a network. It is where an owner writes down
 * where their accounts are, who reads each one and how the brand sounds
 * there — the two things only a person knows, and the first thing the writer
 * will read when S2 arrives.
 */
export default async function SocialPage({
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
      // Every channel in the workspace, once: the counts on the picker need
      // them all, and a workspace holds at most a few dozen.
      channels: await listChannels(tx, ctx.tenant.id),
    }),
    { role: ctx.role },
  );

  const brands = listBrands(
    sites,
    ctx.tenant.name,
    channels.some((c) => c.siteId === null),
  );
  const { brand, showList } = chooseBrand(brands, asked);
  const canWrite = ctx.role === "owner";

  if (showList || !brand) {
    return (
      <div className="space-y-6">
        <MarketingStrip />
        <PageHeader
          icon={<Share2 />}
          title="Social"
          description="Each brand has its own accounts, its own readers and its own voice."
        />
        <Panel>
          <ul className="divide-y divide-divider">
            {brands.map((b) => {
              const mine = channels.filter((c) => c.siteId === b.siteId);
              return (
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
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{b.name}</span>
                        <span className="block truncate text-xs text-subtle-foreground">
                          {mine.length === 0
                            ? "No accounts yet"
                            : mine
                                .map((c) =>
                                  channelTitle({
                                    network: c.network as SocialNetwork,
                                    handle: c.handle,
                                    label: c.label,
                                  }),
                                )
                                .join(", ")}
                        </span>
                      </span>
                    </span>
                    <Badge variant="secondary">{mine.length}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    );
  }

  const mine = channels.filter((c) => c.siteId === brand.siteId);
  const views = await Promise.all(mine.map(toChannelView));
  // What that website's footer shows today, so a row can say when the mark is
  // already there and the button can stand down. A business-level brand has no
  // footer at all, which is why this is empty for it rather than guessed at.
  const site = brand.siteId ? sites.find((s) => s.id === brand.siteId) : undefined;
  const footerUrls = site
    ? readSiteSettings(site.settings).social.map((l) => ({ network: l.network, url: l.url }))
    : [];

  return (
    <div className="space-y-6">
      <MarketingStrip />
      <PageHeader
        icon={<Share2 />}
        title="Social"
        description={
          brands.length > 1
            ? `The accounts ${brand.name} posts from, who reads each one, and how it sounds there.`
            : "The accounts you post from, who reads each one, and how you sound there."
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
      <ChannelsPanel
        channels={views}
        siteId={brand.siteId}
        footerUrls={footerUrls}
        canWrite={canWrite}
      />
      <p className="max-w-prose text-sm text-muted-foreground">
        {brand.key === BUSINESS_BRAND_KEY
          ? "These belong to the business rather than to one website, so they are not offered for a footer."
          : "Showing an account in the footer and posting to it are two different things: removing it here leaves the mark on your website until you take it out there."}{" "}
        Yosher cannot post to any of these yet — that comes later, one network at a time.
      </p>
    </div>
  );
}
