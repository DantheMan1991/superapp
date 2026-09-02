# Payments — build log archive

Older build-log entries for [payments.md](payments.md), swept here on 2026-09-02
so the dossier stays a few screens long (the rule in AGENTS.md). Newest first.
Nothing here is superseded by being archived; the current state of every
decision is in the dossier and in ADR 0015 / ADR 0017.

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
