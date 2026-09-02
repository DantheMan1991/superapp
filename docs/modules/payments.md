# Payments (taking money)

> **The client charging THEIR customer.** One connection per legal entity to the
> provider the client takes cards with — **Square, the account the client
> already has**, on offer since 2026-09-02; or Stripe Connect, built first and
> now parked — so card takings land in the client's own bank, under the
> client's own KYC, liability and tax form. Platform machinery (Layer 0) rather
> than a module: any pack could sell through it, and `retail`'s market till is
> simply the first to want to.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

**READ THIS BEFORE ANYTHING ELSE IN THIS AREA.** There are two Stripes in this
codebase, they point in opposite directions, and **they are not even the same
Stripe API**:

| | Direction | API | Table | Lib | Webhook |
| --- | --- | --- | --- | --- | --- |
| **Billing** | The PLATFORM charges the TENANT | Stripe v1 | `subscriptions` | `src/lib/billing-sync.ts` | `/api/webhooks/stripe` |
| **Payments** (here), Stripe — parked | The TENANT charges THEIR customer | **Stripe Accounts v2** | `payment_accounts` where `provider = 'stripe'` | `src/lib/payments/connect.ts` | `/api/webhooks/stripe/connect` |
| **Payments** (here), Square — on offer | The TENANT charges THEIR customer | **Square OAuth + REST**, plain `fetch` | `payment_accounts` where `provider = 'square'` **+ `payment_credentials`** | `src/lib/payments/square/` | `/api/webhooks/square` |

Same SDK object, same platform secret key, everything else opposite. The next
person will assume there is only one — that assumption is why the table lives in
its own schema domain, why the webhook is a second route rather than a branch,
and why the nav row beside "Billing" is labelled "Taking payments" instead of
something shorter.

**AND SINCE 2026-09-02 THE PAYMENTS SIDE HAS TWO PROVIDERS, pointing the same
way but built on opposite models.** Stripe Connect: the platform CREATES an
account for the farm and acts on it with the platform key — an identifier
stored, never a credential. Square: the farm ALREADY HAS an account, authorises
Yosher through OAuth, and Yosher holds a scoped, revocable, encrypted token in
`payment_credentials`, a table with no member policy. Square has no Connect and
no KYC surface for us; the API reports the verdict, not the homework.
`payment_accounts.provider` says which row is which and CHECKs stop a row lying.

**`stripe.accounts.create` is the WRONG call here and it autocompletes.** This
integration uses `stripe.v2.core.*`. Reaching for the v1 surface fails at
runtime and only at runtime.

The decisions are [ADR 0015](../decisions/0015-a-connected-account-belongs-to-a-company.md)
(where the account hangs — unchanged for both providers) and
[ADR 0017](../decisions/0017-the-square-account-the-farm-already-has.md) (why
Square, why a token is not the secret key 0015 refused, why one table). Read
both before changing where the account hangs, which provider is offered, or
what is stored.

## Slice order

**REORDERED 2026-09-02.** The Stripe slices are numbered as they were; the
Square slices are `S0`–`S3`. Read the State column, not the digits. The order
is the homestead brief's: read before write, and both write paths are wanted.

| # | Slice | State |
| --- | --- | --- |
| **S0** | **Square: connect the account the farm already has, per company — OAuth, encrypted token, the settings screen, revocation webhook, disconnect** | **shipped 2026-09-02** — built and tested; **never driven against Square**, because no Square developer application exists yet (Open items) |
| S1 | **Read: Square payments and payouts, with fees, into the books** (`retail` slice 2) | **next** — no hardware, no till change, and the pilot's existing Square payments are the data |
| S2 | **Write, path one: the app-switch.** The till in the phone's browser opens the Square Point of Sale app with the total; the customer taps the $59 reader or the phone; Square redirects back with the transaction id | after S1. Writes a payment row on the sale at charge time |
| S3 | **Write, path two: the Terminal API.** Pair a Square Terminal by device code; push a checkout with the itemised cart; webhook reports it | after S2 |
| **0** | Stripe Connect: the connected account per company, hosted onboarding, the settings screen | **shipped 2026-08-25, parked 2026-09-02** — rows stay visible; a fresh Stripe connection is offered only where Square is not configured |
| **1** | Stripe Terminal: register a location and a reader, PaymentIntent on the connected account, push it to the reader | **shipped 2026-08-25, parked** — a real card-present charge settled on the connected account |
| 1b | The TILL takes a card through Stripe: wire `collectPayment` into `recordSale` | parked behind S2/S3 |
| 3 | Refunds from the till | |
| 4 | Online / card-not-present, for `retail` slice 6's orders | |

