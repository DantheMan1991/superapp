# 0015 — A connected account belongs to a company, not to the client

- **Date:** 2026-08-25
- **Status:** Accepted (slice built 2026-08-25)
- **Affects:** Layer 0 payments; `retail` slices 2 and 5; `docs/security.md` §6
  and S7; ADR [0010](0010-entities-inside-a-tenant.md)

## Context

The pilot farm cannot take a credit card. Everything else about a market day is
built — the price list, the till, the truck, the cash count — and the one thing
a customer at a stall most often wants to do is the one thing the product cannot
do. Retail's own dossier said offline (slice 1b) was next; the founder corrected
that on 2026-08-25: **he has signal almost all of the time, and what he cannot
do is take a card.** So the payment slices move to the front and 1b becomes
robustness rather than a blocker.

Taking a card means money moving into somebody's bank account, and that forces
three questions at once: whose Stripe account, whose liability, and whose row.

**There are now two Stripes in this codebase and they point in opposite
directions.** What exists today is the PLATFORM charging the TENANT —
subscriptions, hour blocks, `src/lib/stripe.ts`, `src/lib/billing-sync.ts`,
`/api/webhooks/stripe`. This decision is about the TENANT charging THEIR
customer. Same SDK, same secret key, opposite direction, and nothing in the
existing code says which it is, because until now there was only one.

The hardware question is already settled and is not re-argued here: a
**networked reader**, driven server-side from the till in a browser. Tap to Pay
on the farmer's own phone requires a native iOS/Android shell and Yosher is a
Next.js web app, so it is not available — a fact about the platform, not a
preference.

## Decision

**A Stripe connected account is created per Connect, one per LEGAL ENTITY, and
the row hangs off `entities` — nullable, adopted when the books open.**

- `payment_accounts.entity_id` is a composite `(tenant_id, entity_id)` FK to
  `entities`, nullable, with a partial unique index making at most one
  unadopted account per tenant possible.
- **We store the connected account id (`acct_…`) and nothing that is a
  credential.** Charges are made on the tenant's behalf with the platform key
  plus `stripeAccount`. The tenant's own secret key is never stored, never
  asked for, never seen.
- **Every field on the row is Stripe's verdict, not the app's.** The
  `card_payments` capability status, what Stripe is still waiting for, and who
  it is waiting on. They are written only from a signature-verified Connect
  event or a server→Stripe read, exactly as S7 requires of billing — and here
  the rule is given teeth: **members hold a SELECT policy only.** No tenant
  transaction can write this table at all.
- **Onboarding is Stripe-hosted Account Links.** The app never collects a tax
  ID, a bank account, an ID document or a beneficial owner.
- **Liability, fees and tax reporting are the farm's**, stated explicitly
  rather than left to defaults: `losses_collector: stripe`,
  `fees_collector: stripe`, `dashboard: full`. That is the account shape Stripe
  used to call Standard.
- **Built on Stripe's Accounts v2 API** (`/v2/core/accounts`), not v1. See the
  section below — that was forced mid-slice and it changed the schema.

## Why the entity and not the tenant

This is the decision worth arguing, because the tenant is the cheaper answer and
it is wrong.

**ADR 0010's own test decides it.** That ADR draws the line at *does it have to
balance* — a dimension slices one set of books, an entity IS one — and it lists
what belongs to exactly one entity: bank accounts, invoices, bills, fixed
assets, period closes. A connected account is a **bank account with a KYC
wrapper around it**. The money lands in one account, owned by one company.

Three consequences make it concrete:

1. **KYC is per legal person.** A connected account collects an EIN, a legal
   name, a representative and a bank account. The `Test` tenant deliberately
   holds two companies with two tax IDs; one connected account cannot be both.
   A tenant-level account would force a landlord with ten LLCs to route ten
   companies' card revenue through one company's Stripe account.
2. **Stripe issues the 1099-K to the connected account's tax ID.** Hang the
   account off the tenant and one company's card revenue lands on another
   company's tax form. Nothing in the app could detect it. The number would
   simply be wrong on a document filed with the IRS.
3. **`retail` slice 2 posts settlements and fees to the books, and a journal
   entry requires an entity.** If the account hangs off the tenant, the posting
   engine has to guess which company's books a settlement belongs to — and ADR
   0010 already records what that produces. A fixed asset's depreciation used to
   land in whichever company the tenant default happened to be at the moment
   somebody first pressed Post: **a write that inherited a scope**, every entry
   balancing, nothing complaining. Deriving the company from the sale's channel
   instead would be worse, because a channel is not a set of books.

**The sentence that will be cited against this, and why it does not apply.** ADR
0010 says plainly: *"Billing is per tenant, so ten LLCs is one subscription."*
That is about the platform charging the client — the other Stripe. Reading it as
guidance for this one is precisely the tangle this ADR exists to prevent, and it
is the reason `payment_accounts` sits in its own schema domain rather than next
to `subscriptions` in `platform.ts`.

