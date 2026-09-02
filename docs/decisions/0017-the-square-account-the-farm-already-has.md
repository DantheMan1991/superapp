# 0017 — The Square account the farm already has

- **Date:** 2026-09-02
- **Status:** Accepted (slice 0 built 2026-09-02)
- **Affects:** Layer 0 payments; `retail` slices 2 and 5; `docs/security.md`
  §5, §6, S7 and S8; ADR [0015](0015-a-connected-account-belongs-to-a-company.md),
  parts of which this supersedes (named below)

## Context

Eight days after Stripe Connect shipped ([ADR 0015](0015-a-connected-account-belongs-to-a-company.md)),
the founder asked whether to switch card processing to Square. Two facts
decided the answer, and neither was new:

1. **The pilot already pays with Square.** The homestead brief
   ([homestead-farm.md](../modules/homestead-farm.md), *Payments: a provider
   seam*) records "Square plus cash today", and its own recommendation was
   *"an adapter seam with Square as the first implementation"*, read stage
   before write stage. ADR 0015 went Stripe-first and its alternatives table
   never weighs Square. That gap in the record is itself a finding: a decision
   was made implicitly, against the brief, and nothing said so.
2. **Square is what farmers markets run on.** A client arrives with the
   account, the bank link, the KYC and usually the reader. Connecting is a
   consent click. The Stripe hosted onboarding, by contrast, had sat
   uncompleted since 2026-08-25, and the dossier expects a real farm to sit in
   "needs information" for days.

Two things about Square's platform shape what follows:

- **Square has no Connect.** There is no way to create an account for a seller
  or to act for one with a platform key. The seller signs up with Square
  themselves and authorises an application through OAuth; the application
  holds a per-seller access token, scoped and revocable. Acting for a Square
  seller without holding their token is not possible.
- **Square has no KYC surface for us.** Whether a seller can take a card was
  settled between the seller and Square before Yosher was involved. The API
  reports a merchant status and, per location, whether `CREDIT_CARD_PROCESSING`
  is on. There is no requirements list to translate.

The hardware question, re-asked, comes out where ADR 0015 left it and adds one
path. A browser cannot drive a Bluetooth reader on either provider. Square's
Terminal API drives the Square Terminal, the $299 device with a screen, from
the server — the same push-then-wait shape as Stripe's reader slice. And
Square alone offers an app-switch: from the till in the phone's browser, the
Square Point of Sale app opens with the amount pre-filled, the customer taps
the $59 reader or the phone itself, and Square redirects back with the
transaction id. Stripe has nothing like it. Both paths are wanted; both hang
off the connection this ADR is about.

## Decision

**Square is the provider on offer. Stripe Connect is parked, not removed.**
A company connects the Square account it already has, through OAuth, and
Yosher holds the token — encrypted, in a table no member policy can read.

- **`payment_accounts` gains `provider` (`stripe` | `square`)** and the Square
  identifiers (`square_merchant_id`, `square_main_location_id`, a trimmed
  `square_locations` projection). `stripe_account_id` becomes nullable. CHECK
  constraints make a row that lies about its provider unrepresentable: a
  `stripe` row has a Stripe id and no merchant id, a `square` row the reverse.
  **One row per company per provider**, so a company may hold one of each.
- **The token lives in `payment_credentials`, one row per account,
  AES-256-GCM via `encryptSecret()` (S8), with NO member policy at all.**
  Superadmin and `withSystem` only. A tenant transaction selecting from it
  gets zero rows, its own tenant's included. The lib decrypts in exactly one
  function.
- **Where the account hangs does not change.** Per legal entity, nullable
  until the books open, adopted to the default company — every argument in
  ADR 0015 about the 1099-K and the settlement entry applies to a Square
  merchant exactly as to a Stripe account. Square's own unit is one business
  per account, so one merchant connects to one company per tenant (unique).
- **`card_payments_status` keeps Stripe's vocabulary for both providers.**
  `active` is the only value the till will ever treat as yes. For Square it is
  derived: merchant `ACTIVE` and at least one `ACTIVE` location carrying
  `CREDIT_CARD_PROCESSING`. Anything else is `restricted`, with a
  `status_details` code saying why. **The one fact the till asks has one
  column regardless of provider.**
