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

### 2026-08-12 — Draft an invoice or bill from an email thread (branch `claude/accounting-invoice-from-thread`)

The one place this product can lead rather than catch up: we own the mailbox,
the documents and the ledger, so "turn this agreement into an invoice, and show
me the sentence that justifies each line" is a question only we are positioned
to answer.

- **CITATIONS ARE THE FEATURE.** Every proposed line quotes the message it came
  from, and `ai/thread-draft-validate.ts` checks that the quote **actually
  appears in that message**. Whitespace is forgiven (mail bodies get re-wrapped
  in transit); punctuation, spelling and word order are not, so a paraphrase
  fails. This is what lets a reader trust the output in the five seconds they
  will actually give it.
- **An unverified line is KEPT, FLAGGED, and unticked** — never silently
  dropped. Hiding a figure somebody may be owed is its own kind of wrong, and
  the reader has the conversation open behind the dialog. The failure mode is
  "look at this one", not "this quietly vanished".
- **The architecture was decided by RLS, not by taste.** Message bodies are not
  in our database (`mail_thread_index` is metadata only) and `mail_accounts` is
  scoped to ONE USER (`0043`), because a thread is private correspondence. So
  only the mailbox's owner can obtain the text — mail fetches it and hands it
  over; the extension never goes looking. That is why this cannot live on the
  invoice page.
- **New mail-extension hook, `drafters`.** Accounting contributes two; a future
  layer could contribute a job or a quote. Mail still never imports a module —
  `registry.ts` remains the only meeting point, and eslint still enforces it.
- **Bills get uncoded lines on purpose.** `bill_lines.account_id` is nullable by
  design (P9), so a drafted bill lands uncoded and the existing bill-coding AI
  does the categorising it is already good at. Invoices cannot do the same —
  `invoice_lines.income_account_id` is required — so every drafted line lands on
  the lowest-numbered active income account and the reviewer re-points it. The
  prompt is deliberately NOT given the chart of accounts: the hard part of
  reading a thread is what was agreed and for how much, and adding
  categorisation makes it worse at the part that matters.
- **Thinking is ON for this engine**, unlike the four older ones which pin it
  off to preserve their `claude-opus-4-8` behaviour. Deciding whether a
  conversation contains an actual agreement is exactly the reasoning
  `src/lib/claude.ts` says to give room to.
- A malformed payload and "nothing was agreed here" render almost identically —
  an empty line list — so the validator distinguishes them explicitly and the
  reader is told which they are looking at. Found by a test.
- **Deliberately NOT built:** the accepted draft is not auto-linked back to the
  thread. Linking in this product *publishes* a filed copy into Documents
  (see [email.md](email.md)), which is a heavier act than this flow should
  perform silently — the memo records the provenance and the existing
  "Attach to…" button is one click away. Migration `0115` adds the cooldown
  marker only.

### 2026-08-12 — P&L by Month (branch `claude/accounting-pnl-by-month`)

The column spread the by-dimension P&L already had, pointed at time instead of
dimension members. Most of this was generalizing what existed rather than
adding machinery.

- **Columns sum to the ungrouped report, and that is the test that matters.**
  A monthly P&L whose columns do not add back up to the plain one for the same
  range is worse than none — it looks authoritative while disagreeing with the
  statement beside it. Pinned in `tests/reports.test.ts`: every account's Total
  column equals its `cents` from a spread-less run over the same range.
- **`monthsInRange` clips the first and last months to the requested range**,
  so 15 Jan – 20 Mar gives 15–31 Jan, all of Feb, 1–20 Mar. Clipping rather
  than rounding out to whole months is *why* the columns add up.
- **Month labels come from a fixed table, never `toLocaleString`.** A report
  header that reads differently on a machine with a different locale is a bug
  nobody finds until two printouts get compared.
- **The Total column is summed from the buckets**, not copied from the
  ungrouped figure, so it is literally the sum of the columns beside it — the
  calculator check a reader actually does.
- **`perMemberCents` → `perColumnCents`.** The name stopped being true the
  moment a column could be a month; mechanical rename across 7 files.
- **`spread` is its own query parameter, not another value in `dim`.**
  `dimension_members.dimension_type` is free text, not an enum, so a tenant can
  legitimately have a dimension called "month" and a shared value space would
  collide with it.
- **One column axis, one occupant.** A month spread now beats both `compare`
  and `dim`, extending the existing v1 pin. A test caught that the first
  version suppressed `dim` but not `compare`, which would have left rows
  carrying a `comparisonCents` nothing rendered and a header saying "vs …"
  about a comparison that was not on screen.
- **Over 24 months it REFUSES rather than truncating.** Unlike the General
  Ledger, where a truncated report still shows real lines, a silently shortened
  P&L is simply a wrong one. The page catches the error and says so.
- No schema change, no migration.

### 2026-08-12 — "Send this reminder to me" (branch `claude/accounting-reminder-test`)

Reminders shipped with no way to watch one work short of switching them on
over real customers and waiting for 8am. This is the missing half.

- **One renderer, not two.** `reminder-render.ts` was extracted from the sweep
  so the nightly job and the test button build the identical message. Two code
  paths that build "the same" email is exactly how a test button becomes
  reassuring and wrong, so the extraction is the feature — the button is the
  easy part.