**Nullable, because retail does not require accounting.** `retail` depends on
`inventory`, not on the books; a farm can sell at a market with no chart of
accounts and therefore no company at all. Telling it to open a set of books
before it can take a card would be the platform's plumbing showing. So
`entity_id` is nullable and the account is **adopted** when the books open —
assigned to the tenant's default company, guarded to nulls, the same treatment
`provisionAccounting` already gives an asset bought before there were books.

## Accounts v1 or v2

**This was not a free choice and it was made after the table already existed.**
The first implementation used `stripe.accounts.create` (v1), which is what every
Connect tutorial and most of the SDK's surface still describes. The first real
call returned:

> *Stripe no longer recommends Accounts v1 for new Connect integrations. Create
> connected accounts with `POST /v2/core/accounts` instead… If your integration
> requires v1 account creation for a supported compatibility scenario, enable
> Accounts v1 support in the Dashboard.*

So there was a toggle that would have made the finished code work, and the
decision was whether to flip it.

**We did not.** This integration had created exactly zero accounts, so the
migration cost was a migration on an empty table and an afternoon; the same move
a year from now happens with real farms' live accounts on it. Making a
deprecation shim load-bearing on day one, to avoid a cost that only grows, is
the trade this codebase declines everywhere else.

**v2 is also a better fit for the one screen this slice is about**, which was
not obvious until a real account was read:

- **`awaiting_action_from` is a field, not an inference.** v1 made you derive
  "is Stripe reviewing, or is the farm holding it up" from `details_submitted`
  plus an empty requirements list. v2 says which, per requirement. That is the
  difference between a screen that shows a farmer their homework and one that
  invents homework for somebody who has none.
- **`restricts_capabilities` keeps "payouts on hold" expressible.** v2 has no
  `payouts_enabled` boolean, which looked at first like a loss. It is not: a
  missing bank account is a requirement restricting `stripe_balance.payouts` and
  not `card_payments`, so "taking cards, nothing reaching the bank" is still
  representable — and now it is derived from the actual reason rather than from
  two booleans that had to be read together.
- **`status_details[].resolution`** — `provide_info`, `contact_stripe`,
  `no_resolution` — is Stripe telling the screen which button to offer.

**What v2 cost, honestly.**

- **`requirements.entries[].description` is a MACHINE key despite its name.** We
  expected English and there is none; `external_account`,
  `representative.given_name`, `configuration.merchant.mcc`. The translation
  table survives, rewritten in v2's vocabulary. Only `errors[].description` is
  human-readable, and only once something submitted has been rejected.
- **`identity.country` is required before `configuration.merchant` can be set.**
  v1 defaulted it to the platform's country. Nothing on `tenants` holds a
  country, so it is a `US` constant and the first thing that has to become a
  real field for a client outside the US.
- **`include` is required or the response is a skeleton.** `configuration`,
  `requirements`, `identity` and `defaults` are omitted unless named — so a read
  that forgets looks exactly like an account with no capabilities and no
  outstanding requirements, which is the most dangerous possible wrong answer
  here.
- **Events are v2 thin events**, carrying a reference rather than an object, so
  the webhook has to fetch. That turned out to be the best property in the
  design: the event is a nudge and the trusted data always comes from a
  server→Stripe read, so S7 holds by construction rather than by discipline.
- **The SDK's v1 surface is the discoverable one.** `stripe.accounts.create`
  autocompletes; `stripe.v2.core.accounts.create` has to be known about. Both
  libs carry a comment saying so, because the failure is at runtime only.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **One connected account per tenant** | One EIN, one 1099-K and one bank account for a client that has two of each. Wrong on a tax form, and it leaves slice 2's settlement entry with no company to post into. Cheapest by far, and **a one-company test tenant cannot see that it is wrong** — the exact blind spot that cost `production` slice 2c a real bug. |
| **Store the tenant's own Stripe secret key** | The obvious shortcut: ask the farm to paste `sk_live_…` into a form. It puts a C5 secret **per client** in a column, granting unlimited charge, refund and payout authority over their money, with no scoping and no revocation short of a rotation they must perform themselves. `APP_ENCRYPTION_KEY`'s blast radius would grow from "tokens" to "every client's money", and `docs/security.md` would have to be rewritten to allow it. The connected account id is an identifier, not a credential; the authority comes from the platform key plus `stripeAccount`, and the farm can revoke it from its own dashboard. |
| **Express or Custom with `requirement_collection: application`** | We would collect the KYC ourselves: the fields, the documents, the re-collection every time Stripe changes what it wants, in every country. A compliance surface with no revenue attached, dragging the owner's identity documents into C3/C4 for no gain. Hosted Account Links cost nothing and staying current is Stripe's problem. |
| **Platform liability (`losses.payments: application`)** | Puts chargebacks for meat Yosher never saw on Yosher's balance sheet, and makes the platform the merchant of record for every client. |
| **`entity_id` NOT NULL** | Forces a farm to open a chart of accounts before it can take a card. `assets` already made this call the other way, and `provisionAccounting` already has the adoption pattern. |
| **A `provider` column, adapter-shaped from day one** | A column with one value and no second implementation. Every stored field is Stripe's vocabulary (`charges_enabled`, `requirements.currently_due`); pretending otherwise would be a rename that documents nothing. A second provider is a new column, and the table name does not have to change for it. |
| **Members may write the row** | It is the app asserting what only Stripe may assert. A forgotten `withTenant` or a careless future action could flip `charges_enabled`, and the till would believe it. |
| **Defer until the reader slice** | The account is the prerequisite for all of it: registering a reader, creating a PaymentIntent, receiving a settlement. Nothing about payments can start without it. |
| **Enable the Accounts v1 compatibility toggle** | It would have made the already-written code work in five minutes. It also makes a deprecation shim load-bearing on day one, and moves the real migration from an empty table today to real farms' live accounts later. Argued in full above. |

