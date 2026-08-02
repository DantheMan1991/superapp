# Public site

> The marketing surface at `yosherapp.com` — landing page, About, Contact —
> plus the content layer that lets all of it change without touching a page
> component. It is the front door for prospects; the health-check interview
> ([health-check.md](health-check.md)) is the funnel it feeds.
> Status: live · Scope: `platform`

## Build log

Newest first. One entry per session/PR that touched this area. Every PR
that changes it MUST add an entry here (rule in AGENTS.md).

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
  `contact/` (`page.tsx`, `contact-form.tsx`, `actions.ts`, `schema.ts`)
- `src/lib/site.ts` — **the** content knob: nav, contact, images
- `src/lib/contact.ts` — caps, hashing, Resend send
- `src/app/sitemap.ts`, `src/app/robots.ts`

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
  data change, not a code change.
- No blog, case studies or pricing page.
- No analytics on the funnel — there is no measurement of landing → health
  check → promoted prospect.