- **The test key lives outside the real namespace**, `reminder-test:` rather
  than `reminder:`, and that one character does three jobs:
  `sentOffsetsFromKeys` requires the first segment to be exactly `reminder`, the
  sweep's `like('reminder:%')` does not match it, and `listInvoiceReminders`
  filters it out. So **testing the 7-day wording cannot stop the real 7-day
  reminder going out**, and the history panel keeps meaning "what the customer
  received". Pinned by a pure test and again by a DB test.
- **The nonce is a minute bucket**, so a double-clicked button is one email
  while a deliberate re-test a minute later sends again. That inverts the real
  key's rule deliberately: here, sending again is the point. Computed in the
  action, so the key builder stays clock-free and table-testable.
- **The subject is marked `[Test]` and the body is byte-identical.** Reading
  what the customer would read is the whole reason to press it; the subject
  carries the warning so a forwarded copy cannot be mistaken for the real one.
- **The recipient is the owner's own address from `profiles`**, never a
  parameter — the same rule the digest follows. The invoice id is the only
  thing the client chooses; which offset gets previewed is decided server-side.
- **It works while reminders are OFF**, which is when somebody most wants to
  read one. When the schedule has already run its course the last offset is
  used as the stand-in.
- New `EmailKind` `invoice_reminder_test`, so test sends are trivially
  separable in the log.

### 2026-08-11 — General Ledger (branch `claude/accounting-general-ledger`)

The seventh report, and the first one that is line-level rather than
aggregated. `getBalances` sums; this one lists.

- **It reconciles to the trial balance, and that is the test that matters.**
  An accountant's first move with a new ledger is to tie it back, and a report
  that disagrees is not slightly off, it is unusable. Pinned in
  `tests/reports.test.ts`: every trial-balance row's signed net, converted
  through `displayCents`, equals that account's GL closing balance.
- **Accounts with an opening balance and no movement are kept**, with an empty
  line list. That is *why* the reconciliation holds — dropping them would leave
  a difference somebody has to chase.
- **Running balances move on the account's natural side (P6)**, so income
  climbs when credited, while the Debit and Credit columns stay ledger-side and
  positive. The builder sorts by `(entryDate, entryId, lineNo)` itself rather
  than trusting the query plan: a running balance whose order can shift between
  two runs of the same report is worse than none, because the numbers differ
  while the totals agree.
- **ACCRUAL ONLY, deliberately.** Cash basis here is a read-time
  re-recognition producing per-account *adjustments*, not re-dated journal
  lines (ADR 0007) — so a cash-basis GL would show synthetic rows no entry
  backs and nobody can drill into. A ledger you cannot tie back to an entry is
  worse than one that honestly covers a single basis. Same shape of decision as
  Cash Activity's missing basis toggle, different reason. To build it properly,
  build line-level re-dating first, not a toggle.
- **Capped at 5,000 lines, and it says so.** The cap applies in chronological
  order, so a truncated report is the earliest part of the period rather than
  an arbitrary sample; the banner and the **first row of the CSV** both say it
  is incomplete. A truncated report no longer ties to the trial balance, and
  the banner says that too.
- **"Transaction Detail by Account" is this report with one account chosen**,
  not a second report. `ReportControls` gained an optional `accounts` filter
  that renders inside its existing GET form.
- One new query, no schema change, no migration.

### 2026-08-11 — Automatic overdue reminders (branch `claude/accounting-overdue-reminders`)

The first thing in the module that **emails a person with nobody at the
keyboard**. Everything below follows from that one fact.

- **Off by default, per tenant.** `accounting_settings.reminders_enabled`
  defaults false. A migration must never start mailing a client's customers;
  an owner turns it on deliberately, and the action is audited in both
  directions because "when did this start" will eventually be asked.
- **The schedule is a list of day offsets relative to the due date**, negatives
  allowed — the default is `[-3, 0, 7, 14, 30]`: a nudge before, one on the
  day, then chasing. Stored as zod-validated jsonb on the same
  validate-at-write-AND-at-read contract as `recurring_invoices.template`.
- **"Latest applicable offset wins" is the whole design**, and it is in one
  pure function (`invoicing/reminder-schedule.ts`, no `server-only`, 27 table
  tests). Turning reminders on over a book of 90-day-old invoices sends **one**
  email each, not five; an invoice 30 days late is never told it is "due in
  three days"; each offset fires at most once; when the last one is sent the
  invoice goes quiet forever. A missed cron run is self-healing rather than a
  lost reminder — the same offset is still latest-and-unsent tomorrow.
- **No `last_reminded_at` column.** What has been sent is derived from
  `outbound_emails` via the key `reminder:<invoiceId>:<offset>:<recipient>`,
  the same call `send-invoice.ts` made. The offset is in the key rather than
  the date so the autumn DST repeat of 01:00–02:00 cannot become a second
  email. It also means the history panel shows *delivery status*, so a bounce
  reads as a bounce.
- **Two mutes, both applied in the query rather than filtered after**:
  `invoices.reminders_muted` (a dispute, a plan agreed by phone) and
  `customers.reminders_muted` (standing — the big account you would rather
  phone). A mute checked late is a mute a refactor can drop.
