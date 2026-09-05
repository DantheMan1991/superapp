import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { foregroundOn } from "@/lib/brand/core";
import { lookRadiusVars, resolveLook } from "@/lib/brand/looks";
import type { PublicSite } from "@/lib/sites/read";
import { isSafeHref } from "@/lib/sites/links";
import type { ImageRef, Section, SectionStyle, SitePageView, SiteSettings } from "@/lib/sites/schema";
import { SECTION_ATTR } from "@/lib/sites/preview";
import { siteHref, type SiteMode } from "@/lib/sites/slug";
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

export function logoSrc(mode: SiteMode, slug: string): string {
  // On a site host the proxy maps `/logo` to the site's logo route; on the
  // platform host the route is addressed directly.
  return mode === "host" ? "/logo" : `/sites/${slug}/logo`;
}

/**
 * A photo's address for this mode. On a site host the proxy maps
 * `/images/<id>` to the site's image route; on the platform host the route
 * is addressed directly; the draft preview reads the member route, so a
 * photo on an unpublished site is seen only by the people who put it there.
 */
export function imageSrc(mode: SiteMode, slug: string, id: string): string {
  if (mode === "host") return `/images/${id}`;
  if (mode === "draft") return `/api/marketing/sites/images/${id}`;
  return `/sites/${slug}/images/${id}`;
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
  site,
  page,
  mode,
  banner,
}: {
  site: PublicSite;
  page: SitePageView;
  mode: SiteMode;
  /** Above the header: the draft preview's notice. */
  banner?: ReactNode;
}) {
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
      {mode === "draft" ? <DraftSelect /> : <ViewBeacon slug={site.slug} path={page.path} />}
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
  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-8 gap-y-3 px-6 py-4">
        <Link href={href("/")} className="flex items-center gap-3">
          {site.brand.logo ? (
            // Our own logo route, public by definition (ADR 0018); the
            // optimiser would only add a hop in front of a cached file.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoSrc(mode, site.slug)}
              alt={site.title}
              className="h-10 w-auto max-w-[200px] object-contain"
            />
          ) : (
            <span className="text-lg font-semibold" style={{ color: primary }}>
              {site.title}
            </span>
          )}
        </Link>
        {(nav.length > 1 || buttonHref) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {nav.length > 1 && (
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
            {button && buttonHref && (
              <Link
                href={buttonHref}
                className="inline-block rounded-[var(--site-radius-button)] px-4 py-2 text-sm font-medium shadow-sm"
                style={LIGHT_TONE.button}
              >
                {button.label}
              </Link>
            )}
          </div>
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
  return (
    <footer className="border-t border-neutral-200">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {columns.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-neutral-600">
            <div>
              <span className="font-medium text-neutral-900">{brand.displayName}</span>
              {brand.tagline && <span> · {brand.tagline}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {details}
              <SocialLinks links={settings.social} />
            </div>
          </div>
        ) : (
          <div className={cn("grid gap-8", FOOTER_GRID[columns.length])}>
            <div className="space-y-3 text-sm text-neutral-600">
              <div>
                <p className="font-medium text-neutral-900">{brand.displayName}</p>
                {brand.tagline && <p>{brand.tagline}</p>}
              </div>
              {settings.address && <p className="whitespace-pre-line">{settings.address}</p>}
              {(settings.phone || settings.email) && <p className="flex flex-col gap-1">{details}</p>}
              <SocialLinks links={settings.social} />
            </div>
            {columns.map((column, i) => (
              <div key={i} className="text-sm">
                {column.heading && <h2 className="font-semibold text-neutral-900">{column.heading}</h2>}
                {column.text && <p className="mt-2 whitespace-pre-line text-neutral-600">{column.text}</p>}
                {column.links.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {column.links.map((link, j) => {
                      const to = resolveHref(mode, site.slug, link.href);
                      return (
                        <li key={j}>
                          {to ? (
                            <Link href={to} className="text-neutral-600 transition-colors hover:text-neutral-900">
                              {link.label}
                            </Link>
                          ) : (
                            <span className="text-neutral-600">{link.label}</span>
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
        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-neutral-100 pt-4 text-xs text-neutral-500">
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
          <div className="absolute inset-0 bg-neutral-950/55" aria-hidden="true" />
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
          <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
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
              disabled={mode === "draft"}
              onDark={resolved.onDark || resolved.background === "brand"}
            />
          </div>
        </Shell>
      );
    case "hero": {
      const photo = section.image && site.images[section.image.id] ? section.image : null;
      const left = (section.imageSide ?? "right") === "left";
      const words = (
        <div>
          <h1
            className={cn("max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl", centred && "mx-auto")}
            style={{ color: tone.heading }}
          >
            {section.headline}
          </h1>
          {section.subheadline && (
            <p className={cn("mt-4 max-w-2xl text-lg", tone.muted, centred && "mx-auto")}>{section.subheadline}</p>
          )}
          {section.cta && (
            <div className={cn("mt-8", centred && "flex justify-center")}>
              <CtaLink href={resolveHref(mode, site.slug, section.cta.href)} label={section.cta.label} tone={tone} />
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
          {section.heading && <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>}
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
                    <CardIcon name={card.icon} className="mb-4 size-8" style={{ color: inner.heading }} />
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
          <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
          <ul className={cn("mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3", centred && "text-left")}>
            {section.items.map((item, i) => (
              <li key={i} className="rounded-[var(--site-radius)] bg-white p-6 text-neutral-900 shadow-sm ring-1 ring-neutral-200">
                <h3 className="font-semibold" style={{ color: LIGHT_TONE.heading }}>
                  {item.name}
                </h3>
                {item.blurb && <p className={cn("mt-2 text-sm", LIGHT_TONE.muted)}>{item.blurb}</p>}
              </li>
            ))}
          </ul>
        </Shell>
      );
    case "about":
    case "text": {
      const photo = section.type === "about" && section.image && site.images[section.image.id] ? section.image : null;
      const left = section.type === "about" && (section.imageSide ?? "right") === "left";
      const words = (
        <div>
          {section.heading && <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>}
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
            <h2 className="text-2xl font-semibold tracking-tight">{section.headline}</h2>
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
          <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
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
function CtaLink({ href, label, tone }: { href: string | null; label: string; tone: Tone }) {
  const className = "inline-block rounded-[var(--site-radius-button)] px-6 py-3 text-sm font-medium shadow-sm";
  // No usable link: the words stay, as a button that goes nowhere is still the owner's words.
  if (!href) {
    return (
      <span className={className} style={tone.button}>
        {label}
      </span>
    );
  }
  return (
    <Link href={href} className={className} style={tone.button}>
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
      <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>
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
