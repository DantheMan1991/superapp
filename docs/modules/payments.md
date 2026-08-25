# Payments (taking money)

> **The client charging THEIR customer.** A Stripe Connect connected account per
> legal entity, so card takings land in the client's own bank, under the
> client's own KYC, liability and tax form. Platform machinery (Layer 0) rather
> than a module: any pack could sell through it, and `retail`'s market till is
> simply the first to want to.
> Status: `available` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

**READ THIS BEFORE ANYTHING ELSE IN THIS AREA.** There are two Stripes in this
codebase, they point in opposite directions, and **they are not even the same
Stripe API**:

| | Direction | API | Table | Lib | Webhook |
| --- | --- | --- | --- | --- | --- |
| **Billing** | The PLATFORM charges the TENANT | v1 | `subscriptions` | `src/lib/billing-sync.ts` | `/api/webhooks/stripe` |
| **Payments** (here) | The TENANT charges THEIR customer | **Accounts v2** | `payment_accounts` | `src/lib/payments/connect.ts` | `/api/webhooks/stripe/connect` |

Same SDK object, same platform secret key, everything else opposite. The next
person will assume there is only one — that assumption is why the table lives in
its own schema domain, why the webhook is a second route rather than a branch,
and why the nav row beside "Billing" is labelled "Taking payments" instead of
something shorter.

**`stripe.accounts.create` is the WRONG call here and it autocompletes.** This
integration uses `stripe.v2.core.*`. Reaching for the v1 surface fails at
runtime and only at runtime.

The decision is [ADR 0015](../decisions/0015-a-connected-account-belongs-to-a-company.md).
Read it before changing where the account hangs, or which API this talks to.

## Slice order

| # | Slice | State |
| --- | --- | --- |
| **0** | **Connect: the connected account per company, hosted onboarding, the settings screen** | **shipped 2026-08-25** — onboarding form not yet completed by a human, see Open items |
| **1** | **Terminal: register a location and a reader, PaymentIntent on the connected account, push it to the reader** | **shipped 2026-08-25** — driven end to end, a real card-present charge settled on the connected account |
| 1b | The TILL takes a card: wire `collectPayment` into `recordSale` with the `client_ref` story | next — `retail` slice 5's other half |
| 2 | Settlements and fees reaching the books | after 1b — `retail` slice 2 |
| 3 | Refunds from the till | |
| 4 | Online / card-not-present, for `retail` slice 6's orders | |

## Build log

### 2026-08-25 — Slice 1: the reader at the stall (`claude/the-reader-at-the-stall`)

**A REAL CARD-PRESENT CHARGE SETTLED ON THE CONNECTED ACCOUNT**: $12.50, visa
`4242`, captured, on `acct_1U8Bof…` and **not visible on the platform account**.
That last clause is ADR 0015's whole claim and this is the first time anything
has proved it with money rather than with an argument.

**THE BLOCKER SLICE 0 RECORDED TURNED OUT NOT TO EXIST.** Slice 0's open items
said the reader work needed a connected account at `Ready`, and therefore needed
a human to finish Stripe's KYC form. It does not: **Stripe test mode does not
gate card-present charges on the capability status**, so the whole flow —
location, reader, PaymentIntent, tap, `succeeded` — runs on a `restricted`
account. Live mode does gate it, which is why the guard below still exists.

- **`ensureLocation` asks Stripe rather than keeping a column.** A Terminal
  location is an address that groups readers and Stripe already stores it; a
  copy here would be a second thing to keep in step for no reader of it. The
  location id is denormalised onto the reader, so a farm with two market
  addresses is already representable without a migration.
- **The address comes from a form on the FIRST reader**, because Stripe requires
  one and this app holds an address nowhere. Not stored afterwards.
- **`payment_readers` takes the same SELECT-only policy as `payment_accounts`**,
  and the reason is adjacent rather than identical: a row here that Stripe has
  never heard of is a device the till would offer, at a stall, and pushing a
  payment to it fails with a customer holding a card. Every write happens after
  Stripe has already accepted the device.
- **THE IDEMPOTENCY KEY IS THE WHOLE SAFETY STORY, and it is `retail`'s lesson
  reused.** A till with bad signal retries; a retry whose request arrived and
  whose reply did not would charge the customer twice. The caller's `clientRef`
  — minted before it touches the network, exactly as `retail_sales.client_ref`
  is — becomes the Stripe idempotency key, so the second attempt returns the
  FIRST PaymentIntent.
- **`collectPayment` pushes and returns; it does not wait.** A customer takes as
  long as a customer takes. Blocking would tie up a handler for a minute and
  give the stall a spinner it cannot cancel.
- **Taking a payment is MEMBER, registering a reader is OWNER** — the same split
  `retail` draws between recording what the pitch cost and setting a price. A
  till only the owner could operate is a till nobody uses.
