import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { foregroundOn } from "@/lib/brand/core";
import { lookRadiusVars, resolveLook } from "@/lib/brand/looks";
import type { PublicSite } from "@/lib/sites/read";
import { eventDate, eventKey, eventWhen, upcomingEvents } from "@/lib/sites/events-core";
import { blockKey } from "@/lib/site-blocks/core";
import { completeQuestions, completeQuotes, faqJsonLd, logoSizeClass } from "@/lib/sites/proof";
import { isSafeHref } from "@/lib/sites/links";
import { directionsUrl, MAP_ATTRIBUTION, MAP_HEIGHT, MAP_WIDTH, mapKey, pinIsFor } from "@/lib/sites/map-core";
import type { ImageRef, Section, SectionStyle, SitePageView, SiteSettings } from "@/lib/sites/schema";
import { SECTION_ATTR } from "@/lib/sites/preview";
import { jsonLdText, localBusinessJsonLd, siteBaseUrlFor, type BusinessFacts } from "@/lib/sites/seo";
import { isLiveMode, siteHref, type SiteMode } from "@/lib/sites/slug";
import type { Slide } from "@/lib/sites/slides";
import {
  backgroundClass,
  heroHeightClass,
  LIGHT_TONE,
  resolveStyle,
  spacingClass,
  toneFor,
  widthClass,
  type ResolvedStyle,
  type SectionDefaults,
  type Tone,
} from "@/lib/sites/style";
import { cn } from "@/lib/utils";
import { BookingForm } from "./booking-form";
import { CardIcon } from "./card-icons";
import { DraftSelect } from "./draft-select";
import { EnquiryForm } from "./enquiry-form";
import { siteFonts } from "./site-fonts";
import { Gallery, Slideshow } from "./slideshow";
import { SocialLinks } from "./social-icons";
import { ViewBeacon } from "./view-beacon";

/**
 * The public renderer: one page of a tenant's site, from its typed sections.
 *
 * Server components, and nothing here is markup a tenant wrote — every
 * string arrives through the content model and React escapes it. The client
 * islands are the view beacon, the enquiry form (a pending state and a
 * thank-you) and the slideshow and gallery lightbox (`slideshow.tsx`, the
 * page's one moving part). The brand's colours enter as CSS variables on
 * the root so the sections never learn a hex value.
 *
 * Every section sits in a `Shell` that resolves its layout presets
 * (`src/lib/sites/style.ts`): the band behind it, the column its words sit
 * in, the room around it, and the TONE — the colours its words take so they
 * stay readable on a tint, the brand colour, a dark band or a photo.
 *
 * `mode` decides what a link looks like: on the site's own hostname links
 * are root-relative, on the platform host they carry `/sites/<slug>`, and in
 * the draft preview `/sites/<slug>/draft`.
 */

/** Every section's heading, one scale (slice 17): large enough to carry a band on its own. */
const H2 = "text-3xl font-semibold tracking-tight sm:text-4xl";

export function logoSrc(mode: SiteMode, slug: string): string {
  // On a site host the proxy maps `/logo` to the site's logo route; on the
  // platform host the route is addressed directly.
  // The logo route resolves by slug for any site, published or not, so a
  // preview needs no route of its own for it.
  if (mode === "host") return "/logo";
  if (mode === "preview") return `/p/${slug}/logo`;
  return `/sites/${slug}/logo`;
}

/**
 * A photo's address for this mode. On a site host the proxy maps
 * `/images/<id>` to the site's image route; on the platform host the route
 * is addressed directly; the draft preview reads the member route, so a
 * photo on an unpublished site is seen only by the people who put it there.
 */
export function imageSrc(mode: SiteMode, key: string, id: string): string {
  if (mode === "host") return `/images/${id}`;
  if (mode === "draft") return `/api/marketing/sites/images/${id}`;
  // A preview is authorized by its token, not by a session or by the site
  // being published — the two ways an image is otherwise reachable, and a
  // client can use neither.
  if (mode === "preview") return `/p/${key}/images/${id}`;
  return `/sites/${key}/images/${id}`;
}

/** What the settings say about the business, for the structured data. */
function businessFacts(site: PublicSite, mode: SiteMode): BusinessFacts {
  const base = siteBaseUrlFor(site, mode, process.env);
  const address = site.settings.address.trim();
  return {
    name: site.title,
    description: site.brand.tagline,
    url: `${base}/`,
    phone: site.settings.phone,
    email: site.settings.email,
    address,
    pin: pinIsFor(site.settings.map, address) ? site.settings.map : null,
    logoUrl: site.brand.logo ? `${base}/logo` : null,
    sameAs: site.settings.social.map((s) => s.url),
  };
}

/** The map picture's address for this mode, keyed by the pin, the zoom and the colour (`src/lib/sites/map.ts`). */
export function mapSrc(mode: SiteMode, key: string, mapKey: string, siteId?: string): string {
  if (mode === "host") return `/map/${mapKey}`;
  // The member route serves any of the tenant's sites, so it has to be told
  // which one (ADR 0045); the preview route already knows from its token.
  if (mode === "draft") return `/api/marketing/sites/map/${mapKey}?site=${siteId ?? ""}`;
  if (mode === "preview") return `/p/${key}/map/${mapKey}`;
  return `/sites/${key}/map/${mapKey}`;
}

/**
 * An in-site path becomes a link for this mode and the other three shapes
 * pass through; anything else is no link at all, whatever a row holds
 * (`src/lib/sites/links.ts`).
 */