## Build log

Older entries — the two Stripe slices of 2026-08-25 — are in
[payments-build-log.md](payments-build-log.md), swept there on 2026-09-02 so this
file stays a few screens long.

### 2026-09-02 — Slice S0: the Square account the farm already has (`claude/the-square-account-the-farm-already-has`)

**THE FOUNDER ASKED WHETHER TO SWITCH TO SQUARE, AND THE BRIEF HAD ALREADY
ANSWERED.** [homestead-farm.md](homestead-farm.md) records that the pilot pays
with "Square plus cash today" and recommends *"an adapter seam with Square as
the first implementation"*, read stage before write stage. ADR 0015 went
Stripe-first eight days earlier and never weighed Square. So this is less a
reversal than a return to the plan, made at the cheapest possible moment:
nothing live, no live key, no hardware bought, no farm onboarded.
[ADR 0017](../decisions/0017-the-square-account-the-farm-already-has.md) has the
argument and the honest cost.

**SQUARE HAS NO CONNECT, AND THAT DECIDES THE SHAPE.** There is no way to
create an account for a seller or act on one with a platform key. The seller
authorises the application through OAuth and the application holds a token.
So:

- **`payment_accounts` gains `provider`** (`stripe` | `square`), the Square
  identifiers, and CHECKs that make a row that lies about its provider
  unrepresentable. `stripe_account_id` is nullable now — and only on a Square
  row. One row per company PER PROVIDER; a company may hold one of each. ADR
  0015 said the second provider would be a new column; it was.
- **The token lives in `payment_credentials`, encrypted (S8), in a table with
  NO member policy at all** — stricter than `mail_accounts`, which lets members
  see a mailbox token's ciphertext. This token can charge and refund the farm's
  customers, and nothing in a tenant transaction ever needs it. The lib decrypts
  in exactly one function. A tenant's own OWNER selects zero rows.
- **The code flow with the client secret, no PKCE.** Square's PKCE refresh
  tokens are single-use and expire in 90 days; code-flow ones do not expire. A
  farm that connects once should never be asked again.
- **Every scope the four slices need, requested once**, because adding one later
  sends every connected farm back through the consent form. `session=false`:
  this screen decides whose bank the money lands in, so Square asks who you are.
- **The status maps onto Stripe's vocabulary** so the till reads ONE column:
  merchant `ACTIVE` plus an `ACTIVE` location carrying `CREDIT_CARD_PROCESSING`
  is `active`; anything else is `restricted` with a `status_details` code saying
  why. A rejected token is `restricted` + `token_rejected`, rendered "Needs
  reconnecting" — a definite answer from Square, distinct from `closed`.
- **The environment defaults to sandbox.** Square credentials carry no
  `sk_test_` marker, so only `SQUARE_ENVIRONMENT=production` reaches real money.
- **Plain `fetch` with Zod at the boundary**, not Square's SDK: two reads and
  three OAuth calls do not need a dependency whose money type is `bigint`.
- **Disconnect exists here**, unlike the Stripe card: it calls Square's revoke
  endpoint and marks the row only once Square confirms — the provider's word,
  not the app's. If Square says the grant is already gone, the row is marked
  anyway rather than left stuck.
