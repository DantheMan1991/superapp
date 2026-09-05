# 0022 — Page views are counted by a first-party beacon that keeps nothing about the person

- **Date:** 2026-09-04
- **Status:** Accepted (built 2026-09-04, Marketing slice 4b)
- **Affects:** Marketing (`site_page_views`, the public routes, the Website
  screen), `src/app/api/sites/view`, `docs/security.md` trust boundaries
- **Builds on:** [0019](0019-a-website-is-pages-of-typed-sections.md),
  [0021](0021-a-website-enquiry-lands-as-a-party.md)

## Context

A business wants to know whether anyone looks at its website. The pages
are served from a cache (ISR, ADR 0019), so counting on the server would
count cache misses, not people. Something has to run in the visitor's
browser, and whatever runs there decides what the platform learns about a
stranger who never agreed to anything.

The honest number a small business wants is "how many people came today,
and which pages did they look at". It does not want, and should not be
made to hold, a record of who those people were.

## Decision

1. **A first-party beacon, ours.** A client component on every public page
   posts `{ site, path, first }` once per page load to `/api/sites/view`,
   under the platform's `/api/` prefix so the proxy leaves it alone on a
   site's own hostname. No third-party script, no consent banner to earn.
2. **The browser tells a visitor from a view.** It keeps a "counted today"
   note in its own storage, keyed by site and calendar day, and says
   `first: true` once a day. That is the whole mechanism: no cookie, no IP,
   no user agent, nothing hashed. A browser that refuses storage counts as a
   view and never as a visitor. The server trusts the word because a
   counter that can be inflated is still only a counter — nothing else
   hangs off it.
3. **Counters, one row per page per day.** `site_page_views` holds `views`
   and `visitors` per `(site, day, path)`; a day's visitors is the sum over
   its pages (each browser is first on exactly one page). The day is the
   tenant's timezone's. Rows are never deleted by the app; pages × days is
   small.
4. **The write is bounded the way the enquiry's is** (ADR 0021): slug → the
   trusted lookup → published only → `staff` inside the tenant → the member
   policies. And only a path that IS a published page of the site counts,
   so a stranger cannot grow the table with invented paths. The route
   answers 204 whatever happened: which addresses exist is not something a
   beacon should be able to ask.
5. **The draft preview does not count.** An owner looking at their own
   draft is not a visitor.

## Consequences

- The numbers are honest but not forensic: two browsers on one desk are
  two visitors, a cleared storage is a new visitor tomorrow, and a bot that
  runs JavaScript is counted while one that does not is not. The screen
  says what a visitor is.
- Nothing here can be joined to an enquiry, a party or anything else about
  a person, by design. A future "which pages did this contact read" would
  be a different decision and a different ADR.
- The beacon can be inflated by anyone who cares to; there is no cap
  because the write is an increment on one row and the ledger the caps use
  would gain a row per view. If inflation ever matters, a per-site daily
  ceiling on `views` is the first thing to add.

## Alternatives rejected

- **Server-side counting in the page.** Counts cache misses, not people.
- **Hashing the IP and user agent to tell visitors apart.** Keeps a
  derivative of a person's address on the platform's disk for no reason the
  business could name; the browser-side note answers the same question.
- **A third-party analytics script.** Somebody else's tag on a client's
  site, a consent conversation, and a number the platform cannot show on
  its own screen.
