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

### 2026-08-17 — A payment row that would not say whose account it was (branch `claude/payment-rows-name-the-company`)

Found while finishing the drive of the mirror case. The invoice's payment row
read **"2026-08-18 · check → 1040 · Test Operating"** on an OAK ROW invoice, with
nothing saying the money had gone to an affiliate.

- **The register's name is not the answer**, and that is the whole point. It
  reads as an explanation only because this tenant happened to name the account
  after its company; "Main Checking" on somebody else's books looks exactly like
  your own. The row now says **"· received by Test"** — and the bill's row, which
  had the identical gap since slice 2, says **"· paid by Test"**.
- **The same words the ledger entry already carries in its memo** (`received by
  another company` / `paid by another company`), so the document and the journal
  agree rather than describing the same event two ways.
- Both sides in one change, because it is one omission with two instances — the
  bill half had simply never been driven with an affiliate payment on screen.
- Undefined at one company and for the ordinary payment, so every row that does
  not need explaining is byte-identical to what it was.

**Third time this shape has come up** — the Journal header that named the tenant
(slice 1), the close detail page that named no company (slice 4), and now this.
(A fourth followed on 2026-08-18: the asset list, which showed several
companies' assets with no column saying whose.)
The pattern worth naming: **a screen that shows a document's own data is safe;
one that shows a RELATIONSHIP to another company has to say which.** Every
instance has been found by driving and none by a test, because the fixtures all
have one company and the string is correct there.

### 2026-08-17 — The first invoice payment ever rendered, and it 500'd (branch `claude/unapply-across-the-rsc-boundary`)

Found by driving the mirror case on the live Test tenant, one minute after it
deployed. The payment RECORDED — the toast said so and the ledger is exactly
right — and then the invoice page threw `Something went wrong`.

- **`InvoiceActions.Unapply` was a property hung on a `"use client"` export**,
  rendered from the invoice page, which is a SERVER component. Properties do not
  survive the RSC boundary: the server sees a client reference, `.Unapply` is
  `undefined` on it, and React throws #130 (*element type is invalid*). It is a
  plain named export now.
- **NOTHING TO DO WITH INTERCOMPANY.** Any invoice payment would have done it —
  the branch only renders when `payments.length > 0`, and on this tenant no
  invoice had ever had one. That is the whole reason it survived: `tsc` is happy
  (the property exists on the module's own type), the build is happy, ~2,800
  tests are happy, and the one thing that fails is a person clicking Record
  payment. The dossier already lists this area as thinly driven.
- The books were checked directly while the page was down, and were correct:
  `Oak Row Cr AR 1,250 / Dr Due from Affiliates 1,250`, `Test Dr Test Operating
  1,250 / Cr Due to Affiliates 1,250`, both legs linked and posted, invoice
  `paid`. **The feature worked; only the page that shows it did not.**

### 2026-08-17 — The mirror case, and the one-sided void it found (branch `claude/invoice-payment-intercompany`)

The last thing ADR 0010 listed as refused rather than recorded: a customer pays
Oak Row's invoice and the cheque goes into Test's account. No migration —
`postIntercompanyPair` already had the shape.

- **THE MIRROR, and note which way round it goes.** The invoice's company clears
  its receivable and is now OWED by the company that took the money in:

  ```
  Oak Row   Dr Due from Affiliates  1,000   <- Oak is owed by Test
            Cr Accounts Receivable  1,000      (the invoice is settled)
  Test      Dr Checking             1,000      (Test's cash arrived)
            Cr Due to Affiliates    1,000   <- Test now owes Oak
  ```

  So the INVOICE'S company is the `from` side even though no money left it.
  `postIntercompanyPair` names that argument for the bill case, where the
  payer's cash really does move; **what the two shapes actually share is which
  company ends up holding the asset**, and that is what the parameter decides.
- **`invoice_payments.journalEntryId` points at the INVOICE'S leg**, so status
  derivation, A/R aging and unapply keep reading the payment row exactly as they
  did — the same choice `bill_payments` made in slice 2.
- **Undeposited Funds falls through to the ordinary single-entry path**, because
  it is a chart account rather than a register and has no owner. Two companies'
  unbanked cheques share 1250 exactly as their receivables share 1200.
- **The Deposit-to picker offers every register again**, reversing what slice 1b
  did here — the same reversal slice 2 made on the bill's Paid-from, for the
  same reason: the choice used to always fail and now records something. The
  dialog names whose account it is and says what will happen before it happens.

**THE BUG THIS FOUND, which predates it and was live in the bill path since
slice 2.** `assertNotIntercompanyLeg` lived only in `actions.ts`, so the journal
screens were covered and `unapplyBillPayment` was not: it went straight to
`voidEntry` and **voided one leg of a pair**. Proved against the dev database
before writing the fix — the two legs came back `['posted', 'void']`. The paying
company was left with its cash gone and a Due-from balance that
`affiliateBalances` cannot even report, because a group with one surviving entry
reads as half a pair and is skipped.

- **The guard moved into the ENGINE** — `voidEntry` and `reverseEntry` both
  refuse a bare leg now. Same lesson as `assertNoForeignRegisters`: a rule
  enforced per screen is a rule the next caller does not get, and unapply was
  the next caller.
- **`voidIntercompanyPair` is the undo that takes both**, and it is distinct
  from `reverseIntercompanyPair` on purpose: unapply says the payment did not
  happen, which removes it from every report, while a reversal says it happened
  and is being corrected. Both unapply paths route through it.
- `voidEntryUnchecked` is core-internal and deliberately not re-exported from
  `core/index.ts`, the way `asFilterScope` is not — its only caller is the pair
  void, which has already established that it is taking both sides.
- The mutability tiers still apply to EACH leg, so a reconciled line or a closed
  period on either side refuses and the whole transaction rolls back.

**One test changed its mind, which is worth recording rather than hiding.** The
slice-1b case asserting `CROSS_ENTITY_REGISTER` on exactly this payment is gone,
replaced by one asserting the pair — that refusal was right while there was no
way to record the thing. The refusal for a HAND-WRITTEN journal touching a
foreign register is unchanged and still asserted: the guard did not move, the
recording path grew a second shape. Two downstream figures moved with it, and
both are now explained in place: `affiliateBalances` nets to 20,000 rather than
25,000 because the fixture contains 5,000 running the other way, which is the
netting the derived-not-stored design exists to do.

`tests/entities-db.test.ts` is 41 cases: the pair and its direction, the payment
row pointing at the invoice's leg, consolidation eliminating it to a plain bank
deposit, unapply voiding both legs, and the engine refusing a one-sided void.

### 2026-08-17 — `0153`: the lock's contract half, and the scalar goes (branch `claude/close-contract-migration`)

The contract half of ADR 0010 slice 4, run AFTER the deploy that writes
per-company locks — and the two statements in it could not ship together in
`0152` for OPPOSITE reasons, which is the pairing worth remembering.

- **`period_closes.entity_id` SET NOT NULL** could not precede the deploy:
  migrations run ahead of it, and the build live while `0152` landed still
  inserted closes with no company, so the constraint would have rejected every
  close in that window. Fourth time this repo has made that split —
  `0123`/`0125`, `0142`/`0144`, `0145`/`0146`, now `0152`/`0153`.
- **`accounting_settings.closed_through` DROP** could not precede it either, for
  the mirror reason: Drizzle builds its SELECT list from `schema.ts`, so a
  running old build would 500 on every settings read. The schema stopped
  declaring it in the slice-4 PR, that deploy is live (`48aa06b`), and only then
  is the column safe to remove. The `0147` lesson.
- **`0152`'s FIRST backfill is deliberately NOT re-run, and that is the one real
  decision in the file.** It copied the tenant-wide scalar onto every company.
  Re-running it now would copy a STALE scalar over live per-company locks —
  production's scalar still read 2026-06-30 while Oak Row LLC had since closed
  through 2026-07-31, so a re-run would have silently reopened a month somebody
  closed. **A backfill is only safe to repeat while it is still the source of
  truth**, and this one stopped being that the moment the deploy went live. The
  SECOND backfill (entity_id on close rows) does re-run, guarded, because it
  only touches NULLs.
- **Checked before writing it, not assumed:** zero rows on either database had a
  NULL `entity_id`, so the window produced nothing to repair and the guarded
  re-run was the no-op it was expected to be.
- **The null branches the nullable column forced are gone with it** — the
  `closeEntity` helper in `core/close.ts`, the narrative's combined-scope
  fallback, the "All companies" cell in the close history, and the blank
  `entity` columns in the export. A branch for a state the database can no
  longer hold is worse than none.
- **Verified on BOTH databases after applying:** `entity_id` NOT NULL with zero
  nulls, `accounting_settings.closed_through` gone, `entities.closed_through`
  still nullable (null means never closed), and production's two locks intact
  and DIFFERENT — Oak Row LLC through 2026-07-31, Test through 2026-06-30.
  `verify-rls` clean across **115 tables**. The live app was driven afterwards:
  the Close page and the hub card both render, which is the check a DROP
  actually needs — the running build must not select the column that just left.
- The isolation suite's close INSERT case now gives the attacker row **B's own
  company**, so the composite FK has nothing to object to and RLS is the only
  thing that can reject it. A test that could pass for two reasons was proving
  half of what it claimed.

### 2026-08-17 — A close that would not say whose it was (branch `claude/close-names-its-company`)

Found by driving slice 4 on the live Test tenant, minutes after it deployed —
the same way every bug in slices 1 and 2 was found, and the same shape as the
first of them.

- **The close detail page read "Close through 2026-07-31"** above Oak Row LLC's
  checklist snapshot, with nothing anywhere on the page naming Oak Row. It is
  the Journal header bug again (2026-08-16): a string that is correct at one
  company, unfalsifiable in every fixture, and authoritative-looking on the one
  screen where somebody signs a month off. The title and the breadcrumb both
  name the company now, and only when there is more than one.
- **The journal ENTRY page had the same hole, one slice older.** The journal
  LIST grew a Company column in slice 1; the detail page never did. So a
  two-company tenant could open an entry — on the page where they void and
  reverse it — and not be told whose books it belongs to. Noticed while voiding
  the probe entry from the spin, which is the sort of thing only driving finds.
- **The dialog title ran under the close button.** `DialogContent` puts an icon
  button at `top-2 right-2` and `DialogTitle` had no right padding, so any title
  long enough to wrap went beneath it — "Close Oak Row LLC's books through
  2026-07-×31" on screen. Fixed in the PRIMITIVE rather than in the caller: the
  component that positions the button is the one that should reserve its corner.
  `leading-none` went with it, which is why the two lines looked jammed.
- **What the spin PROVED, and it is the point of the slice:** Oak Row closed
  through 2026-07-31 while Test stayed at 2026-06-30; the same journal entry,
  same date, same accounts was REFUSED in Oak Row ("That date falls in a closed
  period") and POSTED in Test. The checklist showed Test's 4 unreviewed
  transactions, 2 draft invoices and 1 draft bill, and showed Oak Row none of
  them — each with only its own register under "not reconciled". The probe entry
  was voided afterwards; Oak Row is left closed through July on purpose, as the
  standing demonstration that two companies sit at different months.

### 2026-08-17 — Per-entity close (branch `claude/per-entity-close`)

Slice 4 of [ADR 0010](../decisions/0010-entities-inside-a-tenant.md), and the
last one it named. `period_closes` locked every company at once; ten LLCs close
in different months. Migration `0152` (expand); **`0153` is the contract half** — `period_closes.entity_id` SET NOT NULL and the
`accounting_settings.closed_through` DROP.

- **THE LOCK MOVED ONTO THE COMPANY** — `entities.closed_through`, written only
  by `completeClose`/`reopenClose`, which is exactly the rule the tenant-wide
  scalar followed. Derived state with two writers is what keeps the lock and the
  close history unable to disagree, and that survived the move unchanged.
- **NOT derived from `max(period_end)`, and the data decided it.** Deriving the
  lock from the close rows is tempting and would make drift impossible rather
  than merely unrepresentable — but production holds exactly ONE close row, on
  the two-company Test tenant, and its lock (2026-06-30) came from the scalar.
  Pure derivation would either silently unlock Oak Row or need a fabricated
  close row nobody performed. A backfilled column preserves every existing lock
  and invents nothing. Checked before writing the migration, not after.
- **`assertPeriodOpen` grew a required `entityId`** — the slice 1 and 3
  instrument again. The failure it forecloses is worse in both directions than
  the reporting one: a tenant-wide check REFUSES a write to a company whose
  books are open, and ACCEPTS one into a company whose books are closed. Neither
  is visible on a single-company tenant.
- **THE CHECKLIST IS SCOPED TOO, and that is the half that took the work.**
  Draft entries, invoices, bills and bills awaiting approval by the document's
  company; unreviewed bank transactions and unreconciled accounts through the
  REGISTER's company (a transaction has no company of its own, its account
  does); ledger integrity narrowed to that company's entries. Telling somebody
  closing Maple that Oak has three draft bills is noise on the one screen whose
  whole job is "is this month finished".
- **The receipts inbox stays UNSCOPED, and it is the honest option.** An uncoded
  receipt has no company yet. Counting it for everybody is a real reason to
  hesitate before closing anyone's month; hiding it would hide the item most
  likely to be somebody's missing expense.
- **"The latest close" is per company.** Reopening Maple's June has nothing to
  say about Oak's July, and the tenant-wide latest check would have refused it.
  Same for monotonicity: closing forward is enforced within a company, and the
  same period end in another company is not a collision — the unique index is
  `(tenant, entity, period_end)` now, because ten LLCs closing the same June is
  the ordinary case.
- **The close narrative finally scopes itself.** `narrative.ts` carried a
  comment since slice 1 saying it used `combined` *because* a close was
  tenant-wide, and named slice 4 as the thing that would change it. It reads the
  close's own company now — anything else is a story about Maple's month told
  over Oak's numbers.
- **"Books closed through" needed a group answer**, and `groupClosedThrough` is
  it: the EARLIEST of the companies, and null the moment one has never been
  closed. That is the date before which nothing can be posted anywhere. The
  latest, or the default company's, would read as a guarantee the books do not
  give. The hub card and the trial-balance footer both go through it, and the
  Close page shows every company's own state as a row of chips — an owner comes
  to that page to find out Oak has not been closed since March.
- **The close page picker has no "all companies", deliberately** — unlike every
  report picker in the module. You cannot close everything at once any more, and
  offering it would offer back the exact thing this slice removed. An unknown
  `?entity=` 404s, which matters more here than on a report because this screen
  WRITES.
- **`0152` was hand-edited three ways and the header says so.** drizzle-kit
  emitted the `accounting_settings.closed_through` DROP inline (removed — a DROP
  goes out AFTER the deploy that stops selecting the column, the `0147` lesson),
  emitted no backfills at all (both added — without them every existing lock
  silently disappears), and put the foreign key before the backfill (reordered
  so it validates real values). The one honest gap is stated in the file: in the
  window between migration and deploy the old build writes closes with a NULL
  entity, and NULLs are distinct in a unique index, so "one completed close per
  period" is unenforced for those minutes. No path to it from the UI.
- **The existing close row went to the DEFAULT company**, which is an
  approximation and labelled as one: a close written before today locked
  everything, so no company is its true owner. The LOCK is preserved for every
  company by the other backfill, which is the part that matters. **The
  consequence, stated rather than discovered later: a non-default company
  carrying an inherited lock has no close row to reopen and can only be closed
  forward.** On production that is Oak Row LLC.
- Applied to dev AND production, both verified before the PR: two columns
  nullable, both companies holding 2026-06-30, zero closes without a company,
  the index swapped, `relforcerowsecurity` still true on `entities` and
  `period_closes`.
- `tests/entities-db.test.ts` grows to 38. The six new ones are the cases only a
  two-company fixture can state: closing one company leaves the other's books
  open (and the same date posts fine in it), the checklist counts one company's
  drafts and not the other's, two companies close the same period, reopening
  Oak's January is allowed while Maple sits at February, monotonicity binds
  within a company only, and the group date is the earliest. Isolation gains
  three: a close cannot name another tenant's company, one completed close per
  period per company, and a second company may close the same period.

### 2026-08-17 — Consolidation, and the third scope (branch `claude/consolidated-scope`)

Slice 3 of [ADR 0010](../decisions/0010-entities-inside-a-tenant.md): the
group's figures with intercompany eliminated. **No migration** — elimination is
derived at read time from links that already exist, like invoice status,
`closed_through` and retained earnings.

- **ELIMINATION IS A LINE-LEVEL EXCLUSION, AND THE SCOPE HAD ALWAYS BEEN AN
  ENTRY-LEVEL PREDICATE.** That mismatch is the whole risk in this slice: a
  consolidated scope that reused `entityScopeCondition` would filter nothing,
  eliminate nothing, and produce a statement that looks right, balances, and
  double-counts every intercompany transaction. So the defence is the same one
  slice 1 used — **make forgetting a compile error**. `entityScopeCondition` now
  takes a `FilterScope` (`Exclude<EntityScope, {kind:"consolidated"}>`), which
  broke all eight of its call sites and made each of them state what it does
  about consolidation. Ledger reports go through `ledgerScopeConditions` in the
  new `core/consolidation.ts`, which returns the entity filter AND the
  elimination in one list to spread, so a report cannot take one and forget the
  other.
- **Eliminate by following the LINK, never by matching amounts** — drop exactly
  the affiliate legs of entries carrying an `intercompany_id`, and nothing else
  in those entries. `intercompany_id IS NOT NULL` is the whole test because
  `0149` enforces exactly two entries in two companies, deferred: a committed
  pair is a complete pair.
- **Why it cannot unbalance a statement:** a pair's affiliate legs are always +X
  and −X, so removing them removes zero. The consolidated trial balance still
  ties with no plug and no invented figure. Checked on paper before any code was
  written, against the two shapes the module can produce: a bill pair
  consolidates to `Dr expense / Cr cash` — the group paid a vendor — and a
  transfer pair to nothing at all, cash out of one register and into another.
  Both are now tests.
- **`combined` KEEPS ITS MEANING.** It sums and eliminates nothing, and
  consolidated arrived BESIDE it as a third kind rather than redefining it — a
  report that quietly started eliminating under the old name would change what
  every saved report link and every archived export already says. A test asserts
  combined still shows both affiliate legs, which is what makes that a promise
  rather than an intention.
- **Consolidated has no `entityId`, in the type.** Eliminating one side of a
  pair while keeping the other leaves that company short by the amount, so a
  consolidated single company is not a thing.
- **Who takes it and who declines, each with its reason in the code.** Trial
  balance, balance sheet and P&L take it. **The general ledger takes it too**,
  because a consolidated trial balance nobody can drill into is a number an
  accountant cannot check — a test pins the two tying out through `displayCents`.
  **Cash Activity declines** (`FilterScope`), the same shape of reason it already
  declines a basis: every register belongs to one company and none is inflated by
  intercompany, so the difference the reader would go looking for cannot exist.
  **A/R aging, A/P aging and the tax summary decline** because they read
  documents, and an affiliate balance never becomes an invoice or a bill.
- **THE P&L'S NUMBERS ARE IDENTICAL TO COMBINED TODAY, and it offers the scope
  anyway.** No intercompany leg touches income or expense. It is offered for the
  stamp — a reader who scoped the balance sheet to the group should not have to
  switch back to see its profit — and because the day one company charges another
  management fees, the obvious next step for a landlord with a management LLC,
  the two stop being equal with nobody having to remember this page. A test pins
  the equality so that day fails loudly.
- **The manual-journal residual is SURFACED, not hidden**, and the argument is
  stronger than consistency with the tax summary's gap: an unlinked affiliate
  line has no counterparty leg to remove with it, so suppressing it would leave
  assets short against liabilities-plus-equity and **hiding it would require
  inventing an equity plug**. `consolidationResidual` counts what elimination
  could not follow — defined as the exact complement of the elimination
  predicate, so it is always precisely what survived on the face of the statement
  — and `ConsolidationNote` says it on the page while `residualNote` puts the
  same sentence in the CSV. It counts LINES as well as the net, because two
  hand-written journals can offset to nothing and still mean something went in
  unlinked.
- **The stamp says which of the three it is** — page, CSV content and CSV
  filename, the rule the basis stamp follows. `?entity=consolidated` on a
  report that declines it **404s**, the same rule an unknown id follows: a scope
  this report does not have is refused rather than quietly answered with the
  combined figures under the name the reader chose for the difference. And on a
  single-company tenant it resolves to that company, so the client who has one
  never learns the word.
- **The books export gains a consolidated set** of the three statements beside
  the per-company and combined ones, once there is more than one company. That
  zip is what goes to the accountant. At one company it is byte-identical.
- **A BUG FOUND BY READING, not by driving, and it predates this slice:**
  `entityParam` on the CSV export was `z.string().uuid().optional()`, but the
  picker's own "All companies" option submits an EMPTY string. On a two-company
  tenant, choosing combined and pressing Export CSV answered *"Invalid input"*
  instead of downloading. It now accepts `""`, `combined` and `consolidated`
  alongside a uuid; `resolveEntityScope` still decides what each one means.
- **DRIVEN ON THE LIVE TEST TENANT after the deploy**, which is how every bug in
  slices 1 and 2 was found. The trial balance drops both affiliate rows and
  totals **10,127.09** against combined's 13,227.09; the balance sheet comes out
  6,272.91 with **Total Liabilities 0.00** where combined shows 9,372.91 and
  3,100 — exactly 3,100 apart on both sides, with equity identical in both,
  which is what elimination not touching equity looks like. The general ledger
  shows no affiliate sections and the bill pair reads as the paper test said it
  would: `Dr Subcontractor Expense 600` in Oak Row, AP raised and settled to
  zero, `Cr Test Operating 600`. Consolidated and combined P&L both come out
  (5,356.78). `/reports/cash?entity=consolidated` 404s. Export CSV on combined
  no longer answers "Invalid input".
- **THE RESIDUAL NOTE HAS BEEN SEEN, and Test now carries a standing residual on
  purpose.** A hand journal was posted on Test —
  `Dr 1500 Due from Affiliates 4.00 / Cr 4000 Sales 4.00`, memo *"Oak Row owes us
  for supplies - booked by hand, not as a transfer"* — and deliberately left
  there, so the note is visible on the consolidated reports from now on rather
  than being a code path nobody has ever rendered. It reads: *"Not eliminated: 1
  journal line in the affiliate accounts with no linked transfer to follow (net
  4.00 debit)."* The distinction it exists to make is visible in the number: 1500
  shows **4.00**, not 3,104 — the linked pair is still eliminated and only the
  unlinked journal survives. Both statements still balance **with it on them**
  (6,276.91 either side), which is the argument for surfacing rather than hiding
  in one figure. A future session should not read that 4.00 as stray data.
- `tests/entities-db.test.ts` grows to 32. The new eight: the bill pair
  consolidating to Dr expense / Cr cash, the transfer pair consolidating to
  nothing at all (asserted as "the only accounts that moved are the two
  registers"), consolidated differing from combined ONLY in the affiliate
  accounts, the consolidated trial balance showing neither and still tying, the
  general ledger dropping the same lines and reconciling to it, the P&L pin, the
  picker's three answers (offered / refused / invisible), and the unlinked
  journal surviving with the residual reporting it.

### 2026-08-17 — The affiliate accounts were codable on a bill (branch `claude/affiliate-accounts-not-codable`)

Found by driving the bill path: the line Account dropdown offered **1500 · Due
from Affiliates** and **2450 · Due to Affiliates**.

- **Not the same class as the three picker bugs before it**, and that is the
  point. Those offered something `postEntry` refuses, so the books were never at
  risk while the screens caught up. This one the engine has no reason to refuse:
  a hand-coded line into an affiliate account posts happily and produces a
  balance that "who owes whom" cannot attribute to anybody, because that table
  walks the intercompany LINKS. The list is the only place it can be prevented.
- **ONE PREDICATE WHERE THERE WERE FOUR COPIES.** `isCodableAccount` now lives
  in `core/coa.ts`; the rule had been spelled out separately in the new-bill
  page, the bill detail page, the recurring dialog and `ai/bill-code.ts`. Four
  copies is why the affiliate accounts had to be remembered in four places and
  were remembered in none — the next system account has one place to go.
- **The AI bill-coder shared the copy too**, so it could have SUGGESTED an
  affiliate account. It now filters through the same predicate as the form: the
  model cannot propose a category a person is not offered.
- **The JOURNAL still allows it, deliberately**, the way it already allows a
  manual entry against AR or AP. That is what a journal is for. The cost is
  stated rather than hidden: an entry into an affiliate account by hand is a
  balance the who-owes-whom table will not explain.

### 2026-08-16 — A retired register is still somebody's (branch `claude/transfer-account-list`)

Found by driving the transfer dialog again after the previous fix. "What did
they get?" offered Oak Row **1020 · Rules Test Checking** — Test's own register,
deactivated months ago — and the server refused it with the cross-company
message. A choice that can never succeed, for the third time in this feature.

- **The exclusion filtered ACTIVE registers only.** The list of things the
  receiving company might have got removes registers, because their own are
  offered separately labelled *cash in* — but it was built from the same active
  -only query that feeds those choices, so a deactivated register of any company
  fell through. `postEntry`'s guard has no `is_active` condition, and rightly
  not: **deactivating a register does not stop it being somebody's.**
- Fixed by excluding every register, active or not, from the account list —
  a second query whose only job is that exclusion.
- The engine was right throughout and refused it every time. Three of the four
  bugs in this slice have been the same shape: a picker offering something the
  posting engine will not accept. The guard has been the thing holding the line
  while the pickers caught up, which is the argument for having put it in the
  engine rather than in each screen.

### 2026-08-16 — There is no accounting for nothing (branch `claude/intercompany-transfer-fix`)

Found by driving the transfer dialog on the live Test tenant, minutes after
slice 2 deployed. Test pays Oak Row 2,500, "Into" left blank, Record transfer →
**"A journal entry needs at least two lines."**

- **A design error, not a typo.** The dialog offered *"it did not reach their
  account"*, which made the receiving entry a single `Cr Due to Affiliates`
  line. One line cannot balance, so it cannot post — and the server said so in
  terms about journal lines rather than about companies, which is the tell that
  the question was wrong rather than the answer.
- **The model was wrong, and the fix is the sentence.** If a company is better
  off by an amount, its books have to say WHAT IT GOT: its own register when the
  cash arrived, or the expense or asset the payer settled on its behalf. There
  is no third option, so "optional" was never a real choice.
- The field is now **required** and asks "What did they get?", offering the
  receiving company's registers (labelled *cash in*) and then the rest of the
  chart. `postIntercompanyPair` refuses an empty side outright with a message
  about companies, so the engine cannot be talked into a one-line entry by a
  future caller either.
- **The `payerLines` side had the same hole and was never exercised** — every
  caller happened to pass one. Both are checked now.
- Also on that page: the banner still said invoices, bills and bank
  transactions all post to the default company, which stopped being true when
  slice 1b landed. A banner that describes last week's behaviour is worse than
  no banner.

### 2026-08-16 — Intercompany pairs (branch `claude/intercompany-pairs`)

Slice 2 of [ADR 0010](../decisions/0010-entities-inside-a-tenant.md). Slice 1b
REFUSED paying one company's bill from another's account; this records it.
Migrations `0148` (the link), `0149` (the trigger), `0150` (the enum value,
alone), `0151` (the accounts for existing tenants).

- **A pair, one entry per company, sharing an `intercompany_id`:**

  ```
  Oak Row     Dr Accounts Payable      500
              Cr Due to Affiliates     500     <- Oak now owes Maple
  Maple St    Dr Due from Affiliates   500     <- Maple is owed by Oak
              Cr Checking              500
  ```

  **Each balances on its own**, so the invariant at the heart of this module is
  untouched — the same reason `entity_id` went on the entry rather than the
  line.
- **THE REGISTER GUARD NEEDED NO EXCEPTION, and that is the strongest signal
  the shape is right.** Oak's entry touches AP and Due-to, both shared chart
  accounts; Maple's touches Due-from and its OWN register. Neither entry touches
  a foreign register, so `assertNoForeignRegisters` is exactly as it was and
  still refuses the unlinked single entry, which is still wrong.
- **ONE PAIR OF ACCOUNTS, not one per counterparty.** Ten LLCs would otherwise
  mean ninety accounts in a chart every company can see. Who owes whom is a
  property of the TRANSACTION, so `affiliateBalances` walks the links at read
  time — the same derived-never-stored habit as invoice status, `closed_through`
  and retained earnings. Found by SUBTYPE (`due_from_affiliate` /
  `due_to_affiliate`), never by code.
- **`intercompany_id` is a GROUPING KEY, not a foreign key.** It points at no
  row, because the thing it identifies is the pair. Consolidation (slice 3)
  eliminates by following it rather than by matching amounts, which is what
  makes elimination mechanical instead of a judgement call.
- **The database enforces "exactly two entries, in two different companies"**
  (`0149`), deferred, same shape as the balance trigger. A half-written pair
  leaves one company owing an affiliate that nobody is owed by; every report
  still balances and no screen surfaces it.
- **NEITHER LEG MOVES ALONE.** `assertNotIntercompanyLeg` refuses voiding *or
  reversing* a single side — stricter than the managed-source guard, which
  still permits a reverse, because a one-sided reversal is exactly as wrong as
  a one-sided void. `reverseIntercompanyPair` undoes both as a new pair.
- **The bill's Paid-from picker offers other companies' registers again**,
  reversing what slice 1b did there — deliberately. That filter existed because
  the choice always failed; it now records a pair, so it is a real option, and
  the dialog says what will happen before it happens. `bill_payments` still
  points at the bill's own leg, so aging, status and unapply are untouched.
- **"Where it landed" is optional on the transfer, and that optionality is the
  feature.** Name a receiving account and both companies' cash moves; leave it
  blank and one company simply settled something on the other's behalf, so only
  the affiliate balance does.
- **THE BUG THIS SLICE ALMOST SHIPPED.** `intercompanyId` was added to the
  schema, to `NewEntryInput`, and to every caller — and `postEntry` never wrote
  it. Both legs would have posted unlinked, the trigger's null-check would have
  waved them through, and consolidation would simply never have found them.
  Caught by the test asserting the id round-trips, which is the only assertion
  that could have.
- **NOT built: consolidation (slice 3).** The links exist and the accounts exist;
  nothing yet sums across companies and eliminates them. Also not built:
  receiving an invoice payment into another company's account, which is the
  mirror of the bill case and still refused.

### 2026-08-16 — `recurring_invoices` dropped, and the invoice total gets its CHECK (branch `claude/drop-recurring-invoices`)

Two contract jobs owed since 2026-08-12 and 2026-08-13, done together because
both must run AFTER this PR's deploy — for opposite reasons, which is the point
worth keeping.

- **The DROP inverts the usual order.** `recurring_invoices` and
  `invoices.recurring_invoice_id` stopped being read when the fold landed
  (`0121`/`0122`), but Drizzle builds its SELECT column list from `schema.ts`,
  so a deployment still declaring the column selects it — dropping under a live
  old build 500s every invoice page. Schema first, deploy, then migrate. That is
  the `0075`/`0088` lesson.
- **The CHECK could not ship earlier for the exact opposite reason.** Migrations
  precede deploys, and the deployment running when `0123` landed wrote
  `total_cents` without touching `subtotal_cents`, so the constraint would have
  rejected every draft edit in that window. Every write path has written all
  three together since.
- **So one is safe only after a deploy and the other is safe either side.** They
  go in one migration that runs after — one instruction rather than two with
  opposite rules.
- **`tsc` did not catch the dead write, and could not.**
  `recurringInvoiceId: input.recurringInvoiceId ?? null` sat inside an object
  returned from a helper, so excess-property checking never reached it — the
  compiler is only strict about literals passed straight to a call. Found by
  grep after removing the column. Same blindness the module has hit before with
  `server-only`.
- **The dev branch had two invoices violating the CHECK**, both on a `Merge
  Test` tenant left behind by an interrupted run. The FIXTURES that made them
  now state the arithmetic, and the stale rows were deleted by hand — **not**
  repaired by the migration. An invoice whose total does not equal subtotal plus
  tax is a real problem when the data is real, and a migration that quietly
  rewrote one to satisfy a constraint would be the worst possible way to learn
  that. Production had none.
- `verify-rls` reports **115 tables** where it reported 116, which is the drop
  showing up in the one place that counts them.

### 2026-08-16 — Document `entity_id` becomes NOT NULL, and the refusal says which line (branch `claude/document-entity-not-null`)

The contract half of slice 1b, plus the follow-up the founder asked for after
watching a cross-company journal get refused with nothing but a toast.

- **`0146`** closes `entity_id` on `invoices`, `bills` and `bank_accounts`,
  after the deploy that writes them. Third time this repo has made that split —
  `0123`/`0125`, `0142`/`0144`, now `0145`/`0146` — and the backfills re-run
  first, because rows written in the window between migration and deploy carry
  a NULL nobody would otherwise repair.
- **The dev branch refused it, and that was worth more than a clean run.** A
  `Merge Test` tenant had invoices and NO company at all — left by a fixture
  written before slice 1 — and `SET NOT NULL` failed with nothing but *column
  "entity_id" contains null values*. `0146` now re-runs `0142`'s guarded
  "one default company per tenant" INSERT first. It is a REPAIR, not an
  invention: `0142` established that invariant, so a tenant lacking a company is
  a gap in it. Production matched nothing, as expected; a migration that only
  works on the two databases you happened to check is not finished.
- **The journal editor no longer offers another company's register**, and
  changing the company CLEARS any line that had picked one — a selection left
  behind would be a value the dropdown cannot render a label for. Same fix the
  Deposit-to picker got, in the one place a cross-company register was still
  selectable. Everything else in the chart stays: a journal has to be able to
  name any account, and only a register is owned.
- **The refusal now marks the line.** `CROSS_ENTITY_REGISTER` carries the
  offending `accountId` in its meta, `fail()` passes it through as an optional
  field on the error result, and the editor rings that row and prints the
  message beneath it. The toast still fires — it is what tells you something
  happened at all — but on a twelve-line journal it cannot tell you WHERE, and
  the account list is long enough that hunting for it is real work.
- `ActionResult`'s error arm gained an optional `accountId`, so `"error" in
  result` and every existing call site are untouched.

### 2026-08-16 — The deposit picker offered another company's account (branch `claude/register-pickers-by-company`)

Found by driving the live Test tenant right after slice 1b deployed: Oak Row
LLC's invoice offered **Test Operating** in "Deposit to". The server refuses it
(`CROSS_ENTITY_REGISTER`, and the toast says why), so this was never a
correctness hole — it is a control that offers a choice which always fails.

- Same class as the recurring invoice that could be coded to Checking, and
  found the same way. The picker listed every ACTIVE register of the tenant; it
  now lists the ones belonging to the document's company.
- **Both sides**: the invoice's Deposit-to and the bill's Paid-from.
- **Undeposited Funds is still offered to everybody**, and that is right: it is
  a chart account rather than a register, so two companies' unbanked cheques
  both sit in 1250 separated by the entry's company — the same way their
  receivables share 1200.
- The engine guard is unchanged and is still the thing that makes this safe.
  The picker mirrors it; it does not replace it.

### 2026-08-16 — Invoices, bills and bank accounts carry a company (branch `claude/entities-on-documents`)

Slice 1 put the company on the journal ENTRY, which made reports scopeable and
left every document posting into the tenant's DEFAULT. This is the half that
makes the ten-LLC landlord's books actually separable. Migration `0145`;
**`0146` is owed after this deploy** and is the three `SET NOT NULL`s.

- **THE DOCUMENT DECIDES, and every entry it posts follows it.** An invoice's
  issuance and all its payments read `invoices.entity_id`; a bill's approval and
  payments read `bills.entity_id`; a bank row, an opening balance and a register
  quick-add read `bank_accounts.entity_id`. `entityForDocument` — the slice-1
  rule that inherited a company from a document's FIRST entry — is now dead for
  all three, because there is nothing left to infer.
- **A LINE MAY NOT TOUCH ANOTHER COMPANY'S REGISTER**, enforced in `postEntry`
  and in `editEntry`, not at the call sites. There is no useful list of call
  sites: any journal can name any account. The case it refuses is the one the
  ADR says this client does constantly — paying Oak Row's bill out of Maple
  Street's checking. As a single entry that is `Dr AP (Oak) / Cr Checking
  (Maple)` tagged to ONE company, so Oak's balance sheet shows cash leaving an
  account it does not own and Maple's shows nothing, **and the ledger still
  balances**. It is intercompany (slice 2), and until that exists it is refused
  rather than mis-recorded. The error says so and says what to do instead.
- **The chart of accounts is NOT constrained by that guard, deliberately.** AR,
  AP and every expense account stay shared: two companies' receivables both sit
  in 1200 and are separated by the entry's company. Only a REGISTER is owned,
  because only a register is an account with a balance somebody reconciles.
- **A/R and A/P aging, and the tax summary, now TAKE A SCOPE.** All three
  declined one in slice 1 for the same stated reason — the documents they read
  had no company — and that reason is gone. The tax summary is the one that
  matters: it shows the gap between what the invoices say and what the ledger
  says, so scoping one column and not the other made the difference
  meaningless. A sales-tax return is filed per company.
- **`entityScopeCondition` grew a column argument** rather than being copied
  three times, so "combined means no predicate" is decided in one place. A
  report that hand-rolled its own `eq(...)` would have to remember that alone.
- **The company is fixed at creation on all three.** `updateInvoiceDraft` and
  `updateBillDraft` do not write it (there is a comment where it would go), and
  a register has no update path for it at all: every entry that has cleared
  through an account belongs to whoever owned it then, so moving one would
  strand them. The correction is a new register and a transfer.
- **A TEMPLATE RESOLVES; A DOCUMENT FREEZES.** `recurring_entries.template`
  gained an OPTIONAL `entityId` — optional for the reason `taxRateId` is, that a
  template which stopped parsing would silently stop generating. Absent means
  the tenant's default, resolved at generation. The invoice or bill it produces
  then freezes what it was given, like any other document.
- **A receipt takes the company of the account it was paid from**
  (`entityForRegisterAccount`). A receipt is not a document with a company of
  its own — it is evidence of money leaving an account, and the account has an
  owner. It falls back to the default only when the paid-from account is not a
  register at all.
- **The list pages scope the WHOLE page, not just the header figure** — the
  MoneyBar, the bucket tallies and the table read one `entity`. A list showing
  one company's invoices under another company's "overdue" total is a screen
  somebody makes a decision from. `CompanyPicker` navigates on change rather
  than behind a Run button (a list is not a question you assemble), and it
  PRESERVES the status filter and bucket in the query string — dropping them
  would widen the list at the moment it narrowed it.
- **The books export gains a `company` column** on `invoices.csv`, `bills.csv`
  and `bank_accounts.csv`, APPENDED in each case so a process reading by
  position is unaffected.
- `tests/entities-db.test.ts` grows to 17: an invoice keeps its company through
  issue and payment **with the default moved in between**, a payment into
  another company's register is refused, a hand-written journal into one is
  refused, and A/R aging comes out per company. Isolation gains three composite
  FK cases — an invoice, a bill and a register each cannot name another
  tenant's company.
- **NOT built, and each is still its own slice:** intercompany pairs (2),
  consolidation with eliminations (3), per-entity CLOSE (4) — `period_closes`
  still locks every company at once. Fixed assets have no company either, so the
  assets pack is `entityForDocument`'s last caller.

### 2026-08-16 — The Journal header claimed one company's books (branch `claude/journal-company-copy`)

Found by driving the live Test tenant straight after slice 1 deployed, which is
the only way it could have been found: the string is correct at one company and
every test fixture has one.

- The page read **"Every entry in Test's books"** — the TENANT's name — directly
  above a table whose new Company column showed two different companies. It
  reads as a scoped list that is not scoped.
- At two or more it now says **"Every entry across all N companies"**; at one it
  is unchanged, so nobody who has never heard of the concept sees it.
- **The list itself stays unscoped, deliberately.** The journal is where you see
  everything; the reports are where you scope. Adding a third filter to this
  page would duplicate the report control without the stamping that makes it
  safe.

### 2026-08-16 — `entity_id` becomes NOT NULL (branch `claude/entity-id-not-null`)

The contract half of the entry below, and the reason it is a separate PR: it
runs AFTER the deploy that writes the column. `0144`, applied to dev AND
production, both verified before the PR opened.

- **The backfill runs AGAIN, first.** Rows written between `0142` and the deploy
  going live have a NULL `entity_id` — nothing was writing the column yet — and
  until they are repaired they are invisible to every entity-scoped report. That
  is the window this migration exists to close, not a belt-and-braces re-run.
  Guarded, so it is a no-op when there is nothing to fix, which is what it was
  on both databases.
- Verified on production after: `entity_id` NOT NULL, 12 entries, zero nulls,
  7 tenants with 7 entities and 7 defaults, zero rows whose entity belongs to
  another tenant, and `verify-rls` clean across all 116 tables.
- **The schema comment changed with it.** `ledger.ts` said the column was
  declared NOT NULL "one release ahead of the database"; that stopped being true
  the moment this landed, and a comment describing a state that has passed is
  worse than none.

### 2026-08-16 — A tenant can hold several companies (branch `claude/entities-slice-1`)

Slice 1 of [ADR 0010](../decisions/0010-entities-inside-a-tenant.md), which the
same day flipped from Proposed to Accepted. A tenant is the CLIENT; a legal
entity inside it owns a set of books. Migrations `0142` (table, column,
backfill, FK) and `0143` (RLS); **`0144` is owed after this deploy** and is the
`SET NOT NULL`.

- **`entity_id` is on the ENTRY, never the line**, so every entry still balances
  on its own and the posting invariant this module is built around is untouched.
  The alternative — an entry spanning entities with a per-entity balance check
  inside it — rewrites that invariant to save writing two rows.
- **THE WHOLE DEFENCE IS ONE REQUIRED PARAMETER.** `EntityScope` is
  `{ kind: "one", entityId } | { kind: "combined" }`, and `getBalances`,
  `getTrialBalance`, `getProfitAndLoss`, `getBalanceSheet`, `getCashActivity`,
  `getGeneralLedger`, `ledgerIsBalanced` and `cashBasisAdjustment` all require
  it. Not optional, and not `entityId?: string` where absent means everything —
  `undefined` is exactly what a caller forgets, while `{ kind: "combined" }` is
  something somebody had to type. This is `listStructures`' lesson applied to
  the ledger, and it matters more here: ADR 0010 names the failure as a report
  that is silently wrong across companies and **perfectly correct on the
  single-company tenant you are testing on**, which is every other fixture in
  the repo.
- **`combined`, not `consolidated`.** It is a plain sum with no eliminations.
  Today that is also the consolidated figure because intercompany does not
  exist; when it does, "combined" is still an honest name for a number that has
  eliminated nothing, so nothing has to be renamed or quietly redefined.
- **`cashBasisAdjustment` is scoped in three places, not one.** The payments in
  the window, EVERY prior payment of those documents (allocation is cumulative),
  and the documents' accrual lines. Scoping only the first would have produced a
  cash-basis report that still balanced and was wrong.
- **The picker is a URL parameter per report, not an ambient selection.** An
  ambient one is the failure mode with a nicer UI: a statement whose scope came
  from a control three screens ago is one whose reader cannot tell whose books
  it is. **An unknown entity id 404s rather than falling back** — the inverse of
  the `basis` rule, and deliberately: an unreadable basis has a safe answer,
  whereas substituting a different company's books for the one that was named is
  wrong about which business it describes while looking entirely normal.
- **The company is stamped wherever the basis is** — page footer, CSV content,
  CSV filename — and **only when the tenant has more than one**. A
  single-company tenant's exports are byte-identical to what they were, which is
  the same promise the picker makes on screen.
- **Two reports decline a scope, each for its own stated reason**, joining the
  three that decline a basis. The **tax summary** reads two sources and shows
  the gap between them — invoices for the per-rate figures, the ledger for what
  is owed — and an invoice has no company yet, so scoping the ledger half alone
  would make the difference between the columns meaningless. **Register
  balances** on the banking pages are every entry that touched the account,
  because a bank account belongs to an entity only from slice 4.
- **A document's entries all land in the company its FIRST one did**
  (`entityForDocument`). This is a live guard, not headroom: the default company
  can be moved, so without it an invoice issued under one default and paid under
  another would split its AR across two balance sheets. Same rule for bill
  payments, re-categorized bank rows and an asset's whole depreciation schedule.
- **A reversal takes the ORIGINAL's company**, never the default and never an
  argument. Otherwise both companies go out of balance while the tenant as a
  whole still nets to zero — the precise shape of wrongness the scope exists to
  catch. Pinned by a test that moves the default first.
- **A TEMPLATE resolves its company; a DOCUMENT freezes one.** Recurring
  journals follow the default as it stands at generation — the same split
  `recurring_entries` already makes for a sales-tax rate. Resolved once per
  template rather than per catch-up month, so a twelve-month catch-up cannot
  straddle two sets of books.
- **The hub asks `ledgerIsBalancedPerEntity`, not `ledgerIsBalanced`.** Two
  companies out by equal and opposite amounts sum to zero, so the combined check
  would report a healthy ledger in exactly the case a mis-scoped write produces.
- **`tests/entities-db.test.ts` is the only fixture in the repo with two
  companies**, and that is why it exists. Eleven cases: each trial balance
  balances on its own, the two add back up to the combined one account by
  account, the P&L/BS/GL each honour their scope, cash equals accrual per
  company, a reversal follows its original, an inactive company refuses a
  posting, and an unknown id refuses rather than falling back.
- **Isolation gains four**, including the one that matters: the composite FK
  refuses an entry naming ANOTHER TENANT's company, so a cross-tenant set of
  books is unrepresentable rather than merely unwritten. The file also says out
  loud what these do *not* certify — two companies of one client are not
  separated by RLS and are not meant to be.
- **`0142` is hand-edited three ways** and the header says so: drizzle-kit
  emitted `ADD COLUMN … NOT NULL` on a table with rows, no backfill at all, and
  the composite FK before the unique index it targets. The column arrives
  NULLABLE because migrations go out AHEAD of the deploy and the deploy running
  while it lands does not write it — a NOT NULL there rejects every invoice
  issued in that window. Same expand/contract split `0123` made for its
  `total = subtotal + tax` CHECK. `src/db/schema/ledger.ts` declares it NOT NULL,
  one release ahead of the database, on purpose.
- **Companies live on their own page reached from ONE hub card**, not an
  eleventh tab: `AccountingNav` was rebuilt because ten tabs already wrapped
  onto two lines, and most tenants have one company for ever. The page still
  exists at one, because adding the second is the only way to get to two.
- **The books export produces a full set of statements PER COMPANY plus a
  combined set**, once there is more than one. A return is filed per entity, so
  an export that could only produce the combined statements would be incomplete
  for exactly the client this was built for. At one company the loop runs once
  and every filename is unchanged. `ledger/entities.csv` is new, and
  `journal_entries.csv` gains `entity_id`/`entity` as APPENDED columns.
- **NOT BUILT, and each is a later slice rather than an oversight:**
  intercompany pairs (2), consolidation with eliminations (3), per-entity
  banking and close (4). **And the honest limit of this one: only a hand-written
  journal can name a company.** Invoices, bills, bank rows, receipts and
  recurring journals all post to the default. The eleven explicit
  `getDefaultEntityId` call sites are the grep that lists what the document
  slice has to revisit — a silent default inside `postEntry` would be the same
  behaviour with nothing to find.

### 2026-08-13 — Sales tax (branch `claude/accounting-sales-tax`)

The largest remaining gap from the 2026-08-10 QuickBooks review, and greenfield
inside a mature module — `grep salesTax` returned nothing before this. Migrations
`0123` (table + columns + backfill) and `0124` (RLS), both applied to dev AND
production, and both verified with `verify-rls.ts` plus a column/constraint dump,
before the PR opened.

- **A FLAT tenant-owned rate list, `payment_terms`' fourth sibling.** No
  jurisdictions and no nexus rules: resolving a rate from a delivery address is
  an address-resolution product — a rate service, an agency registry, a filing
  calendar, economic-nexus thresholds — and Simple Start, the benchmark, does not
  give the founder's own file much of it. The upgrade path if it ever matters is
  a `sales_tax_rate_components` child table plus per-component tax lines, both
  additive to this shape.
- **NOTHING IS SEEDED, unlike the other three lists.** "Net 30" is a sensible
  default everywhere; there is no tax rate that is right anywhere, and a seeded
  0% or 7% is a wrong number on somebody's invoice. `provisionCatalogue` does not
  touch the table and the "Add the standard set" restore does not apply to it. A
  tenant with no rates simply has no tax controls, which is the correct state for
  most of them. The FIRST rate a tenant creates becomes the default, because a
  list of one with nothing selected is a control that does nothing.
- **`rate_ppm`, not basis points, and that is arithmetic rather than fussiness.**
  8.875% (New York City) is 887.5 basis points, which is not an integer. Percent
  × 10,000 carries four decimal places of percent and covers every real US rate.
- **ONE RATE PER INVOICE, TAXABILITY PER LINE.** `invoice_lines.is_taxable` is
  the split that lets a trade bill exempt labour and taxed materials on one
  document — the common case wherever services are exempt and goods are not. A
  boolean rather than a second rate on purpose: two rates on one invoice is a
  different feature and this is not half of it.
- **The tax block on the invoice is FROZEN at write.** `tax_rate_ppm` is a COPY
  of the rate, not a reference, so editing a rate tomorrow cannot re-price a
  document already sent and cannot make the invoice disagree with the entry
  posted from it. Pinned by a DB test that moves a rate from 7.25% to 10% and
  asserts the issued invoice, its stored tax and its ledger balance are all
  unchanged. Derived-at-read was never a candidate for exactly this reason.
- **`total_cents` becomes the GROSS, and that is the point.** It has always meant
  "what the customer owes" — tax changes the value, not the meaning. That is what
  makes ~45 call sites correct with no edit: the overpayment guard, aging, the
  MoneyBar, reminders, the PDF balance, bank matching. Its `>= 0` CHECK is
  untouched. A test pays the subtotal of a taxed invoice and confirms it does
  *not* settle, and that paying the gross does.
- **The `total = subtotal + tax` CHECK is DELIBERATELY NOT in `0123`.** Migrations
  go out ahead of the deploy, and the running `updateInvoiceDraft` writes
  `total_cents` without touching `subtotal_cents` — the constraint would reject
  every draft edit in the window. It belongs with the follow-up migration
  alongside the `recurring_invoices` DROP. Until then `tests/sales-tax-db.test.ts`
  asserts the invariant over every stored invoice. `tax_cents >= 0` IS safe in
  `0123`, because nothing before this deploy writes the column and its default
  satisfies it.
- **`subtotal_cents` is backfilled in `0123`, not left on its DEFAULT 0.** Every
  invoice that exists charges no tax, so its subtotal is its total; a column that
  reads as a real figure and is wrong is worse than one that is absent. Guarded
  by `tax_cents = 0`, so a re-run is a no-op. Verified on production: 4 invoices,
  4 with subtotal = total, zero rows where subtotal + tax ≠ total.
- **Issuing adds ONE credit line, found by SUBTYPE `sales_tax`** — never by the
  2200 the template happens to use, since a tenant may have renumbered. Looked up
  only when tax ≠ 0, so a tenant who removed the account and never charges tax is
  unaffected. The tax figure is RECOMPUTED at issue from the frozen lines and the
  frozen rate rather than read off the column, so the entry and the document
  cannot disagree, and the recomputed value is written back — issuance is
  self-healing for any row a write path left stale.
- **The tax line carries NO DIMENSION**, deliberately. A dimension answers "which
  part of the business earned this", and this line is not earnings.
- **Partial payment and void needed no code at all.** Accrual puts the whole
  liability in 2200 at issue, so a payment stays Dr deposit / Cr AR; `voidInvoice`
  already reverses the entire issuance entry. Both are pinned by tests rather
  than assumed.
- **Cash basis came free, and that is worth knowing before somebody "fixes" it.**
  `cashBasisAdjustment` excludes only the AR/AP control leg and pro-rata-recognises
  every *other* line of the document — the tax credit is one of those — so on a
  cash-basis report the liability lands proportionally as payments arrive.
  `cash-basis-allocate.ts` needed no change.
- **ROUNDING HAPPENS ONCE, ON THE SUMMED TAXABLE BASE.** Per-line rounding
  accumulates and produces a tax figure that does not equal rate × base, which is
  both the number a customer checks with a calculator and the number a return
  asks for. Three lines of $0.10 at 5% is 2 cents here and 3 cents per-line; a
  test asserts the difference rather than describing it.
- **BigInt intermediates, forced not stylistic.** `MAX_AMOUNT_CENTS` is 1e13 and
  the scale is 1e6, so the product reaches 1e19, past `Number.MAX_SAFE_INTEGER`
  — where the answer would be quietly wrong rather than loudly. Second place in
  the module to need it after `cash-basis-allocate.ts`, and it hit the same trap:
  BigInt LITERALS (`2n`) need an ES2020 target and this tsconfig is lower, so it
  is `BigInt(2)`.
- **`invoicing/tax.ts` is pure, no `server-only`**, for the reason `terms.ts` is:
  the builder computes the tax in the browser as you type and the server
  recomputes it on save, and two implementations of one rule is how those come to
  disagree. 34 table tests, no database.
- **`invoiceTotalCents` → `invoiceSubtotalCents`.** The name stopped being true
  the moment an invoice could carry tax, and a helper called "total" returning the
  pre-tax figure is what a later change reads wrong. Same move as
  `perMemberCents` → `perColumnCents`.
- **The P&L exclusion was already free — WHICH IS WHY IT IS NOW PINNED.**
  `sales_tax` is absent from `PNL_SECTION_BY_SUBTYPE` and a liability matches
  neither fallthrough branch, so `pnlSectionFor` returns null. Nothing would have
  noticed somebody adding a line to that map. Three tests: the account maps to no
  P&L section at any code or name, and end to end a 157,250 invoice shows 150,000
  of income and a net profit of 150,000 with no tax row anywhere on the statement.
- **The tax summary is the eighth report and the only one built from DOCUMENTS.**
  The ledger knows what you owe and ties to the balance sheet; the invoices know
  the taxable base a return asks for. Neither is honest alone, so it carries both
  and **states the difference**. A non-zero difference is NORMAL — earlier
  periods' unremitted tax sits in the balance — and the page says so, because the
  alternative is a reader treating it as a fault. **Accrual only**, stamped on the
  report: a cash-basis version means pro-rating each invoice's tax across its
  payments per rate, which is a feature rather than a toggle, and a return
  computed on the wrong basis is not slightly wrong. Third report to refuse a
  basis control, third distinct reason.
- **No division in the report (P5).** The first cut recovered the taxable base by
  dividing tax by rate; it was approximate wherever the tax had been rounded,
  which is the wrong trade when the exact figure is one `filter (where is_taxable)`
  sum away. The tax is the authority, the base is summed from the frozen lines.
- **`ReminderRenderContext.tax` is REQUIRED, not optional.** An optional field is
  one a caller can forget, and the symptom would be a chasing letter whose
  attached invoice omits the tax being chased for. `invoiceTaxFields` is the one
  resolver the PDF route, the send path and both reminder paths call — the same
  rule `reminder-render.ts` itself exists for.
- **Subtotal and tax on the PDF are not decoration.** Most US states require sales
  tax stated separately on the document, so an invoice folding it into one total
  is the wrong document. They appear only when there IS tax; "Tax 0.00" implies a
  taxed sale that came to nothing.
- **Recurring invoice templates store the rate ID, not the ppm**, and that
  inverts the invoice's freeze on purpose: a template is a standing instruction
  ("bill this at the state rate"), so a rate correction *should* reach next
  month's invoice — which then freezes it like any other. Optional in the schema,
  so every template written before today still validates; one that stopped
  parsing would silently stop generating.
- **The books export gains `sales/sales_tax_rates.csv`**, four columns on
  `invoices.csv` and `taxable` on `invoice_lines.csv`. The new invoice columns are
  APPENDED, so a process reading that file by position is unaffected.
- Isolation gains four cases: the unscoped select, an insert attributed to the
  other tenant, an UPDATE of the other tenant's rate (the write half — one tenant
  must not be able to change what another charges), and the composite FK refusing
  an invoice that names the other tenant's rate.
- **Not built, all deliberate:** tax on BILLS (tax paid a vendor is part of the
  expense in the US; the regime where it matters is VAT/GST, which is a different
  posting model and half of it would be worse than none — note
  `ai/extract-validate.ts` has pulled `taxCents` off receipts since session 5 and
  nothing has ever needed it); a customer-level default rate and a tax-exempt
  flag; a one-click "record a tax payment" against 2200 (remit with a journal or
  a bill, both of which already work, and the summary shows the balance); and
  cash-basis tax.
- **Turning tax ON ticks every line; turning it off leaves the flags alone.**
  Found by reasoning through the empty-default case rather than by a test:
  a tenant with rates but no *default* picks one and would have watched the tax
  read 0.00 with every line unticked — the control appearing to do nothing.
  Choosing a rate means "tax this invoice"; the per-line flag is for the
  exceptions. The asymmetry on the way back is what makes switching to a rate
  and back non-destructive.
- **Nobody has clicked any of this.** Compiled, built, and proven against a real
  database — 15 DB cases and 34 pure ones. The routes were driven far enough to
  confirm they resolve (`/reports/sales-tax` answers 307 to `/sign-in`), which is
  as far as an agent session gets: the page bodies execute only behind a Clerk
  session. Compiled-and-tested, not seen, per the standing note in Open items.

### 2026-08-12 — Every confirmation is a real dialog now (branch `claude/accounting-confirm-dialogs`)

Accounting held the only five `window.confirm` calls in the codebase, and they
guarded Issue, Void, Delete draft, Unapply payment, Disconnect bank and
Cancel/Reopen reconciliation — which is to say every irreversible action in the
module.

- **A suppressed confirm returns FALSE, so the button silently does nothing.**
  Embedded browsers and webviews suppress native dialogs; that is how this was
  found, clicking Issue in an in-app browser and getting no toast, no error and
  no network request. Unstyled is the smaller half of the problem — undebuggable
  from a support ticket is the larger one.
- **`useConfirm` is promise-shaped on purpose** (`components/app/use-confirm.tsx`).
  The declarative form the rest of the app writes by hand — hold "what am I
  confirming" in state, wire the dialog's button to the action — turns every
  call site inside out: a guard clause at the top of a handler becomes a
  callback somewhere else. Here `if (!(await confirm({...}))) return;` sits on
  the line `window.confirm` occupied, so a reviewer checks the MESSAGE rather
  than re-checking the control flow.
- **The resolver is a ref, not state.** Resolving must not wait for a render,
  and a second question supersedes the first by answering it `false` rather
  than leaving a promise — and the caller's `await` — hanging forever.
- **Escape, the overlay and the close button all resolve `false`** through one
  `onOpenChange`, so there is no route out that leaves the action ambiguous.
- **The messages got longer, because there was finally room for them.**
  "Void INV-0007? Its ledger effect is removed." became a title and a sentence
  saying the invoice stops counting towards what you are owed and the number is
  never reused. Destructive actions get the red button; Reopen does not, since
  it is reversible.
- Nothing about the actions themselves changed — same server actions, same
  version CAS, same guards. This is the layer in front of them.

### 2026-08-12 — A recurring invoice could be coded to Checking (branch `claude/accounting-recurring-account-filters`)

Found by clicking it. The unified Add-recurring dialog was handed ONE list of
every active account and gave it to all three kinds, so the field labelled
"Income account" on a recurring invoice line offered Checking, Accounts
Payable, Retained Earnings and Cost of Goods Sold — and the bill "Category"
picker offered bank registers.

- **Three lists now, each mirroring the one-off builder for that kind**, so a
  template and a hand-keyed document offer the same choices: invoice lines →
  `accountType = 'income'` (`sales/invoices/new`); bill lines → codable, which
  is active minus bank registers, opening balance and system AR/AP
  (`purchases/bills/new`); journal lines → everything, which is what a journal
  is for.
- **The filter is still only in the UI**, here and in both one-off builders:
  neither `createInvoiceDraft` nor the recurring create action checks the
  account TYPE server-side. This change reaches parity rather than fixing that,
  and the gap is in Open items now rather than implied.
- Regression risk it removes: a rent template coded to Checking generates a
  wrong draft every month until somebody notices, and each one posts on issue.

### 2026-08-12 — `recurring_invoices` folds into `recurring_entries` (branch `claude/accounting-recurring-converge`)

The module had two recurrence mechanisms. It now has one. The stated limit from
the recurring-journals entry below — *"`kind` has room for `'invoice'` when that
is worth doing"* — is closed. Migrations `0121` (schema) and `0122` (backfill),
both applied to dev AND production before the PR opened.

- **EXPAND half of an expand/contract, and the contract half is a SEPARATE PR
  that must land after this deploy.** `recurring_invoices` and
  `invoices.recurring_invoice_id` both survive this change untouched; the running
  deploy still selects them, and a DROP that precedes the deploy which stops
  reading a column is the outage `drizzle/0075` taught. Nothing here is
  destructive, which is why it could go to production before the merge.
- **Ids are PRESERVED across the fold.** A template's id is already recorded on
  invoices it generated, so reusing it keeps those links meaningful and makes
  backfilling `invoices.recurring_entry_id` a straight copy rather than a lookup
  through a mapping table. Both statements in `0122` are guarded, so the
  migration is idempotent.
- **The enum is RECREATED, not extended, and that is forced.** Drizzle's
  migrator runs every pending migration in ONE transaction, so
  `ALTER TYPE ... ADD VALUE 'invoice'` followed by `0122` inserting that value
  trips Postgres' `check_safe_enum_use` — *"New enum values must be committed
  before they can be used."* Splitting the migrations does not help; they still
  share a transaction, and a fresh database (CI, a new environment) hits it on
  its first run. A type CREATED in the current transaction is the documented
  exception, so `0121` builds the type new, moves the column across through
  `text`, drops the old one and renames. **Both CHECKs that mention `kind` come
  off first and go back on after** — a CHECK is re-parsed against the new column
  type, and one left in place fails with `operator does not exist:
  recurring_entry_kind_new = recurring_entry_kind`.
- **Caught by applying to dev first, twice.** The `::text` comparison in the new
  CHECK was the first catch; the single-transaction batching was the second, and
  it only appeared on production because dev had taken the two migrations in
  separate runs. Dev was rolled back to pre-`0121` and re-migrated from scratch
  so the path CI and production take is the path that was proved.
- **`recurring_entries_party_shape` replaces `recurring_entries_vendor_shape`**:
  a bill has a vendor and no customer, an invoice has a customer and no vendor,
  a journal has neither. One CHECK for the whole matrix, so no kind can acquire
  the wrong party. Isolation covers both columns now — the vendor smuggle test
  had a customer-shaped twin missing.
- **One list, one Generate button, one engine.** `/sales/recurring` is gone from
  the Sales nav and left behind as a redirect, because bookmarks and browser
  history do not update themselves and a 404 is a worse answer than the list
  they wanted. `invoicing/recurring.ts` and its four actions are deleted;
  `advanceMonthly` moved to `recurring/schedule.ts` rather than being deleted
  with them.
- **A vendor merge could not have absorbed a recurring bill.** `merge-ops.ts`
  re-pointed `invoices`, `recurring_invoices` and `bills`, but recurring bills
  arrived after it was written and their vendor FK is `NO ACTION` — so absorbing
  two vendors that both had one would have failed on the FK. Fixed in passing,
  since the same edit had to touch the customer side anyway.
- **The books export gains `ledger/recurring_entries.csv`** and loses
  `sales/recurring_invoices.csv`. Recurring journals and bills were never
  exported at all, so "take your books and go" was quietly incomplete for a day.
- **Not built:** editing a template, still — pause/resume and re-create only,
  for all three kinds.

### 2026-08-12 — The thread drafter has a live test, and it passes (branch `claude/live-thread-draft-test`)

The drafter shipped as the only AI engine in the module WITHOUT a gated live
test — `extract`, `bill-code`, `narrative` and `interview` all had one. Its
fixture tests proved the validator rejects bad output; nothing proved good
output ever arrives, because the fixtures were written by the same hand as the
validator. If the prompt were weak the symptom would be every line arriving
unticked, and no test in the repo would have noticed.

```
RUN_LIVE_THREAD_DRAFT=1 npx vitest run tests/live-thread-draft.test.ts
```

**RUN 2026-08-12 against `claude-opus-5`. All three cases pass.** What it
actually produced, on a conversation agreeing $3,450 labour + $780 materials:

- Two lines, **both citations verified** — `"Second fix carpentry comes to
  $3,450.00 for labour"` and `"plus $780.00 for materials"`, each found in the
  message it cited. Amounts exact to the cent, party matched to the id offered.
- Three caveats, one of them better than anything designed for: *"The client
  asked to be invoiced on completion of the work, which was due to start on the
  20th; this draft is dated today and may be premature."*

**The negative case is the one that matters** and it holds: given the same job
discussed with only a RANGE (*"somewhere between three and five thousand"*) and
an explicit "I'll get you a proper number once I've been round", it returned
**zero lines** and said why. A range discussed is not a price agreed, and
inventing $4,000 there is the failure that would make the feature
untrustworthy — worse than proposing nothing.

- `callThreadDraftModel` is now exported, the same split `bill-code.ts` makes
  for `callBillCodingModel`, so the live test drives the real model without a
  database.
- **Found by running it:** the model flagged that *"our usual 30 days"* was
  mentioned but set no due date, because the drafter has no idea payment terms
  exist. `payment_terms` shipped the same day — resolving the customer's default
  term in the accept path is now a real, small improvement. Recorded in Open
  items rather than bolted on here.

### 2026-08-12 — Obligation statuses and the MoneyBar (branch `claude/accounting-moneybar`)

The last item from the 2026-08-10 QuickBooks review. Read-side only: no schema
change, no migration, nothing persisted.

- **`issued` is a lifecycle state; "Overdue 60 days" is an obligation.** The
  first says what the software did, the second says what somebody is owed — and
  that is the difference between a list you scan and a list you act on. The
  lifecycle status is still what the database stores and what every guard
  checks; `obligationFor` is a rendering of it, computed at read time.
- **BALANCE BEATS STATUS.** `paid` derives from payments and the two are written
  in one transaction, but if they ever disagreed the money is the fact and the
  status is a summary of it. Pinned by a test.
- **Void and draft are read BEFORE the date maths**, so a stale due date on a
  voided invoice can never render as an alarm.
- **`destructive` is spent only on overdue money.** "Due in 3 days" is not red;
  if it were, neither figure would mean anything. A zero Overdue total is not
  red either — a red zero is a false alarm.
- **The MoneyBar's figures cover EVERY row, not the 200 the table shows.** A
  total that silently described a page would be the number somebody trusts to
  decide whether to worry. The display query therefore runs LAST, so an active
  bucket is a real predicate rather than a filter applied after `limit(200)`.
- **AR buckets are Overdue / Not due yet / Not deposited / Deposited.** Two are
  about the document and two about the money, which is deliberate: "which
  cheques have I not banked?" needs the payment side, and `undeposited_funds`
  is read as a SUBTYPE rather than hard-coded to 1250, since a tenant may have
  renumbered it.
- **AP buckets swap the deposit pair for Awaiting approval / Paid recently.** A
  bill awaiting approval is an obligation on a PERSON with no date to be late
  against, so it keeps its own bucket and its own label rather than being
  rendered as a due date.
- **A bucket takes over the list**; the status pills stay visible and clear it.
  Two filters that could disagree on one page is worse than one that wins.
- An empty bucket compiles to `false`, never `id in ('')` — the column is a
  uuid, so the empty-string sentinel would be a type error at the database
  rather than a query matching nothing.
- `daysBetween` was **exported from `lib/dates.ts` rather than copied**. It was
  private, and `aging-core.ts` and `attention/source.ts` had each already grown
  their own — three implementations of one calendar subtraction. New callers use
  the shared one; the other two are left alone rather than swept up inside an
  unrelated change.
- **Not built:** obligation language on the invoice and bill DETAIL pages (both
  still show the lifecycle badge), and a deposits screen for the two money
  buckets to link into.

### 2026-08-12 — Per-record History panel (branch `claude/accounting-record-history`)

"What has happened to this invoice." No new table and no new writes: every
financial mutation already writes an audit row in the SAME TRANSACTION as the
change, so the history is a consequence of a rule that already existed rather
than a second record that could disagree with the first.

- **`listRecordHistory` takes SEVERAL targets, not one**, and that signature is
  the feature. An invoice's payments are audited against the PAYMENT row and
  its posting against the ENTRY, so a panel filtering on the invoice alone
  shows "created, issued" and silently omits the money — which is the half
  somebody opens a history for. The caller passes its own related ids; nothing
  guesses. Pinned by a DB test asserting both halves: the invoice alone finds
  one event, the invoice plus its payment finds both.
- **Labels are DERIVED, not enumerated.** There are 77 accounting actions today
  and the number only goes up; a hand-written map would be stale within a week,
  and a stale map fails in the worst available way — omitting the event
  somebody is looking for. `<domain>.<verb>` is split and humanised, with a
  short override table for the ones that read badly, so a brand-new action
  nobody thought about still renders as a sentence. **The raw action stays on
  the row's `title`**, because somebody reconciling against the audit log needs
  the slug the log actually holds.
- **`meta` is never dumped.** It carries whatever each call site thought worth
  recording — before/after blobs, internal ids — so only keys with an agreed
  meaning are read. Adding a key to an audit call can therefore never change
  this panel by accident.
- **The panel renders NOTHING when there is nothing to say**, like
  `EntityThreads`: a record created before this existed has no rows, and a
  permanently empty History card on every invoice would be furniture.
- **`audit_log` gained its first target index** (`0120`) — this is the first
  read that filters by target rather than by tenant or time, on a table that
  only ever grows.
- **Numbered `0120`, not `0118`.** PR #137 was open at the same time and
  already claimed 0118 and 0119. Drizzle applies in journal order so the gap is
  cosmetic; a collision would not have been. Worth knowing whenever two
  accounting PRs are in flight.
- `audit_log` is member-READABLE by policy (`drizzle/0001`), which is what makes
  this a plain read under the caller's own RLS rather than needing `withSystem`.
- **Not built:** history on journal entries, customers and vendors — the query
  is target-agnostic, so each is a one-line addition when wanted.

### 2026-08-12 — Recurring journals and bills (branch `claude/accounting-recurring-journals`)

The benchmark QuickBooks file runs a monthly depreciation JOURNAL, which this
module could not express at all — the only recurrence it had was
`recurring_invoices`, and an invoice is the one recurring document that has a
customer and a due date. Migrations `0118` (table) and `0119` (RLS), both
applied to dev AND production before the PR opened.

- **One table with a `kind`, not one per kind.** Everything except the payload
  is identical: a name, a monthly day, a next run date, a catch-up position, an
  active flag. `template` is jsonb, zod-validated at write AND re-validated at
  generation, the same contract `recurring_invoices.template` keeps.
- **`recurring_invoices` is NOT folded in, and that is a stated limit rather
  than an oversight.** *(Closed 2026-08-12 — see the top of this log.)* It is live, has rows, has its own UI and a customer FK,
  so absorbing it means a data migration and a rewrite this change did not
  need. `kind` has room for `'invoice'` when that is worth doing. **Until then
  the module has two recurrence mechanisms** — the schema comment says so, and
  so does this line, because the alternative is somebody discovering it.
- **A journal may POST automatically; a bill never does.** The same decision
  bank rules already carry: a template is a decision the owner wrote down,
  replayed deterministically, so it may act — unlike a model's guess. Off by
  default. A bill stays a draft because *approving* a bill is what posts it,
  and that approval is the control an owner already exercises over money
  going out; generating an approved bill would remove it.
- **A rule never overrides the period lock**, here as everywhere: an
  auto-posting run whose date falls in a closed period lands as a DRAFT and is
  counted in `deferredToDraft`, so somebody can see a depreciation entry is
  sitting unposted rather than assuming it went in.
- **The balance check is at WRITE time.** The posting engine would reject an
  unbalanced journal anyway — but once a month, at generation, where the only
  evidence is an error row nobody reads. `journalTemplateBalances` is pure, the
  create action refuses on it, and the dialog shows a running imbalance as you
  type.
- **`advanceMonthly` is imported from `invoicing/recurring.ts`, not copied**, so
  the two mechanisms cannot drift on month arithmetic. *(It moved to
  `recurring/schedule.ts` when the two mechanisms became one.)* Catch-up is capped at 12
  and dates each entry to the month it was FOR, never to today.
- **Idempotency key `recurring:<templateId>:<date>`** on posted journals, so a
  re-run cannot double-post a month even if the version CAS is beaten.
- **No `frequency` column**, unlike `recurring_invoices`: that enum has exactly
  one value, and importing it would make `payables` depend on `invoicing`,
  which already depends on `payables` for `bill_lines` — a circular import
  between two eagerly-evaluated drizzle schema files is a real breakage.
- **Not built:** editing a template (pause/resume and re-create only), and any
  cadence other than monthly.

### 2026-08-12 — Catalogue: saved items, payment terms, payment methods (branch `claude/accounting-products-terms`)

The three lists a business reuses on every invoice. Migrations `0116` (tables)
and `0117` (RLS), both applied to dev AND production before the PR opened.

- **`products` is a SAVED LINE, not inventory.** No quantity on hand, no cost
  of goods, no stock movement — picking one fills a line's description, price
  and account so the tenth invoice does not need them typed again. Calling it
  "products" is already the generous reading, and the schema comment says so
  before somebody builds stock tracking on it.
- **`payment_terms.due_in_days` is the whole of the arithmetic.** No "net EOM",
  no "2/10 net 30": an early-payment discount changes what is OWED, which is a
  posting question rather than a date question, and half of it would be worse
  than none. **At most one default per tenant, enforced by a partial unique
  index** rather than by care.
- **Terms drive the due date, and typing a date clears the term.** A hand-typed
  date is a deliberate override, so the term stops claiming to describe it.
  An EXISTING draft keeps the date it was saved with — re-deriving on open would
  silently move a date somebody chose. `terms.ts` is pure because the browser
  computes the date as you type and the server recomputes it on save, and two
  implementations of one rule is how those come to disagree.
- **`payment_methods` replaces a zod enum that was written into a text column**,
  and the five old values are seeded WITH THEIR EXISTING CODES so historic
  payments still render as names. **There is deliberately no FK** from
  `invoice_payments.method`: deactivating or renaming a method must never
  rewrite what a posted payment recorded. A method's `code` is therefore
  derived once at creation and never changes; renaming changes the LABEL only.
- **The payment action now validates the method against the tenant's own list**,
  inside the posting transaction, so a method deactivated mid-flight cannot slip
  between the check and the write. It was previously a fixed enum, which no
  longer describes what the column may hold.
- **`customers.payment_terms_id` null means "whatever the default is"**, not
  "no terms" — so changing the default moves every customer who never had a
  special arrangement, which is what somebody editing the default expects.
- Provisioned with the chart of accounts and idempotent the same way, so
  re-provisioning is also the backfill path for tenants that predate the lists.
- **Not built:** setting a customer's default terms from the customer form (the
  column and the resolution logic are both live; only the control is missing),
  and using saved items on BILLS, where `expense_account_id` is already carried.

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
- `customers`, `invoices` (state machine; partial/paid DERIVED from payments, never client-set; race-safe INV-#### numbering), `invoice_lines` (signed unit prices for discounts, integer-math amounts), `invoice_payments` (born atomically with their Dr deposit / Cr AR entry), `recurring_invoices` (monthly templates generate DRAFTS — human approves before AR posts; folded into `recurring_entries` on 2026-08-12)
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
| `accounts` | S1 | Chart of accounts, hierarchical. **Tenant-wide, shared by every company** (ADR 0010) — that sharing is most of what "manage ten LLCs in one place" means |
| `journal_entries.intercompany_id` | 2026-08-16 | The link between the two halves of an INTERCOMPANY transaction (`0148`). A grouping key, not a foreign key. Exactly two entries per id, in two different companies, by the deferred trigger in `0149` |
| `entities` | 2026-08-16 | The legal entities inside one client; **the entity owns the books** ([ADR 0010](../decisions/0010-entities-inside-a-tenant.md)). At least one per tenant, exactly one `is_default` by partial unique index. Deactivate, never delete — it owns posted entries and the FK is NO ACTION. NOT a `dimension_members` type: the test is whether the trial balance has to balance within it |
| `journal_entries` / `journal_lines` | S1 | The ledger; balanced-at-commit trigger. `journal_entries.entity_id` (`0142`) says whose books — **on the ENTRY, never the line**, so an entry still balances on its own. Composite FK `(tenant_id, entity_id)`. NOT NULL since `0144`, which ran after the deploy — `0142` had to add it nullable because migrations precede deploys |
| `dimension_members` / `line_dimensions` | S1 | Dimension tagging (industry-pack seam); line_dimensions gained invoice_line_id (S4) and bill_line_id (S6) with exactly-one-parent CHECKs |
| `accounting_settings` | S1 | Per-tenant config (fiscal year, etc.). Gained `reminders_enabled` (default **false**) and `reminder_offsets` jsonb (`0114`) |
| `bank_accounts`, `bank_transactions`, `reconciliations`, `reconciliation_lines`, `plaid_items` | S3 | Feeds, staging, reconciliation; encrypted Plaid tokens. `bank_accounts.entity_id` (`0145`) — **a register belongs to exactly one company**, chosen at creation and never moved, and `postEntry` refuses any line touching another company's register |
| `bank_rules` | 2026-08-10 | Deterministic feed categorization. Priority-ordered, first match wins; `is_suggested` marks a machine-proposed rule; `auto_post` posts without review but never into a closed period. Gained `set_vendor_id` (`0113`) so a rule can name the payee too. `bank_transactions.rule_suggestion` is a **snapshot**, not an FK — it records what a rule said at match time, so editing the rule later cannot rewrite what the owner was shown |
| `parties` | 2026-08-03 | **Shared, not this module's.** The identity spine behind `customers` and `vendors`; written through `src/lib/parties/`. See [crm.md](crm.md) |
| `customers`, `invoices`, `invoice_lines`, `invoice_payments` | S4 | AR. `customers.party_id` (2026-08-03) makes the row a role on a party. Both `customers` and `invoices` gained `reminders_muted` (`0114`) — standing and one-off suppression of automatic chasing. `recurring_invoices` folded into `recurring_entries` (`0121`/`0122`) and was dropped in `0147` |
| `documents`, `document_links` | S5 | Capture substrate; exactly-one-of link targets |
| `vendors`, `bills`, `bill_lines`, `bill_payments` | S6 | AP. `vendors.party_id` (2026-08-03) makes the row a role on a party |
| `period_closes`, `close_notes` | S7 | Month-end close |
| `recurring_entries` | 2026-08-12 | **The** recurrence table: invoices, bills and journals. `kind` discriminates the jsonb `template`; two CHECKs pin the shape (`party_shape` — a bill has a vendor, an invoice a customer, a journal neither; and `auto_post_shape` — only a journal may post itself). `invoices.recurring_entry_id` records which template made a row |
| `products`, `payment_terms`, `payment_methods` | 2026-08-12 | The catalogue: saved invoice lines, named terms (`due_in_days`, one default per tenant by partial unique index), and the tenant-owned payment-method list. `invoice_payments.method` stores a method's CODE with **no FK** — deactivating a method must never rewrite a posted payment. `customers.payment_terms_id` (nullable = use the default) |
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
- **Automatic overdue reminders are DONE** (2026-08-11) — see the build log. What is not built: a reminder for **bills we owe** (the AP mirror), and reminder wording an owner can edit, both deliberately left until somebody asks
- **General Ledger and Transaction Detail by Account are DONE** (2026-08-11) — one report with an account filter, so seven reports now. See the build log for the accrual-only decision
- **P&L by Month is DONE** (2026-08-12) — the by-dimension column spread generalized to time. What is NOT built: quarter and year columns, which the same `periods` seam would carry with a different bucketer
- **Drafting from an email thread is DONE** (2026-08-12) — both directions, with verified citations, and **proven against the real API** (see the build log; `RUN_LIVE_THREAD_DRAFT=1`). Now worth doing: the drafter sets no due date because it does not know `payment_terms` exists — resolving the customer's default term in the accept path would close that. What is NOT built: auto-linking the accepted draft back to the thread (deliberate, see the build log), and drafting from a thread the *reader does not own*, which RLS forbids by design
- **The per-record History panel is DONE** (2026-08-12) on invoices and bills; journal entries, customers and vendors are a one-line addition each
- **Products & Services, Terms and Payment Methods are DONE** (2026-08-12) — see the build log for the two deliberate gaps (customer-level default terms have a column and resolution but no control; saved items are invoice-only so far)
- **Line account pickers are filtered in the UI ONLY.** `createInvoiceDraft`, `createBillDraft` and the recurring create action all accept whatever account id they are given, so nothing but the dropdown stops an invoice line posting revenue to Checking. Worth a server-side type check on all three paths, in one change rather than three
- **Recurring entries GENERATE ON THEIR OWN** since 2026-08-13 (`/api/cron/recurring`, 6am in the tenant's zone). What is not built: any way to see the sweep's history in the UI — the counts come back to the cron caller and nowhere else
- **Recurring journals and bills are DONE** (2026-08-12), and so is **folding `recurring_invoices` into them** (2026-08-12) — the module has ONE recurrence mechanism, one list and one engine. **DONE**: `drizzle/0147` dropped `recurring_invoices` and `invoices.recurring_invoice_id`. What is not built for any kind: editing a template, and any cadence other than monthly
- **Obligation statuses and the MoneyBar are DONE** (2026-08-12) on the invoice and bill LISTS. What is not built: the same language on the detail pages, and a deposits screen for the two money buckets to link into. **That closes the 2026-08-10 QuickBooks review list.**
- **Sales tax is DONE** (2026-08-13) — a tenant-owned rate list, per-line taxability, one frozen tax block on the invoice, one Cr to the `sales_tax` account at issue, and a per-rate summary that reconciles against the ledger. Deliberately NOT built, each for a reason in the build log: **tax on bills** (US purchase tax is part of the expense; the regime where it matters is VAT/GST, a different posting model), a **customer-level default rate and tax-exempt flag** (the invoice-level control is live; this is the `resolveTaxRate` signature's obvious next argument, ~30 lines), a **one-click remittance** debiting the tax account (a journal or a bill does it today, and the summary shows the balance to remit), **cash-basis tax**, and **splitting a combined rate into components** for a return that wants state and county separately
- **`drizzle/0147` closed the last two owed contract migrations** (2026-08-16): the `recurring_invoices` DROP and the `total_cents = subtotal_cents + tax_cents` CHECK. They ran together because both must follow this deploy — the DROP because a live build still selecting a dropped column 500s, the CHECK because it could not precede the deploy that started writing `subtotal_cents`. Nothing is owed in that lane now
- ~~The last item from that review~~: **obligation-language statuses** ("Overdue 60 days" rather than `issued`) and the **MoneyBar** bucket filters (Overdue / Not due yet / Not deposited / Deposited, each clickable with a total) on the invoice and bill lists. Everything else on that list is now built