- **Stripe is parked, not removed.** Its rows stay visible and manageable; a
  fresh Stripe connection is offered only where Square is not configured.
  `connect.ts` and `terminal.ts` now filter `provider = 'stripe'`, and the
  Terminal lib narrows the nullable Stripe id in one place and throws if handed
  a Square row — `stripeAccount: null` would act on the PLATFORM account.
- Migrations `0241` (columns + `payment_credentials`) and `0242` (its RLS). The
  `provider` default STAYS on the column, against the discriminator convention,
  because the migration lands before the deploy and running code inserts
  without naming a provider — see the schema comment.
- 22 pure tests (signature with a known vector, the authorize URL, token
  parsing, both error shapes, the refresh window, the projection, every screen
  state) and 7 isolation tests (the no-policy table from four directions, the
  composite FK under `withSystem`, the four ways a row can lie, one-per-provider,
  the cascade). Two 2026-08-25 build-log entries swept to the archive file.

**WHAT IS NOT PROVEN, PLAINLY.** No Square developer application exists yet, so
`SQUARE_APPLICATION_ID` is unset everywhere and **the OAuth round trip has never
run against Square** — not in the sandbox, not in production. The start route,
the callback, the merchant read, the webhook signature and the disconnect are
built, typed, linted and tested against known shapes, and the settings page
renders. Driving them needs the founder to create the application (SETUP.md
§4.7), which is a one-time platform step exactly as Connect's signup was.

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `payment_accounts` | **One company's ability to take a card, through one provider.** `provider` = `stripe` (the connected account id plus Stripe's verdicts) or `square` (the merchant id, its locations, and the verdict derived from them) | `tenant_id`, FORCE RLS, and **members hold SELECT ONLY** — every write is `withSystem`, from a provider event, the OAuth callback or the reconcile. Composite FK to `entities` (RESTRICT), nullable. UNIQUE per `(tenant_id, entity_id, provider)` **plus** a partial unique on `(tenant_id, provider) WHERE entity_id IS NULL`, because Postgres treats NULLs as distinct and a books-less tenant could otherwise mint accounts without limit. UNIQUE `(tenant_id, square_merchant_id)`: one Square account on one company per tenant. CHECKs: `provider IN ('stripe','square')`; a `stripe` row has a Stripe id and no merchant id, a `square` row the reverse; a Stripe id looks like `acct_…`. `(tenant_id, id)` unique, as the target the reader, credential and settlement slices point at |

The Stripe columns, all of them v2's vocabulary:

- **`card_payments_status`** — `active` \| `pending` \| `restricted` \|
  `unsupported`. **NULL means Stripe has not said**, which is not the same as
  `restricted`. `active` is the only value that means yes.
- **`status_details`** — `[{code, resolution}]`. `resolution` is the useful
  half: `provide_info`, `contact_stripe` or `no_resolution` is Stripe telling
  the screen which button to offer.
- **`requirements`** — a trimmed projection of `requirements.entries`, each
  carrying `awaitingActionFrom` and `restricts`. **Field NAMES, never field
  values**: no tax ID, bank detail or document lands here.
- **`requirements_deadline_status`** and **`requirements_due_by`** are two
  columns because a real account returns `past_due` with a NULL time. Urgency
  cannot be inferred from the date, and the date cannot be inferred from the
  status.

The Square columns — and the two shared ones the till reads:

- **`card_payments_status`** is SHARED and keeps Stripe's words for both
  providers: `active` is the only yes. For Square it is derived — merchant
  `ACTIVE` and at least one `ACTIVE` location with `CREDIT_CARD_PROCESSING`.
- **`status_details`** is shared too. Square rows carry OUR codes:
  `card_processing_not_activated`, `merchant_inactive`, `token_rejected`.
- **`square_merchant_id`** — how the webhook finds the row; it knows nothing else
  about us. **`square_main_location_id`** — where a till charge is made until a
  channel can pick its own. **`square_locations`** — `[{ id, name, status, type,
  canTakeCards }]`, a trimmed projection for the screen and the till.
