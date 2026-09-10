# 0044 — An industry marketing site is data on the one front door, and its domain is a routing switch

- **Date:** 2026-09-10
- **Status:** Accepted
- **Affects:** Public site (`src/lib/verticals/`, `src/app/(marketing)/for/`), `src/proxy.ts` and `src/lib/sites/slug.ts` when a domain is added later

## Context

The front door is one page for every visitor. It has to stay
industry-neutral — a trade noun in core marketing is the same mistake as a
trade noun in `src/modules/`, and `docs/modules/public-site.md` has said so
since the site was written. That neutrality is correct and it costs
conversions: a farmer reading "the outsourced business office" has to do the
translating, and most of them will not.

The founder asked for the standard answer to that — an umbrella site listing
the industries served, with a standalone site per industry, "Yosher Homestead"
first. Three things were already true and shaped what standalone could mean:

- **One deploy, one codebase.** The monolith rule is non-negotiable, and a
  second Next.js project for a marketing site would be the first crack in it.
- **The funnel is code.** `/health-check` is an AI interview, `/sign-up` is
  Clerk, and both are the point of a vertical page. A site that cannot render
  them is a brochure with a link on it.
- **An unknown hostname is already spoken for.** `classifyHost`
  (`src/lib/sites/slug.ts`) treats any host that is not the platform's as a
  domain a CLIENT connected, and the proxy rewrites it to `/domain/<host>`.
  Pointing `yosherhomestead.com` at the app today reaches a tenant-site lookup
  and a 404 — the vertical pages had to exist before a domain could serve one.

## Decision

**A vertical is one data file** in `src/lib/verticals/` — pages of typed
sections in that industry's own nouns — assembled by one renderer at
`/for/<slug>`, inside the existing `(marketing)` route group and its chrome.
Adding an industry is a file and a registry line; there is no second site.

**The domain is a separate, later, reversible switch.** Nothing in a vertical
reads the host, so putting one on `yosherhomestead.com` is a change to
`platformHostsFromEnv` plus a rewrite in `src/proxy.ts` — and until that is
worth doing, `/for/homestead` is a real page rather than a placeholder.

**A vertical may name an industry profile, and the name is checked.**
`Vertical.industry` is a `src/industries` slug, and `tests/verticals.test.ts`
fails if it names a profile that does not exist — so the packs a page promises
and the packs a signup installs cannot drift apart silently.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| A separate codebase and deploy per industry site | Breaks the monolith rule for marketing copy, of all things. Three sites is three of everything to keep current — chrome, contact form, funnel, analytics — for one person shipping a platform |
| Separate domains from day one | Each starts from zero search authority, and it front-loads routing work for a page nobody has read yet. The content model is identical either way, so the domain can wait until a vertical has earned it |
| Build the vertical sites in Yosher's own Marketing module, as the operator tenant (ADR 0041) | The best story and the wrong tool. That renderer draws typed sections for a business's own site; it cannot host the health-check interview, sign-up, or the docs — which are exactly what a vertical page is for. **Still worth doing separately** as a demo farm site, which is a client site and what that renderer is for |
| One long "industries" section on the existing landing page | An industry needs its own title, description, URL and structured data to be findable at all. A section is not a search result |
| Subdomain per industry (`homestead.yosherapp.com`) | Not rejected, deferred. It collides with `SITE_DOMAIN`'s site-slug rules and needs that boundary worked out first; the path form has no such question |

## Consequences

**What it buys.** A new industry is a data file, a registry line and a
build-log entry — no chrome, no deploy, no funnel to re-wire. The industries
list on `/for` and the strip on the landing page are both `map`s over the same
registry, so neither can name a page that is not there. The sitemap picks up a
vertical the day its file lands. The page ships no JavaScript of its own.

**What it costs.**

- **The content model is now a schema.** A section kind a vertical wants and
  the union does not have is a change to the renderer, and it lands for every
  vertical at once. That is the same bargain the tenant site templates make
  (ADR 0030) and it has the same failure mode: the second industry will want
  one thing that does not fit, and the honest fix is a new kind, not a
  `dangerouslySetInnerHTML` escape hatch.
- **Nothing here can check that a claim is true.** The tests are structural.
  The rule that every claim must be BUILT lives in a comment at the top of
  `homestead.ts`, along with the three things deliberately left off it, and it
  is enforced by a person reading a dossier.
- **A path is not a brand.** `/for/homestead` does not feel like a standalone
  site the way `yosherhomestead.com` would, and that difference is real. It is
  deferred, not denied.

## Notes

**The thing that would make us revisit:** a vertical whose audience genuinely
does not overlap the umbrella's — where sharing a header with "the outsourced
business office" costs more than sharing a domain saves. Then that one vertical
gets its own host and its own chrome, and the rest stay where they are. The
data model does not have to change for that; the renderer picks a different
frame.

The first vertical is `homestead`, and it names the `homestead-farm` profile.
Its slug is deliberately shorter than the profile's — `/for/homestead-farm`
reads like a database key — which is why the URL label and the industry slug
are two fields rather than one.
