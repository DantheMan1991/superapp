# Accounting

> Full double-entry accounting for client tenants: ledger, reports, banking
> feeds, invoicing (AR), documents/receipts, payables (AP), and month-end
> close — with AI assist at every capture point. This is the flagship
> module of Phase 2 ("The Outsourced Business Office").
> Status: `available` · Scope: `module`

The flagship pipeline it enables: emailed bill → extracted document →
prefilled bill draft → AI line coding → owner approval (posts to ledger) →
payment → bank-feed match → month-end close with AI narrative → full-books
export for the accountant.

## Build log

Newest first. One entry per session/PR that touched this module. Every PR that
changes this module MUST add an entry here (rule in AGENTS.md).

> **Older entries live in [`accounting-build-log.md`](./accounting-build-log).**
> This section keeps the most recent work only. Add new entries at the top here;
> when it grows past a few screens, sweep the oldest across. This dossier is read
> at the start of every accounting session, so its length is a real cost — it was
> 4,367 lines before the 2026-09-14 sweep, 94% of it build log.

### 2026-09-14 — The dossier got too big to read (`claude/dossiers-too-big-to-read`)

Nothing about the module changed. This records why the file you are reading is
shorter. It had reached **4,367 lines, 94% of it build log** — the largest file
in `docs/`, bigger than `email.md` ever was before the rule about sweeping was
written down — and AGENTS.md tells every accounting session to read this dossier
first. That length was a fixed cost paid at the start of every change to the
flagship module of Phase 2.

- Entries dated before 2026-09-08 moved to `accounting-build-log.md`. **Nothing
  was edited and nothing was dropped**: 110 entries before, 8 here and 102 there,
  every moved line byte-identical to what it was. build-docs walks the whole
  `docs/` tree, so the archive renders at `/admin/docs` with no code change
- **New entries still go here**, at the top. Sweep the oldest across when this
  section outgrows a few screens
- **Data model, key files & seams, decisions & gotchas and open items did not
  move.** They are the part of this file read for the CURRENT state rather than
  the history, and they were only ~250 of the 4,367 lines — the build log was the
  whole problem
- Archived entries still describe schema and routes as they were on the day they
  were written. Left as written: they record what was true, which is the only
  thing a build log is for

### 2026-09-13 — The two party words become the tenant's (`claude/core-declares-its-party-words`)

Accounting is the first CORE module to declare vocabulary. It owns `customer` and
`vendor` — not CRM, though CRM renders them, because a key has exactly one owner
and the Customers and Vendors pages are here.

Every screen in the module that names a party now renders the business's own
word: both list pages and their empty states and pagers, the invoice and bill
builders, the customer and vendor dialogs, opening balances, recurring templates,
receipts and the bill-from-receipt dialog, the deposits table, credit memos,
reminders and the statement, the A/P Aging tile's description and the Companies
page's explanation of what is shared. The machinery, the provider and the line
between what was swept and what was not are all in
[packs-and-profiles.md](packs-and-profiles.md).