- **`requirements` is always `[]` on a Square row.** Square has no requirements
  list to give us.

| `payment_credentials` | **The one secret in this domain.** A Square OAuth access token and refresh token for ONE `payment_accounts` row, AES-256-GCM via `encryptSecret()` (S8), plus the granted scopes and the expiry | `tenant_id`, FORCE RLS, and **NO MEMBER POLICY AT ALL** — superadmin and `withSystem` only; a tenant transaction selects zero rows, its own tenant's included, and INSERT is refused. Composite FK to `(tenant_id, payment_account_id)` — CASCADE, because a token for an account that no longer exists is meaningless. UNIQUE per `(tenant_id, payment_account_id)`: reconnecting replaces. `revoked_at` set and the ciphertext blanked on revocation, never deleted |

| `payment_readers` | **A card reader at a stall.** One row per physical (or simulated) device, registered on ONE connected account | `tenant_id`, FORCE RLS, **members hold SELECT ONLY** for the same reason the account does. Composite FK to `(tenant_id, payment_account_id)` — CASCADE, because a reader is meaningless without the account it pays into — which makes "a device pointed at another business's bank" unrepresentable. UNIQUE per `(tenant_id, stripe_reader_id)`: re-registering a known device is an update. CHECKs that the ids look like `tmr_…` and `tml_…`, because swapping them would register a payment against an address instead of a device. Archived, never deleted |

**Never a column on `payment_accounts`:** the tenant's Stripe secret key, a
Square token, any bank detail, any card number, any KYC document. The Square
token is in `payment_credentials` and nowhere else.

**No `payment_locations` table, and no charge table yet.** A Terminal location
lives in Stripe, and Square's locations live in Square with a projection here;
a payment gets a row when a sale needs to reference one (S2, S3) — and with
Square that is not optional, because Square deletes completed Terminal checkouts
after 30 days.

## Key files & seams

- `src/lib/payments/status.ts` — **pure.** The state machine and the English.
  Read this before changing any sentence a client reads about their own money
- `src/lib/payments/connect.ts` — server. Account creation, Account Links, the
  `sync`/`reconcile` pair, and the lazy adoption. **Shaped after
  `src/lib/billing-sync.ts` deliberately** — same two-function pattern, so the
  opposite direction does not also mean an opposite design
- `src/app/api/webhooks/stripe/connect/route.ts` — the Connect endpoint, its own
  signing secret, v2 thin events
- `src/lib/payments/terminal.ts` — server. Locations, readers, and the charge.
  **Acts AS the connected account via `{ stripeAccount }`**, which is the whole
  difference between this and `billing-sync.ts`
- `src/app/dashboard/settings/payments/` — the screen, its actions, its buttons.
  `reader-controls.tsx` holds the only place a payment can be driven today
- `scripts/stripe-connect-probe.ts` — Stripe with nothing else in the way.
  `create` prints the requirement keys a real account returns
- `src/db/schema/payments.ts` · `drizzle/0206` (table) · `0207` (RLS) ·
  `0208`/`0209` (the v1→v2 reshape) · `0241` (provider + Square columns +
  `payment_credentials`) · `0242` (its RLS — the no-member-policy one)
- `tests/payments-status.test.ts` · `tests/payments-square.test.ts` ·
  `tests/isolation/payments.test.ts`
- **Square**, all under `src/lib/payments/square/`:
  - `config.ts` — env, hosts, the sandbox default, the redirect and webhook URLs
  - `oauth.ts` — **pure apart from `fetch`**: the authorize URL, code exchange,
    refresh, revoke, the refresh window, both error shapes, the English
  - `api.ts` — the two reads (`/v2/merchants/me`, `/v2/locations`), Zod at the
    boundary, and which error codes mean "the token is dead"
  - `status.ts` — **pure**: merchant + locations → the shared status columns,
    and the screen's sentences
  - `signature.ts` — **pure**: the webhook HMAC, tested with a known vector
  - `pending.ts` — the encrypted single-use state cookie
  - `accounts.ts` — server. Connect, reconcile, refresh, revoke, disconnect;
    **the ONE place a Square token is decrypted**
