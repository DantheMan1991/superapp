# 0043 — The platform's revenue is posted by the webhook, as the operator's owner, through the ordinary invoice

- **Date:** 2026-09-10
- **Status:** Accepted (built 2026-09-10, back-office slice 5)
- **Affects:** the Stripe webhook (`src/app/api/webhooks/stripe/route.ts`),
  the hour-block credit (`src/lib/retainer-billing.ts`),
  `src/lib/platform-revenue.ts`, `operator_postings`, the operator's tenant
  page, Accounting's invoicing verbs (called, not changed)
- **Builds on:** [0011](0011-machine-posted-entries.md),
  [0041](0041-a-tenant-is-a-workspace-and-a-client-is-a-party-in-the-operator-tenant.md),
  [0035](0035-the-books-begin-on-a-day-and-nothing-is-dated-before-it.md)

## Context

Yosher runs on Yosher (ADR 0041), so Yosher's own books live in the operator
tenant's Accounting — and nothing put revenue in them. `subscriptions` and
`retainer_purchases` were written from Stripe's verified webhook and read by
the console's MRR stat, and no ledger ever saw a dollar. The first thing a
business notices about its own books is that its income is missing.

Three shapes were on the table. A bank feed alone (Stripe's payouts land in
the bank; the feed codes them) is what the onboarding plan prescribes for a
farm, but a payout is a lump of several clients' charges net of fees: no
revenue per client, no invoice a client's statement could show. A machine
source for invoices (ADR 0011's mechanism) would let the webhook post
without an owner — but it would also let any staff member issue an invoice,
which is wider than the need. And a separate ledger of "platform revenue"
would be a second set of books beside the first.

## Decision

**The webhook posts each charge into the operator's books through the
ordinary invoice, as the operator's owner, with nobody at the keyboard.** A
paid Stripe invoice or a paid hour-block session becomes a draft with one
line to Service Revenue (4010, else Sales 4000), issued, and paid into
Undeposited Funds on the day Stripe says it was paid, for the customer role
on the client's party — the same three verbs a person uses, called with
`{ role: "owner", userId: "" }`. Nobody is elevated: the platform is posting
its own sales into its own books, which is the distinction ADR 0011 drew
when it refused to elevate a staff member's action. The bank feed then
matches the payout, the way any business's card takings reach its bank.

Idempotent on Stripe's id twice over: `operator_postings` claims each Stripe
object once and remembers what became of it — posted with the invoice, or
skipped with the reason — and the invoice carries the id in its memo, so a
crash between the ledger write and the record is found, not repeated.

A charge that cannot post yet is **skipped with a reason, never dropped**:
no operator, Accounting off, an unknown Stripe customer, a client with no
party, nothing paid, a foreign currency, a missing account, a day before the
operator's books begin (ADR 0035), or a refusal the ledger makes. The
operator's page lists them and retries them — a client that has since got
its party posts on the retry.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| The bank feed alone | A payout is several clients' charges net of fees: no revenue per client, no invoice on a statement. The feed still matches the payout to Undeposited Funds; it is the second half, not the whole. |
| A machine source for invoices | Would widen who may issue an invoice to any staff member, to let a webhook that has no staff member post. The need is narrower than the mechanism. |
| Borrow the founder's user id | Attributes to a person what Stripe did. `userId: ""` with `actorLabel: stripe-webhook` on the audit says who actually acted. |
| A separate revenue ledger | A second set of books beside the first, and every report would have to learn it. |
| Post from the bank feed's payout when it arrives | Late by days, and by then the per-charge detail is gone. |

## Consequences

**Buys.** Revenue per client in the operator's own books, on the day it was
paid; a statement a client could be shown; the MRR stat and the P&L agree.
The founder's first real client's first payment is an invoice in Yosher's
Accounting without anybody typing it.

**Costs.** Two more Stripe events matter (`invoice.paid` joins
`checkout.session.completed`). The operator's books need Accounting on and a
chart with 4010/4000 and Undeposited Funds — the general template's, so a
custom chart must keep them. A charge before the books' start day is skipped
for good unless the start day moves. Sales tax is not applied — SaaS in the
operator's home state, a question for the accountant, recorded as an open
item. Retainer *time* is still not posted (revenue or WIP), deferred as
before.

## Notes

- **What would make us revisit:** a second currency, or a second operator.
- The lesson underneath: **an idempotency key is not enough when the write
  spans two transactions** — the second half needs its own way to find the
  first, which is what the memo marker is.