- **Every column on the account row is the provider's verdict, written only
  after a server→provider read or a signature-verified event** (S7, extended
  from "Stripe" to "the provider"). Members hold SELECT only, as before.
- **The authorization-code flow with the client secret, no PKCE.** A Square
  refresh token obtained through PKCE is single-use and expires in 90 days;
  one from the code flow does not expire. A farm that connects once should
  never be asked again. The interception risk PKCE guards is covered by the
  client secret Square demands at exchange and the encrypted state cookie
  that binds the callback to the browser that started it.
- **Every scope the four payment slices need is requested once**, because
  adding a scope later sends every connected farm back through the consent
  form. `session=false`, so Square asks who is connecting even when a session
  is open: this screen decides whose bank the money lands in.
- **The environment defaults to sandbox.** Square credentials carry no
  `sk_test_` marker, so the only way to reach production Square is to say so
  in `SQUARE_ENVIRONMENT`.
- **Stripe's code and tables stay.** Rows already connected stay visible and
  manageable; a fresh Stripe connection is offered only where Square is not
  configured at all. A future client with no processor is exactly who
  Connect's hosted onboarding serves, and the homestead brief already named
  Stripe as the cheapest second provider.

## What this supersedes in ADR 0015

ADR 0015 stands for where the account hangs and why. Two of its sentences are
narrowed here, on purpose and with the reasoning:

- *"A `provider` column — a column with one value and no second implementation
  documents nothing."* True then; the second implementation now exists, and
  0015 itself said the second provider would be a new column rather than a new
  table. That is what happened.
- *"We store the connected account id and nothing that is a credential."*
  Still true of the Stripe row, and still true of `payment_accounts`. It is not
  true of the payments domain any more: `payment_credentials` holds a Square
  OAuth token. The next section is why that is a different thing from the
  secret key 0015 refused.

## Why a token is not the secret key 0015 refused

The shortcut ADR 0015 rejected was a form that takes the farm's `sk_live_…`.
That key is **unlimited authority** over the account — every charge, refund,
payout and setting, forever, revocable only by a rotation the farm must
perform itself. Holding one per client would grow `APP_ENCRYPTION_KEY`'s blast
radius from "tokens" to "every client's money".

A Square OAuth token is bounded three ways a secret key is not:

1. **Scoped.** It can do what the seller consented to and nothing else. The
   scopes are stored beside it.
2. **Expiring.** Thirty days unless renewed; the app renews inside the last
   week, and a stolen token that is not renewed dies on its own.
3. **Seller-revocable, and Square tells us.** The seller withdraws it from
   their own Square dashboard, Square delivers `oauth.authorization.revoked`,
   and the row closes and the ciphertext is blanked.

And there is no alternative: Square offers no platform-key model. The codebase
already holds exactly this kind of credential twice — Plaid access tokens and
mailbox OAuth tokens, both under `encryptSecret()` (S8). What is new is the
**table with no member policy**, which is stricter than either precedent,
because this token authorises charges and refunds on the farm's money and the
cheaper answer is to keep even its ciphertext out of member reach.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **Keep Stripe Connect as the only provider** | The pilot has Square, the market has Square, and the hosted onboarding nobody finished is the day-or-two state every new client would sit in. Stripe also has no app-switch, so the $59 reader and Tap to Pay on the farmer's phone are unreachable from a web till. |
| **A separate `square_accounts` table** | The till would read two tables to answer one question. ADR 0015 anticipated this exact moment and said the second provider is a new column. The Stripe-only columns are null on a Square row and the CHECKs keep them honest. |
| **Token columns on `payment_accounts`** | Members hold SELECT there, because the till must read it. Ciphertext in front of every member is what `mail_accounts` accepts for a mailbox; for a token that can refund the farm's money, a table with no member policy costs one join and removes the exposure entirely. |
| **PKCE, as the mail flow uses** | Square's PKCE refresh tokens are single-use and expire in 90 days. A farm that sells every Saturday for three years would be re-consenting four times a year for a threat the client secret already covers. |
| **Request only this slice's scopes** | Least privilege, and a real chore for a real person every time a slice adds one: the consent form again, per farm. One consent listing everything the roadmap needs, recorded here. |
| **Square's Node SDK** | Two reads and three OAuth calls do not need a dependency whose money type is `bigint` (which `JSON.stringify` refuses). Plain `fetch` with Zod at the boundary (S5) is what the mail flow does. Revisit when the Terminal slice wants typed checkout objects. |
| **Treat a reconcile 401 as a disconnection** | ADR 0015's rule stands: a network failure is not a disconnection. But a 401 with the token is Square answering, not the network failing, so it is written as "needs reconnecting" — `restricted` plus a detail code — never as `closed`. |
| **Remove the Stripe Connect code** | Nothing is gained by deleting a working provider that a client with no processor would want. Parked: rows visible, no new connections offered while Square is configured. |