**Two things a reader of this module should know.** Four of its screens said
"Supplier" while the rest said "Vendor" — the recurring form and the recurring
list among them — against a `vendors` table and a `VENDOR_INACTIVE` error code;
that was drift, and they now all say whatever the business calls one. And
**`core/errors.ts` was deliberately left alone**: its sentences ("That customer no
longer exists.") are a static map with no tenant in scope, so making them speak
the tenant's word needs a contract change rather than a call, and it is named as a
follow-up rather than half-done.

### 2026-09-13 — The quick add gets a verb a sentence can call (`claude/paid-the-feed-store`)

**A refactor with no behaviour in it, done for a slice that needs it next.**

`quickAddTransactionAction` held the whole rule in its body — the lines, the
transfer's far end, the entity, the `posted`-or-`draft` status, the refusals.
That is fine for a screen and impossible for anything else: a server action opens
its own transaction and reads its own session, so nothing that already has a
`tx` can call it.

[tell.md](tell.md)'s slice C1 needs exactly that — *"paid the feed store two
hundred forty cash"* — and a tell source records through **the module's own
verb**, inside the transaction the platform opened
([ADR 0039](../decisions/0039-a-pack-declares-what-it-can-be-told-in-one-sentence.md)'s
third rule). The alternative was a second copy of the posting rule, which is how
two doors come to disagree about somebody's books.

So `banking/quick-add.ts` owns it and the action is the thin wrapper it should
always have been. **Same lines, same statuses, same refusals, same audit** — the
audit stayed in the action because it describes the DOOR (`via: "quick_add"`),
which is the one thing the two callers genuinely differ about.

Two things are said out loud that were implicit before:

- **`status` is returned.** A non-owner's entry is a DRAFT, and a caller that
  does not say so is telling somebody their money is in the books when it is
  waiting for an owner. The screen never had to care; a spoken confirmation does.
- **The expert check is on the verb.** `actions.ts`'s gate refuses the outside
  accountant every write, and a second door that did not would hand them writes
  their own screens refuse them. ADR 0039 says the verb's level is the rule, so
  that is where it is.

`quickAddPosting` is the read-only half, for the preview
([ADR 0054](../decisions/0054-tell-may-draft-never-send.md) §2). It builds the
same lines from the same input rather than describing them alongside — two
descriptions of one posting is how a preview comes to be confidently wrong.

**31 banking tests pass unchanged**, which is the whole proof a behaviour-
preserving move can offer.

### 2026-09-10 — The platform's own revenue posts through the ordinary invoice (`claude/back-office-5-the-money-loop`)

Back-office slice 5, [ADR 0043](../decisions/0043-the-platforms-revenue-is-posted-by-the-webhook-as-the-operators-owner.md).
Nothing in this module changed; what changed is that a caller with nobody at
the keyboard now uses it. `src/lib/platform-revenue.ts` turns a paid Stripe
invoice or hour block into `createInvoiceDraft` → `issueInvoice` →
`recordPayment` in the OPERATOR tenant's books, with
`{ role: "owner", userId: "" }`: every posting verb requires an owner, and the
platform posting its own sales into its own books is not the elevation ADR
0011 refused. The line goes to 4010 (else 4000), the payment to Undeposited
Funds, the day is Stripe's paid day in the operator's timezone, the memo is
`stripe:<id>`. A day before the books begin is refused by `assertPeriodOpen`
as it would be for anyone, and the caller records it as skipped rather than
retrying blindly. The customer role is hung on the client's existing party by
a direct `customers` insert — `createCustomer` mints a new party, which the
client already has.

### 2026-09-09 — Vendors from a register's payees (`claude/vendors-from-the-bank`)

Onboarding slice 2b ([onboarding.md](onboarding.md)), and the last piece of
the plan's standing-data half. A card on the register — `8 payees you have no
vendor for` — opening a dialog that proposes one vendor per payee, with the
lines each covers, and names those lines when they are ticked.

**The shape is the paste dialog's without the paste** ([ADR 0036](../decisions/0036-a-pasted-list-is-proposed-by-the-model-reviewed-by-a-person-and-written-by-the-modules-own-verb.md)):
something proposes rows, a person reads every one, and the module's own verb
(`createVendor`) writes them. **No model is called** — the rows come from
`bank_transactions` the business already has, and the phrases are computed by
`payeeCandidates` in `rules-learn.ts`, which is pure and tested on its own.
So there is no accuracy to review, only the decision about which payees are
worth a vendor.

`payeeCandidates` reuses the rule-learning tokenizer: group by the leading
real word, then the longest run the group's descriptions share, **with no
threshold** (a vendor billed once a year is still a vendor) and **money out
only** (a payee you pay is a vendor; money in is a customer).
`trimReferenceNumbers` drops the store and cheque numbers off the ends, so a
payee seen once is `Kroger`, not `Kroger 0412`. Sorted by what each accounts
for, so the first row of the dialog is the one worth naming.

`payees.ts` adds the two database halves. `listRegisterPayees` leaves out
rows already named and rows set aside as personal (ADR 0034) — proposing a
vendor for the grocer is noise on exactly the register where the list would
otherwise be longest — and matches a candidate to a vendor on file only when
the vendor's WHOLE name appears in the phrase. `nameRegisterPayees`
**recomputes the candidates and skips a phrase the fresh list does not hold**,
because the page's list can be minutes old and the rows a pick labels must be
the rows it was counted from; the same reason `saveForTarget` re-reads a paste
target's fields.

Tests: `tests/banking-rules.test.ts` (5 more, pure) and
`tests/banking-payees-db.test.ts` (5). Guides: `register.md` (the card, how
to do it, the message, who can do what), `import-statement.md`.

**Driven on Hilltop (dev).** The mixed register read `2 payees you have no
vendor for` — the six rows set aside as personal and the market deposit all
correctly outside the question, leaving the two money-out lines still in
review. Farm Checking read `1 payee`, and its dialog held two rows: the feed
mill unticked with its name locked and `You already have a vendor called
“Pleasant Valley Feed Mill”. Tick to put that name on these lines.`, and
`Tractor Supply Co` ticked, `1 line, 92.15 out. From “TRACTOR SUPPLY CO”.`
`Name 1 payee` gave `1 vendor added, 1 line named`; the row's `Payee` column
then read Tractor Supply Co, the vendor appeared under Purchases, and the
card was gone. **Dev fixture now:** Hilltop has a `Tractor Supply Co` vendor
and one Farm Checking row named with it.

### 2026-09-09 — The opening position: invoices and bills open when the books began (`claude/the-opening-position`, migration `0281`)

Onboarding slice 5a ([onboarding.md](onboarding.md), [ADR 0037](../decisions/0037-a-document-open-when-the-books-began-is-real-and-its-other-leg-is-opening-balance-equity.md)):
the second of the plan's three gaps closed. **An opening document is an
ordinary invoice or bill with one flag**, `is_opening`, set once by the
Opening page's verbs (`opening/position.ts`: a one-line draft, then the
ordinary `issueInvoice` / `approveBill`). The rule is in the verbs, not the
page: `core/opening.ts` reads the company's start day (`BOOKS_START_UNSET`
without one), refuses a document dated on or after it
(`OPENING_NOT_BEFORE_START`), and hands back the entry date and Opening
Balance Equity; issuance posts Dr AR / Cr OBE ON the day, approval Dr OBE /
Cr AP, with the document keeping its real date and due date so it ages and
gets paid like any other. **The cash lens reads the flagged documents' own
lines** (`cash-basis.ts`, step 3) instead of their OBE legs, so the pilot's
January collection of a November invoice is January income under the
account chosen on the line — which is the only reason the line has one.
`findOpeningBalanceAccountId` joins the by-subtype lookups in `coa.ts`.

**The Opening page**, `/dashboard/m/accounting/opening`, `Opening` in the
nav beside `Close`: the same start-day control as the Close page, a card
and dialog each for open invoices and open bills (customer or vendor,
number, the document's date before the day, due, amount still owed, the
income or expense account, memo), and the accrual trial balance as of the
day with the OBE row shaded as `the plug`. One company at a time, `?entity=`
with the Close page's 404 rule. The setup card's `Say when your books begin`
now lands here; the Close page's card gained an `Opening position` button.

**Tests.** `tests/opening-position.test.ts` (6): the day required and the
date before it, the refused draft rolled back; AR / OBE on the day with
income untouched; paid in January, cash income under the line's account and
accrual none; the bill mirror; the position's lists and the plug that
balances AR against AP. Guides: `opening.md` (new), `close.md`,
`workspace/getting-around.md`.

**Driven on Hilltop (dev).** The page read the day set in slice 4, both
buttons live, the standing card honest that nothing was posted as of the
day. `Add an open invoice` → Maple Street Market, `INV-2025-118`, issued
2025-11-15 (the date box capped at 2025-12-31), due 2025-12-15, 500.00,
`4000 · Sales`, `Record the invoice` → `Recorded INV-2025-118, open from
2025-11-15` in 1.5 s; the list read `open`, and the standing read `1200
Accounts Receivable 500.00` against `3000 Opening Balance Equity · the plug
500.00`, totals equal. The Close page's card carries the `Opening position`
button and the nav the `Opening` tab. **Dev fixture now:** Hilltop has one
open invoice, INV-2025-118 for Maple Street Market, unpaid.

**Not in this slice.** Equipment owned before the books began and the
depreciation already taken on it (gap 3): the asset page, next.

### 2026-09-09 — Vendors and customers from a pasted list (`claude/paste-anything`)

Onboarding slice 2 ([onboarding.md](onboarding.md), [ADR 0036](../decisions/0036-a-pasted-list-is-proposed-by-the-model-reviewed-by-a-person-and-written-by-the-modules-own-verb.md)):
`Paste a list` beside `New vendor` and `Add customer`. This module's part is
one file, `paste/targets.ts` — five fields each (name, email, phone, address,
notes; terms and the default account deliberately not, because a pasted list
does not carry them and a guessed Net 30 sets every due date wrong),
duplicates by name, and `save` = `createVendor` / `createCustomer` exactly as
the forms call them, so a party is born with each and the CRM sees it. The
dialog, the model call and the review are the platform's
(`src/lib/paste-targets/`). Offered to owners and staff, never the accountant.
Guides: `vendors.md`, `customers.md`.

### 2026-09-08 — The day the books begin (`claude/the-books-begin`, migration `0280`)

Onboarding slice 4 ([onboarding.md](onboarding.md)), and the lower bound the
period never had. [ADR 0035](../decisions/0035-the-books-begin-on-a-day-and-nothing-is-dated-before-it.md)
is the decision.

**`entities.books_start_on`**, beside `closed_through`, because the two are
the two ends of one company's books and the lock already moved off
`accounting_settings` for exactly this reason. Null = never said. Set, moved
or cleared by `setBooksStartOn` (owner-only): earlier and clear are always
allowed; a day after a non-void entry of that company is refused
(`BOOKS_START_HAS_ENTRIES`), and a day after the close is refused
(`BOOKS_START_AFTER_CLOSE`).

**`assertPeriodOpen` now reads both bounds in one query** and refuses a date
before the start with `BEFORE_BOOKS_START`, checked before the close because it
is the more specific thing to say. Every posting and every date edit already
passed through that guard — journals, invoices at issue, bills at approval,
quick add, bank rows posted by hand or by rule, recurring templates — so
nothing new had to learn the rule. Opening balances are dated ON the day, and
the day itself is allowed.

**Imports drop the earlier lines rather than carrying them in.**
`importTransactions` filters rows before the register's company's start and
returns `skippedBeforeStart` and `booksStartOn`; the wizard's summary says
`12 dated before your books begin on 2026-01-01 were left out.`
`syncPlaidItem` does the same per linked register (`SyncResult.skippedBeforeStart`,
in the sync toast). Not imported-and-excluded, deliberately: a row the books
can never take would sit on the Excluded tab forever, one Restore from posting
2025 into 2026.

**The Close page is the home**, there being no settings screen for
`accounting_settings` at all — the fiscal year is read by every report and
written by nothing. A `Books begin on` card above the checklist, per company,
with `Set the date` / `Change` opening a dialog that states the rule, and
`Clear` in it (`setBooksStartAction`, audited as `accounting.books_start_set`).

**The setup card asks for it first.** `accounting.books-start` on the default
company, ahead of the register: a fact about the business the module needs,
proven missing by a null column (ADR 0033), not advice. Every existing tenant
sees the row until an owner sets the day — which is the point.

**Tests.** `tests/books-start-db.test.ts`: unset on a fresh company and first
on the card; staff refused, owner sets, the step clears; a post dated before
refused, on the day allowed, a date edit to before refused; a later day
refused for entries and for the close, earlier and clear allowed; an import
drops two of three lines and says so, and a re-import still drops them while
the kept one is a duplicate. `tests/setup-sources-db.test.ts` updated for the
new first row. Guides: `close.md` (the card, `How to say when your books
begin`, five messages, who can do what), `import-statement.md`, `banking.md`,
`register.md`, `new-entry.md`, `new-invoice.md`, `new-bill.md`,
`workspace/getting-around.md`.

**Driven on Hilltop (dev), and it found nothing to fix.** The setup card led
with `Say when your books begin`; `Set the date` on the Close page took
`2026-01-01` and the row cleared; a four-row statement on the personal register
imported two and read `2 dated before your books begin on 2026-01-01 were left
out.`, the 2025 lines never reaching the queue; `Change` to `2026-09-01` was
refused with the entries message and the dialog held; a quick add dated
`2025-12-15` was refused with the books-begin message. Hilltop now begins on
`2026-01-01`, which is the founder's chosen day.

### 2026-09-08 — The personal account (`claude/the-mixed-account`, migrations `0278`–`0279`)

Onboarding slice 3 ([onboarding.md](onboarding.md)), and the blocker for
loading the pilot farm, whose one bank account carries the groceries and the
feed store alike. [ADR 0034](../decisions/0034-a-personal-account-is-a-register-whose-ledger-leg-is-the-owners-equity.md)
is the decision; this is what shipped.

**A fourth register kind, `personal`, whose ledger account is EQUITY.**
`createBankAccount` opens it on an `owner_funds` account in the 3300s
(beside Owner Contributions and Owner Draws) instead of a bank asset, so the
ordinary posting — register on one side, category on the other — produces the
accountant's entry by itself: a business line paid from it credits the owner's
funds, a business receipt landing in it debits them, and the balance is what
the owner has put in net of what they took out. The hub card and the register
page read it as `Put in by you, net`. **Nothing in `categorizeTransaction`
changed**; splits, transfers, matches and undo work as they did.

**Three refusals, one code.** No opening balance (the form hides the fields and
`createBankAccount` refuses `PERSONAL_REGISTER`), no reconciliation
(`startReconciliation` refuses, the button is not offered, the reconcile page
404s, and the close checklist no longer counts it as behind), and the account is
not a deposit target. All three have the same cause and the same message: the
balance was never the business's.

**Personal by default.** `bank_rules.action` (`categorize | exclude`,
`0278`) lets a rule set a row aside on arrival — status `excluded`, a
`rule_suggestion` naming the rule, nothing posted, no closed-period or
closed-register yield because there is nothing to post. `set_account_id` is
nullable with a CHECK holding it to the action. The AI sweep is told whose
account it is (`SuggestGathered.personal`), the user turn leads with an
inverted prior (`PERSONAL_INSTRUCTION`), the pseudo-code `PERSONAL` sits in
the chart it is shown and `validateSuggestions` accepts it only when the
caller allows (`allowPersonal`), and the register's set-aside rows travel as
history under that code. Accepting a personal suggestion sets the row aside
(`acceptSuggestionsAction` now returns `setAside` too). `Set aside the rest as
personal (N)` on the To review tab, behind a confirm, sets aside every waiting
row nothing called the business's (`excludeTransactionsAction`, 50 at a time).
**Setting aside teaches the register**: `proposeExcludeRulesFromHistory`
groups set-aside descriptions by their leading merchant word
(`commonExcludePhrases`) and proposes one exclude rule per group at the
threshold, `(Suggested) Kroger as personal`, personal registers only — on a
business register an excluded row is a duplicate, not a payee to stop watching.

**Visible to the owner and the accountant, never to staff — in Postgres.**
`0279` replaces three `member_all` policies by name: `bank_accounts` hides
`kind = 'personal'` (compared as text, because the enum value arrived in
`0278` and a runner wrapping both files in one transaction would trip
"unsafe use of new value") unless `app_current_tenant_role()` is `owner` or
`expert`; `bank_transactions` and `bank_rules` (when scoped to a register)
INHERIT through an `EXISTS` on the register, the documents-versions device, so
there is no second copy of the rule. **THE COST IS ROLE PLUMBING**: `withTenant`
defaults to `staff`, under which the owner's own register reads as empty.
Every banking action now opens its transaction through `inTenant(ctx, fn)`,
which passes the role and the user, and the hub, register, import, reconcile
and rules pages pass `{ role, userId }`. `isCodableAccount` refuses the
`owner_funds` subtype by shape, because staff cannot see the register row
and the id set alone would not protect the account from a bill line.

**Words.** The tab reads `Personal (n)`, the row button `Personal`, the way
back `It's the business's`, the chips `RULE · personal` and `AI · personal ·
92%`, the type in the add dialog `Personal (mixed)` with what it means
under it. Plaid may never pick the kind: a feed knows what an account is at the
bank, not whose money runs through it.

**Tests.** `tests/banking-personal.test.ts` (pure): the validator's
`PERSONAL` gate, the prompt's inverted prior, exclude rules in `matchRules`
and their priority, `commonExcludePhrases`. `tests/banking-personal-db.test.ts`
(as an owner through real RLS): the equity leg and code, the three refusals,
an exclude rule setting rows aside on import and idempotent on re-apply, the
credit/debit directions and the net, the proposal after three set-asides and
never on a business register, the sweep's `personal` flag and history and
`PERSONAL` dropped on a checking register, and staff seeing none of the
register, its rows or its scoped rules while the owner and the accountant see
all three, including a staff INSERT refused by the policy. Guides:
`banking.md`, `register.md`, `bank-rules.md`, `import-statement.md`,
`chart-of-accounts.md`; `workspace/getting-around.md` for the setup row.

**Driven on Hilltop (dev), and three things it found.** `Add manually` →
`Personal (mixed)`: the note appears and the opening-balance fields go; the
card reads `personal account · private` and `Put in by you, net 0.00`; the
register page carries the note, `Personal (0)`, no `Reconcile`, and `Nothing
to review — everything is sorted.` Nine mixed lines imported by CSV; the real
sweep answered `AI · personal · 95%` for the grocer, the pharmacy and Netflix,
`45%` for fuel, `5000 · 60%` and `55%` for the two feed stores and `4000 ·
80%` for the market cash. `Accept 5 suggestions` → `Posted 1, set aside 4 as
personal`; `Personal` on a row → `Set aside as personal` with Undo; `Post` on
the feed store → the figure moved from `(86.00)` to `56.00`, which is 142 put
in less 86 taken out; `It's the business's` → `Back in review`; the rules
dialog's `Set aside as personal` hides the four posting controls and shows
the note; the phone layout holds. Found: (1) `{icon:wallet}` in the guide was
not a registered guide icon — `tests/guides.test.ts` caught it on CI, the
icon is registered now; (2) the option label `Personal account (mixed)` sat
in a half-width column and pushed the dialog 16px wider than itself, hence
`Personal (mixed)`; (3) **the bulk set-aside opened no dialog and left its
button disabled** — the confirm was awaited INSIDE `startTransition`, the
same trap the 2026-08-12 confirm-dialog entry records, fixed by asking first
and driven again. **The Chase personal register with its nine lines is left
on the dev fixture** for the founder to drive.

## Data model

| Table | Since | Purpose |
| --- | --- | --- |
| `accounts` | S1 | Chart of accounts, hierarchical. **Tenant-wide, shared by every company** (ADR 0010) — that sharing is most of what "manage ten LLCs in one place" means |
| `journal_entries.intercompany_id` | 2026-08-16 | The link between the two halves of an INTERCOMPANY transaction (`0148`). A grouping key, not a foreign key. Exactly two entries per id, in two different companies, by the deferred trigger in `0149` |
| `entities` | 2026-08-16 | The legal entities inside one client; **the entity owns the books** ([ADR 0010](../decisions/0010-entities-inside-a-tenant.md)). At least one per tenant, exactly one `is_default` by partial unique index. Deactivate, never delete — it owns posted entries and the FK is NO ACTION. NOT a `dimension_members` type: the test is whether the trial balance has to balance within it |
| `journal_entries` / `journal_lines` | S1 | The ledger; balanced-at-commit trigger. `journal_entries.entity_id` (`0142`) says whose books — **on the ENTRY, never the line**, so an entry still balances on its own. Composite FK `(tenant_id, entity_id)`. NOT NULL since `0144`, which ran after the deploy — `0142` had to add it nullable because migrations precede deploys |
| `dimension_members` / `line_dimensions` | S1 | Dimension tagging (industry-pack seam); line_dimensions gained invoice_line_id (S4) and bill_line_id (S6) with exactly-one-parent CHECKs |
| `accounting_settings` | S1 | Per-tenant config (fiscal year, etc.). Gained `reminders_enabled` (default **false**) and `reminder_offsets` jsonb (`0114`) |
| `bank_accounts`, `bank_transactions`, `reconciliations`, `reconciliation_lines`, `plaid_items` | S3 | Feeds, staging, reconciliation; encrypted Plaid tokens. `bank_accounts.entity_id` (`0145`) — **a register belongs to exactly one company**, chosen at creation and never moved, and `postEntry` refuses any line touching another company's register. `0263` (2026-09-06) relaxed the one-feed-row-per-entry index to one per entry **per register** (`bank_transactions_tenant_acct_entry_idx`), so a transfer between two own registers is one entry with a row on each side |
| `credit_memos` | 2026-09-07 | A credit against one invoice (`0269`; `source = credit_memo`, `0268`; RLS `0270`, owner-only writes). Posts Dr income / Cr AR and settles the invoice through an `invoice_payments` row of `method = credit_memo` (`payment_id`, detached on void) — see the build log for why that one decision is the whole design. Own `CM-####` series |
| `deposits` | 2026-09-07 | Payments held in Undeposited Funds banked together as one entry (`0265`; `source = deposit`, `0264`; RLS `0266`, owner-only writes). `invoice_payments.deposit_id` points back, cleared by a void. One company per deposit, the register's; a deposit is voided, never deleted |
| `bank_rules` | 2026-08-10 | Deterministic feed categorization. Priority-ordered, first match wins; `is_suggested` marks a machine-proposed rule; `auto_post` posts without review but never into a closed period. Gained `set_vendor_id` (`0113`) so a rule can name the payee too. `bank_transactions.rule_suggestion` is a **snapshot**, not an FK — it records what a rule said at match time, so editing the rule later cannot rewrite what the owner was shown |
| `entities.books_start_on` | 2026-09-08 | The day one company's books begin ([ADR 0035](../decisions/0035-the-books-begin-on-a-day-and-nothing-is-dated-before-it.md), `0280`), beside `closed_through` — the two ends of the period on one row. Null = never said. Written only by `setBooksStartOn` (owner), never to a day after a non-void entry or after the close. Read by `assertPeriodOpen` (refuses `BEFORE_BOOKS_START`), by the CSV import and the Plaid sync (rows before it are not staged), and by the setup card |
| `invoices.is_opening`, `bills.is_opening` | 2026-09-09 | Open on the day the books began ([ADR 0037](../decisions/0037-a-document-open-when-the-books-began-is-real-and-its-other-leg-is-opening-balance-equity.md), `0281`). Boolean, default false, written once by the Opening page's verbs. Read by `issueInvoice` / `approveBill` (the entry is dated on the start day and the other leg is Opening Balance Equity), by the cash lens (recognition from the document's lines), and by the Opening page's lists |
| `bank_accounts.kind = 'personal'`, `accounts.subtype = 'owner_funds'`, `bank_rules.action` | 2026-09-08 | The personal register ([ADR 0034](../decisions/0034-a-personal-account-is-a-register-whose-ledger-leg-is-the-owners-equity.md), `0278`). Its ledger account is EQUITY (`owner_funds`, 3300s), never a bank asset; no opening balance, never reconciled, not a deposit target. `bank_rules.action` is `categorize` (default, every pre-existing rule) or `exclude` (sets the row aside on arrival); `set_account_id` became nullable, held to the action by CHECK `bank_rules_action_account`. `bank_transactions.rule_suggestion` and `ai_suggestion` may now carry `action: "exclude"` / `personal: true` with a null `accountId`. RLS `0279`: `bank_accounts` hides the kind from `staff`; `bank_transactions` and register-scoped `bank_rules` inherit through an EXISTS |
| `parties` | 2026-08-03 | **Shared, not this module's.** The identity spine behind `customers` and `vendors`; written through `src/lib/parties/`. See [crm.md](crm.md) |
| `customers`, `invoices`, `invoice_lines`, `invoice_payments` | S4 | AR. `customers.party_id` (2026-08-03) makes the row a role on a party. Both `customers` and `invoices` gained `reminders_muted` (`0114`) — standing and one-off suppression of automatic chasing. `recurring_invoices` folded into `recurring_entries` (`0121`/`0122`) and was dropped in `0147` |
| `documents`, `document_links` | S5 | Capture substrate; exactly-one-of link targets |
| `vendors`, `bills`, `bill_lines`, `bill_payments` | S6 | AP. `vendors.party_id` (2026-08-03) makes the row a role on a party. `vendors.payment_terms_id` (`0267`, 2026-09-07): the vendor's usual terms, null = none, composite FK to `payment_terms` |
| `period_closes`, `close_notes` | S7 | Month-end close |
| `recurring_entries` | 2026-08-12 | **The** recurrence table: invoices, bills and journals. `kind` discriminates the jsonb `template`; two CHECKs pin the shape (`party_shape` — a bill has a vendor, an invoice a customer, a journal neither; and `auto_post_shape` — only a journal may post itself). `invoices.recurring_entry_id` records which template made a row |
| `products`, `payment_terms`, `payment_methods` | 2026-08-12 | The catalogue: saved invoice lines, named terms (`due_in_days`, one default per tenant by partial unique index), and the tenant-owned payment-method list. `invoice_payments.method` stores a method's CODE with **no FK** — deactivating a method must never rewrite a posted payment. `customers.payment_terms_id` (nullable = use the default). `payment_terms` moved to `src/db/schema/catalogue.ts` (2026-09-07) so `vendors` could point at it without a schema-file cycle |
| `sales_tax_rates` | 2026-08-13 | The fourth reference list, and the only one **not seeded** — there is no rate that is right anywhere. `rate_ppm` is percent × 10,000 (8.875% = 88,750), because basis points cannot express a real US rate. One default per tenant by partial unique index. `invoices` gained `tax_rate_id` (composite FK, NO ACTION), `tax_rate_ppm` (**a frozen copy**, so a rate change never re-prices an issued invoice), `tax_cents` and `subtotal_cents`; `invoice_lines` gained `is_taxable`. `total_cents` is now the GROSS and still means what it always did — what the customer owes. The `total = subtotal + tax` CHECK landed in `0147` (`0123`'s header says why it had to wait) |

All tables: `tenant_id`, FORCE RLS. Isolation coverage is split by area, one file
per area under `tests/isolation/` — `accounting.test.ts` (core ledger),
`banking.test.ts` (feeds, reconciliation, rules, Plaid), `payables.test.ts`,
`close.test.ts`, `documents.test.ts`. Until 2026-08-10 this line claimed
`accounting.test.ts` covered everything, which was never true of the banking
tables; if you add a table, add it to the file for its area and correct this
sentence rather than leaving it aspirational.

## Key files & seams

- `src/modules/accounting/` — `core/` (posting engine, reports, reconciliation), `banking/`, `invoicing/`, `documents/`, `payables/`, `close/`, `export/`, `ai/` (shared engine pattern), `templates/` (COA)
- `invoicing/reminder-render.ts` is the single place a reminder message is built — the sweep and the owner's test send both go through it, deliberately
- `invoicing/reminder-schedule.ts` and `invoicing/reminder-email.ts` are **pure** for the same reason, and it matters most here: this is the one path that emails somebody nobody on our side chose, so proving its behaviour on a table of cases is the control. `reminder-run.ts` (the sweep) only finds rows and sends; it decides nothing
- `invoicing/tax.ts` is **pure**, and everything that decides a tax figure is in
  it — the rounding, the parse, the format, the taxable/exempt split. The invoice
  builder calls it in the browser as you type and the server calls it again on
  save, which is the same reason `terms.ts` is pure and the reason it matters
  more here. `core/tax-summary.ts` is its report-side twin, and neither divides
- `invoicing/invoices.ts` exports `invoiceTaxFields`, the ONE resolver for the
  subtotal/tax/label a rendered invoice needs. The PDF route, the send path and
  both reminder paths call it; `ReminderRenderContext.tax` is required rather
  than optional so none of them can quietly omit the tax
- `banking/rules-match.ts` and `banking/rules-learn.ts` are **pure** (no `server-only`) — all the deciding lives there and is table-tested without a database, exactly as `ai/*-validate.ts` is split from `ai/*-code.ts`. The rules form imports `ruleConditionsSchema` from the matcher so the client validates against the same schema the action re-validates against
- Tenant UI under `src/app/dashboard/m/accounting/`
- **Reports are all the same two pieces**: a pure builder in `core/report-builders.ts` (fixture-testable, no database, no division) and a thin fetch wrapper in `core/reports.ts`. `getBalances` is the one aggregate engine they share; the General Ledger is the only one that also runs its own line-level query, because it lists rather than sums
- AI engines all follow the same shape: pure prompt seam + pure validate seam + injectable model call + forced tool_choice + cooldown; suggestions never post — a human accepts

## Decisions & gotchas

- **A DOCUMENT OPEN WHEN THE BOOKS BEGAN IS A REAL DOCUMENT WHOSE OTHER LEG
  IS OPENING BALANCE EQUITY** (ADR 0037, 2026-09-09). The flag is set once
  and the rule is in the verbs, so `issueInvoice` and `approveBill` are the
  only places that know it. The cash lens reads a flagged document's LINES,
  never its OBE leg, and the substitution map from `@/lib/basis-lens` does
  not apply to those lines — they are not journal lines. An opening document
  has no dimensions and no tax; anything wanting either is an ordinary
  document written on the day.
- **THE BOOKS BEGIN ON A DAY, PER COMPANY, AND NOTHING IS DATED BEFORE IT**
  (ADR 0035, 2026-09-08). One guard, `assertPeriodOpen`, holds both ends of the
  period; a new posting path that bypasses it bypasses the close too, which is
  the existing rule. Imports DROP earlier rows rather than staging them
  excluded. The refusal message is static, so the Close page is where the
  actual day is read. Rows that reached a register before the day was set are
  not swept; they are refused one at a time at posting.
- **A PERSONAL REGISTER'S LEDGER LEG IS OWNER'S EQUITY** (ADR 0034,
  2026-09-08), and every read of a register now has to carry the caller's
  role. `withTenant` defaults to `staff`; `drizzle/0279` hides a personal
  register and its rows from `staff`; so an owner path that opens its
  transaction without `{ role }` shows the owner an EMPTY register with no
  error. Banking actions go through `inTenant(ctx, fn)` in `actions.ts`, the
  banking pages pass `{ role: ctx.role, userId: ctx.userId }`, and any new
  reader of `bank_accounts`, `bank_transactions` or `bank_rules` must do the
  same. Other readers that run as staff — `assertCodableAccounts`,
  `assertNoForeignRegisters`, the bill form — simply do not see the personal
  register, which is why `isCodableAccount` refuses the `owner_funds` subtype
  by shape rather than trusting the register-id set.
- **The enum value and the policy that names it are in different migrations,
  and the policy compares as text.** `0278` adds `'personal'` to
  `bank_account_kind`; `0279` writes `"kind"::text <> 'personal'`. A policy
  written `"kind" <> 'personal'` in the same transaction as the ADD VALUE
  fails with "unsafe use of new value" — the runner (`drizzle-orm`'s migrator)
  can wrap pending files together, and this is the second time a new enum
  value has been used by the migration after it (see `0264`/`0265`).
- **Plaid never picks `personal`.** `PlaidLinkableAccount.kind` excludes it at
  the type level: a feed knows what an account is at the bank, not whose money
  runs through it. The kind is the owner's call, in the add dialog.
- **MONEY BETWEEN TWO COMPANIES IS A PAIR OF ENTRIES**, never one. As a single
  entry it leaves one balance sheet showing cash it does not own and the other
  showing nothing, while the ledger still balances. Each leg touches only its
  own company's accounts plus a shared affiliate account, which is why the
  register guard needs no exception for it. Neither leg may be voided or
  reversed alone. See [ADR 0010](../decisions/0010-entities-inside-a-tenant.md).
- **One Due-from and one Due-to account, shared.** Who owes whom is derived from
  the links (`affiliateBalances`), not from per-counterparty accounts — ten LLCs
  would be ninety accounts otherwise.
- **A REPORT MUST STATE ITS COMPANY, and cannot forget to.** `EntityScope` is a
  required argument on every report engine — `{ kind: "one" }` or
  `{ kind: "combined" }`, never an optional field where absent means everything.
  A report that lost its scope would be silently wrong across companies and
  perfectly correct on the single-company tenant it is tested against, which is
  every fixture in the repo bar `tests/entities-db.test.ts`. If a new report
  genuinely should not take one, say why in its own comment the way the tax
  summary does — do not make the parameter optional. See
  [ADR 0010](../decisions/0010-entities-inside-a-tenant.md).
- **`combined` is not `consolidated`.** It sums across companies and eliminates
  nothing. That is the same number today, because intercompany does not exist
  yet; the name is chosen so it stays true when it does.
- **RLS is not the wall between two companies of one client**, deliberately, and
  it stays absolute between clients. There is no `app.current_entity` and there
  is not going to be one in this design — separation between companies is
  application code, which ADR 0010 names as its own strongest counter-argument.
- **A DOCUMENT carries its own company; a TEMPLATE resolves the current
  default.** `invoices`, `bills` and `bank_accounts` each have an `entity_id`
  chosen at creation and never editable afterwards, and every entry they post
  reads it — so moving the tenant's default cannot split a document's AR across
  two balance sheets, and a reversal always takes its original's company. A
  recurring template resolves the default at generation instead, the same split
  the sales-tax rate already makes.
- **A LINE MAY NOT TOUCH ANOTHER COMPANY'S REGISTER**, enforced in `postEntry`
  and `editEntry`. Paying one company's bill from another's account is
  INTERCOMPANY (slice 2) and is refused rather than mis-recorded — as one entry
  it would leave both balance sheets wrong while the ledger still balanced. The
  chart of accounts is deliberately NOT constrained: two companies' receivables
  share account 1200, separated by the entry's company. Only a register is
  owned.
- **Three-tier mutability**: draft (free edit) → posted (edit-with-version/void/reverse) → reconciled (immutable; reverse only). The DB backs each tier with triggers/FKs, not just app code.
- **Derived, never stored**: invoice/bill statuses derive from payments; `closed_through` derives from period_closes; Retained Earnings is computed — no closing entries exist.
- **All money is integer cents.** No floats, and no division in report math — with exactly one quarantined exception, `core/cash-basis-allocate.ts`, where pro-rata recognition inherently divides. It uses BigInt intermediates and a largest-remainder rule so each split sums to the cent. Nowhere else in the report path may divide.
- **Cash basis does not zero AR/AP that came from a manual journal.** Only
  invoice and bill documents are re-recognised; a hand-written entry crediting
  AP has no payment to re-date to and stays put. See [ADR 0007](../decisions/0007-cash-basis-reporting.md).
- **Reports carry a basis.** Accrual is the default and the ledger as posted; cash re-recognises invoice income and bill expense on their payment dates ([ADR 0007](../decisions/0007-cash-basis-reporting.md)). Cash basis is derived at read time — there is no second ledger, and nothing about it is ever posted.
- **Two reports have NO basis toggle, for two different reasons.** Cash Activity reads only registers, which the adjustment never touches, so both bases give the same numbers. The General Ledger is line-level, and cash basis produces per-account adjustments rather than re-dated lines — a cash-basis GL could only show synthetic rows nobody can drill into. Neither omission is an oversight; do not "finish" either by adding the control.
- **Truncate or refuse, depending on whether a partial answer is still true.** The General Ledger truncates and says so — its lines are real, just fewer. A P&L over too many months REFUSES, because a statement missing three of its months is not a shorter statement, it is a wrong one.
- **One column axis, one occupant.** `compare`, `dim` and `spread` all want the same columns; a month spread beats both, `compare` beats `dim`. Adding a fourth means picking its place in that order, not adding another optional field.
- **A report that truncates says so, in the file as well as on screen.** The General Ledger's 5,000-line cap writes an `INCOMPLETE` first row into the CSV, because these files are opened months later with no memory of the screen that produced them.
- **AI never writes to the ledger.** Every AI feature (categorization, extraction, bill coding, close narrative) only suggests or prefills; a human action posts. **A RULE may post** (`auto_post`) — the difference is that a rule is a decision the owner wrote down, replayed deterministically, not a model's guess.
- **A rule beats the model** wherever both have an opinion, in the queue, in the bulk Accept, and in the chip that is shown. A rule is explainable, free, and identical on every run.
- **Automatic reminders are off until an owner turns them on**, and the switch cannot be turned on with an empty schedule — a control that says on and does nothing is a state somebody discovers three months later.
- **A recurring template may post; an AI suggestion never may.** Same line bank rules drew: a schedule the owner wrote down and can read back is a decision, replayed. It is off by default, journals only, and it still yields to the period lock — a closed month leaves a draft and says so.
- **Lifecycle status is stored; obligation language is rendered.** `obligationFor` is never persisted and never checked by a guard — every rule in the module still reads `status`. A derived label that started being written back would be a second source of truth for whether an invoice is paid.
- **Reference data deactivates, never deletes, and never rewrites history.** A saved item or term may be named on records that already exist. The payment-method list goes further: it has no foreign key from `invoice_payments`, so renaming a method changes the label and nothing else — the code a payment recorded is what it recorded.
- **A DOCUMENT freezes its rate; a TEMPLATE resolves one.** `invoices.tax_rate_ppm` is a copy taken at write, so correcting a rate leaves every issued invoice and every entry posted from one exactly as they were. A recurring template stores the rate ID instead, and re-resolves it every month, because a template is a standing instruction rather than a record of what was charged. The two are opposite on purpose; do not "make them consistent".
- **Tax collected is never income.** It lands in the `sales_tax` account — found by SUBTYPE, never by code — and a liability reaches no P&L section, so the exclusion is structural rather than a filter somebody has to remember. It is pinned by a test anyway, because the thing that would break it is a one-line addition to `PNL_SECTION_BY_SUBTYPE` that looks harmless.
- **Tax rounds ONCE, on the summed taxable base**, never per line. Per-line rounding produces a total that does not equal rate × base, which is the arithmetic both the customer and the return do.
- **The tax summary reads two sources and shows the gap.** Per-rate figures come from invoices (a return's boxes), the amount owed comes from the ledger (ties to the balance sheet), and the difference is stated rather than reconciled away — it is normally non-zero, because earlier periods' unremitted tax is still in the account. Any future report combining a document view with a ledger view owes the reader the same.
- **An AI claim about a source is checked against the source.** The thread drafter verifies every quote appears in the message it cites; an unverifiable one is shown flagged and unticked, never dropped and never presented as fact. Any future "the assistant found this in X" owes the reader the same check — a citation nobody verifies is worse than no citation, because it is believed.
- **Anything that previews an outbound message must share the renderer that sends it.** `reminder-render.ts` exists so the test button and the nightly sweep cannot drift; a preview built by its own code path is worse than none, because it is believed. Apply the same rule to any future preview (invoice, statement, digest).
- **Reminders overtake, they do not queue.** Only the latest applicable offset can fire, so enabling the feature over an old book sends one email per invoice rather than one per missed offset. Nothing else in the module needs this rule; it exists because the alternative loses a client on the first morning.
- **A rule never overrides the period lock.** Auto-post skips rows dated in a closed period and leaves them for review; the import still succeeds.
- **A transfer between two of the business's own accounts is ONE entry, matched from both sides** (`0263`, 2026-09-06). The register the money left posts it as `Transfer to …`; the register it reached matches it. The side that posted is undone by voiding, which returns both rows; the side that matched unlinks with Unmatch alone. A feed row is still satisfied by exactly one entry — P12 — and an entry now satisfies at most one row per register it touches, never two on the same register.
- **Email-in tokens must be lowercase** — mail infra lowercases local parts (found in production, `8147c2d`).
- **Blob store is private** — use the presigned upload flow and pass the RW token explicitly server-side.
- **Managed-source entries** (invoice/bill) can't be voided from the journal; void via their document's lifecycle.

## Open items

**The two group scopes may be named backwards for the commonest case** (found
2026-09-13 while designing [construction.md](construction.md); an accountant
should confirm before any user-facing word changes). The report control offers
"All companies (combined)" for a plain sum and "All companies (consolidated)" for
a sum with intercompany eliminated. In accounting usage those labels sit the
other way round for entities under **common ownership without a parent**:
*combined* statements are the ones prepared for brother-sister companies and they
**do** eliminate intercompany, while *consolidated* additionally eliminates a
parent's investment in a subsidiary and presents noncontrolling interests — which
[consolidation.ts](../../src/modules/accounting/core/consolidation.ts) states in
its own header that it deliberately does not do.

So the mechanism is right and only the title is in question. It matters because
the first real group on the platform is brother-sister commonly owned (the
construction pilot: three LLCs owned directly by one family, confirmed
2026-09-13), its statements go to a bank and a surety, and the word on the page is
what they read. The cheap version is a wording change plus the export filename;
the wrong version is renaming the scope values in the URL, which are an API. **Do
not change either on a hunch** — the module's own header is evidence the
distinction was understood, so ask what was intended first.

**Never confirmed by a human** (as of 2026-08-10, found while driving the live
app): the **Send button on an issued invoice** — the draft case is proven, but
two attempts to click Issue did not register, so nobody has watched Send appear
and work; and a **focus oddity in the rule dialog**, where typing after opening
the category Select went into the condition-value box instead of the dropdown.
Both may be artefacts of browser automation rather than defects. Check them by
hand before building on either screen.

A third, now closed: **the General Ledger page was rendered by a signed-in
person on 2026-09-02**, while its tenant guide was being checked — Hilltop
Farm's September lines with opening, running and closing balances, on the
dev branch. It had carried the note since 2026-08-12 because the page body
only executes behind a Clerk session. The standing rule stays: treat every
screen shipped without such a session as compiled-and-tested, not seen.


- **The 2026-09-06 improvement pass** (fewer clicks, easier UI, a phone that
  works, then gaps), verified against the code and the real screens at 375px;
  the review-queue slice in the build log is the first thing built from it.
  Still open, roughly in value order: ~~an **Issue and send** on the invoice~~
  (DONE 2026-09-06, `claude/issue-and-send`); ~~**Record payment and Approve as row actions** on the invoice and bill
  lists~~ (DONE 2026-09-06/07) and ~~on What needs you~~ (Approve DONE 2026-09-07,
  `claude/approve-from-what-needs-you`);
  ~~**the whole list row as the link**~~ (DONE on both lists); ~~**a customer
  created from the invoice form** the way the bill form creates a vendor~~ (DONE 2026-09-07, `claude/customer-from-invoice`);
  ~~**vendor default terms**, and a control for the `customers.payment_terms_id`
  column that already exists~~ (DONE 2026-09-07, `claude/default-terms`, `0267`); ~~the `Combobox` on the vendor, customer and
  line-account pickers~~ (DONE 2026-09-07, `claude/type-ahead-pickers`, plus the journal line and Quick add); ~~**a Transfer choice in the review queue**~~ (DONE 2026-09-06,
  `claude/own-account-transfers`, migration `0263`); ~~**a deposit screen** for Undeposited Funds~~ (DONE
  2026-09-07, `claude/bank-deposits`, migrations `0264`–`0266`; the tile now leads to it); ~~**search and paging** on every list~~ (DONE
  2026-09-07, `claude/search-and-pages`; the register still has no date filter); ~~**splitting one bank
  transaction** across categories~~ (DONE 2026-09-07, `claude/split-transaction`); ~~the bill and invoice line editors as stacked blocks on a phone~~ (DONE
  2026-09-07, `claude/forms-on-a-phone`); ~~money tiles and Overview cards two-up~~ (DONE 2026-09-07); ~~the native `window.confirm()`s~~ (bill void and unapply became dialogs
  2026-09-07 on the bills slice; regenerate and disable email-in the same day,
  none left); ~~`loading.tsx` under the accounting routes~~ (DONE 2026-09-07); ~~an explicit camera control on the Inbox upload for the app~~ (DONE
  2026-09-07, `Take photo` below `md`)
- **Fixed assets carry a company** (2026-08-17, `0154`) — the last item on ADR 0010's list. `entityForDocument`/`entityOfDocument` are DELETED with it: nothing infers a company from where an entry happened to land any more. **Nothing is owed in the migration lane** — `assets.entity_id` stays NULLABLE, unlike every other one, because the assets pack `requires: []` and a tenant can register equipment with no books at all
- **An invoice banked into another company's account is RECORDED** (2026-08-17), the mirror of the bill case and the last item ADR 0010 listed as refused. It also closed a live hole in the bill path: unapplying an intercompany payment voided ONE leg, because `assertNotIntercompanyLeg` lived only in the action layer. The guard is in `voidEntry`/`reverseEntry` now and `voidIntercompanyPair` is the undo that takes both
- **Per-entity close is DONE** (2026-08-17, slice 4 of ADR 0010) — the lock is `entities.closed_through`, the checklist is scoped, and two companies can close different months. **The contract half is DONE too** (`0153`, applied and verified on both databases the same day): `period_closes.entity_id` is NOT NULL and `accounting_settings.closed_through` is dropped. **Nothing is owed in the migration lane.** Two things this slice leaves behind on purpose: a company carrying a lock INHERITED from the tenant-wide scalar has no close row to reopen and can only be closed forward (on production that is Oak Row LLC), and `assets` still has no company, so depreciation reads its lock through `entityForDocument`
- **Consolidation is DONE** (2026-08-17, slice 3 of ADR 0010): a third scope beside "one company" and combined, on the trial balance, balance sheet, P&L and general ledger, plus a consolidated set in the books export. Eliminates by following the `intercompany_id`, never by matching amounts; the unlinked-journal residual is surfaced on the page and in the CSV rather than reconciled away. What is NOT built: **per-entity close** (4 — `period_closes` still locks every company at once), a company on **fixed assets** (the assets pack is `entityForDocument`'s last caller), and **receiving an invoice payment into another company's account**, the mirror of the bill case, still refused. And deliberately not built at all: full GAAP consolidation — no investment-in-subsidiary elimination, no minority interest, no purchase accounting, because these are commonly owned LLCs rather than a parent with subsidiaries
- **Documents carry a company** (2026-08-16, slice 1b): `invoices`, `bills` and `bank_accounts` each have an `entity_id`, the posting engine refuses a line touching another company's register, and A/R aging, A/P aging and the tax summary all take a scope now. `drizzle/0146` closed the expand/contract — all three are NOT NULL on both databases. **Intercompany pairs are DONE** (slice 2, same day — `0148`–`0151`). What is NOT built: **consolidation with eliminations** (3), **per-entity close** (4 — `period_closes` still locks every company at once), and a company on **fixed assets**, which leaves the assets pack as `entityForDocument`'s last caller
- **Companies (legal entities) are DONE** (2026-08-16, slice 1 of ADR 0010) — the table, `entity_id` on entries, the picker, and scoped trial balance, P&L, balance sheet, cash activity and general ledger. `drizzle/0144` closed the expand/contract the same day: `entity_id` is NOT NULL on both databases, with the window's backfill re-run first. Still queued in that lane: the `recurring_invoices` DROP and the `total = subtotal + tax` CHECK below. What is NOT built, each a later slice: **intercompany pairs** (2), **consolidation with eliminations** (3), **per-entity banking and close** (4) — `period_closes` still locks every company at once. And the limit worth stating to anybody selling this: **a multi-company tenant can only put entries in a second company by hand-journaling**, since invoices, bills and bank feeds all post to the default
- Credit memos (designed-for headroom in S4, unbuilt)
- Recurring-invoice cron (fast-follow; zero schema change needed)
- Industry-pack dimension packs ("P&L by property" seam live but no pack registered yet — Real Estate pack is the planned next build)
- **Invoice delivery is done** (PDF + email, 2026-08-10). What is NOT built: a `Viewed` signal, which would need a tracked open or a public link — and a public payor view is deliberately not planned, since payment processing for tenants' customers is out of scope by design
- **Automatic overdue reminders are DONE** (2026-08-11) — see the build log. ~~What is not built: a reminder for **bills we owe** (the AP mirror)~~ (DONE 2026-09-07 as attention items, `claude/ap-reminders`); reminder wording an owner can edit is deliberately left until somebody asks
- **General Ledger and Transaction Detail by Account are DONE** (2026-08-11) — one report with an account filter, so seven reports now. See the build log for the accrual-only decision
- **P&L by Month is DONE** (2026-08-12) — the by-dimension column spread generalized to time. ~~What is NOT built: quarter and year columns, which the same `periods` seam would carry with a different bucketer~~ Quarter and year columns DONE 2026-09-07 (`claude/pnl-columns`), on the fiscal year
- **Drafting from an email thread is DONE** (2026-08-12) — both directions, with verified citations, and **proven against the real API** (see the build log; `RUN_LIVE_THREAD_DRAFT=1`). Now worth doing: the drafter sets no due date because it does not know `payment_terms` exists — resolving the customer's default term in the accept path would close that. What is NOT built: auto-linking the accepted draft back to the thread (deliberate, see the build log), and drafting from a thread the *reader does not own*, which RLS forbids by design
- **The per-record History panel is DONE** (2026-08-12) on invoices and bills; journal entries, customers and vendors are a one-line addition each
- **Products & Services, Terms and Payment Methods are DONE** (2026-08-12) — see the build log for the two deliberate gaps (customer-level default terms have a column and resolution but no control; saved items are invoice-only so far)
- ~~**Line account pickers are filtered in the UI ONLY.**~~ **Closed 2026-09-01, in two halves the same day.** The bill half came first, because a matched line's GRNI coding round-tripping through the form is what let the same receipts clear GRNI twice. The invoice and recurring halves followed once that PR's own build log admitted they were still open: `assertCodableAccounts` in core is the shared server-side rule, called by invoice lines and by recurring **bill and invoice** templates at the moment they are saved. Bill lines enforce the same rule in their own `assertLineAccounts`, which does not call it because it needs the one exception a stock match requires; a journal template, like the hand-written journal, is checked for existence and activity only. See the build log for the two boundaries that had to be stated — a journal may still name any account, and an invoice line may credit a liability
- **Recurring entries GENERATE ON THEIR OWN** since 2026-08-13 (`/api/cron/recurring`, 6am in the tenant's zone). ~~What is not built: any way to see the sweep's history in the UI — the counts come back to the cron caller and nowhere else.~~ **Closed 2026-09-01, as two columns rather than a history table:** a template that fails carries the error's CODE in `last_error` and the moment in `last_error_at`, the list shows a `failing` badge with the sentence, and only that template's next clean run clears it. The sweep's aggregate counts still go to the cron caller alone; the per-template note is the surface anybody actually needs. ~~This is what made the retired-tag decision what it was~~ — that decision stands: a dropped tag is a SUCCESS and never lands in `last_error`
- ~~**THE RECURRING FRONTIER NEEDS ITS OWN COLUMN.**~~ **Closed 2026-09-02** (migration `0240`): `recurring_entries.generated_through` is the last period the sweep reached, written only by the success UPDATE and backfilled from `next_run_date - 1 month`; `updateRecurringEntry` compares against it by month. A forward edit no longer ratchets — the month after the last generated one is always reachable again
- ~~**A FAILING TEMPLATE IS NOT ON `/dashboard/today` OR IN THE DIGEST.**~~ **Closed 2026-09-02**: `attention/source.ts` derives it as the third accounting obligation, bounded on the sweep's own predicate (active AND due) so it self-clears on the fix, the pause, and a forward edit past today. The note is the fact; the feed is a consumer of it, exactly as this item said
- ~~**EDIT MODE RENDERS A BLANK SELECT FOR A PARTY OR ACCOUNT THAT MAY NO LONGER BE PICKED.**~~ **Closed 2026-09-02**: `lib/pick-options.ts` offers the template's own dead party or account back, marked, to that dialog alone; the item is disabled, Save is blocked, and a sentence says what to do. For the account the answer was not "blank" after all — the stored value shown and marked `(cannot be chosen)` is what tells somebody WHICH account to re-pick
- **THE BILL AND INVOICE BUILDERS' PARTY SELECTS HAVE THE SAME BLANK TRIGGER** for a deactivated party on an existing draft: the bill `[id]` page loads its own vendor unfiltered for the header and active vendors only for the select. `partyOptions` (2026-09-02) is the fix and is unapplied there; nobody has hit it yet
- ~~**`generateRecurringEntries` counts a record it may not have written.**~~ **Closed 2026-09-01**, in its own PR as it deserved. `created`, `posted` and the deferral now all hang off `PostResult.deduped`, and `periodsWalked` carries the months the loop walked so a gap between the two is visible in the sweep's JSON. It was never reachable through the schedule; it is fixed because a count whose correctness rests on an unreachability argument goes wrong the first time somebody makes it reachable
- **Recurring journals and bills are DONE** (2026-08-12), and so is **folding `recurring_invoices` into them** (2026-08-12) — the module has ONE recurrence mechanism, one list and one engine. **DONE**: `drizzle/0147` dropped `recurring_invoices` and `invoices.recurring_invoice_id`. **Templates can be born with a dimension tag since 2026-09-01**, on all three kinds, and the list shows what each one carries. ~~What is not built for any kind: **editing a template** — which is why a tag, like an amount and an account, is fixed at creation~~ **Editing landed 2026-09-01** — every field but `kind`, under a version CAS, with the one guard that matters (the next run cannot move back over months already generated). What is not built: any cadence other than monthly
- **Obligation statuses and the MoneyBar are DONE** (2026-08-12) on the invoice and bill LISTS. What is not built: the same language on the detail pages, and a deposits screen for the two money buckets to link into. **That closes the 2026-08-10 QuickBooks review list.**
- **Sales tax is DONE** (2026-08-13) — a tenant-owned rate list, per-line taxability, one frozen tax block on the invoice, one Cr to the `sales_tax` account at issue, and a per-rate summary that reconciles against the ledger. Deliberately NOT built, each for a reason in the build log: **tax on bills** (US purchase tax is part of the expense; the regime where it matters is VAT/GST, a different posting model), a **customer-level default rate and tax-exempt flag** (the invoice-level control is live; this is the `resolveTaxRate` signature's obvious next argument, ~30 lines), a **one-click remittance** debiting the tax account (a journal or a bill does it today, and the summary shows the balance to remit), **cash-basis tax**, and **splitting a combined rate into components** for a return that wants state and county separately
- **`drizzle/0147` closed the last two owed contract migrations** (2026-08-16): the `recurring_invoices` DROP and the `total_cents = subtotal_cents + tax_cents` CHECK. They ran together because both must follow this deploy — the DROP because a live build still selecting a dropped column 500s, the CHECK because it could not precede the deploy that started writing `subtotal_cents`. Nothing is owed in that lane now
- ~~The last item from that review~~: **obligation-language statuses** ("Overdue 60 days" rather than `issued`) and the **MoneyBar** bucket filters (Overdue / Not due yet / Not deposited / Deposited, each clickable with a total) on the invoice and bill lists. Everything else on that list is now built
