# 0058. A pay application is an ordinary invoice, and retainage is a negative line to a receivable

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's progress-billing slice as the forcing case

## Context

A contractor bills a fixed-price job against a schedule of values: each pay
application (the AIA G702/G703, which is also a home's draw request with
different words) says how much of each line is complete to date, holds back a
retainage, subtracts what earlier applications already certified, and arrives
at a current payment due. That number has to reach the books: it is money the
client owes, it ages, it gets chased and paid, and the cash-basis lens has to
recognise it.

Accounting already has all of that for an invoice. The question was whether a
pay application IS one, or whether construction billing gets its own
receivable — the way most construction packages ship a "job billing" ledger
beside the accounting one, reconciled monthly by somebody.

## Decision

**An issued pay application is an ordinary Accounting invoice, made through
Accounting's own verbs, and the application remembers which one it became.**

- `issuePayApplication` freezes the certificate's totals and calls
  `createInvoiceDraft` → `issueInvoice` — the same path the platform's own
  revenue takes ([ADR 0043](0043-the-platforms-revenue-is-posted-by-the-webhook-as-the-operators-owner.md)).
  `job_pay_applications.invoice_id` is the link, RESTRICT, and the CHECK
  `(status = 'draft') = (invoice_id is null)` makes "issued but not invoiced"
  unrepresentable.
- The invoice is for the **current payment due**, in two lines the ledger can
  read: the work earned this period to contract revenue (`4030`, else the
  general chart's `4000`), tagged with the project's cost object; and the
  retainage withheld this period as a **negative line to the retainage
  receivable** (`1230`). The entry is therefore Dr AR (net), Dr Retainage
  Receivable (held), Cr Revenue (gross) — the treatment every contractor's
  accountant expects, and exactly what the invoice model already does with a
  negative line.
- **Releasing retainage is the same line running the other way.** A later
  application at a lower rate — the final one at 0% — computes less retainage
  to date than the last certificate held, the "withheld this period" is
  negative, the line is positive to `1230`, and the invoice collects what was
  held. There is no second feature for release.
- The pack never reads Accounting's tables to follow the link. It reads the
  invoice back through `loadInvoice`, voids it through `voidInvoice` (which
  refuses one with payments), and hangs the customer role on the contract's
  party through a new Accounting verb, `ensureCustomerForParty`. Accounting
  learns nothing about pay applications.
- The pack's status is `draft | issued | void` and nothing else. Whether the
  client has PAID is the invoice's business, read from it when shown.

## Consequences

- AR, aging, reminders, statements, payments, deposits and the cash lens all
  see a pay application with no work, because it is an invoice. A job's
  billed revenue is on every report that groups by project, because the line
  carries the dimension.
- A pay application is edited only while a draft. Issued, it is a certificate
  somebody holds, and it is voided — through Accounting, only the latest one
  on the contract, and only while unpaid — never edited in place. Earlier
  certificates are what later ones were computed from.
- A tenant whose chart lacks `1230` cannot withhold retainage until it adds
  the account; the refusal names it. A pack must not create accounts in a
  business's chart on its own.
- Revenue on the books is billings, not percent complete. That is right for
  the completed-contract and small-contractor books this serves; the WIP
  adjustment that trues revenue up to earned is its own slice and posts an
  ordinary journal entry, as the construction dossier already says.

## Alternatives considered

- **A job-billing receivable of the pack's own**, reconciled to Accounting.
  Rejected: a second ledger, with every report needing to learn it and a
  reconciliation nobody asked for. The platform's rule since ADR 0007 is one
  ledger and lenses over it.
- **Post a journal entry directly** (`postEntry`) rather than an invoice.
  Rejected: the amount would be in the ledger and nowhere a client could be
  chased or a payment applied — an invoice is the document, not the entry.
- **Invoice the gross and track retainage off-book.** Rejected: the
  receivable the profile seeds would carry nothing, and the balance sheet
  would show retainage nobody could see.
