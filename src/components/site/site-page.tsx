import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { foregroundOn } from "@/lib/brand/core";
import type { PublicSite } from "@/lib/sites/read";
import type { ImageRef, Section, SitePageView, SiteSettings } from "@/lib/sites/schema";
import { siteHref, type SiteMode } from "@/lib/sites/slug";
import { EnquiryForm } from "./enquiry-form";
import { ViewBeacon } from "./view-beacon";

/**
 * The public renderer: one page of a tenant's site, from its typed sections.
 *
 * Server components, and nothing here is markup a tenant wrote — every
 * string arrives through the content model and React escapes it. The one
 * client island is the enquiry form (`enquiry-form.tsx`), which needs a
 * pending state and a thank-you. The brand's colours enter as CSS variables
 * on the root so the sections never learn a hex value.
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

/** An in-site path becomes a link for this mode; anything else passes through. */
export function resolveHref(mode: SiteMode, slug: string, href: string): string {
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
  const style = {
    "--site-primary": primary,
    "--site-primary-fg": foregroundOn(primary),
    "--site-accent": accent,
  } as CSSProperties;
  const nav = site.pages
    .filter((p) => p.inNav)
    .sort((a, b) => a.navOrder - b.navOrder);
  const href = (path: string) => siteHref(mode, site.slug, path);

  return (
    <div style={style} className="flex min-h-screen flex-col bg-white text-neutral-900">
      {banner}
      {/* The draft preview is the owner looking, not a visitor: no count. */}
      {mode !== "draft" && <ViewBeacon slug={site.slug} path={page.path} />}
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
          {nav.length > 1 && (
            <nav aria-label="Site" className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {nav.map((p) => {
                const current = p.path === page.path;
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
        </div>
      </header>

      <main className="flex-1">
        {page.content.sections.map((section, i) => (
          <SectionView key={i} section={section} site={site} mode={mode} pagePath={page.path} sectionIndex={i} />
        ))}
      </main>

      <footer className="border-t border-neutral-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-neutral-600">
          <div>
            <span className="font-medium text-neutral-900">{site.brand.displayName}</span>
            {site.brand.tagline && <span> · {site.brand.tagline}</span>}
          </div>
          <div className="flex flex-wrap gap-x-4">
            {site.settings.phone && <a href={`tel:${site.settings.phone}`}>{site.settings.phone}</a>}
            {site.settings.email && <a href={`mailto:${site.settings.email}`}>{site.settings.email}</a>}
          </div>
        </div>
      </footer>
    </div>
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
  switch (section.type) {
    case "form":
      return (
        <section className="mx-auto max-w-3xl px-6 py-14">
          <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
          {section.note && <p className="mt-3 text-neutral-600">{section.note}</p>}
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
          />
        </section>
      );
    case "hero": {
      const photo = section.image && site.images[section.image.id] ? section.image : null;
      return (
        <section className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
          <div className={photo ? "grid items-center gap-10 md:grid-cols-[3fr_2fr]" : undefined}>
            <div>
              <h1
                className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
                style={{ color: "var(--site-primary)" }}
              >
                {section.headline}
              </h1>
              {section.subheadline && (
                <p className="mt-4 max-w-2xl text-lg text-neutral-600">{section.subheadline}</p>
              )}
              {section.cta && (
                <div className="mt-8">
                  <CtaLink href={resolveHref(mode, site.slug, section.cta.href)} label={section.cta.label} />
                </div>
              )}
            </div>
            {photo && (
              <Photo site={site} mode={mode} image={photo} eager className="w-full rounded-2xl object-cover shadow-sm" />
            )}
          </div>
        </section>
      );
    }
    case "image": {
      const photo = section.image && site.images[section.image.id] ? section.image : null;
      if (!photo) return null;
      return (
        <section className={section.layout === "wide" ? "px-0 py-6" : "mx-auto max-w-3xl px-6 py-10"}>
          <figure>
            <Photo
              site={site}
              mode={mode}
              image={photo}
              className={
                section.layout === "wide"
                  ? "max-h-[70vh] w-full object-cover"
                  : "w-full rounded-2xl object-cover shadow-sm"
              }
            />
            {section.caption && (
              <figcaption className={`mt-3 text-sm text-neutral-600 ${section.layout === "wide" ? "mx-auto max-w-5xl px-6" : ""}`}>
                {section.caption}
              </figcaption>
            )}
          </figure>
        </section>
      );
    }
    case "offer":
      return (
        <section className="border-t border-neutral-100 bg-neutral-50">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
            <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {section.items.map((item, i) => (
                <li key={i} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-neutral-200">
                  <h3 className="font-semibold" style={{ color: "var(--site-primary)" }}>
                    {item.name}
                  </h3>
                  {item.blurb && <p className="mt-2 text-sm text-neutral-600">{item.blurb}</p>}
                </li>
              ))}
            </ul>
          </div>
        </section>
      );
    case "about":
    case "text": {
      const photo = section.type === "about" && section.image && site.images[section.image.id] ? section.image : null;
      const words = (
        <div>
          {section.heading && (
            <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
          )}
          <div className="mt-4 space-y-4 text-neutral-700 leading-relaxed">
            {section.body.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
        </div>
      );
      if (!photo) return <section className="mx-auto max-w-3xl px-6 py-14">{words}</section>;
      return (
        <section className="mx-auto max-w-5xl px-6 py-14">
          <div className="grid gap-8 md:grid-cols-[3fr_2fr] md:items-start">
            {words}
            <Photo site={site} mode={mode} image={photo} className="w-full rounded-2xl object-cover shadow-sm" />
          </div>
        </section>
      );
    }
    case "cta":
      return (
        <section style={{ backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" }}>
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6 px-6 py-12">
            <h2 className="text-2xl font-semibold tracking-tight">{section.headline}</h2>
            <Link
              href={resolveHref(mode, site.slug, section.cta.href)}
              className="rounded-full bg-white px-6 py-3 text-sm font-medium text-neutral-900 shadow-sm"
            >
              {section.cta.label}
            </Link>
          </div>
        </section>
      );
    case "contact":
      return <ContactSection heading={section.heading} note={section.note} settings={site.settings} />;
    case "hours":
      if (site.settings.hoursLines.length === 0) return null;
      return (
        <section className="mx-auto max-w-3xl px-6 py-14">
          <h2 className="text-2xl font-semibold tracking-tight">{section.heading}</h2>
          <ul className="mt-4 space-y-1 text-neutral-700">
            {site.settings.hoursLines.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          {section.note && <p className="mt-3 text-sm text-neutral-600">{section.note}</p>}
        </section>
      );
  }
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

function CtaLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-block rounded-full px-6 py-3 text-sm font-medium shadow-sm"
      style={{ backgroundColor: "var(--site-primary)", color: "var(--site-primary-fg)" }}
    >
      {label}
    </Link>
  );
}

/** Reads the details LIVE from the site's settings — nothing is copied into the section. */
function ContactSection({
  heading,
  note,
  settings,
}: {
  heading: string;
  note: string;
  settings: SiteSettings;
}) {
  const hasDetails = settings.phone || settings.email || settings.address;
  return (
    <section className="mx-auto max-w-3xl px-6 py-14">
      <h2 className="text-2xl font-semibold tracking-tight">{heading}</h2>
      {note && <p className="mt-3 text-neutral-600">{note}</p>}
      {hasDetails && (
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {settings.phone && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Phone</dt>
              <dd className="mt-1">
                <a href={`tel:${settings.phone}`} style={{ color: "var(--site-primary)" }}>
                  {settings.phone}
                </a>
              </dd>
            </div>
          )}
          {settings.email && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Email</dt>
              <dd className="mt-1">
                <a href={`mailto:${settings.email}`} style={{ color: "var(--site-primary)" }}>
                  {settings.email}
                </a>
              </dd>
            </div>
          )}
          {settings.address && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-neutral-500">Address</dt>
              <dd className="mt-1 whitespace-pre-line">{settings.address}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}
