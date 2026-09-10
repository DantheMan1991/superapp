# Public site

> The marketing surface at `yosherapp.com` — landing page, About, Contact —
> plus the content layer that lets all of it change without touching a page
> component. It is the front door for prospects; the health-check interview
> ([health-check.md](health-check.md)) is the funnel it feeds.
> Status: live · Scope: `platform`

## Build log

Newest first. One entry per session/PR that touched this area. Every PR
that changes it MUST add an entry here (rule in AGENTS.md).

### 2026-09-10 — Yosher Homestead, and the industries we serve (`claude/yosher-homestead-vertical`)

The founder: "a really good marketing website for Yosher Homestead … a
general Yosher website that lists all of the industries we serve but then
stand alone sites for each industry." No migration.
[ADR 0044](../decisions/0044-an-industry-marketing-site-is-data-on-the-one-front-door.md)
records the shape: **a vertical is DATA on the one front door, and its domain
is a routing switch that can wait.**

- **The registry** (`src/lib/verticals/`): `types.ts` is the typed section
  union — `hero`, `problems`, `capabilities`, `spotlight`, `steps`, `faq`,
  `cta` — and a `Vertical` carries its URL slug, its sub-brand, the industry
  profile it sells, the card for the list, and its SEO pair. `index.ts` is the
  one file naming a vertical. Adding an industry is a file and a line.
- **One renderer**, `src/components/marketing/vertical-sections.tsx`, a server
  component: a vertical page ships no JavaScript of its own, and the FAQ opens
  with `<details>` — the same script-free disclosure the tenant sites' phone
  header uses, which matters for a reader on one bar of signal in a field.
  **Bands are computed, not declared**: the hero bands itself and everything
  after alternates by index, so a section inserted in the middle re-stripes
  what is below it and a data file cannot get the rhythm wrong.
- **The pages**: `/for` lists the industries (every card a registry row, plus a
  dashed "Not your trade?" panel that is deliberately NOT a registry row), and
  `/for/[vertical]` renders one. An unknown slug is a 404. The landing page's
  three-layers section gained a strip of the same registry — INSIDE that
  section rather than beside it, which keeps the plain/muted alternation
  intact — and `Who it's for` is now first in `NAV`, because "is this for me?"
  is a stranger's first question.
- **Yosher Homestead** (`src/lib/verticals/homestead.ts`), in the
  `homestead-farm` profile's own nouns — paddock, lot, kill sheet, cut sheet,
  the butcher — so the words on the page are the words on the screens. Its
  spotlight is one steer from the pasture to the freezer in six steps, which is
  the run no general accounting package can follow. **Every claim on it is
  built and shipped, and the file's header names the three things deliberately
  left off**: profit per enterprise as a report (costs carry the enterprise,
  but the revenue side is `enterprises` slice 4 and parked), email from the
  farm's own domain (SES production access refused 2026-09-07, outbound
  sandboxed), and licensed professional review (the landing page frames it as
  a direction on purpose).
- **SEO**: `generateMetadata` per vertical with a canonical and OpenGraph, and
  **`title: { absolute }`** — the root layout's template is `%s · Yosher` and a
  sub-brand already carries the name. FAQ structured data comes from
  `faqJsonLd` (`src/lib/sites/proof.ts`), the same one implementation the
  tenant sites use. The sitemap maps the registry, so a vertical is crawlable
  the day its file lands.
- **Driven on localhost.** `/for/homestead` and `/for` rendered at 1280 and at
  375 with no horizontal overflow and no console or server errors; the hero's
  `#what-it-does` button resolves; an unknown slug 404s while both real routes
  answer 200; the `FAQPage` JSON-LD and both new sitemap URLs are in the
  response. **A `<details>` trap worth writing down:** a closed answer's
  `getBoundingClientRect()` reports a non-zero height, because Chrome hides
  closed content with `content-visibility` rather than `display: none`.
  `checkVisibility()` is the API that answers correctly — it returned `false`,
  and the section measured 721px closed against 801px with one open.
- **Tests**: `tests/verticals.test.ts` — unique URL-safe slugs, an `industry`
  that must name a real profile in `industryRegistry`, exactly one hero and it
  first, every `#anchor` resolving to a section id on that page, every href
  in-site, every asked question answered (so none is dropped from the
  structured data), and the title/description inside what a search result
  shows.
- **Not built here:** a second vertical, a domain of its own (the routing note
  is in ADR 0044), photographs — the page carries none, and a farm page will
  want them — and a health check that knows which vertical sent the visitor.

### 2026-09-04 — The contact form's caps move to a shared valve (`claude/marketing-site-forms`)