export function resolveHref(mode: SiteMode, slug: string, href: string): string | null {
  if (!isSafeHref(href)) return null;
  if (href.startsWith("/")) return siteHref(mode, slug, href);
  return href;
}

export function SitePage({
  site: given,
  page,
  mode,
  banner,
  linkKey,
}: {
  site: PublicSite;
  page: SitePageView;
  mode: SiteMode;
  /**
   * What in-site links address the site by. The slug for every mode but
   * `preview`, which is addressed by its token — a preview whose nav pointed
   * at the slug would send the client to the members-only draft route.
   */
  linkKey?: string;
  /** Above the header: the draft preview's notice. */
  banner?: ReactNode;
}) {
  /**
   * HOW THIS SITE IS ADDRESSED IN THIS MODE. Everything below builds links
   * and asset URLs from `site.slug`, in a dozen places across thirteen
   * components — so rather than thread a second key through all of them and
   * miss one silently, the slug IS the key: for a preview it is the token,
   * and `/p/<token>/…` mirrors `/sites/<slug>/…` for pages, images, the map
   * and the logo.
   *
   * The two things that need the real slug are both switched off in preview
   * anyway: the visitor beacon (`isLiveMode`) and the forms (`disabled`).
   */
  const site = linkKey ? { ...given, slug: linkKey } : given;
  const primary = site.brand.primaryColor ?? "#1f2937";
  const accent = site.brand.accentColor ?? primary;
  // The look (slice 6d): the fonts as bundled families, the corners as variables the classes read.
  const look = resolveLook(site.brand);
  const fonts = siteFonts(look.fontPairing);
  const style = {
    "--site-primary": primary,
    "--site-primary-fg": foregroundOn(primary),
    "--site-accent": accent,
    "--site-font-heading": fonts.heading,
    "--site-font-body": fonts.body,
    ...lookRadiusVars(look),
  } as CSSProperties;
  return (
    <div style={style} className={cn("site-root flex min-h-screen flex-col bg-white text-neutral-900", fonts.className)}>
      {banner}
      {/* The draft preview is the owner looking, not a visitor: no count, and a way to point at a section. */}
      {mode === "draft" && <DraftSelect />}
      {/* Only a real visit counts. A preview is one client looking at
          their own site, and counting it would make the owner's
          visitor numbers a lie on day one. */}
      {isLiveMode(mode) && <ViewBeacon slug={site.slug} path={page.path} />}
      {/* The home page tells search engines what the settings say about the business (slice 11). */}
      {page.path === "/" && isLiveMode(mode) && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdText(localBusinessJsonLd(businessFacts(site, mode))) }}
        />
      )}
      {/* Answered questions on the page, for search engines (slice 16). */}
      {isLiveMode(mode) &&
        page.content.sections
          .filter((s) => s.type === "faq")
          .map((s) => (s.type === "faq" ? faqJsonLd(s.items) : null))
          .filter((ld): ld is Record<string, unknown> => ld !== null)
          .map((ld, i) => <script key={`faq-${i}`} type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdText(ld) }} />)}
      <Announcement site={site} mode={mode} />
      <SiteHeader site={site} mode={mode} pagePath={page.path} primary={primary} accent={accent} />

      <main className="flex-1">
        {page.content.sections.map((section, i) => (
          <SectionView key={i} section={section} site={site} mode={mode} pagePath={page.path} sectionIndex={i} />
        ))}
      </main>

      <SiteFooter site={site} mode={mode} />
    </div>
  );
}

/**
 * The frame around every page — the bar across the top, the header and the
 * footer — reads the site's settings live, as the contact section does:
 * nothing here waits for a publish.
 */
