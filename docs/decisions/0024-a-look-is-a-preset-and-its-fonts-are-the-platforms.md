# 0024 — A look is a preset, and its fonts are the platform's

- **Date:** 2026-09-05
- **Status:** Accepted (built 2026-09-05, Marketing slice 6d)
- **Affects:** the brand kit (`brand_kits.look`, `font_pairing`,
  `button_shape`; `src/lib/brand/looks.ts`), the public renderer and its
  fonts (`src/components/site/site-fonts.ts`), the Marketing brand screen
- **Builds on:** [0018](0018-the-brand-kit-is-layer-0-data.md) (the kit is
  Layer 0 data), [0019](0019-a-website-is-pages-of-typed-sections.md)
  (sections are data; the renderer decides how they look)

## Context

Every site read in one typeface, with one button shape, because slice 1
gave the renderer one look and the brand kit only colours. A farm, a law
office and a roofing crew should not read alike, and "make the site feel
like us" is the first thing an owner asks for after the colours. Type is
where a site's character mostly lives.

Three ways to give a business its type:

1. **Let the owner upload font files, or paste a stylesheet.** The most
   freedom, and the most trouble: font licensing the platform cannot check,
   a new kind of blob with its own rules, CSS on a public page that a tenant
   wrote (the stored-XSS surface ADR 0019 closed by making sections data),
   and a page that reads badly because a display face was set as body text.
2. **Link Google Fonts at request time.** A `<link>` to `fonts.googleapis.com`
   on every public page. No files to hold; but every visitor's browser then
   asks Google for a file, which sends the visitor's address to a third party
   from a page the platform promised keeps nothing about the person (ADR
   0022), and adds a request the platform does not control to every tenant
   site.
3. **A curated list, bundled by the platform.** A handful of pairings chosen
   to read well together at the renderer's sizes, fetched once at build time
   by `next/font` and served with the page from the platform's own origin.

## Decision

**A look is a preset, never a stylesheet, and its fonts are the platform's.**

- The brand kit holds three short words: a **look** (`modern`, `warm`,
  `classic`), a **font pairing** (six, each two bundled families) and a
  **button shape** (`pill`, `rounded`, `square`), each `''` for "as the look
  says" on the business kit and "as the business kit says" on a company's,
  the way a section's style says `default`. The CHECKs on the table are the
  whole vocabulary; nothing an owner chooses is a file, a URL or CSS.
- The families come through `next/font/google` at build time (the root
  layout already brings Geist that way), with `preload: false`, and are
  served from the platform's origin with the page. A visitor's browser never
  asks a third party for a font. `clean` is Geist itself, which is why a
  site saved before this decision reads exactly as it did.
- The look reaches the page as CSS variables on the renderer's root: the
  heading and body families, and three corner radii (photos and panels, the
  form's boxes, buttons). The classes read the variables; nothing else in
  the renderer knows which look is on.
- The kit is Layer 0 data (ADR 0018), so the look is the business's, not
  the website's: the documents keep their own type for now
  (`src/lib/pdf/fonts`), and a share page or a mail signature may read it
  when they want it.

## Consequences

- Adding a pairing is an entry in `FONT_PAIRING_SPECS`, a `next/font` call
  in `site-fonts.ts` and a word in the CHECK; nothing else changes.
- A tenant who wants a face outside the list cannot have it. That is the
  price of the first option's troubles never arriving, and the list can grow.
- The build needs the network once, for the font files. It already did.
- The preview on the brand screen and the site use the same variables from
  the same module, so what the owner sees beside Save is what the site draws.