`src/lib/contact.ts` no longer carries its own `ipKey`/`overCap`: the
`public_access_attempts` counting lives in `src/lib/public-caps.ts`
(`ipKey`, `overPublicCap`, a `PublicCap` of kind + hourly-per-IP + daily),
because the tenant websites' enquiry forms (Marketing slice 4, ADR 0021)
needed the same valve. The contact form's numbers (`contact_form`, 5 per IP
per hour, 200 per day) and behaviour are unchanged; only where the code
lives moved.

### 2026-07-28 — The whole business, and the three layers (`5f77dc9`, PR #28)
- Landing page rewritten around the actual positioning: a whole-business
  platform (field crews, shop floors, jobs), not office software. The three
  layers — core tools, capability packs, industry profiles — are the page's
  spine, mirroring [extension-model.md](../extension-model.md).
- Copy stays industry-neutral throughout. Naming a trade in core marketing
  is the same mistake as naming one in `src/modules/`.
- `sitemap.ts` and `robots.ts` added; absolute URLs come from `SITE.url`.

### 2026-07-28 — Shared chrome, About, Contact, and an image system (`4ba0de7`, PR #28)
- `(marketing)` route group with its own `layout.tsx`: header, nav and footer
  shared across `/`, `/about`, `/contact`, `/health-check`. The app shell and
  the public site do not share chrome — different audiences, different nav.
- `src/lib/site.ts` is the single content knob: nav, contact details and every
  image path. Pages read from it and never hardcode a path or an address.
- **Every contact field is optional and a null renders as nothing.** A blank
  slot beats a placeholder phone number a real prospect tries to call.
- Contact form: server action → `submitContactEnquiry` → Resend to a fixed
  recipient. Honeypot, Zod, per-IP and platform-wide caps.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `public_access_attempts` | Rate-limit ledger shared with the health check | Counted in the same transaction as the insert, so concurrent submissions cannot both pass the cap |

No enquiry table. Contact messages are relayed by email and not stored —
there is no CRM yet, and a table of unread prospect messages nobody reads is
worse than none.

## Key files & seams

- `src/app/(marketing)/` — `layout.tsx` (shared chrome), `page.tsx`, `about/`,
  `contact/` (`page.tsx`, `contact-form.tsx`, `actions.ts`, `schema.ts`),
  `for/` (`page.tsx` the industries list, `[vertical]/page.tsx` one industry)
- `src/lib/site.ts` — **the** content knob: nav, contact, images. Stays
  industry-neutral; trade nouns belong in a vertical
- `src/lib/verticals/` — one file per industry we sell to, plus the registry
  ([ADR 0044](../decisions/0044-an-industry-marketing-site-is-data-on-the-one-front-door.md)).
  **Not `src/lib/site-templates/`**, which builds a CLIENT's site for their
  industry; this is ours, about that industry
- `src/components/marketing/vertical-sections.tsx` — the one renderer
- `src/lib/contact.ts` — caps, hashing, Resend send
- `src/app/sitemap.ts` (maps the vertical registry), `src/app/robots.ts`

## Decisions & gotchas

- **The recipient is fixed in code**, never derived from input. A contact form
  whose destination any field can influence is an open relay.
- **The honeypot answers with the success state**, not an error. Telling a
  scraper which submissions were rejected is how it learns to stop tripping
  the trap.
- **Only async functions may be exported from a `"use server"` file** — the
  Zod schema, the state type and the length cap live in `./schema.ts` for that
  reason. Same trap that bit the mail rules editor (`f6d1ccd`).
- **`site.ts` is imported by client components**, so it holds nothing secret
  and no tenant data. Everything in it is public by definition.
- Marketing copy stays industry-neutral — trade-specific nouns are the
  industry profiles' job, not the front door's.

## Open items

- **Real photography and real contact details are still placeholders.** The
  image system and the optional-field behaviour exist precisely so this is a
  data change, not a code change. **The vertical pages carry no photographs at
  all**, and a farm page is the one that most wants them — a hero shot, the
  herd, the market stall. That is the largest single improvement available to
  `/for/homestead` and it needs a camera, not a commit.
- **`yosherhomestead.com` is not connected**, by decision rather than
  oversight (ADR 0044). When it is worth doing: teach `platformHostsFromEnv`
  the extra host and rewrite it to `/for/homestead` in `src/proxy.ts`.
  **Until then, do not point a domain at the app expecting it to work** —
  `classifyHost` reads an unknown host as a client's connected domain and the
  lookup 404s.
- **The health check does not know which vertical sent the visitor.** A farmer
  arriving from `/for/homestead` gets the same neutral opening as everyone
  else, which wastes the one thing we already knew about them.
- **Only one vertical exists.** The second is the one that tests whether the
  section union is right; expect it to want a kind that is not there.
- No blog, case studies or pricing page.
- No analytics on the funnel — there is no measurement of landing → health
  check → promoted prospect, and now no measurement of vertical → health check
  either.