- `src/app/api/payments/square/start/route.ts` · `…/callback/route.ts` — the
  OAuth trip out and back
- `src/app/api/webhooks/square/route.ts` — Square events, its own signing key
- `src/app/dashboard/settings/payments/square-controls.tsx` — disconnect, refresh
- The OTHER direction, so you can tell them apart: `src/lib/stripe.ts` (shared
  lazy client), `src/lib/billing-sync.ts`, `src/app/api/webhooks/stripe/route.ts`

## Decisions & gotchas

- **THE TWO STRIPES POINT IN OPPOSITE DIRECTIONS.** `subscriptions` is us
  charging the client; `payment_accounts` is the client charging their customer.
  If you find yourself reaching for one inside the other's file, stop.
- **THIS IS ACCOUNTS V2. `stripe.accounts.*` IS V1 AND WILL FAIL.** It is also
  the discoverable half of the SDK and what every tutorial shows. `v2.core`.
- **`include` IS NOT OPTIONAL ON A v2 READ.** Without it Stripe returns a
  skeleton with no `configuration` and no `requirements` — which is
  indistinguishable from an account with no capabilities and nothing
  outstanding. The most dangerous possible wrong answer, and it is silent.
- **THE CAPABILITY STATUS IS STRIPE'S TO SAY, NEVER THE APP'S.** There is no
  member write policy, so there is no code path that could assert it. Do not add
  one to make a test easier.
- **THE DENIAL IS SILENT, and this surprised the tests.** A member policy scoped
  `FOR SELECT` gives an UPDATE no USING clause to satisfy, so Postgres reports
  zero rows changed rather than raising. Only the INSERT is loud. The guarantee
  holds either way; do not expect an exception to announce it.
- **`awaiting_action_from` DECIDES WHAT GOES ON THE FARM'S TO-DO LIST.**
  Anything not literally `user` is Stripe's problem, including a shape we do not
  recognise — so a malformed row is quiet rather than alarming.
- **AMBER MEANS A CLOCK IS RUNNING, NOT "SOMETHING IS MISSING".** Every
  requirement on a new v2 account is `past_due`. See build log defect 2.
- **CARDS WORKING IS NOT MONEY ARRIVING.** v2 has no `payouts_enabled`; a
  missing bank account is a requirement restricting `stripe_balance.payouts` and
  not `card_payments`. That is where the "payouts on hold" state comes from.
- **THE RETURN URL DOES NOT MEAN SUCCESS.** Stripe sends them back whether they
  finished or abandoned. Reconcile; never believe the redirect.
- **AN ACCOUNT LINK EXPIRES IN MINUTES.** `refresh_url` is hit when it does, and
  the page says so plainly rather than looking broken.
- **THE TENANT IS RESOLVED FROM OUR OWN ROW, NEVER FROM STRIPE METADATA.**
  Metadata is writable by anyone who can reach the account. Trusting it would be
  exactly the "look up the tenant for the id the client sent" shape S2 names.
- **A RECONCILE FAILURE IS NOT A DISCONNECTION.** A network blip and a revoked
  authorization look alike from here, and marking a live account closed would
  tell a farm mid-market that its till is off. A close event is the fact.
- **A CLOSED ROW IS MARKED, NEVER DELETED**, and `closed_at` is stamped once —
  re-stamping on every sync would move the date every time somebody loaded the
  page. It is also checked BEFORE the capability status, because a farm that
  disconnects can leave a row saying `active`.
- **AN UNKNOWN REQUIREMENT IS SHOWN, NOT DROPPED.** Stripe adds keys without
  telling us, and a screen that silently hid one would leave somebody stuck on a
  step the page swore was finished. The fallback prettifies the key.