function Announcement({ site, mode }: { site: PublicSite; mode: SiteMode }) {
  const bar = site.settings.announcement;
  if (!bar.shown || !bar.text) return null;
  const to = bar.href ? resolveHref(mode, site.slug, bar.href) : null;
  return (
    <div
      role="region"
      aria-label="Announcement"
      className="px-6 py-2 text-center text-sm font-medium"
      style={{ backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" }}
    >
      {to ? (
        <Link href={to} className="underline decoration-1 underline-offset-4 hover:decoration-2">
          {bar.text}
        </Link>
      ) : (
        bar.text
      )}
    </div>
  );
}

/** The logo or the name, the menu, and the owner's button at the end of it. */
function SiteHeader({
  site,
  mode,
  pagePath,
  primary,
  accent,
}: {
  site: PublicSite;
  mode: SiteMode;
  pagePath: string;
  primary: string;
  accent: string;
}) {
  const nav = site.pages
    .filter((p) => p.inNav)
    .sort((a, b) => a.navOrder - b.navOrder);
  const href = (path: string) => siteHref(mode, site.slug, path);
  const button = site.settings.headerButton;
  const buttonHref = button ? resolveHref(mode, site.slug, button.href) : null;
  const folds = nav.length > 1;
  const headerButton =
    button && buttonHref ? (
      <Link
        href={buttonHref}
        className="inline-block rounded-[var(--site-radius-button)] px-4 py-2 text-sm font-medium shadow-sm"
        style={LIGHT_TONE.button}
      >
        {button.label}
      </Link>
    ) : null;
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-x-6 px-6 py-4">
        <Link href={href("/")} className="flex min-w-0 items-center gap-3">
          {site.brand.logo ? (
            // Our own logo route, public by definition (ADR 0018); the
            // optimiser would only add a hop in front of a cached file.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc(mode, site.slug)}
              alt={site.title}
              className={cn("w-auto object-contain", logoSizeClass(site.settings.logoSize))}
            />
          ) : (
            <span className="truncate text-lg font-semibold" style={{ color: primary }}>
              {site.title}
            </span>
          )}
        </Link>
        {(folds || headerButton) && (
          <>
            {/* A wide screen: the pages in a row and the button at the end, as ever. */}
            <div className={cn("items-center gap-x-6", folds ? "hidden md:flex" : "flex")}>
              {folds && (
                <nav aria-label="Site" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                  {nav.map((p) => {
                    const current = p.path === pagePath;
                    return (
                      <Link
                        key={p.path}
                        href={href(p.path)}
                        aria-current={current ? "page" : undefined}
                        className="border-b-2 py-1 transition-colors hover:text-neutral-900"
                        style={{
                          borderColor: current ? accent : "transparent",
                          color: current ? "#171717" : "#525252",
                        }}
                      >
                        {p.title}
                      </Link>
                    );
                  })}
                </nav>
              )}
              {headerButton}
            </div>
            {/*
             * A phone (slice 14): the button stays in the row and the pages
             * fold behind a Menu button. A native disclosure, so it needs no
             * script (ADR 0019 keeps the page's scripts few), opens and
             * closes from the keyboard, and closes by itself when a page is
             * chosen, because the next page is a new document.
             */}
            {folds && (
              <div className="flex shrink-0 items-center gap-3 md:hidden">
                {headerButton}
                <details className="group relative">
                  <summary
                    className="-m-2 flex cursor-pointer list-none items-center rounded-md p-2 text-neutral-700 hover:bg-neutral-100 [&::-webkit-details-marker]:hidden"
                    aria-label="Menu"
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 group-open:hidden" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M4 7h16M4 12h16M4 17h16" />
                    </svg>
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="hidden size-6 group-open:block" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </summary>
                  <nav
                    aria-label="Site"
                    className="absolute right-0 top-full z-20 mt-3 min-w-56 rounded-[var(--site-radius)] bg-white p-2 text-sm shadow-lg ring-1 ring-neutral-200"
                  >
                    {nav.map((p) => {
                      const current = p.path === pagePath;
                      return (
                        <Link
                          key={p.path}
                          href={href(p.path)}
                          aria-current={current ? "page" : undefined}
                          className="block rounded-md border-l-2 px-3 py-2 hover:bg-neutral-50"
                          style={{
                            borderColor: current ? accent : "transparent",
                            color: current ? "#171717" : "#525252",
                            fontWeight: current ? 600 : 400,
                          }}
                        >
                          {p.title}
                        </Link>
                      );
                    })}
                  </nav>
                </details>
              </div>
            )}
          </>
        )}
      </div>
    </header>
  );
}

const FOOTER_GRID = ["", "sm:grid-cols-2", "sm:grid-cols-2 lg:grid-cols-3", "sm:grid-cols-2 lg:grid-cols-4"];

/**
 * The details and the profiles elsewhere, the owner's columns beside them
 * when there are any, and the year. Without columns it stays the one quiet
 * row it has always been.
 */
function SiteFooter({ site, mode }: { site: PublicSite; mode: SiteMode }) {
  const { settings, brand } = site;
  const columns = settings.footerColumns;
  const details = (
    <>
      {settings.phone && <a href={`tel:${settings.phone}`}>{settings.phone}</a>}
      {settings.email && <a href={`mailto:${settings.email}`}>{settings.email}</a>}
    </>
  );
  // A band in the brand colour (slice 17), the way the best small-business
  // sites close a page: the words take the colour's own foreground, and the
  // rules are that foreground at a fraction.
  const rule = "color-mix(in srgb, var(--site-primary-fg) 18%, transparent)";
  return (
    <footer style={{ backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" }}>
      <div className="mx-auto max-w-5xl px-6 py-12">
        {columns.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm opacity-90">
            <div>
              <span className="font-semibold">{brand.displayName}</span>
              {brand.tagline && <span> · {brand.tagline}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {details}
              <SocialLinks links={settings.social} />
            </div>
          </div>
        ) : (
          <div className={cn("grid gap-8", FOOTER_GRID[columns.length])}>
            <div className="space-y-3 text-sm opacity-90">
              <div>
                <p className="text-base font-semibold">{brand.displayName}</p>
                {brand.tagline && <p>{brand.tagline}</p>}
              </div>
              {settings.address && <p className="whitespace-pre-line">{settings.address}</p>}
              {(settings.phone || settings.email) && <p className="flex flex-col gap-1">{details}</p>}
              <SocialLinks links={settings.social} />
            </div>
            {columns.map((column, i) => (
              <div key={i} className="text-sm">
                {column.heading && <h2 className="text-xs font-semibold uppercase tracking-[0.15em] opacity-80">{column.heading}</h2>}
                {column.text && <p className="mt-3 whitespace-pre-line opacity-90">{column.text}</p>}
                {column.links.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {column.links.map((link, j) => {
                      const to = resolveHref(mode, site.slug, link.href);
                      return (
                        <li key={j}>
                          {to ? (
                            <Link href={to} className="opacity-90 transition-opacity hover:opacity-100 hover:underline">
                              {link.label}
                            </Link>
                          ) : (
                            <span className="opacity-90">{link.label}</span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t pt-4 text-xs opacity-75" style={{ borderColor: rule }}>
          <p>
            © {new Date().getFullYear()} {brand.displayName}
          </p>
          {settings.footerNote && <p>{settings.footerNote}</p>}
        </div>
      </div>
    </footer>
  );
}

/**
 * The band, the column and the room around one section, from its resolved
 * style. A `photo` background is the photo drawn behind everything,
 * darkened so the words stay readable; it is decorative, so it carries no
 * description and is never counted as one that needs it. `spacing` is the
 * class for the room, which the hero supplies from its own scale.
 */
function Shell({
  site,
  mode,
  style,
  resolved,
  spacing,
  eager,
  index,
  children,
}: {
  site: PublicSite;
  mode: SiteMode;
  style: SectionStyle | undefined;
  resolved: ResolvedStyle;
  spacing: string;
  /** The hero's background photo loads with the page; every other one waits. */
  eager?: boolean;
  /** Where on the page this is; the draft marks it so the editor can be told which section was clicked. */
  index: number;
  children: ReactNode;
}) {
  const band = backgroundClass(resolved.background);
  const photo =
    resolved.background === "photo" && style?.photo && site.images[style.photo.id] ? style.photo : null;
  const marker = mode === "draft" ? { [SECTION_ATTR]: index } : {};
  return (
    <section className={cn(band.className)} style={band.style} {...marker}>
      {photo && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageSrc(mode, site.slug, photo.id)}
            alt=""
            aria-hidden="true"
            width={site.images[photo.id].width}
            height={site.images[photo.id].height}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* A gradient rather than a flat wash (slice 17): darkest under the words, lighter above, so the picture still reads. */}
          <div className="absolute inset-0 bg-gradient-to-t from-neutral-950/75 via-neutral-950/50 to-neutral-950/30" aria-hidden="true" />
        </>
      )}
      <div className={cn("relative", widthClass(resolved.width), spacing, resolved.align === "center" && "text-center")}>
        {children}
      </div>
    </section>
  );
}

function SectionView({
  section,
  site,
  mode,
  pagePath,
  sectionIndex,
}: {
  section: Section;
  site: PublicSite;
  mode: SiteMode;
  pagePath: string;
  /** Where on the page this is: the form names it so its questions can be read back. */
  sectionIndex: number;
}) {
  // The renderer's own adjustments to a kind's defaults, before the owner's choices.
  const adjust: Partial<SectionDefaults> =
    section.type === "about" && section.image
      ? { width: "page" }
      : section.type === "columns" && section.look === "plain"
        ? { background: "none" }
        : section.type === "image" && section.layout === "wide"
          ? { width: "full" }
          : {};
  const resolved = resolveStyle(section.type, section.style, adjust);
  const tone = toneFor(resolved.background);
  const centred = resolved.align === "center";
  const shell = { site, mode, style: section.style, resolved, index: sectionIndex };
  const room = spacingClass(resolved.spacing);

  switch (section.type) {
    case "form":
      return (
        <Shell {...shell} spacing={room}>
          <h2 className={H2}>{section.heading}</h2>
          {section.note && <p className={cn("mt-3", tone.muted)}>{section.note}</p>}
          <div className={cn(centred && "mx-auto max-w-xl text-left")}>
            <EnquiryForm
              siteSlug={site.slug}
              pagePath={pagePath}
              sectionIndex={sectionIndex}
              buttonLabel={section.buttonLabel}
              askPhone={section.askPhone}
              thanks={section.thanks}
              fields={section.fields}
              // The preview shows the form; only the live site takes messages.
              // A preview is a client looking at their own site; a message sent
              // from it would be a real lead from a visit that never happened.
              disabled={!isLiveMode(mode)}
              onDark={resolved.onDark || resolved.background === "brand"}
            />
          </div>
        </Shell>
      );
    case "booking":
      return (
        <Shell {...shell} spacing={room}>
          <h2 className={H2}>{section.heading}</h2>
          {section.note && <p className={cn("mt-3", tone.muted)}>{section.note}</p>}
          <div className={cn(centred && "mx-auto max-w-xl text-left")}>
            <BookingForm
              siteSlug={site.slug}
              pagePath={pagePath}
              sectionIndex={sectionIndex}
              title={section.title}
              minutes={section.minutes}
              buttonLabel={section.buttonLabel}
              askPhone={section.askPhone}
              thanks={section.thanks}
              // A preview is a client looking at their own site; a message sent
              // from it would be a real lead from a visit that never happened.
              disabled={!isLiveMode(mode)}
              onDark={resolved.onDark || resolved.background === "brand"}
            />
          </div>
        </Shell>
      );
    case "map": {
      const address = site.settings.address.trim();
      // Nothing to show and nobody to tell: the public page skips the section; the draft says why.
      if (!address && mode !== "draft") return null;
      const pin = pinIsFor(site.settings.map, address) ? site.settings.map : null;
      const key = pin ? mapKey(pin, section.zoom, site.brand.primaryColor ?? "#1f2937") : null;
      const aside = section.showAddress || section.directions;
      return (
        <Shell {...shell} spacing={room}>
          <h2 className={H2}>{section.heading}</h2>
          {section.note && <p className={cn("mt-3", tone.muted)}>{section.note}</p>}
          <div className={cn("mt-6 grid gap-6", key && aside && "md:grid-cols-[3fr_2fr]", centred && "text-left")}>
            {key && (
              <figure>
                {/* Our own route, a picture the platform drew; the optimiser would only add a hop in front of a cached file. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mapSrc(mode, site.slug, key)}
                  width={MAP_WIDTH}
                  height={MAP_HEIGHT}
                  alt={`Map showing ${address}`}
                  loading="lazy"
                  decoding="async"
                  className="w-full rounded-[var(--site-radius)] shadow-sm ring-1 ring-neutral-200"
                />
                <figcaption className={cn("mt-2 text-xs", tone.faint)}>{MAP_ATTRIBUTION}</figcaption>
              </figure>
            )}
            {aside && (
              <div>
                {!address ? (
                  <p className={tone.muted}>Add an address in the site&rsquo;s details and it is shown here, on a map.</p>
                ) : (
                  <>
                    {section.showAddress && <p className="whitespace-pre-line text-lg">{address}</p>}
                    {!key && mode === "draft" && (
                      <p className={cn("mt-2 text-sm", tone.muted)}>The address is not on the map yet. Save the site&rsquo;s details again to place it.</p>
                    )}
                    {section.directions && (
                      <div className="mt-5">
                        <a
                          href={directionsUrl(address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block rounded-[var(--site-radius-button)] px-6 py-3 text-sm font-medium shadow-sm"
                          style={tone.button}
                        >
                          Get directions
                        </a>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </Shell>
      );
    }
    case "events": {
      // Live: whatever the Events calendar holds when the page is drawn (ADR 0025's sibling).
      const upcoming = upcomingEvents(site.events, new Date(), section.horizonDays, section.count);
      return (
        <Shell {...shell} spacing={room}>
          <h2 className={H2}>{section.heading}</h2>
          {section.note && <p className={cn("mt-3", tone.muted)}>{section.note}</p>}
          {upcoming.length === 0 ? (
            <p className={cn("mt-6", tone.muted)}>{section.emptyText || "Nothing scheduled yet. Check back soon."}</p>
          ) : (
            <ol className={cn("mt-6 divide-y", resolved.onDark ? "divide-white/15" : "divide-neutral-200", centred && "text-left")}>
              {upcoming.map((event) => {
                const date = eventDate(event, site.timezone);
                return (
                  <li key={eventKey(event)} className="flex gap-5 py-4">
                    <div className="w-14 shrink-0 text-center">
                      <div className={cn("text-xs uppercase tracking-wide", tone.faint)}>{date.weekday}</div>
                      <div className="text-2xl font-semibold leading-none" style={{ color: tone.heading }}>
                        {date.day}
                      </div>
                      <div className={cn("text-xs uppercase tracking-wide", tone.faint)}>{date.month}</div>
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-semibold">{event.title}</h3>
                      <p className={cn("text-sm", tone.muted)}>
                        {eventWhen(event, site.timezone)}
                        {event.location ? ` · ${event.location}` : ""}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Shell>
      );
    }
    case "quotes": {
      // Testimonials (slice 16): only quotes with words and a name, and nothing at all without one.
      const quotes = completeQuotes(section.items);
      if (quotes.length === 0 && mode !== "draft") return null;
      return (
        <Shell {...shell} spacing={room}>
          {section.heading && <h2 className={H2}>{section.heading}</h2>}
          {quotes.length === 0 ? (
            <p className={cn("mt-6 text-sm", tone.faint)}>Testimonials show here once one has words and a name.</p>
          ) : (
            <ul className={cn("mt-8 grid gap-6", quotes.length > 1 && "sm:grid-cols-2", quotes.length > 2 && "lg:grid-cols-3", centred && "text-left")}>
              {quotes.map((q, i) => (
                <li key={i} className="flex flex-col rounded-[var(--site-radius)] bg-white p-6 text-neutral-900 shadow-sm ring-1 ring-neutral-200">
                  <span aria-hidden="true" className="font-heading text-5xl leading-none" style={{ color: LIGHT_TONE.heading }}>
                    &ldquo;
                  </span>
                  <blockquote className="mt-2 flex-1 leading-relaxed">{q.quote}</blockquote>
                  <p className="mt-4 text-sm font-semibold" style={{ color: LIGHT_TONE.heading }}>
                    {q.name}
                  </p>
                  {q.detail && <p className={cn("text-sm", LIGHT_TONE.muted)}>{q.detail}</p>}
                </li>
              ))}
            </ul>
          )}
        </Shell>
      );
    }
    case "faq": {
      // Questions (slice 16): answered ones only, as native disclosures, and nothing at all without one.
      const questions = completeQuestions(section.items);
      if (questions.length === 0 && mode !== "draft") return null;
      return (
        <Shell {...shell} spacing={room}>
          {section.heading && <h2 className={H2}>{section.heading}</h2>}
          {section.note && <p className={cn("mt-3", tone.muted)}>{section.note}</p>}
          {questions.length === 0 ? (
            <p className={cn("mt-6 text-sm", tone.faint)}>Questions show here once one has an answer.</p>
          ) : (
            <div className={cn("mt-6 divide-y", resolved.onDark ? "divide-white/15" : "divide-neutral-200", "text-left")}>
              {questions.map((q, i) => (
                <details key={i} className="group py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                    <span>{q.question}</span>
                    <span aria-hidden="true" className={cn("shrink-0 text-xl leading-none transition-transform group-open:rotate-45", tone.faint)}>
                      +
                    </span>
                  </summary>
                  <p className={cn("mt-2 max-w-2xl whitespace-pre-line leading-relaxed", tone.muted)}>{q.answer}</p>
                </details>
              ))}
            </div>
          )}
        </Shell>
      );
    }
    case "block": {
      // A pack's block (slice 9b): the site draws the rows the slot loaded,
      // in its own look. No entry means the pack is off or could not answer:
      // nothing on a public page, a word to the owner in the draft.
      const view = site.blocks[blockKey(section)];
      if (!view && mode !== "draft") return null;
      return (
        <Shell {...shell} spacing={room}>
          {section.heading && <h2 className={H2}>{section.heading}</h2>}
          {section.note && <p className={cn("mt-3", tone.muted)}>{section.note}</p>}
          {!view ? (
            <p className={cn("mt-6 text-sm", tone.faint)}>Nothing to show yet: check this section&apos;s settings, and that its pack is switched on.</p>
          ) : view.rows.length === 0 ? (
            <p className={cn("mt-6", tone.muted)}>{section.emptyText || "Nothing listed yet. Check back soon."}</p>
          ) : (
            <ul className={cn("mt-6 divide-y", resolved.onDark ? "divide-white/15" : "divide-neutral-200", centred && "text-left")}>
              {view.rows.map((row, i) => (
                <li key={i} className="flex items-baseline justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <span className="font-medium">{row.name}</span>
                    {row.status === "sold_out" && (
                      <span className={cn("ml-2 rounded-full px-2 py-0.5 text-xs uppercase tracking-wide", resolved.onDark ? "bg-white/15" : "bg-neutral-100 text-neutral-600")}>
                        Sold out
                      </span>
                    )}
                    {row.detail && <div className={cn("text-sm", tone.faint)}>{row.detail}</div>}
                  </div>
                  <span className={cn("shrink-0 tabular-nums", row.status === "sold_out" ? tone.faint : "font-semibold")}>{row.amount}</span>
                </li>
              ))}
            </ul>
          )}
          {view?.footnote && <p className={cn("mt-4 text-sm", tone.faint)}>{view.footnote}</p>}
        </Shell>
      );
    }
    case "hero": {
      const photo = section.image && site.images[section.image.id] ? section.image : null;
      const left = (section.imageSide ?? "right") === "left";
      // The scale of the page's one big statement (slice 17): the taller the
      // hero, the larger its type; an eyebrow above it in small capitals in
      // the accent; up to two buttons, the second quieter.
      const scale =
        section.height === "tall"
          ? "text-5xl sm:text-6xl lg:text-7xl"
          : section.height === "compact"
            ? "text-3xl sm:text-4xl lg:text-5xl"
            : "text-4xl sm:text-5xl lg:text-6xl";
      const words = (
        <div>
          {section.eyebrow && (
            <p
              className={cn("mb-4 text-xs font-semibold uppercase tracking-[0.2em] sm:text-sm", centred && "mx-auto")}
              style={{ color: resolved.onDark ? "rgba(255,255,255,0.85)" : "var(--site-accent)" }}
            >
              {section.eyebrow}
            </p>
          )}
          <h1
            className={cn("max-w-4xl font-semibold leading-[1.05] tracking-tight", scale, centred && "mx-auto")}
            style={{ color: tone.heading }}
          >
            {section.headline}
          </h1>
          {section.subheadline && (
            <p className={cn("mt-5 max-w-2xl text-lg leading-relaxed sm:text-xl", tone.muted, centred && "mx-auto")}>{section.subheadline}</p>
          )}
          {(section.cta || section.secondary) && (
            <div className={cn("mt-9 flex flex-wrap items-center gap-3", centred && "justify-center")}>
              {section.cta && <CtaLink href={resolveHref(mode, site.slug, section.cta.href)} label={section.cta.label} tone={tone} size="lg" />}
              {section.secondary && (
                <CtaLink href={resolveHref(mode, site.slug, section.secondary.href)} label={section.secondary.label} tone={tone} size="lg" quiet />
              )}
            </div>
          )}
        </div>
      );
      return (
        <Shell {...shell} spacing={heroHeightClass(section.height)} eager>
          {photo ? (
            <div className={cn("grid items-center gap-10", left ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-[3fr_2fr]")}>
              {left && <Photo site={site} mode={mode} image={photo} eager className="w-full rounded-[var(--site-radius)] object-cover shadow-sm" />}
              {words}
              {!left && <Photo site={site} mode={mode} image={photo} eager className="w-full rounded-[var(--site-radius)] object-cover shadow-sm" />}
            </div>
          ) : (
            words
          )}
        </Shell>
      );
    }
    case "columns": {
      if (section.cards.length === 0) return null;
      const grid =
        section.columns === 2
          ? section.widths === "wide-left"
            ? "md:grid-cols-[2fr_1fr]"
            : section.widths === "wide-right"
              ? "md:grid-cols-[1fr_2fr]"
              : "sm:grid-cols-2"
          : section.columns === 4
            ? "sm:grid-cols-2 lg:grid-cols-4"
            : "sm:grid-cols-2 lg:grid-cols-3";
      const panels = section.look === "cards";
      // A white panel keeps the light tone whatever the band behind it.
      const inner = panels ? LIGHT_TONE : tone;
      return (
        <Shell {...shell} spacing={room}>
          {section.heading && <h2 className={H2}>{section.heading}</h2>}
          {section.intro && <p className={cn("mt-3 max-w-2xl", tone.muted, centred && "mx-auto")}>{section.intro}</p>}
          <ul className={cn("grid gap-6", grid, (section.heading || section.intro) && "mt-8", centred && "text-left")}>
            {section.cards.map((card) => {
              const photo = card.image && site.images[card.image.id] ? card.image : null;
              const to = card.cta ? resolveHref(mode, site.slug, card.cta.href) : null;
              return (
                <li key={card.id} className={panels ? "rounded-[var(--site-radius)] bg-white p-6 text-neutral-900 shadow-sm ring-1 ring-neutral-200" : ""}>
                  {photo ? (
                    <Photo site={site} mode={mode} image={photo} className="mb-4 aspect-[4/3] w-full rounded-[calc(var(--site-radius)*0.75)] object-cover" />
                  ) : card.icon ? (
                    <span className="mb-4 inline-flex size-12 items-center justify-center rounded-full" style={{ backgroundColor: "color-mix(in srgb, var(--site-accent) 16%, white)" }}>
                      <CardIcon name={card.icon} className="size-6" style={{ color: inner.heading }} />
                    </span>
                  ) : null}
                  {card.heading && (
                    <h3 className="font-semibold" style={{ color: inner.heading }}>
                      {card.heading}
                    </h3>
                  )}
                  {card.body.length > 0 && (
                    <div className={cn("mt-2 space-y-2 text-sm", inner.muted)}>
                      {card.body.map((paragraph, i) => (
                        <p key={i}>{paragraph}</p>
                      ))}
                    </div>
                  )}
                  {card.cta && to && (
                    <Link
                      href={to}
                      className="mt-4 inline-block text-sm font-medium underline-offset-4 hover:underline"
                      style={{ color: inner.heading }}
                    >
                      {card.cta.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </Shell>
      );
    }
    case "gallery": {
      const tiles = toSlides(section.items, site, mode);
      if (tiles.length === 0) return null;
      return (
        <Shell {...shell} spacing={room}>
          <Gallery heading={section.heading} tiles={tiles} columns={section.columns} captionClass={tone.muted} />
        </Shell>
      );
    }
    case "slideshow": {
      const slides = toSlides(section.items, site, mode);
      if (slides.length === 0) return null;
      if (section.layout === "wide" && resolved.width === "page" && (section.style?.width ?? "default") === "default") {
        // A wide show runs edge to edge; its heading and caption keep the page column.
        return (
          <Shell {...shell} resolved={{ ...resolved, width: "full" }} spacing={room}>
            <div className="-mx-6">
              {section.heading && (
                <h2 className="mx-auto max-w-5xl px-6 pb-4 text-2xl font-semibold tracking-tight">{section.heading}</h2>
              )}
              <Slideshow slides={slides} seconds={section.seconds} layout="wide" onDark={resolved.onDark} />
            </div>
          </Shell>
        );
      }
      return (
        <Shell {...shell} spacing={room}>
          {section.heading && <h2 className="pb-4 text-2xl font-semibold tracking-tight">{section.heading}</h2>}
          <Slideshow slides={slides} seconds={section.seconds} layout="inset" onDark={resolved.onDark} />
        </Shell>
      );
    }
    case "image": {
      const photo = section.image && site.images[section.image.id] ? section.image : null;
      if (!photo) return null;
      const wide = section.layout === "wide";
      return (
        <Shell {...shell} spacing={room}>
          <figure className={cn(wide && "-mx-6")}>
            <Photo
              site={site}
              mode={mode}
              image={photo}
              className={wide ? "max-h-[70vh] w-full object-cover" : "w-full rounded-[var(--site-radius)] object-cover shadow-sm"}
            />
            {section.caption && (
              <figcaption className={cn("mt-3 text-sm", tone.muted, wide && "mx-auto max-w-5xl px-6")}>{section.caption}</figcaption>
            )}
          </figure>
        </Shell>
      );
    }
    case "offer":
      return (
        <Shell {...shell} spacing={room}>
          <h2 className={H2}>{section.heading}</h2>
          {/* Tiles (slice 17): a photo with the name on it where there is one, a tinted band with the initial where there is not. */}
          <ul className={cn("mt-8 grid gap-6 sm:grid-cols-2", section.items.length >= 3 && "lg:grid-cols-3", section.items.length === 4 && "lg:grid-cols-4", centred && "text-left")}>
            {section.items.map((item, i) => {
              const photo = item.image && site.images[item.image.id] ? item.image : null;
              return (
                <li key={i} className="overflow-hidden rounded-[var(--site-radius)] bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-200 transition-shadow hover:shadow-md">
                  {photo ? (
                    <div className="relative">
                      <Photo site={site} mode={mode} image={photo} className="aspect-[4/3] w-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-neutral-950/70 to-transparent px-5 pb-4 pt-12">
                        <h3 className="text-lg font-semibold text-white">{item.name}</h3>
                      </div>
                    </div>
                  ) : (
                    <div className="relative flex h-28 items-end px-5 pb-4" style={{ backgroundColor: "color-mix(in srgb, var(--site-primary) 12%, white)" }}>
                      <span aria-hidden="true" className="absolute right-4 top-2 font-heading text-6xl font-semibold leading-none opacity-20" style={{ color: "var(--site-primary)" }}>
                        {item.name.trim().charAt(0).toUpperCase()}
                      </span>
                      <h3 className="text-lg font-semibold" style={{ color: LIGHT_TONE.heading }}>
                        {item.name}
                      </h3>
                    </div>
                  )}
                  {item.blurb && <p className={cn("px-5 py-4 text-sm leading-relaxed", LIGHT_TONE.muted)}>{item.blurb}</p>}
                </li>
              );
            })}
          </ul>
        </Shell>
      );
    case "about":
    case "text": {
      const photo = section.type === "about" && section.image && site.images[section.image.id] ? section.image : null;
      const left = section.type === "about" && (section.imageSide ?? "right") === "left";
      const words = (
        <div>
          {section.heading && <h2 className={H2}>{section.heading}</h2>}
          <div className={cn("mt-4 space-y-4 leading-relaxed", tone.body)}>
            {section.body.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </div>
      );
      return (
        <Shell {...shell} spacing={room}>
          {photo ? (
            <div className={cn("grid gap-8 md:items-start", left ? "md:grid-cols-[2fr_3fr]" : "md:grid-cols-[3fr_2fr]")}>
              {left && <Photo site={site} mode={mode} image={photo} className="w-full rounded-[var(--site-radius)] object-cover shadow-sm" />}
              {words}
              {!left && <Photo site={site} mode={mode} image={photo} className="w-full rounded-[var(--site-radius)] object-cover shadow-sm" />}
            </div>
          ) : (
            words
          )}
        </Shell>
      );
    }
    case "cta":
      return (
        <Shell {...shell} spacing={resolved.spacing === "tight" ? "py-12" : room}>
          <div className={cn("flex flex-wrap items-center gap-6", centred ? "flex-col justify-center" : "justify-between")}>
            <h2 className={H2}>{section.headline}</h2>
            <CtaLink href={resolveHref(mode, site.slug, section.cta.href)} label={section.cta.label} tone={tone} />
          </div>
        </Shell>
      );
    case "contact":
      return (
        <Shell {...shell} spacing={room}>
          <ContactSection heading={section.heading} note={section.note} settings={site.settings} tone={tone} centred={centred} />
        </Shell>
      );
    case "hours":
      if (site.settings.hoursLines.length === 0) return null;
      return (
        <Shell {...shell} spacing={room}>
          <h2 className={H2}>{section.heading}</h2>
          <ul className={cn("mt-4 space-y-1", tone.body)}>
            {site.settings.hoursLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {section.note && <p className={cn("mt-3 text-sm", tone.muted)}>{section.note}</p>}
        </Shell>
      );
  }
}

/**
 * A gallery's or a slideshow's photos as the client component takes them:
 * the address for this mode and the size from the row. A photo whose row
 * is gone is skipped, so a section with none left draws nothing.
 */
function toSlides(
  items: ReadonlyArray<{ image: ImageRef; caption: string }>,
  site: PublicSite,
  mode: SiteMode,
): Slide[] {
  return items.flatMap((item) => {
    const meta = site.images[item.image.id];
    if (!meta) return [];
    return [
      {
        src: imageSrc(mode, site.slug, item.image.id),
        alt: item.image.alt,
        caption: item.caption,
        width: meta.width,
        height: meta.height,
      },
    ];
  });
}

/**
 * A photo from the site's library. Width and height come from the row so
 * the page keeps its shape while the bytes arrive; the hero's is eager,
 * everything else lazy. Our own route, like the logo: the optimiser would
 * only add a hop in front of a cached file.
 */
function Photo({
  site,
  mode,
  image,
  className,
  eager,
}: {
  site: PublicSite;
  mode: SiteMode;
  image: ImageRef;
  className: string;
  eager?: boolean;
}) {
  const meta = site.images[image.id];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageSrc(mode, site.slug, image.id)}
      alt={image.alt}
      width={meta.width}
      height={meta.height}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      className={className}
    />
  );
}

/** The button: the brand colour on a light background, white where the background is the brand colour or dark. */
function CtaLink({
  href,
  label,
  tone,
  size = "md",
  quiet = false,
}: {
  href: string | null;
  label: string;
  tone: Tone;
  /** `lg` for the hero's buttons. */
  size?: "md" | "lg";
  /** The second button: an outline in the words' colour rather than a filled one. */
  quiet?: boolean;
}) {
  const className = cn(
    "inline-block rounded-[var(--site-radius-button)] font-semibold transition-shadow hover:shadow-md",
    size === "lg" ? "px-7 py-3.5 text-base" : "px-6 py-3 text-sm",
    quiet ? "border-2 border-current bg-transparent" : "shadow-sm",
  );
  const style = quiet ? { color: tone.heading } : tone.button;
  // No usable link: the words stay, as a button that goes nowhere is still the owner's words.
  if (!href) {
    return (
      <span className={className} style={style}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={className} style={style}>
      {label}
    </Link>
  );
}

/** Reads the details LIVE from the site's settings — nothing is copied into the section. */
function ContactSection({
  heading,
  note,
  settings,
  tone,
  centred,
}: {
  heading: string;
  note: string;
  settings: SiteSettings;
  tone: Tone;
  centred: boolean;
}) {
  const hasDetails = settings.phone || settings.email || settings.address;
  return (
    <>
      <h2 className={H2}>{heading}</h2>
      {note && <p className={cn("mt-3", tone.muted)}>{note}</p>}
      {hasDetails && (
        <dl className={cn("mt-6 grid gap-4 sm:grid-cols-3", centred && "text-left")}>
          {settings.phone && (
            <div>
              <dt className={cn("text-xs uppercase tracking-wide", tone.faint)}>Phone</dt>
              <dd className="mt-1">
                <a href={`tel:${settings.phone}`} style={{ color: tone.heading }}>
                  {settings.phone}
                </a>
              </dd>
            </div>
          )}
          {settings.email && (
            <div>
              <dt className={cn("text-xs uppercase tracking-wide", tone.faint)}>Email</dt>
              <dd className="mt-1">
                <a href={`mailto:${settings.email}`} style={{ color: tone.heading }}>
                  {settings.email}
                </a>
              </dd>
            </div>
          )}
          {settings.address && (
            <div>
              <dt className={cn("text-xs uppercase tracking-wide", tone.faint)}>Address</dt>
              <dd className="mt-1 whitespace-pre-line">{settings.address}</dd>
            </div>
          )}
        </dl>
      )}
    </>
  );
}