## Consequences

**What this buys.** Payouts land in the farm's own bank, under the farm's own
KYC, with the farm's own liability and its own 1099-K — per company, so a
two-LLC client is right rather than nearly right. Yosher never holds funds,
never becomes a money transmitter, and never sees a card number. The reader
slice has somewhere to hang a Terminal location, and the settlements slice has a
company to post into.

**What it costs, honestly.**

- **A one-company tenant cannot see the difference**, which is the whole risk.
  `Test` deliberately holds two companies and is the only place the difference
  is visible by hand. Anything built on this that is driven only against
  `Hilltop Farm` has proved nothing about the entity.
- **The picker appears at two**, so the settings screen is a list of companies
  rather than a single card. More UI than a tenant-level design, and it is the
  cheaper half of the cost above.
- **Connect events need their own endpoint and their own signing secret.**
  `account.updated` is delivered to a Connect-enabled webhook, so there is a
  second route and a second env var. Missing it fails quietly rather than
  loudly: the reconcile on page load heals the state, so the screen is right
  when somebody looks at it and stale when nobody does. That is acceptable here
  only because nothing yet acts on the state without a person present, and it
  stops being acceptable the moment the till reads it.
- **Adoption is lazy, not transactional.** `provisionAccounting` runs inside a
  tenant transaction and this table refuses tenant writes, so the books cannot
  adopt the account as they are created. Adoption runs under `withSystem` from
  the payments lib when the settings page loads or an onboarding link is minted.
  A tenant that opens its books and never opens the payments page keeps a null
  company until it does — harmless today, and a thing to remember when slice 2
  starts reading the company for real.
- **Nothing here charges anybody.** A `card_payments` status of `active` means
  Stripe would accept a charge, not that the app can make one. Two slices
  separate those.
- **The country is a constant.** v2 requires `identity.country` and nothing on
  `tenants` holds one, so every connected account is created as `US`. Correct
  for every client today and wrong the moment one is not.
- **A farm can disconnect from its own Stripe dashboard**, and the row survives
  it because slice 2's settlements will reference it. Marked, never deleted.
- **The requirement translation table is a maintenance tax with no alarm on
  it.** Stripe's requirement keys are machine strings and this repo turns them
  into English by hand. An unrecognised key renders as a prettified key rather
  than disappearing, which is the right failure — but nothing tells us it
  happened. `scripts/stripe-connect-probe.ts create` prints the current list.

## Notes

**What lands where next, so this does not paint into a corner.** Registering a
Terminal location and reader, and creating a PaymentIntent on the connected
account, are the next slice; the settlement and its fee reaching the books is
the slice after. Both hang off this row: the reader off `(tenant_id, id)`, and
the settlement's journal entry off the same `entity_id` this row already names.
`retail_sales.payment_method` has been recorded since retail slice 1 precisely
so that matching has something to match against.

**The state nobody designs is the one most farms will sit in.** Onboarding is
not a click — Stripe asks for a tax ID, a bank account and often an ID document,
and a real farm sits in "needs information" for a day or two. So the screen
names the outstanding requirements in English rather than showing a spinner or a
bare `representative.given_name`, and the translation of Stripe's field names is
a pure function with tests, because it is the part a farmer actually reads.

**And driving that state killed a rule that had looked obvious.** The badge
turned amber when any requirement was `past_due` — which in v2 is EVERY
requirement on a brand-new account, because nothing has been provided yet. A
farm that clicked Connect thirty seconds earlier saw the alarm colour, so by the
time it was genuinely late the badge said exactly what it had always said. Amber
now means Stripe has put a real DATE on it, which is why the deadline status and
the deadline time are two columns rather than one.

**What would make us revisit:** a client wanting one Stripe account across
several of its companies — a single-member group filing one return for all of
them. That is legitimate and this schema refuses it (unique per company). The
answer would be a many-to-one, not a widening, and it wants its own ADR.
