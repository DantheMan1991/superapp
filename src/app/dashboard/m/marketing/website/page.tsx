import Link from "next/link";
import { Camera, ExternalLink, Globe, Plus } from "lucide-react";
import { withTenant } from "@/db";
import { templateFor } from "@/lib/site-templates/resolve";
import { requireTenant } from "@/lib/auth";
import { isModuleEnabled, requireModuleEnabled } from "@/lib/modules";
import { describeBooking } from "@/lib/sites/booking-core";
import { mapStatusLine } from "@/lib/sites/map-core";
import { readDomainRecords } from "@/lib/sites/domains";
import { listSiteEnquiries } from "@/lib/sites/enquiries";
import { readEnquiryAnswers } from "@/lib/sites/enquiry-schema";
import { undescribedPhotosOnPage } from "@/lib/sites/pages";
import { isStarterPhoto, pageSpots, shotLine, shotNotesFor, shotSummary } from "@/lib/sites/shots";
import { resolveBrand } from "@/lib/brand/core";
import { BUSINESS_KIT } from "@/lib/brand/owner";
import { chooseSite } from "@/lib/sites/choose";
import { loadSiteDrafts } from "@/lib/sites/read";
import { findKit } from "@/modules/marketing/kit-ops";
import { listSites } from "@/modules/marketing/site-ops";
import { BrandKitPanel } from "@/modules/marketing/components/brand-kit-panel";
import { DeleteSiteButton } from "@/modules/marketing/components/delete-site-controls";
import {
  RemoveOwnLookButton,
  StartOwnLookButton,
} from "@/modules/marketing/components/own-look-controls";
import { SiteList } from "@/modules/marketing/components/site-list";
import { listSiteViews } from "@/lib/sites/views";
import { summarizeViews } from "@/lib/sites/views-core";
import { normalizeSiteSlug, platformHostsFromEnv, siteDomainFromEnv } from "@/lib/sites/slug";
import { isVercelConfigured } from "@/lib/vercel/domains";
import { dateInTimezone, todayInTimezone } from "@/lib/timezone";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/app/page-header";
import { Panel } from "@/components/app/panel";
import { ConnectDomainForm, DomainRow } from "@/modules/marketing/components/domain-controls";
import { EnquiriesPanel } from "@/modules/marketing/components/enquiries-panel";
import { HeaderFooterForm, HeaderFooterSummary } from "@/modules/marketing/components/header-footer-form";
import { VisitorsPanel } from "@/modules/marketing/components/visitors-panel";
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
export default async function WebsitePage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string }>;
}) {
  const ctx = await requireTenant();
  await requireModuleEnabled(ctx.tenant.id, "marketing");
  const today = todayInTimezone(ctx.tenant.timezone);
  const asked = (await searchParams).site ?? "";

  /**
   * WHICH SITE THIS SCREEN IS ABOUT (ADR 0045).
   *
   * One site — every client today — opens straight into it and never learns
   * that a business may have several, which is the same promise ADR 0010 keeps
   * about companies. Several, and no site asked for, draws the list instead.
   * An id that is not this tenant's simply is not in `sites`, so it falls
   * through to the list rather than to an error: RLS already decided.
   */
  const sites = await withTenant(ctx.tenant.id, (tx) => listSites(tx, ctx.tenant.id), {
    role: ctx.role,
  });
  const { site: chosen, showList } = chooseSite(sites, asked);
  if (showList) return <SiteList sites={sites} canWrite={ctx.role === "owner"} />;

  const { drafts, enquiries, views, siteKit, businessKit } = await withTenant(
    ctx.tenant.id,
    async (tx) => {
      const drafts = chosen ? await loadSiteDrafts(tx, ctx.tenant.id, chosen.id) : null;
      // This site's OWN look, and the business look it falls back to
      // (ADR 0045). A null kit means the site wears the business's, which is
      // every site until somebody says otherwise.
      const siteKit = chosen
        ? await findKit(tx, ctx.tenant.id, { kind: "site", siteId: chosen.id })
        : null;
      const businessKit = await findKit(tx, ctx.tenant.id, BUSINESS_KIT);
      const enquiries = drafts ? await listSiteEnquiries(tx, ctx.tenant.id, drafts.site.id) : [];
      const views = drafts ? await listSiteViews(tx, ctx.tenant.id, drafts.site.id, today) : [];
      return { drafts, enquiries, views, siteKit, businessKit };
    },
    { role: ctx.role },
  );
  // Where a message's contact and follow-up can be opened: the panel links
  // there only when the module is on, since a switched-off module's page
  // is a 404. The records exist either way.
  const [crmOn, workOn] = drafts
    ? await Promise.all([isModuleEnabled(ctx.tenant.id, "crm"), isModuleEnabled(ctx.tenant.id, "work")])
    : [false, false];
  const canWrite = ctx.role === "owner";
  // What a site kit's blank look falls back to: the business kit's answers,
  // resolved exactly as the Marketing screen resolves a company's.
  const businessLook = resolveBrand({
    tenantName: ctx.tenant.name,
    business: businessKit,
    company: null,
  });
  const businessInherits = {
    look: businessLook.look,
    fontPairing: businessLook.fontPairing,
    buttonShape: businessLook.buttonShape,
  };
  // Where a photo belongs on each page, read from the drafts as they are now (slice 18).
  const starters = new Set(drafts?.images.filter((i) => isStarterPhoto(i.pathname)).map((i) => i.id) ?? []);
  const notes = shotNotesFor(templateFor(ctx.tenant.industry));
  const spotsByPath = Object.fromEntries((drafts?.view.pages ?? []).map((p) => [p.path, pageSpots({ path: p.path, content: p.content }, starters, notes)]));
  const shots = shotSummary(Object.values(spotsByPath).flat());
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
        title={sites.length > 1 && drafts ? drafts.site.title || drafts.site.slug : "Website"}
        description={
          drafts
            ? sites.length > 1
              ? `One of ${ctx.tenant.name}'s ${sites.length} websites.`
              : `${ctx.tenant.name}'s site, built from your brand kit and details.`
            : `A website for ${ctx.tenant.name}, written from your brand kit and the details you give it.`
        }
        actions={
          /* ADD A WEBSITE LIVES HERE, not on the list. The list is drawn only
             from two sites up, so a business with one had no way to build a
             second — the control has to be reachable from a site, not only
             from a list it cannot see. */
          canWrite && drafts ? (
            <div className="flex flex-wrap items-center gap-2">
              {sites.length > 1 && (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/dashboard/m/marketing/website">All websites</Link>
                </Button>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/m/marketing/website?site=new">
                  <Plus className="size-4" /> Add a website
                </Link>
              </Button>
            </div>
          ) : undefined
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
                  {`Built from the ${templateFor(ctx.tenant.industry).name} template. `}
                  {drafts.site.copySource === "model"
                    ? "The words were written by Yosher's assistant from your brand kit; read them before you publish."
                    : "The words are the template's own; read them before you publish."}
                </p>
              </div>
              {canWrite && <SiteStatusButtons siteId={drafts.site.id} status={drafts.site.status} />}
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
              siteId={drafts.site.id}
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
                  undescribed: undescribedPhotosOnPage(page.content).missing,
                  open: (spotsByPath[page.path] ?? []).filter((s) => s.status !== "photo").length,
                  published: row?.published !== null && row?.published !== undefined,
                };
              })}
            />
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-heading">Photos</h2>
              <p className="text-sm text-muted-foreground">
                Where a photo belongs on your pages, what to take there, and a way to put it in from your phone.
              </p>
            </div>
            <Panel className="flex flex-wrap items-center justify-between gap-4 p-5">
              <p className="text-sm">{shotLine(shots)}</p>
              <Button asChild variant="outline" size="sm">
                <Link href={`/dashboard/m/marketing/website/photos?site=${drafts.site.id}`}>
                  <Camera className="size-4" />
                  Open the shot list
                </Link>
              </Button>
            </Panel>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-heading">Messages</h2>
              <p className="text-sm text-muted-foreground">
                What people sent through the form on your site. Each one is a contact and
                a follow-up in your workspace, and was emailed to you.
              </p>
            </div>
            <Panel>
              <EnquiriesPanel
                canWrite={canWrite}
                crmOn={crmOn}
                workOn={workOn}
                rows={enquiries.map(({ enquiry, partyName, followUp }) => ({
                  id: enquiry.id,
                  name: enquiry.name,
                  email: enquiry.email,
                  phone: enquiry.phone,
                  message: enquiry.message,
                  answers: readEnquiryAnswers(enquiry.answers),
                  pagePath: enquiry.pagePath,
                  receivedOn: dateInTimezone(enquiry.createdAt, ctx.tenant.timezone),
                  partyId: enquiry.partyId,
                  partyName,
                  workItemId: enquiry.workItemId,
                  followUp,
                  notifyVia: enquiry.notifyVia,
                  booking:
                    enquiry.bookingStartsAt && enquiry.bookingEndsAt
                      ? {
                          title: enquiry.bookingTitle,
                          when: describeBooking(enquiry.bookingStartsAt, enquiry.bookingEndsAt, ctx.tenant.timezone),
                        }
                      : null,
                }))}
              />
            </Panel>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-heading">Visitors</h2>
              <p className="text-sm text-muted-foreground">
                How many people looked at your site in the last thirty days, and which pages.
              </p>
            </div>
            <Panel>
              <VisitorsPanel
                summary={summarizeViews(views, today)}
                titles={Object.fromEntries(drafts.view.pages.map((p) => [p.path, p.title]))}
              />
            </Panel>
          </section>

          <section className="space-y-3">
            <h2 className="font-heading text-lg font-semibold tracking-heading">Details on the site</h2>
            <Panel className="p-6">
              {canWrite ? (
                <SiteDetailsForm siteId={drafts.site.id} title={drafts.site.title} settings={drafts.view.settings} mapStatus={mapStatusLine(drafts.view.settings)} />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Phone</dt><dd>{drafts.view.settings.phone || "None"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Email</dt><dd>{drafts.view.settings.email || "None"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Address</dt><dd className="whitespace-pre-line">{drafts.view.settings.address || "None"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">On the map</dt><dd>{mapStatusLine(drafts.view.settings)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Hours</dt><dd>{drafts.view.settings.hoursLines.join("; ") || "None"}</dd></div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">Only an owner can change these.</p>
                </dl>
              )}
            </Panel>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-heading">Header and footer</h2>
              <p className="text-sm text-muted-foreground">
                What every page shares: a line across the top, a button in the header, your pages
                elsewhere, and the footer&rsquo;s columns. Saved changes show on the site straight away.
              </p>
            </div>
            <Panel className="p-6">
              {canWrite ? (
                <HeaderFooterForm siteId={drafts.site.id} settings={drafts.view.settings} />
              ) : (
                <HeaderFooterSummary settings={drafts.view.settings} />
              )}
            </Panel>
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="font-heading text-lg font-semibold tracking-heading">Your own domain</h2>
              <p className="text-sm text-muted-foreground">
                Point a domain you already own at this site. Your free address keeps
                working alongside it.
              </p>
            </div>
            <Panel className="divide-y divide-divider">
              {drafts.domains.map((d) => (
                <DomainRow
                  key={d.id}
                  canWrite={canWrite}
                  row={{
                    id: d.id,
                    domain: d.domain,
                    status: d.status === "active" || d.status === "error" ? d.status : "pending",
                    records: readDomainRecords(d.records),
                    vercelVerified: d.vercelVerified,
                    vercelConfiguredBy: d.vercelConfiguredBy,
                    lastError: d.lastError,
                    lastCheckedAt: d.lastCheckedAt?.toISOString() ?? null,
                  }}
                />
              ))}
              {canWrite ? (
                <div className="p-5">
                  <ConnectDomainForm
                    siteId={drafts.site.id}
                    enabled={isVercelConfigured()}
                    platformHosts={platformHostsFromEnv(process.env)}
                    siteDomain={siteDomain}
                  />
                </div>
              ) : (
                drafts.domains.length === 0 && (
                  <p className="p-5 text-sm text-muted-foreground">No domain connected yet.</p>
                )
              )}
            </Panel>
          </section>

          {canWrite && (
            <section className="space-y-3">
              <h2 className="font-heading text-lg font-semibold tracking-heading">Address</h2>
              <Panel className="p-6">
                <SiteSlugForm siteId={drafts.site.id} slug={drafts.site.slug} siteDomain={siteDomain} />
              </Panel>
            </section>
          )}

          {/* THIS SITE'S LOOK (ADR 0045). A site with no kit of its own wears
              the business's, which is the common case and says so rather than
              drawing an empty form. The panel is the same one the Marketing
              screen draws for the business and for a company — one editor,
              three owners. */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-heading text-lg font-semibold tracking-heading">
                This website&apos;s look
              </h2>
              {canWrite && siteKit && (
                <RemoveOwnLookButton
                  owner={{ kind: "site", siteId: drafts.site.id }}
                  name={drafts.site.title || drafts.site.slug}
                />
              )}
            </div>
            {siteKit ? (
              <BrandKitPanel
                tenantId={ctx.tenant.id}
                owner={{ kind: "site", siteId: drafts.site.id }}
                kit={siteKit}
                resolved={resolveBrand({
                  tenantName: ctx.tenant.name,
                  business: businessKit,
                  company: siteKit,
                })}
                inherits={businessInherits}
                fallbackName={drafts.site.title || ctx.tenant.name}
                canWrite={canWrite}
              />
            ) : (
              <Panel className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <div className="font-medium">Uses your brand.</div>
                  <div className="text-sm text-muted-foreground">
                    Its name, colors, fonts and logo are your business&apos;s. Give
                    it its own to run this site as a separate brand.
                  </div>
                </div>
                {canWrite && (
                  <StartOwnLookButton
                    owner={{ kind: "site", siteId: drafts.site.id }}
                    name={drafts.site.title || drafts.site.slug}
                  />
                )}
              </Panel>
            )}
          </section>

          {/* Removing it. Last on the screen and owner-only, because it is the
              one control here that cannot be undone. The counts come from what
              the screen already loaded, so the confirm can say what goes
              without a second read. */}
          {canWrite && (
            <section className="space-y-2">
              <h2 className="font-heading text-lg font-semibold tracking-heading">
                Delete this website
              </h2>
              <Panel className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div className="text-sm text-muted-foreground">
                  Its pages, photos and messages go with it, and it cannot be
                  undone. Your customers and follow-ups are kept.
                </div>
                <DeleteSiteButton
                  siteId={drafts.site.id}
                  name={drafts.site.title || drafts.site.slug}
                  counts={{
                    pages: drafts.pages.length,
                    photos: drafts.images.length,
                    enquiries: enquiries.length,
                  }}
                />
              </Panel>
            </section>
          )}
        </>
      )}
    </div>
  );
}