- 27 pure tests, 22 isolation tests. Migration `0210`, `0211` is RLS. **No
  hand-reordering** — the composite FK targets `payment_accounts`, which already
  existed.

**DRIVEN THROUGH THE REAL UI**, not the probe: the address form, the pairing
code, the reader appearing `online`, the guard refusing, then the charge, the
tap and `Paid`. Two defects, both found by doing it rather than by reading it:

1. **`readers.del(id, options)` PUT THE ACCOUNT IN THE QUERY STRING.** The
   signature is `del(id, params, options)`, so passing `{ stripeAccount }`
   second sends it as a parameter and Stripe rejects the call — and
   `archiveReader` catches and logs delete failures, so **the reader would have
   stayed registered while the app said it was retired**, silently, forever.
   `tsc` did not catch it; a cleanup script that actually ran did.
2. **A THIRD REQUIREMENT-KEY FAMILY, and the table could not keep up.** The same
   account returned `representative.given_name` when it was created and
   `identity.individual.given_name` a few hours later, once Stripe had decided
   its entity type — so eleven readable lines became "Individual given name",
   "Individual date of birth day", "Individual date of birth month"… undeduped.
   Enumerating prefixes was the wrong shape. Keys are now **normalised** to a
   canonical form before lookup, which collapsed three tables into one and
   handles a family nobody had seen.

### 2026-08-25 — Slice 0: the account that belongs to the farm (`claude/the-account-that-belongs-to-the-farm`)

Retail's dossier said offline (1b) was next. The founder corrected it on
2026-08-25: **he has signal almost all of the time, and what he cannot do is
take a credit card.** So the payment slices went to the front, and this is the
half that has to exist before any of the rest can: whose Stripe account, whose
liability, whose bank.

**THE DECISION IS WHERE THE ACCOUNT HANGS, AND THE CHEAP ANSWER IS WRONG.** ADR
0015 argues it in full; the short form is that a connected account is a bank
account with a KYC wrapper — an EIN, a legal name, a representative — and ADR
0010 puts anything with a balance on exactly one entity. Two LLCs are two tax
IDs and two 1099-Ks. One row per tenant would put one company's card revenue on
another company's tax form, and **nothing in the app could detect it.**

The sentence that will be cited against it is ADR 0010's own *"billing is per
tenant, so ten LLCs is one subscription"* — which is about the OTHER Stripe.

- **The tenant's own secret key is never stored, never asked for, never seen.**
  The obvious shortcut is a form that takes `sk_live_…`; it would put a C5
  secret per client in a column, granting unlimited charge, refund and payout
  authority over their money. We store `acct_…`, an identifier, and act with the
  platform key.
- **Members hold a SELECT policy and nothing else** (`drizzle/0207`). Every
  column is Stripe's verdict about a KYC review this platform does not perform,
  and S7 already says such state comes only from a signature-verified event or a
  server→Stripe read. Here that rule is a policy rather than a habit. The
  failure it forecloses is a farm told it can take a card and a customer's card
  declined at a stall with a queue behind it.
- **`entity_id` is nullable**, because `retail` requires `inventory` and not
  `accounting` — a farm can sell at a market with no books at all. Adopted when
  the books open, to the tenant's DEFAULT company, guarded to nulls. Same
  treatment `provisionAccounting` gives an asset bought before there were books,
  except it cannot live there: that function runs inside a tenant transaction
  and this table refuses tenant writes. So adoption is lazy, on page load.
- **Onboarding is Stripe-hosted Account Links.** No tax ID, bank account or ID
  document ever reaches this server. `collection_options.fields:
  "eventually_due"` asks for everything in one sitting rather than sending a
  farmer back a month later for a document.
- **The return URL does not mean success.** Stripe sends them back whether they
  finished or abandoned, so the page reconciles from the API rather than
  believing the redirect. This is the trap that makes onboarding screens claim
  a business is ready when it is not.

**THEN STRIPE CHANGED THE GROUND MID-SLICE.** The whole thing was built, tested
and migrated on Accounts **v1** — and the first real `accounts.create` returned
*"Stripe no longer recommends Accounts v1 for new Connect integrations."* There
was a dashboard toggle that would have made the finished code work. It was
declined: this integration had created zero accounts, so moving cost a migration
on an empty table, and the same move a year later happens with real farms' live
accounts on it. ADR 0015 has the argument and the honest cost.

**What v2 changed, beyond the call site.** Its account object is shaped nothing
like v1's — no `charges_enabled`, no `payouts_enabled`, no `details_submitted`.
There is a capability STATUS and a list of REQUIREMENTS that each say who is
holding them up and what they restrict. That is a better model for this screen
and it rewrote the schema (`0208` drops v1's vocabulary, `0209` adds v2's).

