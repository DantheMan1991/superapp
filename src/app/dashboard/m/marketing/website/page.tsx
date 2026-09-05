import Link from "next/link";
import { ExternalLink, Globe } from "lucide-react";
import { withTenant } from "@/db";
import { requireTenant } from "@/lib/auth";
import { requireModuleEnabled } from "@/lib/modules";
import { loadSiteDrafts } from "@/lib/sites/read";
import { normalizeSiteSlug, siteDomainFromEnv } from "@/lib/sites/slug";
import { dateInTimezone } from "@/lib/timezone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { MarketingStrip } from "@/modules/marketing/components/marketing-strip";
import { PagesPanel } from "@/modules/marketing/components/pages-panel";
import {
  BuildSiteForm,
  SiteDetailsForm,
  SiteSlugForm,
  SiteStatusButtons,
} from "@/modules/marketing/components/website-controls";

export const dynamic = "force-dynamic";

/**
 * The website screen: build it, look at it, publish it, keep its details
 * right. Editing what a page SAYS is slice 2's editor; here the words come
 * from the assistant and can be asked for again.
 */
export default async function WebsitePage() {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "marketing");
  const drafts = await withTenant(
    ctx.tenant.id,
    (tx) => loadSiteDrafts(tx, ctx.tenant.id),
    { role: ctx.role },
  );
  const canWrite = ctx.role === "owner";
  const siteDomain = siteDomainFromEnv(process.env);
  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  const hostUrl = (slug: string) =>
    siteDomain
      ? `${appUrl.protocol}//${slug}.${siteDomain}${appUrl.port ? `:${appUrl.port}` : ""}`
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Globe />}
        title="Website"
        description={
          drafts
            ? `${ctx.tenant.name}'s site, built from your brand kit and details.`
            : `A website for ${ctx.tenant.name}, written from your brand kit and the details you give it.`
        }
      />
      <MarketingStrip />

      {!drafts ? (
        <Panel className="space-y-4 p-6">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-heading">
              Build your website
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Three pages to start: home, about and contact. The words are
              written from your brand kit and the details below; the logo and
              colors come from your brand. Nothing goes on the internet until
              you publish it.
            </p>
          </div>
          {canWrite ? (
            <BuildSiteForm
              defaultSlug={normalizeSiteSlug(ctx.tenant.slug).ok ? ctx.tenant.slug : ""}
              siteDomain={siteDomain}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Only an owner can build the website.</p>
          )}
        </Panel>
      ) : (
        <>
          <Panel className="space-y-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-heading text-lg font-semibold tracking-heading">
                    {drafts.view.title}
                  </h2>
                  {drafts.site.status === "published" ? (
                    <Badge
                      variant="outline"
                      className="border-transparent bg-success/15 text-emerald-700 dark:text-emerald-300"
                    >
                      Published
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Draft</Badge>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {drafts.site.status === "published" && drafts.site.publishedAt
                    ? `On the internet since ${dateInTimezone(drafts.site.publishedAt, ctx.tenant.timezone)}.`
                    : "Not on the internet yet."}
                  {" "}
                  {drafts.site.copySource === "model"
                    ? "The words were written by Yosher's assistant from your brand kit; read them before you publish."
                    : "The words are the standard set; read them before you publish."}
                </p>
              </div>
              {canWrite && <SiteStatusButtons status={drafts.site.status} />}
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {hostUrl(drafts.site.slug) && (
                <div>
                  <dt className="text-xs text-muted-foreground">Address</dt>
                  <dd className="font-mono">{hostUrl(drafts.site.slug)}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-muted-foreground">
                  {hostUrl(drafts.site.slug) ? "Also at" : "Address"}
                </dt>
                <dd className="font-mono">/sites/{drafts.site.slug}</dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href={`/sites/${drafts.site.slug}/draft`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                  Preview the draft
                </Link>
              </Button>
              {drafts.site.status === "published" && (
                <Button asChild variant="outline" size="sm">
                  <Link href={hostUrl(drafts.site.slug) ?? `/sites/${drafts.site.slug}`} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    Open the live site
                  </Link>
                </Button>
              )}
            </div>
          </Panel>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-heading">Pages</h2>
              <p className="text-sm text-muted-foreground">
                Drag to set the menu order. A page&rsquo;s words wait for Publish; its
                place in the menu shows at once.
              </p>
            </div>
            <PagesPanel
              key={drafts.pages.map((p) => `${p.id}:${p.navOrder}`).join(",")}
              slug={drafts.site.slug}
              canWrite={canWrite}
              pages={drafts.view.pages.map((page) => {
                const row = drafts.pages.find((p) => p.path === page.path);
                return {
                  id: row?.id ?? page.path,
                  path: page.path,
                  title: page.title,
                  sections: page.content.sections.length,
                  published: row?.published !== null && row?.published !== undefined,
                };
              })}
            />
          </section>

          <section className="space-y-3">
            <h2 className="font-heading text-lg font-semibold tracking-heading">Details on the site</h2>
            <Panel className="p-6">
              {canWrite ? (
                <SiteDetailsForm title={drafts.site.title} settings={drafts.view.settings} />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Phone</dt><dd>{drafts.view.settings.phone || "None"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{drafts.view.settings.email || "None"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Address</dt><dd className="whitespace-pre-line">{drafts.view.settings.address || "None"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Hours</dt><dd>{drafts.view.settings.hoursLines.join("; ") || "None"}</dd></div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">Only an owner can change these.</p>
                </dl>
              )}
            </Panel>
          </section>

          {canWrite && (
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-semibold tracking-heading">Address</h2>
              <Panel className="p-6">
                <SiteSlugForm slug={drafts.site.slug} siteDomain={siteDomain} />
              </Panel>
            </section>
          )}
        </>
      )}
    </div>
  );
}
