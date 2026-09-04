# 0019 — A website is pages of typed sections, hosted by the platform

- **Date:** 2026-09-04
- **Status:** Accepted (slice 1 built 2026-09-04)
- **Affects:** Marketing (`sites`, `site_pages`, `src/lib/sites/`), the
  proxy (`src/proxy.ts`), the public routes under `/sites` and `/hosted`,
  the trust boundaries in `docs/security.md`
- **Builds on:** [0018](0018-the-brand-kit-is-layer-0-data.md)

## Context

The founder's brief for Marketing includes a website builder "with drag and
drop" that "builds the website and then allows for easy customization", hosted
by the platform, with a domain name, and with industry packs adding an online
store. The assessment that set the path (2026-09-04) made one call this file
records: the builder is **block-based**, not a free-form canvas, and the site
is **generated from the business's own data** before anyone edits it.

Two things were true of the codebase when the first slice was built. Every
public surface so far (`/s/[token]`, `/health-check`) is unauthenticated by
design and treats every input as hostile. And the platform's own DNS carries
the mail records that ADR 0003's self-hosted mail depends on, so nothing may
move `yosherapp.com`'s nameservers to get a wildcard.

## Decision

- **A site is pages, and a page is a list of typed sections held as JSON**,
  validated by one Zod model on every write and again on every read. A
  section is one of a fixed set (hero, about, offer, hours, contact, text,
  cta) with bounded strings. Nothing a tenant or the assistant writes is
  markup; the renderer decides how a section looks.
- **Draft and published are two columns on the page.** Editing touches the
  draft; publishing copies it; the public renderer reads only the published
  snapshot. Unpublishing is a status flip that keeps everything.
- **The site is generated first.** The assistant writes words into fixed
  slots from the brand kit, the industry and the details the owner typed;
  the standard copy fills whatever it leaves blank, and stands in entirely
  when there is no key. The owner reads, then publishes.
- **Two addresses, one route body.** Every site is reachable at
  `/sites/<slug>` on the platform host, always. When `SITE_DOMAIN` names a
  domain the platform owns, `<slug>.<SITE_DOMAIN>` is rewritten by the proxy
  to `/hosted/<slug>/…`, the same renderer with root-relative links. Locally
  `SITE_DOMAIN` defaults to `localhost`, because Chrome resolves
  `anything.localhost` with no hosts-file edit.
- **The public read path opens a tenant, not a hole.** `slug → tenant` is one
  `withSystem` lookup returning identifiers; everything after runs in that
  tenant's context as `staff` through the ordinary member policies. There is
  no public RLS policy. The site's logo is served by a public route addressed
  by the site, the one blob stream with a public cache header.
- **Published pages are cached** (ISR, five minutes) and revalidated on
  publish. The draft preview is a separate, dynamic, session-checked route.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| Free-form drag-and-drop canvas (absolute positioning) | A generator cannot fill a canvas from data, layouts break on phones, and it is a multi-year product of its own. Blocks are what "build it for me, then let me tweak it" needs. |
| Storing HTML the editor produced | Stored XSS on a public page rendered from what a tenant typed. Typed sections make that impossible by construction. |
| A public RLS policy on `sites` (`USING (status = 'published')`) | Would be the first policy that returns rows with no tenant context and would erode the "no context → no rows" backstop for one convenience. One trusted lookup is the established shape (inbound-mail tokens, share links). |
| Host routing only, no path address | Nothing to look at until a domain is bought and put on Vercel's nameservers. The path address is the fallback, the preview and the local-dev answer. |
| A wildcard on `yosherapp.com` | Its zone carries SES, Migadu and Stalwart records that the mail dossier says not to touch. The site domain is a separate purchase. |
| `use cache` / Cache Components | Enabling them changes rendering semantics for every page in the app. Route-segment ISR does the job for two routes without that blast radius. |

## Consequences

- Slice 2 (the editor) edits `site_pages.draft` through the same Zod model;
  it needs no new tables and cannot produce a page the renderer cannot draw.
- Packs extend the site through a declared slot (P5 in the extension model):
  a new section TYPE registered by a pack, never a pack reading another
  pack's tables. The retail shop block is the first candidate.
- Custom domains (slice 3) are a table of `(domain → site)` plus Vercel's
  Domains API, with `hostToSiteSlug` growing a second lookup. Nothing in the
  renderer changes.
- `/hosted/<slug>` is reachable on the platform host too, where its
  root-relative links point at the platform. Harmless; not an address anyone
  is given.
- The renderer's `<img>` for the logo and its inline colour variables are
  the two places the brand kit reaches the public page; a third consumer is
  an import, not a seam.

## Notes

The lesson worth keeping is the one the migration taught within the hour:
**drizzle-kit emits every foreign key before every index**, so a composite FK
to a table created in the same migration fails unless the referenced unique
index is moved ahead of it by hand. `ledger.ts` had said so since ADR 0010;
this was the first time the referenced table was new in the same file.
