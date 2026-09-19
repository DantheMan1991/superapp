# 0096. A route handler is a door too

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** the founder — *"It is imperative that a user can't [see] data she or he is not supposed to."*

## Context

[ADR 0093](0093-what-somebody-may-open-is-a-gate-which-company-s-rows-they-may-read-is-postgres.md)
put the person check inside `requireModuleEnabled`, and
[ADR 0095](0095-a-tool-declares-its-own-parts-and-the-gate-reads-the-path.md)
added the area check beside it. Both were argued from the same premise: that
function has 349 call sites and is the universal chokepoint, so putting the
question there covers everything without editing anything.

**It is the universal chokepoint for PAGES and SERVER ACTIONS. It is not one
for ROUTE HANDLERS, and nobody checked.**

Asked to make the restrictions finer, the first thing worth doing was to audit
what the existing ones actually cover. Nineteen route handlers read tenant data.
**None of them called `requireModuleEnabled`.** Twelve called `isModuleEnabled`,
which asks whether the BUSINESS has the tool and never whether this PERSON may
reach it.

So somebody whose access level denied Accounting outright could still

    GET /api/accounting/invoices/<id>/pdf

and be handed the invoice. They need the uuid — and uuids are in URLs, in
emails, and in lists the same person can see on screens they do have.

`tests/module-gate-scan.test.ts` did not catch it because it looked at
`page.tsx` files and `"use server"` files, and route handlers are neither. The
test that existed to make the convention structural had the same blind spot the
convention did.

The full books export was the one surface already safe, and by a different
mechanism: it refuses `role === "staff"` outright. It still asked only
`isModuleEnabled`, so an accountant on a restricted level would have got
everything.

## Decision

**`routeGate(tenantId, moduleId, areas?)`** — null when allowed, a `Response`
when not, because a handler cannot `notFound()`. It asks all three questions in
the order they matter: has the business got this tool, may this person reach it,
and may they reach the part of it this route serves.

**THE AREA IS NAMED, NOT DERIVED.** A page's area comes from its own path.
`/api/accounting/invoices/[id]/pdf` is not under `/dashboard/m/`, so nothing can
derive it — the route says which part of which tool it serves.

**EVERY MAPPING CAME FROM THE SCREEN THAT LINKS TO THE ROUTE**, not from the
route's name. `/api/accounting/documents/[id]/file` sounds like Documents and is
linked only from the accounting Inbox, so it is `accounting:receipts`. Guessing
from names is how `drizzle/0387` attached a policy to `journal_entries` because
a column was called `entry_id` when it meant `time_entries`, and that lesson is
two migrations old.

**`areas` IS ANY-OF.** A commitment PDF is linked from both the Ordered tab and
the Commitments tab; somebody who can reach either has a legitimate route to the
file, and demanding both would refuse people who should not be refused.

**A ROUTE WITH NO SIGNED-IN CALLER IS LISTED WITH ITS REASON.** The inbound mail
webhook, a device grant, a published site's images, the Square OAuth start —
each is named in `NOT_A_SESSION` with what authorises it instead. An allowlist
nobody has to justify is a hole with a comment on it.

## Consequences

- Nine signed-in data routes now refuse a person their level shuts out: two
  accounting files, the books export, a document file, and five Jobs PDFs.
- `tests/module-gate-scan.test.ts` covers route handlers in both directions —
  every one that reads tenant data calls `routeGate`, and none of them settles
  for `isModuleEnabled`, which is the weaker question that let the PDF out.
  Proved by deleting the call from the invoice PDF route and watching 1 of 228
  fail.
- A tenth route, `feedback/attachments/[id]`, is listed rather than gated:
  feedback is not a module (ADR 0053), so there is no slug to ask about.

## What this does NOT do, and it matters more than what it does

**A SCREEN GATE IS NOT A DATA GATE.** This closes doors. It does not make a
number invisible.

Denying `accounting:reports` hides the Reports pages. The same money is still in
the Journal, in the trial balance, and on a bill's detail — every one of them a
different view of `journal_lines`. If the intention is *"this person must not
see what we spend"*, taking Reports away does not do it, and an owner who
believes otherwise has been misled by a tick box.

The only mechanism that hides data whatever screen somebody finds is a **row**
rule — which is what [ADR 0094](0094-a-company-scope-is-resolved-by-the-transaction-not-passed-to-it.md)
built for companies, in Postgres, across 49 tables. Anything finer than a
company — margins, wages, one customer's balance — needs the same kind of work
again, per dimension, and should not be attempted from the area screen.

**Server actions remain area-gated only by the submitting page's path**
(ADR 0095), which is defence in depth for writes and not a boundary.

## Alternatives rejected

**Leave route handlers to the role check.** Three of the nine had no role check
at all, and role is a much blunter instrument than a level — the whole point of
levels is that "staff" is not one thing.

**Derive the area from the API path.** `/api/accounting/invoices/…` would map to
`accounting:sales` only by knowing that invoices live under Sales, which is the
kind of knowledge that rots. Naming it in the route puts the fact next to the
code that depends on it.

**Make `routeGate` throw so it matches `requireModuleEnabled`.** A thrown
`notFound()` in a route handler produces a page-shaped error for a caller
expecting JSON or a PDF.