## Consequences

**What this buys.** The pilot connects the account it already takes cards
with, in one consent, with no KYC to finish. Every farmers-market client
arrives the same way. The read stage — payments and payouts with fees into the
books — needs no hardware and no till change, and it is next. Two write paths
follow, app-switch and Terminal API, both hanging off this connection. The
496-line requirements translation table has no Square counterpart to maintain.

**What it costs, honestly.**

- **A credential per client, in the database.** Bounded as argued above, but
  a rotation of `APP_ENCRYPTION_KEY` now touches money, not just mail and bank
  feeds. The decrypt-all/re-encrypt runbook applies unchanged; the stakes rose.
- **The token is refreshed on page load only.** A farm that never opens the
  payments page for thirty days ends up with an expired access token, and the
  refresh then happens on the next load. Harmless while nothing acts without a
  person present; **the moment the till reads this connection, a scheduled
  refresh stops being optional** — the same shape as the webhook argument in
  ADR 0015. Recorded as an open item in the dossier.
- **Square's webhook needs its own subscription and signing key**, and its
  own signature scheme (HMAC over notification URL plus body). Missing it fails
  quietly, exactly as the Connect webhook does, and stops being acceptable at
  the same moment.
- **The notification URL is part of the HMAC.** A trailing slash or an
  http/https mismatch between `NEXT_PUBLIC_APP_URL` and the Developer Console
  fails every signature, silently, until somebody compares the two strings.
- **Square deletes completed Terminal checkouts after 30 days.** The slices
  that take a payment must record the payment id on the sale at charge time;
  "reconcilable only in the provider" stops being an option.
- **The `provider` default stays on the column**, against the convention that
  discriminators get none: it was added to a table with live rows and running
  code that inserts without naming a provider, and the migration lands before
  the deploy. Dropping it would be a second migration after the deploy, for a
  column every insert site now names anyway.
- **Two providers on one page.** A company shows a Square card, and a Stripe
  card only where one was connected. Nothing connected disappears, and the
  screen is longer than a one-provider design.
- **Still US-shaped.** Nothing here adds a country; Square reports one per
  merchant and it is stored for display, as Stripe's is.

## Notes

**What lands where next.** The read stage first — Square's Payments and
Payouts APIs, matched to market days and posted with the fee breakdown, which
the homestead brief argued delivers most of the value with no hardware. Then
the app-switch write path (Square Point of Sale API, mobile web), because the
pilot's hardware exists today. Then the Terminal API. Each is its own slice
and its own dossier entry; each writes a payment row on the sale.

**Sandbox.** Square's sandbox is a separate application with its own
credentials at `connect.squareupsandbox.com`, and the OAuth flow there is
driven from the Developer Console's sandbox test account. The Point of Sale
API cannot be tested in the sandbox at all — that slice will need a real phone,
the real Square app and small real charges.

**One thing not settled by Square's docs as read:** whether an application
must be listed on the App Marketplace before sellers other than the developer
can authorise it. The OAuth pages do not say. Confirm before the second client.

**What would make us revisit:** a client wanting one Square account across
several of its companies (the schema refuses it, unique per company — the same
many-to-one question ADR 0015 deferred), or Square offering a platform-key
model that removes the need to hold a token at all.