- **`describePaymentAccount` is pure and tested**, because the state that
  matters is the middle one. A farm that has filled the form in sits at
  `restricted` with every remaining requirement `awaiting_action_from: stripe`,
  and a screen that listed those as a to-do would invent homework for somebody
  who has none. v1 made you infer that; v2 states it.
- **26 pure tests, 15 isolation tests.** Migrations `0206` (table), `0207` (RLS),
  `0208`/`0209` (the v2 reshape). **No hand-reordering needed** — the composite
  FK targets `entities`, which already exists.
- **`scripts/stripe-connect-probe.ts`** talks to Stripe with no browser, tenant
  or database in the way. Every requirement key in `status.ts` was read off a
  real account with it rather than guessed, and it refuses a non-test key.

**DRIVEN ON THE `Test` TENANT, WHICH HOLDS TWO COMPANIES ON PURPOSE**, because a
one-company tenant cannot see the difference this whole slice turns on. The page
rendered a card each for `Test` and `Oak Row LLC`; the button on the
**non-default** company created a real v2 connected account and the row landed
against **Oak Row LLC's** id — confirmed against the database, not inferred from
the screen. Stripe's hosted onboarding opened. The form itself is a KYC flow
that has to be completed by the business owner, so it is **still outstanding**
(Open items).

It found three defects, and only clicking could have:

1. **The error told the farm to try again in a moment, forever.** Every farm's
   first click on a fresh deployment hits the not-signed-up-for-Connect error,
   which is permanent and ours, so "try again" means they retry and then ring
   us. Now a distinct message that says it is ours to fix. Stripe gives no error
   `code` for it — `code`, `param` and `doc_url` are all undefined against the
   live test-mode account — so the message text is the only signal there is,
   matched narrowly with the old wording left as the fallback.
2. **A THIRTY-SECOND-OLD ACCOUNT RENDERED AMBER.** The badge warned when any
   requirement was `past_due`, which in v2 is *every* requirement on a new
   account, because nothing has been provided yet. The alarm colour fired
   immediately and then never changed, so by the time a farm was genuinely late
   the badge said what it had always said. **A tone that is always on carries no
   information.** Amber now means Stripe has put a real DATE on it — which is
   exactly why the deadline status and the deadline time are two columns.
3. **Two lines of the to-do list read as the same line.** `business_url` and
   `product_description` rendered as "A website, or a description of what you
   sell" and "A description of what you sell", one above the other. Now "A
   website for the business".

Also fixed while here: `/dashboard/settings` needed `exact: true` in the nav, or
the new row at `/dashboard/settings/payments` lit up two sidebar items at once.

## Data model

| Table | Purpose | Notes (RLS, invariants, FKs) |
| --- | --- | --- |
| `payment_accounts` | **One company's ability to take a card.** The connected account id plus Stripe's verdicts on it | `tenant_id`, FORCE RLS, and **members hold SELECT ONLY** — every write is `withSystem`, from the Connect event or the reconcile. Composite FK to `entities` (RESTRICT), nullable. UNIQUE per `(tenant_id, entity_id)` **plus** a partial unique on `(tenant_id) WHERE entity_id IS NULL`, because Postgres treats NULLs as distinct and a books-less tenant could otherwise mint accounts without limit. CHECK that the id looks like `acct_…` — v2 kept v1's prefix, confirmed against a real account — so the two Stripes crossing fails at the database. `(tenant_id, id)` unique, as the target the reader and settlement slices will point at |

The columns worth knowing, all of them v2's vocabulary:

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

| `payment_readers` | **A card reader at a stall.** One row per physical (or simulated) device, registered on ONE connected account | `tenant_id`, FORCE RLS, **members hold SELECT ONLY** for the same reason the account does. Composite FK to `(tenant_id, payment_account_id)` — CASCADE, because a reader is meaningless without the account it pays into — which makes "a device pointed at another business's bank" unrepresentable. UNIQUE per `(tenant_id, stripe_reader_id)`: re-registering a known device is an update. CHECKs that the ids look like `tmr_…` and `tml_…`, because swapping them would register a payment against an address instead of a device. Archived, never deleted |

**Never a column here:** the tenant's Stripe secret key, any bank detail, any
card number, any KYC document.

**No `payment_locations` table, and no charge table yet.** A Terminal location
lives in Stripe; a PaymentIntent gets a row when `retail` slice 5 links one to a
sale and the shape is known rather than guessed.

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
  `0208`/`0209` (the v1→v2 reshape)
- `tests/payments-status.test.ts` · `tests/isolation/payments.test.ts`
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

## Open items

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
- **There is no disconnect button.** A farm revokes from its own Stripe
  dashboard and the event records it. Deliberate — a button here would be a
  write to a table that refuses writes, so it would have to call Stripe and wait
  for the event anyway.
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