- **Its own cron** (`/api/cron/invoice-reminders`, hourly, wakes at each
  tenant's local 8am), not a passenger on the digest. The reason is blast
  radius: the digest mails our own users, this mails our clients' customers.
  An incident in one must not stop the other. 8am is an hour after the digest
  so an owner reads "invoice 12 is 30 days overdue" before their customer does.
- **Capped at 50 per tenant per sweep**, well under the 100/hour valve in
  `lib/email/send.ts` — which fails sends rather than deferring them. The
  remainder is deferred rather than lost, for free, by the schedule rule above.
- **The attached PDF is the invoice as issued**, not the outstanding balance. A
  reminder whose attachment quietly shows a different total from the invoice
  the customer agreed to is the kind of thing their bookkeeper notices.
- Isolation: the sweep gets its own two cases in `tests/isolation/accounting.test.ts`
  — it never selects another tenant's invoices, and one tenant's send log
  cannot silence another's reminder. Found while writing them:
  **`outbound_emails` refuses a member INSERT outright**, so that log cannot be
  forged from inside a tenant at all.
- ~~**Still unproven by a human:** nothing has watched a real reminder
  arrive.~~ Addressed 2026-08-12 by the test-send button above — press Test on
  any row of `/sales/reminders`. The unattended cron path still needs
  `CRON_SECRET` set and a tenant with reminders switched on.

### 2026-08-10 — UI: the nav collapses, and three contrast failures go with it (branch `claude/ui-foundation`)

Presentation only — no query, action, schema or policy changed. The shared
vocabulary this uses is in [design-system.md](design-system.md); the reasoning is
[ADR 0008](../decisions/0008-warm-neutrals-and-layered-elevation.md).

- **`AccountingNav` is now a `CategoryStrip`.** Ten text tabs that wrapped onto
  two lines became one row that scrolls sideways, with an icon over each label.
  The component name and export did not change, so all ~25 pages importing it
  picked this up without an edit.
- **Three rows of navigation became one and a half.** The invoices page rendered
  `AccountingNav` *plus* `SalesNav` *plus* a status filter row before the first
  invoice. `SalesNav`/`PurchasesNav` are now `FilterPills` on the `accent`
  variant and share a single row with the status pills on the `solid` variant —
  distinct enough that eight adjacent pills do not read as one control. The rule
  worth keeping: **a strip moves between sections, pills filter the list you are
  on.**
- **Fixed: `text-brand` was failing WCAG AA in production.** `--brand` measures
  **2.81:1** on white, below even the 3:1 bar for icons and large text, and it was
  the active state of `SalesNav` and `PurchasesNav` and the icon chip on every
  banking account card. All now use `--module-accent`, which is pitched to clear
  4.5:1. Three separate call sites, one root cause.
- **Hardcoded `amber-50/300/900`** on the Plaid sandbox banner moved to the
  `--warning` token, so it follows the theme instead of being light-mode-only.
- **The banking Rules link was an anchor styled to look like a button** — it had
  no focus ring. It is a real `Button asChild` now.
- Converted: the hub (eight hand-built cards → `StatCard`), invoices, customers,
  recurring, bills, vendors, accounts, journal, banking, receipts.
- **`--module-accent` is set for every module route** by a client layout at
  `src/app/dashboard/m/layout.tsx`, using `display: contents` so it adds no box
  that could break a full-width module's height chain.
- **Reports and trial balance converted too**, plus a second contrast pass.
  `ReportTable` is shared by P&L, Balance Sheet and both aging reports, so
  converting it once covered four report bodies. Seven `bg-emerald-600` badges
  became `bg-success/12 text-success-foreground` — the first attempt used
  `bg-success` with white text and **measured 3.28:1**, so it was replaced with a
  tint plus a new dark `--success-foreground` (5.9–6.2:1 light, 9–10:1 dark).
  Three more bare `text-brand` sites fixed in `register-controls.tsx` and
  `bill-builder.tsx` — the AI/rule suggestion chips in the bank review queue.

- **Detail and `new` pages finished.** Every page in the module now uses
  `PageHeader` — `text-2xl font-semibold tracking-tight` appears **zero** times
  under `src/app/dashboard/m/accounting/`. Status badges moved into the header's
  actions slot alongside the buttons, which is where a verdict belongs.
- **`ui/card.tsx` swapped `ring-1 ring-foreground/10` for `shadow-elevation-1`.**
  One edit, and every remaining `Card` in the *whole app* matches `Panel` — worth
  far more than converting another thirty call sites, and it closes most of the
  "half-migrated" gap ADR 0008 warned about. `DialogContent` took
  `--elevation-3` the same way.
- **The invoice detail page's print rules are untouched.** Its `print:hidden` on
  the on-screen header, the separate print-only header, and the
  `print:table-cell` columns are all exactly as they were. Note `ring-1` was
  itself a box-shadow in Tailwind, so swapping it for another box-shadow changes
  nothing about what reaches paper.
- Four more hardcoded `amber-*` banners (posted-entry edit warning, duplicate-bill
  warning) moved onto `--warning`.

**Not verified:** the printed invoice has not been checked against a real print
preview in either state. The change is argued to be inert, not observed to be.

### 2026-08-10 — Rules learn a payee, and the feed screen fixes (branch `claude/rules-payee`)
- **Rules can set the payee** (`0113`: `bank_rules.set_vendor_id`, `bank_transactions.vendor_id`). Found by driving the real app against the QuickBooks benchmark: every one of their rules sets a payee as well as a category, and without it a matched row still needed the vendor typed in by hand — half the work the rule was meant to save
- **The payee is applied to the row, not suggested.** Unlike the category it posts nothing, so there is nothing to accept. **A payee already set by hand is never overwritten** by a later rule run
- **It stops at the staging row.** `journal_entries` has no party column and inventing one for this would be a far larger change than the feed screen needs, so the payee is feed metadata and a "From/To" column, not something that reaches the ledger. Say so before promising a vendor report built on it
- **Two layout bugs on the rules table**, both found by using it rather than reading it: the table overflowed its card and hid Turn off / Edit / Delete behind a horizontal scrollbar, and a long rule name overlapped the next column. Columns now collapse by breakpoint and fold into the name cell instead of disappearing
- **The import result now says what the rules did.** It already computed `{matched, autoPosted, skippedLocked}` and threw it away, which made the feature invisible at the one moment it ran
- **Accessible names on every Select trigger** in the rule dialog — they read as bare `combobox` before, unlike the labelled ones in the benchmark

### 2026-08-10 — Invoice delivery: the PDF, and sending it (branch `claude/invoice-pdf`)
- **`/api/accounting/invoices/[id]/pdf`** renders the invoice with `@react-pdf/renderer`. Until now the module could not produce an invoice document at all — `pdf` appeared in it only as an *input* mime type for receipt extraction
- **A GET route, not a server action.** Actions are capped at 4MB and return through the RSC channel; this is a file somebody saves, prints or forwards. Same shape as the books export. Auth is re-checked on every fetch, and the expert role may read it — a PDF of the books is a report, not a mutation
- **Sending goes through `@/lib/email/send`**, the platform's one outbound door, which already owns the rate caps, the non-production recipient redirect, the sender identity and the `outbound_emails` log. `EmailKind` has had `"invoice"` in it since that seam was written; this is the caller it was waiting for. **No mailbox prerequisite** — the header comment there already promises a JMAP transport can slot in later without touching a single caller
- **`SendEmailInput` gained `attachments`** (capped at `MAX_ATTACHMENT_BYTES`, far under the provider's limit so a rejected send is our error message rather than theirs). An invoice email without the invoice attached is not a delivery
- **There is NO `sent_at` column.** Whether an invoice has been sent is derived from `outbound_emails` by the idempotency-key prefix `invoice:<id>:` — a uuid cannot contain a colon, so the prefix is exact. One fact, one home, the same as invoice status deriving from payments
- **The idempotency key is `(invoice, recipient)`** and nothing else. Keyed on the invoice alone it would swallow a genuine re-send to a corrected address; keyed on a timestamp every retry would be a second email at the customer
- **Only issued/partial/paid can be sent.** A draft would go out saying DRAFT and a void one should not go out at all
- **The Noto Sans TTFs moved to `src/lib/pdf/fonts`** and the loader with them. Two modules generate PDFs now, and eslint forbids one module importing another — the same reasoning that moved the money helpers to `@/lib/money`. **`next.config.ts` traces the directory per route**: miss that and the fonts are absent in the serverless bundle and generation fails at request time, a failure that cannot reproduce locally
- **`invoice-pdf-model.ts` is pure and holds every decision**; the renderer is layout with no arithmetic. A draft prints **DRAFT INVOICE** (a document that does not is one that gets paid twice), a void one is watermarked, and Paid/Balance rows appear only once something has been paid
- **`formatQuantity("")` returned `"0"`** in the first cut — `Number("")` is `0` and finite. A quantity nobody entered would have printed on a document somebody pays from. Caught by the test, fixed in the code
- Deliberately **no public payor view**. QuickBooks has one because it collects card payments there; payment processing for tenants' customers is out of scope by design (the PCI firewall), so the email plus its attachment IS the delivery story

### 2026-08-10 — Cash basis, derived at read time (branch `claude/cash-basis`)
- **[ADR 0007](../decisions/0007-cash-basis-reporting.md) reverses the master plan's exclusion.** Cash basis was out of scope for the whole core phase; most US small businesses file on it, and it is the first question an accountant asks. The plan was not edited — ADRs are immutable, so the reversal is a new one
- **`getBalances` gains `basis`, defaulting to `accrual`.** It is the single query engine every report goes through, so the toggle lands in exactly one place. The accrual path is unchanged — same SQL, same rows — and a test pins that passing no basis equals passing `"accrual"`
- **Recognition moves to the payment dates, pro-rata.** Invoice and bill entries are excluded; each payment's AR/AP leg is replaced by that payment's share of the document's income or expense lines, carrying their dimension tags. Everything else (bank imports, manual journals) is already cash-dated and passes through
- **The control leg is what keeps it balanced**: the offset is exactly the negation of what was recognised, so an overpayment leaves its residual on AR — unapplied cash is owed back to the customer, not revenue. "AR is always zero on cash basis" is therefore *nearly* true, deliberately
- **`cash-basis-allocate.ts` is the only division in report math.** P5 pins report math to integer cents with no division and `report-builders.ts` says so at the top; pro-rata cannot honour that, so the division is quarantined in one pure module with a largest-remainder rule, BigInt intermediates, and 20 tests. Two invariants: each payment's split sums exactly to its allocation, and no cent is invented or lost by the order payments arrive in
- **Reversals of invoice/bill entries are excluded too.** `reverseEntry` is only guarded in the journal *action*, not in core, so a reversal could in principle outlive the document nobody is recognising. Cheap insurance, not a currently reachable case
- **Cash Activity has no basis toggle** and that is deliberate — it reads only bank, cash and credit-card accounts, which the adjustment never touches. Offering one would invite readers to hunt for a difference that cannot exist
- **The basis is stamped on the report and in the CSV** — footer row *and* filename. Two correct profit figures for one period are only safe if a file forwarded to an accountant says which it is

### 2026-08-10 — Bank rules, and where a suggestion came from (branch `claude/bank-rules`)
- **`bank_rules` + `bank_transactions.rule_suggestion`** (`0111`/`0112`). A rule states a mapping the owner has already decided; the AI categorizer reasons about a row it has never seen. Where both have an opinion the **rule wins**, and the review queue now badges the chip `RULE` or `AI · 87%` so the answer is never anonymous
- **Prompted by the founder's own QuickBooks.** Seven of their rules are named `(Suggested) …` — QuickBooks watched them categorize, proposed the rule, and now applies it deterministically. We were re-inferring `Westfield → Insurance` through Claude on every import, at token cost, with no memory and no explanation
- **Rules are learned, not only written.** After the same coding is chosen by hand `RULE_PROPOSAL_THRESHOLD` (3) times on one register, `proposeRuleFromHistory` mints an inactive-priority `(Suggested)` rule named after the mapping. The phrase comes from `commonDescriptionPhrase`, the longest contiguous run of words shared by every matching description — `OH WESTFIELD INS SIGNATURES` + `Westfield Ins 07/06` → `westfield ins`. A lone generic word (`deposit`, `payment`, `fee`) is refused; a generic *phrase* like `account maintenance fee` is kept
- **Dismiss deactivates, it does not delete.** A deleted proposal would be re-proposed the moment the mapping was chosen again, because the duplicate check only sees rules that still exist. Inactive is what makes "no thanks" stick
- **Auto-post yields to the period lock.** `applyRulesToUnreviewed` reads `closedThrough` ONCE up front and skips locked rows rather than catching `PERIOD_CLOSED` per row — catching mid-transaction would mean working on a transaction Postgres has already aborted. A rule must never be able to break a bank import
- **The proposal runs in its own transaction**, after the entry commits. A try/catch inside the categorize transaction was written first and then removed: it is false comfort, since a failed INSERT aborts the whole transaction and the swallowed error would still have lost the posting
- **No `set_dimension_member_ids`.** A jsonb array of member ids carries no referential integrity — the "jsonb tags" design the master plan rejected. It lands as a composite FK when the dimension write path exists
- **`tests/isolation/banking.test.ts` is new, and overdue.** `reconciliations`, `reconciliation_lines` and `plaid_items` had **no isolation coverage at all**, and `bank_accounts` / `bank_transactions` were certified only incidentally by `documents.test.ts` — while the Data model section below claimed every table was covered. `plaid_items` stores the AES-256-GCM encrypted Plaid access token

### 2026-08-08 — The lint gate goes green (branch `claude/lint-clean`)
- **11 orphaned `getSettings` reads removed.** The 2026-08-05 entry below moved every accounting "today" onto `tenants.timezone`; wherever the only use of `settings` had been `settings.bookkeepingTimezone`, the fetch itself was left behind. Each was a redundant round trip on a page load
- **Found by eslint, not by grep.** There are 27 `const settings = await getSettings(...)` calls in the module and only these 11 were dead — a grep-and-delete would have broken the other 16. `posting.ts` alone has two, one live and one dead
- **One dead read was in `reverseEntry`, a write path.** `getSettings` throws `SETTINGS_MISSING`, so these reads were incidentally asserting the settings row exists, and that assertion is now gone. Judged unreachable — a tenant cannot have a posted entry to reverse without settings, and `assertPeriodOpen` fetches them itself — but it is a behaviour change, recorded here rather than left to be rediscovered
- **`invoice-builder.tsx`'s `useMemo` on the invoice total removed.** Its dependency was `filled`, an array rebuilt from `rows` on every render, so it never once hit its cache; it only stopped the React Compiler from memoizing the component. See the React Compiler rules in [conventions.md](../conventions.md) §8
- Unescaped apostrophe in the vendors empty state; unused imports in `actions.ts`, `documents/actions.ts`, `core/reconciliation.ts`, `documents/ingest.ts`

### 2026-08-06 — `bookkeeping_timezone` dropped (branch `claude/drop-bookkeeping-timezone`)
- `0088` removes the column deprecated in the entry below. `tenants.timezone` is the only clock; `accounting_settings` no longer carries one
- **Applied AFTER the deploy**, like `0075` and for the same reason: nothing read the value, but Drizzle builds its SELECT column list from `schema.ts`, so a deployment still declaring the column selects it. Dropping under a live old build 500s `getSettings` and every accounting page
- Carries the value up one last time first, but only for a tenant still on the untouched default — an unconditional backfill would overwrite a zone an owner had since set at `/dashboard/settings`

### 2026-08-05 — The books' day boundary moves to the tenant (branch `claude/tenant-timezone`)
- `accounting_settings.bookkeeping_timezone` is **deprecated**. It had no UI and no writer anywhere in `src/`, so every tenant sat on the `America/New_York` default and every accounting "today" was New York's, correct only by luck
- All **21** reads now use `tenants.timezone` (`0086`): pages take `ctx.tenant.timezone`, and `posting.ts` / `recurring.ts` / the books export take `getTenantTimezone(tx, tenantId)` because `LedgerCtx` deliberately carries only an id
- `settings.csv` keeps its `bookkeeping_timezone` **header** — an export is a file somebody's accountant already parses — but the value now follows the tenant. `tests/export.test.ts` sets the two zones differently so the assertion cannot pass by coincidence
- The column is **not dropped this release** (the inverse of `0075`'s ordering): the previous deployment still SELECTs it. A follow-up migration removes it. Full reasoning in [timezone.md](timezone.md)

### 2026-08-04 — `customers.email` / `.phone` retired; the party owns the address (branch `claude/party-contact-points`)
- The four columns were **dropped** (`0075`). `party_contact_points` is the only store now, so the customers page, the CRM record and the mail composer cannot show three answers to one question
- **The forms keep their Email and Phone boxes.** They edit the party's main address of that kind directly — `setPreferredContactValue` renders `preferredContact` and writes back to the same row, so correcting a typo edits one address instead of adding a second, and **an emptied box now deletes it**. That reverses the additive rule from the entry below, deliberately: additive was right for a mirror of a column and wrong for the thing itself. Full reasoning in [crm.md](crm.md)
- **`0075` must be applied AFTER the deploy** — the only migration in the repo that inverts the standing order, because dropping a column breaks the code still selecting it. It re-runs the backfill first (addresses typed into the old form after `0074` ran exist nowhere else) and refuses to drop if anything usable would be lost
- **Five** read sites moved, not the two the entry below predicted: the customers page, the vendors page, `mail/extension.ts` (search, resolve, `{{customer.email}}` and the contact source) and both halves of the books export. Neither dialog component changed — the pages hand them the values. The placeholder key `{{customer.email}}` is unchanged too; renaming it would break every saved template that used it
- `customers.address` and `.notes` STAY. Nothing reads a postal address that they do not serve, and `party_addresses` is deferred rather than forgotten
- The customers and vendors CSVs keep their `email` and `phone` columns, filled from the party. An export is a file somebody's accountant already has a process for

### 2026-08-04 — Customer and vendor addresses now also live on the party (branch `claude/party-contact-points`)
- `party_contact_points` arrived on the shared spine. Existing `customers`/`vendors` email and phone values were backfilled onto their parties, and `createCustomer`/`updateCustomer` (and the vendor equivalents) now contribute them through `@/lib/parties` on every write
- **The sync is ADDITIVE, unlike the name sync.** Clearing `customers.email` does NOT remove a contact point — a name is one fact with an authoritative copy, a way of reaching somebody is one of several. Mirroring would let an invoicing change silently delete a mobile number somebody added in CRM
- **Nothing accounting reads has changed.** `customers.email` / `.phone` / `.address` are untouched and still authoritative for invoicing; this is the expand phase. Retiring them is a later contract slice — only two files read them directly
- An unusable value contributes nothing rather than failing the save it is attached to

### 2026-08-03 — The party spine: customers and vendors became roles (branch `claude/crm-party-spine`)
- `customers` and `vendors` gained `party_id` (composite FK to the new shared `parties` table) and are now ROLE records — "a party we invoice", "a party we pay". No existing foreign key moved: `invoices.customer_id` and `bills.vendor_id` point exactly where they did
- A business that is both a customer and a vendor is now ONE party with two role rows, which neither table could previously state. `UNIQUE (tenant_id, party_id)` on each stops a party taking the same role twice
- `createCustomer`/`createVendor` mint the party in the same transaction via `@/lib/parties` — the single door onto that table; this module never writes `parties` directly. A rename carries onto the party (`syncPartyName`) so the invoice and the CRM cannot disagree about who the customer is
- Deactivating a customer or vendor deliberately does NOT deactivate the party: the same business may still be live in the other role
- Migrations `0059`–`0062`, expand/backfill/contract with compatibility triggers covering the deployed code through the window. **The backfill matched nothing** — one party per existing role row, because fusing on a name would silently merge two real businesses. Full reasoning in [crm.md](crm.md)

### 2026-07-23 — Session 7: Close & accountant tools (`90e8775`, PR #4)
- Expert (accountant) role: memberships-backed overlay on the Clerk role, fail-closed `gate()` across all accounting actions, owner toggle on the Team page
- Month-end close subsystem: `period_closes` + `close_notes`, warn-not-block checklist, monotonic closes with latest-only reopen, sign-off, review notes; `closed_through` became derived state (old trial-balance lock dialog retired)
- Close-narrative AI (auto-runs on close); full-books export as a streaming zip (all-table CSVs, reports, audit trail, document blobs), owner+expert only, 60s cooldown

### 2026-07-23 — Inbox rename + context-aware routing (`516edc5`, `f5bef04`)
- "Capture" tab renamed to **Inbox**; routing buttons on inbox documents are context-aware (bill vs expense vs invoice destinations)

### 2026-07-22 — Email-in & upload production fixes (`8147c2d`)
- Email-in silently dropped mail: forwarding-address tokens were mixed-case base64url but mail infrastructure lowercases local parts (Outlook did). Tokens now lowercase hex (128-bit), parsing case-folds; a real missed bill was replayed and recovered
- Uploads failed on the private blob store: switched to the presigned flow with the same tenant/namespace/allowlist gates; read-write token now passed explicitly in every server-side blob call (SDK otherwise prefers ambient OIDC creds, which fail locally)
- Also (`c59f7a8`): tiny signature-logo email attachments filtered out; tool renamed to "Bills & Receipts"

### 2026-07-22 — Session 6: Payables (`3c39027`)
- `vendors`, `bills` (state machine draft → awaiting_approval → approved → partial → paid / void), `bill_lines` (nullable account until coded; approve enforces), `bill_payments` (atomic entry, CAS-serialized derivation)
- Create-bill-from-document idempotent by link presence; prefill trusts extraction line items only when they sum exactly to the total
- AI line coding (vendor-history few-shot + industry-pack context seam); duplicate detection warns, never blocks
- `ENTRY_SOURCE_MANAGED` guard: invoice/bill entries can no longer be voided from the journal (closed a latent session-4 desync gap)
- AP aging via shared `lib/aging-core.ts` (mirrors AR)

### 2026-07-22 — Session 5: Documents (`c223b25`)
- Two-table split: `documents` (blob, sha256, email provenance, extraction jsonb, inbox/filed/trashed lifecycle) + `document_links` with exactly-one-of composite FKs to entries / bank txns / invoices (bill_id added in session 6)
- Client-direct uploads to private Vercel Blob (token route re-gates tenant + module + namespace + allowlist); authenticated streaming route for reads
- Email-in via Resend inbound: per-tenant bearer-token forwarding address, svix-verified webhook, attachment-level idempotency, hourly rate cap
- Claude vision extraction (auto-runs on arrival, only prefills — never posts); receipt inbox with match-to-bank-txn suggestions
- Soft-delete only, linked docs can't be trashed; unlink-first coordination on all hard-delete paths (P21)

### 2026-07-21 — Session 4: Invoicing / AR (`e86e7f3`, PR #3)
- `customers`, `invoices` (state machine; partial/paid DERIVED from payments, never client-set; race-safe INV-#### numbering), `invoice_lines` (signed unit prices for discounts, integer-math amounts), `invoice_payments` (born atomically with their Dr deposit / Cr AR entry), `recurring_invoices` (monthly templates generate DRAFTS — human approves before AR posts)
- Bank-feed matching closes the double-count trap: staged deposits matching recorded payments get labeled candidates; Match links the feed row to the EXISTING entry, posting nothing
- Voiding any matched entry sends its feed row back to review (P13, shared `resetBankLinkForEntry`)
- A/R aging report; issued invoices freeze lines; unapply blocked when the deposit line is reconciled

### 2026-07-21 — Session 3: Banking (`b1e9370`, PR #2)
- One staging table for both feeds (Plaid + CSV import), hash-dedup; categorization/AI/reconciliation are feed-agnostic
- `bank_accounts` (1:1 with a ledger account), `reconciliations` + `reconciliation_lines` (NO ACTION composite FK = DB backstop for reconciled immutability), `plaid_items` (AES-256-GCM encrypted access tokens)
- Third mutability tier: entries with reconciled lines are immutable — reverse is the only correction path
- First live AI feature: batched categorization suggestions (forced tool_choice, few-shot from tenant history, suggestions never post)
- Fixed in-session: re-categorize after void posts a FRESH entry via per-attempt idempotency keys

### 2026-07-21 — Session 2: Reports (`bfc261a`, PR #1)
- Pure, DB-free report builders: P&L (with prev-period/prev-year and by-dimension columns), Balance Sheet, Cash Activity; CSV export server-recomputed
- Policy set pinned P1–P7: fiscal-year boundaries, computed Retained Earnings with NO closing entries, inclusive dates, posted-only reads, integer cents (zero rounding), natural contra presentation, own-subtype sectioning
- P&L split-by-dimension is the future "P&L by property" seam for industry packs

### 2026-07-21 — Session 1: Core Ledger Platform (`5ce7e65`)
- Schema: `accounts`, `journal_entries`, `journal_lines`, `dimension_members`, `line_dimensions`, `accounting_settings` — FORCE RLS, composite tenant FKs, idempotency + single-reversal partial uniques, optimistic versioning
- DB-enforced invariants: deferrable constraint trigger rejects unbalanced non-draft entries at commit; append-only `audit_log` trigger
- Posting engine (`src/modules/accounting/core`) is the ONLY writer of ledger rows; three-tier mutability policy; period lock; COA service; dimension registry (industry-pack seam)
- `logAuditInTx` writes the audit row in the same transaction as every financial mutation
- 44-account general COA template provisioned idempotently BEFORE module enable

## Data model

| Table | Since | Purpose |
| --- | --- | --- |
| `accounts` | S1 | Chart of accounts, hierarchical |
| `journal_entries` / `journal_lines` | S1 | The ledger; balanced-at-commit trigger |
| `dimension_members` / `line_dimensions` | S1 | Dimension tagging (industry-pack seam); line_dimensions gained invoice_line_id (S4) and bill_line_id (S6) with exactly-one-parent CHECKs |
| `accounting_settings` | S1 | Per-tenant config (fiscal year, etc.). Gained `reminders_enabled` (default **false**) and `reminder_offsets` jsonb (`0114`) |
| `bank_accounts`, `bank_transactions`, `reconciliations`, `reconciliation_lines`, `plaid_items` | S3 | Feeds, staging, reconciliation; encrypted Plaid tokens |
| `bank_rules` | 2026-08-10 | Deterministic feed categorization. Priority-ordered, first match wins; `is_suggested` marks a machine-proposed rule; `auto_post` posts without review but never into a closed period. Gained `set_vendor_id` (`0113`) so a rule can name the payee too. `bank_transactions.rule_suggestion` is a **snapshot**, not an FK — it records what a rule said at match time, so editing the rule later cannot rewrite what the owner was shown |
| `parties` | 2026-08-03 | **Shared, not this module's.** The identity spine behind `customers` and `vendors`; written through `src/lib/parties/`. See [crm.md](crm.md) |
| `customers`, `invoices`, `invoice_lines`, `invoice_payments`, `recurring_invoices` | S4 | AR. `customers.party_id` (2026-08-03) makes the row a role on a party. Both `customers` and `invoices` gained `reminders_muted` (`0114`) — standing and one-off suppression of automatic chasing |
| `documents`, `document_links` | S5 | Capture substrate; exactly-one-of link targets |
| `vendors`, `bills`, `bill_lines`, `bill_payments` | S6 | AP. `vendors.party_id` (2026-08-03) makes the row a role on a party |
| `period_closes`, `close_notes` | S7 | Month-end close |

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
- `banking/rules-match.ts` and `banking/rules-learn.ts` are **pure** (no `server-only`) — all the deciding lives there and is table-tested without a database, exactly as `ai/*-validate.ts` is split from `ai/*-code.ts`. The rules form imports `ruleConditionsSchema` from the matcher so the client validates against the same schema the action re-validates against
- Tenant UI under `src/app/dashboard/m/accounting/`
- **Reports are all the same two pieces**: a pure builder in `core/report-builders.ts` (fixture-testable, no database, no division) and a thin fetch wrapper in `core/reports.ts`. `getBalances` is the one aggregate engine they share; the General Ledger is the only one that also runs its own line-level query, because it lists rather than sums
- AI engines all follow the same shape: pure prompt seam + pure validate seam + injectable model call + forced tool_choice + cooldown; suggestions never post — a human accepts

## Decisions & gotchas

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
- **An AI claim about a source is checked against the source.** The thread drafter verifies every quote appears in the message it cites; an unverifiable one is shown flagged and unticked, never dropped and never presented as fact. Any future "the assistant found this in X" owes the reader the same check — a citation nobody verifies is worse than no citation, because it is believed.
- **Anything that previews an outbound message must share the renderer that sends it.** `reminder-render.ts` exists so the test button and the nightly sweep cannot drift; a preview built by its own code path is worse than none, because it is believed. Apply the same rule to any future preview (invoice, statement, digest).
- **Reminders overtake, they do not queue.** Only the latest applicable offset can fire, so enabling the feature over an old book sends one email per invoice rather than one per missed offset. Nothing else in the module needs this rule; it exists because the alternative loses a client on the first morning.
- **A rule never overrides the period lock.** Auto-post skips rows dated in a closed period and leaves them for review; the import still succeeds.
- **Email-in tokens must be lowercase** — mail infra lowercases local parts (found in production, `8147c2d`).
- **Blob store is private** — use the presigned upload flow and pass the RW token explicitly server-side.
- **Managed-source entries** (invoice/bill) can't be voided from the journal; void via their document's lifecycle.

## Open items

**Never confirmed by a human** (as of 2026-08-10, found while driving the live
app): the **Send button on an issued invoice** — the draft case is proven, but
two attempts to click Issue did not register, so nobody has watched Send appear
and work; and a **focus oddity in the rule dialog**, where typing after opening
the category Select went into the condition-value box instead of the dropdown.
Both may be artefacts of browser automation rather than defects. Check them by
hand before building on either screen.

A third, of a different kind: **the General Ledger page has never been
rendered by a signed-in person** (2026-08-12). `getGeneralLedger` is proven
against a real database, reconciliation included, and the route compiles and
resolves — but the page body only executes behind a Clerk session, which
agent sessions cannot open. Treat every screen shipped this way as
compiled-and-tested, not seen.


- Credit memos (designed-for headroom in S4, unbuilt)
- Recurring-invoice cron (fast-follow; zero schema change needed)
- Industry-pack dimension packs ("P&L by property" seam live but no pack registered yet — Real Estate pack is the planned next build)
- **Invoice delivery is done** (PDF + email, 2026-08-10). What is NOT built: a `Viewed` signal, which would need a tracked open or a public link — and a public payor view is deliberately not planned, since payment processing for tenants' customers is out of scope by design
- **Automatic overdue reminders are DONE** (2026-08-11) — see the build log. What is not built: a reminder for **bills we owe** (the AP mirror), and reminder wording an owner can edit, both deliberately left until somebody asks
- **General Ledger and Transaction Detail by Account are DONE** (2026-08-11) — one report with an account filter, so seven reports now. See the build log for the accrual-only decision
- **P&L by Month is DONE** (2026-08-12) — the by-dimension column spread generalized to time. What is NOT built: quarter and year columns, which the same `periods` seam would carry with a different bucketer
- **Drafting from an email thread is DONE** (2026-08-12) — both directions, with verified citations. What is NOT built: auto-linking the accepted draft back to the thread (deliberate, see the build log), and drafting from a thread the *reader does not own*, which RLS forbids by design
- From the 2026-08-10 QuickBooks review, the rest in rough value order: Products & Services, Terms, Payment Methods; recurring journals and bills; a per-record History panel; **obligation-language statuses** ("Overdue 60 days" rather than `issued`) and the **MoneyBar** bucket filters (Overdue / Not due yet / Not deposited / Deposited, each clickable with a total) on the invoice and bill lists
