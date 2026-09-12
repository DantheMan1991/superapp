# 0046 — A preview link shows an unpublished site, and the token stands in for the slug

- **Date:** 2026-09-11
- **Status:** Accepted
- **Affects:** Marketing (sites), `src/lib/sites/previews.ts`, `/p/[token]/**`, `SiteMode`, migrations 0300/0301
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md), [0045](0045-a-business-may-have-several-websites-and-a-kit-may-belong-to-one.md), and the document share's trust model (`src/modules/documents/shares/resolve.ts`)

## Context

The point of the website tool is handing a business its site. Until this, the
only way to show somebody one was to **publish it**: `/sites/<slug>/draft`
calls `resolveTenantContext()` and 404s for anyone who is not a signed-in
member of that tenant. An agency building a site for a client had no way to
say "here it is, what do you think?" — only "it's live now, tell me what's
wrong."

Two things made it more than a route.

**A preview with no photographs is not a preview.** An unpublished site's
images are reachable exactly two ways and a client can use neither:
`/api/marketing/sites/images/<id>` wants a member session, and
`/sites/<slug>/images/<id>` wants the site published. The same is true of the
drawn map.

**Links inside the page pointed at the wrong place.** In `draft` mode every
in-site link is built as `/sites/<slug>/draft…`, which is the members-only
route. A multi-page preview would have had a nav where every item 404s for the
person it was sent to.

## Decision

**A token addresses a site the way a slug does, and `/p/<token>/` mirrors
`/sites/<slug>/` completely** — the page and its paths, images, the map, the
logo. `SiteMode` gains `preview`, and the renderer substitutes the token for
`site.slug` in one place at the top rather than threading a second key through
thirteen components.

**The trust model is the document share's, verbatim.** `withSystem` does the
token → tenant hop and nothing else; every read after it runs under
`withTenant` as `staff`. Every refusal — unknown, revoked, expired,
malformed — renders the same words.

**Deliberately thinner than a document share**, because what is behind it is
marketing copy the owner intends to publish, not files: no passcode, no use
cap. `expires_at` stays NOT NULL, which is the one rule kept whole — there are
no never-expiring anonymous links in this product.

**Revoking is an UPDATE, and there is no DELETE policy at all.** A link handed
to somebody outside the business is not the owner's to erase; who made it,
when, and whether it was opened survives the revocation. It dies only with its
site.

**A preview is not a visit.** `isLiveMode` gates the visitor beacon, the
structured data and the canonical URL, and the enquiry and booking forms are
shown but disabled.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A short-lived cookie, then the existing `/sites/<slug>/draft` | Far less code, and it would mean teaching `resolveTenantContext` about a second kind of principal. Auth is the last place to be clever; a read-only route family is the boring, auditable version |
| Thread a `linkKey` prop through the thirteen components that take `mode` | One missed call site is a link that silently points at the members-only route — and the compiler cannot see it, because the argument is a `string` either way. Substituting the slug once makes the mistake unrepresentable |
| Serve preview images from the existing member route | It wants a session, which is the thing a client does not have |
| Let the preview take form submissions | A client reviewing their own site would create a real lead from a visit that never happened, and inflate the owner's visitor count on day one |
| Delete a revoked link | Loses the record of a secret that was handed outside the business, which is exactly when a record matters |

## Consequences

**What it buys.** A business can be shown its site before anything is on the
internet, on any device, with no account — and the owner can see whether they
have opened it yet, which is otherwise a phone call.

**What it costs.**

- **A fourth address shape to keep in step.** Anything added to
  `/sites/<slug>/…` has to be added to `/p/<token>/…` or it silently breaks in
  previews only. The logo route exists purely to keep the mirror complete —
  `/sites/<slug>/logo` would have served it — because one shape that did not
  follow the rule is the one somebody forgets.
- **The slug substitution is a trick, and it is only safe because of two
  gates.** `site.slug` inside the renderer is the token in preview mode, so
  anything that needs the REAL slug must be switched off there. Today that is
  the visitor beacon and the forms, and both are gated. A third such use would
  need the same treatment and nothing enforces that but this paragraph.
- **A preview's images are served on a private, five-minute cache**, so a
  revoked link stops serving pictures promptly rather than when a cache
  decides. That costs a re-fetch on every look.

## Notes

**Found on the way and fixed here:** `memberMapResponse` still resolved the
tenant's site with `findFirst` by tenant alone — left behind by ADR 0045, and
with two sites it drew one site's pin in the other's brand colour. It now takes
a site id, and the member map route reads one from the query.

**What would make us revisit:** a client who wants to leave comments on the
preview. That is a different feature with a different table, and it would want
the passcode this deliberately leaves out.