- **TERMINAL IS A v1 API EVEN THOUGH THE ACCOUNT IS v2.** `stripe.terminal.*`
  beside `stripe.v2.core.*` in one file is correct, not a leftover.
- **`{ stripeAccount }` GOES IN THE OPTIONS ARGUMENT, WHICH IS NOT ALWAYS THE
  SECOND ONE.** `list(params, options)` but `del(id, params, options)` and
  `retrieve(id, params, options)`. Passing it one slot early sends it as a query
  parameter; Stripe rejects the call, `tsc` does not, and if the caller
  swallows errors the failure is silent. That shipped once here — see build log
  defect 1.
- **`retrieve` RETURNS `Reader | DeletedReader`.** A device removed on Stripe's
  side has no `status`; narrow before reading one.
- **A REQUIREMENT KEY IS NORMALISED, NEVER MATCHED WHOLE.** Stripe moves the
  same question between `representative.`, `identity.individual.` and
  `person_xxx.` as an account progresses. Add leaves to `LABELS`, not prefixes.
- **THE IDEMPOTENCY KEY IS NOT OPTIONAL FOR A TILL.** `collectPayment` takes the
  caller's `clientRef` and hands it to Stripe. Without it a retry charges twice
  — the same rule, and the same reason, as `retail_sales.client_ref`.
- **`collectPayment` DOES NOT WAIT FOR THE CUSTOMER**, and nothing that calls it
  should either. Push, then poll `readPaymentStatus`.
- **THE CAPABILITY GUARD CANNOT BE VERIFIED BY TEST MODE.** Test mode happily
  takes a card on a `restricted` account, so the guard in `collectPayment` is
  the only thing standing between a live farm and a decline at the stall. Do not
  conclude from a green test run that it is unnecessary.
- **CONNECT IS A ONE-TIME PLATFORM SIGNUP.** Not per client, not an env var.
  Without it every client's first click fails identically, which is why that one
  error has its own message saying it is ours to fix. SETUP.md §4.5.
- **THE CONNECT WEBHOOK IS A SEPARATE ENDPOINT WITH A SEPARATE SECRET**, and it
  parses **v2 event notifications** (`parseEventNotification`), not v1 events.
  It keys off `related_object.type`, never the event name, because Stripe adds
  v2 event types faster than a hard-coded list stays current and every one of
  them means the same thing to us: go and look at the account.
- **MISSING THE WEBHOOK FAILS QUIETLY.** The page reconciles on load, so the
  state is right when somebody looks and stale when nobody does. Acceptable only
  while nothing acts on it without a person present — **it stops being
  acceptable the moment the till reads the capability status**, which is the
  next slice.
- **ONE STRIPE API CALL PER COMPANY, PER PAGE LOAD.** Fine at one or two. A
  ten-LLC client would want a staleness check on `synced_at`.
- **`identity.country` IS REQUIRED AND IS A CONSTANT (`US`).** v1 defaulted it;
  v2 refuses to guess and nothing on `tenants` holds one.
- **RESPONSIBILITIES ARE STATED, NOT DEFAULTED.** They decide who is liable for
  a disputed charge, so they are written where a reader can see them. Note v2
  spells "the account pays Stripe's fees" as `fees_collector: stripe`; v1's
  `account` is not a valid value and the API is what caught it, not `tsc` —
  `tsx` strips types, so a probe script does not typecheck itself.

Square, since 2026-09-02:

- **FILTER BY PROVIDER, ALWAYS.** `payment_accounts` holds both. `connect.ts`
  and `terminal.ts` read `provider = 'stripe'`; everything under `square/` reads
  `provider = 'square'`. A Map keyed by company with no filter lets one
  provider's row silently replace the other's — which is exactly what the
  Stripe loader used to do.
- **`stripe_account_id` IS NULLABLE NOW, AND `stripeAccount: null` ACTS ON THE
  PLATFORM ACCOUNT.** The Terminal lib narrows it in one helper and throws if
  handed a Square row. Do not `?? ""` your way past the type.
