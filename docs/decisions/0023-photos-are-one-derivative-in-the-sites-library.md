# 0023 — Photos are one derivative in the site's own library, served by the platform

- **Date:** 2026-09-04
- **Status:** Accepted (built 2026-09-04, Marketing slice 5)
- **Affects:** Marketing (`site_images`, the `image` section and the photo
  on `hero` and `about`, the editor's picker), the blob store's tenant
  prefixes (`src/lib/blob.ts`), the proxy's rewrite, the public routes,
  `docs/security.md` trust boundaries
- **Builds on:** [0018](0018-the-brand-kit-is-layer-0-data.md) (the logo's
  storage and public route), [0019](0019-a-website-is-pages-of-typed-sections.md)

## Context

A site without photos is a brochure with the pictures torn out. Adding
them raises four questions the logo did not: photos are big (a phone's is
3–8MB), they come in many formats, they carry metadata a business would
not want published (GPS position above all), and there are many of them
per site rather than one per kit. The logo slice settled how a picture
gets into the private store (a presigned upload the browser makes, then a
registration that trusts only the real bytes) and how it reaches the
internet (a platform route with a public cache header). This decision
extends that to photos and settles what is kept.

## Decision

1. **A library per site, in the tenant's own prefix.** `site_images` rows
   under `sites/<tenant>/photos/`, at most `SITE_IMAGES_MAX` (60) per site.
   Sections point at a row by id and carry their own alt text; one photo
   can be placed twice with different words. Removing a row takes the
   photo off every page that showed it, and the screen says so.
2. **One derivative, made by the platform, is all that is ever kept.**
   Whatever is uploaded (JPEG, PNG or WebP, ≤ 12MB) is decoded, its EXIF
   orientation baked into the pixels, resized to a long edge of at most
   1,600 pixels, and re-encoded as a JPEG — or a PNG when the upload had
   transparency. Every metadata tag is dropped on the way, so nothing a
   camera wrote into the file reaches the internet. The upload itself is
   deleted in the same breath. An SVG is refused outright (the stored-XSS
   rule the logo already follows); a decompression bomb is refused by the
   decoder's pixel limit.
3. **Served by the platform, never as a blob URL.** `/sites/<slug>/images/<id>`
   and `/domain/<host>/images/<id>` for a PUBLISHED site only, through the
   same trusted lookup and `staff` context as the pages, with a public
   cache header (an hour in the browser, a week at the edge; the bytes
   under an id never change). On a site's own hostname the proxy maps
   `/images/<id>` there, the way it maps `/logo`; `/images` is a reserved
   page path. Members — the editor's picker and the draft preview — read
   the member route, so a photo on an unpublished site is seen only by the
   people who put it there.
4. **Three placements, no free canvas.** A photo beside the hero's
   headline, a photo beside the about section's paragraphs, and a `Photo`
   section of its own with a caption, in the text column or full width.
   The renderer decides the layout; the owner decides the photo and the
   words. A gallery is a later section, not a reason to loosen this.

## Consequences

- Photos are counted against the platform's blob bill, bounded by 60 × a
  derivative that is rarely over 400KB. The upload's bytes never linger.
- A photo cannot be edited (cropped, rotated by hand) inside Yosher; a
  replaced photo is a new row. The picker is a library, not an editor.
- The browser scales the one derivative for every placement. If pages
  ever get heavy, a second, smaller size per row is the next step; the
  row has the room and the route can pick by a query.
- Alt text is the owner's job and is per placement; the picker asks for
  it beside every placed photo and nothing enforces it.

## Alternatives rejected

- **Keeping the original.** The metadata risk and the bill, for a file
  nobody would serve.
- **Serving public blob URLs.** The store is private for every tenant's
  sake; a public URL per photo would be a second access model to keep
  right, and a removed photo would linger at its URL.
- **Next's image optimiser in front of the route.** A hop in front of a
  cached, already-sized file, and a dependency on the platform host for a
  page served on the business's own domain.
