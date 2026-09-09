# 0037 — A document open when the books began is a real document, and its other leg is Opening Balance Equity

- **Date:** 2026-09-09
- **Status:** Accepted
- **Affects:** accounting module — `invoices.is_opening`, `bills.is_opening`, `issueInvoice`, `approveBill`, the cash-basis lens, the Opening page, the setup card

## Context

A business converting to Yosher picks a day its books begin (ADR 0035) and
leaves history where it was. But on that day some money is in flight: an
invoice sent in November that nobody has paid, a feed bill that arrived the
week before. Those are the opening position's receivables and payables, and
the plan ([docs/modules/onboarding.md](../modules/onboarding.md)) said they
should be "real documents, so they age and get paid like any other".

Nothing in the module could take one. An invoice dated in November posts
income in November, which `assertPeriodOpen` now refuses because November is
before the books began; an invoice dated on the start day posts income on
the start day, which double-counts what the old books already reported. And
`isCodableAccount` refuses Opening Balance Equity on a document line by
design, so a person could not even code around it by hand.

On top of that, the pilot farm files on the cash basis, where a prior-year
receivable collected in January IS January's income. Whatever the accrual
entry says, the cash lens has to recognise the collection under the invoice's
own income account.

## Decision

**An opening document is an ordinary invoice or bill with one flag,
`is_opening`, set once by the Opening page and never edited.** It has its
real date (before the books began), its real due date, its customer or
vendor, one line, no tax, no dimensions. It ages by its due date, takes
payments, appears on statements and in reminders, and is voided like any
other. Nothing downstream learns a new kind of document.

**Its issuance or approval is dated ON the start day, and its other leg is
Opening Balance Equity.** `issueInvoice` posts Dr AR / Cr OBE; `approveBill`
posts Dr OBE / Cr AP. The income or expense belongs to the old books; what
the new books inherit is a receivable, a payable, and a plug. The rule lives
in the verbs (`core/opening.ts`), not in the page, so a document made by any
path posts the same way.

**On the cash basis, recognition comes from the document's lines.** The
cash lens already excludes issuance and recognises a document's accrual lines
as it is paid; for an opening document those lines are OBE, which would make
the collection vanish from the P&L. So for flagged documents the lens reads
the invoice or bill LINES instead — the income or expense account the person
chose for exactly this purpose — and the January collection lands under it.

**The Opening page is the one screen for the day, the documents and the
standing.** It hosts the same start-day control as the Close page, a dialog
for each kind of open document, and the accrual trial balance as of the day
with Opening Balance Equity named as the plug. The setup card's "Say when
your books begin" now lands there.

## Alternatives considered

- **A hand journal for opening balances.** Right for a bank balance, wrong
  for a receivable: a journal line to AR does not age, cannot take a payment
  against a customer, and appears on no statement. The plan said "real
  documents" for that reason.
- **Allow the issue date to be before the books began and post income
  there.** Puts the old books' income in the new books and breaks the rule
  ADR 0035 just made. Rejected.
- **Post income on the start day.** Double-counts on accrual — the old books
  reported it — and puts it in the wrong period even on cash. Rejected.
- **Infer "opening" from the date** (issue date before the start day) rather
  than a flag. Moving the start day earlier would silently un-open a document
  whose OBE entry had already posted. A flag written once is honest.
- **Let the cash lens recognise OBE.** The pilot's January P&L would miss the
  income it is taxed on. Rejected; reading the lines costs two queries.

## Consequences

- One migration, `0281`: two boolean columns, default false.
- An opening document carries no dimensions and no tax, and the dialog offers
  neither. A dimension on prior-year income is a report nobody files; tax
  collected before the books began is the old books' liability.
- Opening Balance Equity's balance is the plug until the accountant moves it
  to retained earnings, and the Opening page says so beside the row. Nothing
  moves it automatically.
- Reminders treat an opening invoice like any other overdue invoice. A
  customer who paid the old business on paper and is chased by the new one
  is a real possibility; muting reminders per customer or per invoice already
  exists for it.
- Equipment owned before the books began, and the depreciation already taken
  on it, is the next slice: the asset page, not this one.