- **THE TOKEN IS DECRYPTED IN ONE FUNCTION** (`accessTokenFor`). A second call
  site is a review finding, not a convenience.
- **A REJECTED TOKEN IS NOT A DISCONNECTION EITHER — BUT IT IS A DEFINITE
  ANSWER.** A network failure is logged and left (ADR 0015's rule). A 401 with
  the token is Square speaking: the row goes to `restricted` + `token_rejected`
  and the screen says "Needs reconnecting". `closed_at` is only ever set by the
  revocation webhook or the owner's disconnect.
- **THE NOTIFICATION URL IS PART OF THE WEBHOOK SIGNATURE.** A trailing slash or
  an http/https mismatch between `NEXT_PUBLIC_APP_URL` and the Developer Console
  fails every event, silently. Compare the two strings before anything else.
- **THE REFRESH TOKEN COMES BACK UNCHANGED.** Code-flow refreshes return the same
  refresh token; a null in the response means KEEP what is stored. Overwriting
  with empty breaks the connection a month later, far from the cause.
- **SQUARE'S CONSENT IS ALL-OR-NOTHING**, so the scopes requested are the scopes
  granted, and `payment_credentials.scopes` stores the requested list.
- **`session=false` HAS NO EFFECT IN THE SANDBOX.** Do not conclude from a
  sandbox run that Square skipped the login.
- **THE SANDBOX IS A DIFFERENT APPLICATION**, with its own credentials and host
  (`connect.squareupsandbox.com`). `SQUARE_ENVIRONMENT` picks the host; the
  credentials have to match it or every call is a 401 that looks like a dead
  token.
- **THE PROVIDER DEFAULT STAYS ON THE COLUMN.** Against the discriminator
  convention, for the migrate-then-deploy window. The schema comment says why;
  do not "fix" it.
- **NO `Square-Version` HEADER.** Square honours the application's console
  version when the header is absent; a hard-coded date would fail the day it
  stopped being a released version.

## Open items

Square first, because it is the provider on offer:

- **NO SQUARE DEVELOPER APPLICATION EXISTS, so the OAuth trip has never run.**
  `SQUARE_APPLICATION_ID` is unset in every environment. Creating it is a
  one-time platform step for the founder (SETUP.md §4.7: application, redirect
  URL, webhook subscription, then the sandbox test account). Until then every
  Square card on the settings page renders "Not connected" and the connect
  route answers 503. **Everything in slice S0 past the page is built and
  unproven.**
- **THE TOKEN IS REFRESHED ON PAGE LOAD ONLY.** Square access tokens live thirty
  days; the reconcile renews inside the last week, but only when somebody opens
  the payments page. A farm that does not for a month ends with an expired
  token that is renewed on the next load — harmless while nothing acts without
  a person present, **not acceptable once the till reads this connection**. A
  scheduled refresh (the notifications cron is the obvious home) has to land
  with or before S2.
- **`oauth.authorization.revoked` HAS NEVER BEEN RECEIVED.** Handler written,
  signature verified against a known vector; no subscription exists. Until then
  a revocation surfaces as "Needs reconnecting" on the next page load rather
  than as a closed row.
- **WHETHER SQUARE REQUIRES APP MARKETPLACE REVIEW before sellers other than the
  developer can authorise the application is not settled by the docs as read.**
  Confirm before the second client connects.
- **ONE MERCHANT, ONE COMPANY.** A client running one Square account across
  several LLCs is refused by the unique index — the same many-to-one question
  ADR 0015 deferred, deferred again in ADR 0017.
- **THE LOCATION THE TILL CHARGES AT IS THE MAIN ONE.** A stall and a farm store
  on one Square account are two locations; S2/S3 should let a channel name its
  location rather than inherit the merchant's default.
- **The Stripe rows in production are test-mode rows** (`sk_test_`), and the
  parked Stripe card still shows them. Harmless; worth remembering when the
  screen looks busier than a one-provider farm expects.

Stripe, parked:

- **NOBODY HAS COMPLETED THE HOSTED ONBOARDING, so nothing has ever reached
  `Ready` — but slice 1 proved this blocks less than it looked like it would.** What IS proven end to end: the screen renders one card per company
  on a two-company tenant; the non-default company's button creates a real v2
  connected account against the non-default company's id; the row is written
  with the right status, requirements, country and currency; Stripe's hosted
  form opens; the incomplete state renders in English; and the reconcile is what
  the page reads. What is **built and unproven**: everything past that form —
  `reviewing`, `payouts_held`, `ready`, and the `?status=expired` branch. The
  form is a KYC flow that Stripe says must be completed by the business owner,
  so it needs a human. The live account waiting on it is
  `acct_1U8BofACBTDANiJF` (Oak Row LLC, dev branch).
- **`account.updated` and its v2 cousins have never been received.** The handler
  is written, verifies signatures and re-fetches; no event destination is wired
  to it. `stripe listen --forward-connect-to` is the local way in. Until then
  the reconcile is the only path, and it only runs when somebody opens the page.
- **Nothing reads the capability status yet.** The till records a payment method
  and does not ask whether a card could be taken. It should, and when it does
  the webhook stops being optional.
- **There is no disconnect button for Stripe.** A farm revokes from its own
  Stripe dashboard and the event records it. Deliberate — a button here would be
  a write to a table that refuses writes, so it would have to call Stripe and
  wait for the event anyway. (Square has one, because Square has a revoke
  endpoint that answers synchronously.)
- **"Manage" is a plain link to `dashboard.stripe.com`**, not a login link.
  Login links are an Express-account feature and these have the full dashboard,
  so the farm signs in to its own Stripe account normally.
- **A tenant that opens its books and never opens this page keeps a null
  company.** Harmless today because nothing reads the company yet; it stops
  being harmless when slice 2 posts a settlement.
- **The requirement labels are US-shaped and unalarmed.** "Social Security
  number", "EIN". A client outside the US would see the fallback prettifier for
  its own equivalents — legible, and not right. Nothing tells us when a key
  falls through to the fallback, either.
- **The country is hard-coded to `US`.** The first non-US client needs a real
  field on `tenants`, not a constant in `connect.ts`.
- **THE TILL DOES NOT CALL ANY OF THIS YET.** `collectPayment` works and its
  only caller is a panel on the settings page. Wiring it into `recordSale` is
  `retail` slice 5's other half, and it is where the `client_ref` already minted
  by the till should become the idempotency key rather than a second uuid.
- **NOTHING RECORDS THAT A CHARGE HAPPENED.** There is no charge table: the
  PaymentIntent id is returned to the browser and forgotten. That is deliberate
  until a sale needs to reference one, and it means today a payment taken
  through the panel is reconcilable only in Stripe.
- **A `succeeded` PaymentIntent IS READ BY POLLING, NOT BY EVENT.** Fine for a
  person watching a screen; wrong for a till that may lose signal mid-tap. The
  Connect endpoint could carry `payment_intent.succeeded` and does not.
- **A READER'S `status` IS ONLY AS GOOD AS ITS LAST SYNC**, refreshed on page
  load. A reader that goes offline while somebody is looking at the page still
  reads `online`.
- **The address for a Terminal location is asked for once and never editable.**
  Changing it means deleting the location in Stripe, which the app does not
  offer.
- **`simulateTap` ships in production code.** It refuses anything that is not a
  `simulated_*` device, so it cannot be pointed at a real reader — but it is a
  test helper living on a live surface, and a `NODE_ENV` guard would be belt and
  braces.
- **A flapping account writes one audit row per flap.** Only `active` and
  `restricted` transitions are audited, which is the right filter at this
  volume; worth a thought if it ever gets noisy.
