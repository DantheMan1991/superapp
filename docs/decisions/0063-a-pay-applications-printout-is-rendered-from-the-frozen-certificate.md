# 0063. A pay application's printout is rendered from the frozen certificate, in the shape everybody knows and in our own words

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's printout slice as the forcing case

## Context

Slices 5, 5b and 5d bill a contract by pay application and post each one as
an ordinary invoice ([ADR 0058](0058-a-pay-application-is-an-ordinary-invoice.md)).
The invoice is what the customer pays from; it is not what an owner, an
architect or a lender asks to see. On a commercial job the contractor
submits an **application and certificate for payment** — nine numbered lines
from the contract sum to the current payment due, a change-order summary, a
certification the contractor signs and a certificate the architect signs —
with a **continuation sheet** behind it, a row per schedule line. The
pilot's AIA pay applications are exactly this, and the form is the same on a
home draw, a cost-plus job and a time-and-materials job, with different
words on a few lines.

Three questions were open: **what the document is a rendering of**, **whether
it is the AIA's form**, and **what a cost-plus or T&M application prints in
place of a schedule**.

## Decision

**The printout is a rendering of the certificate the pack already froze,
generated on request and never stored.** An issued application's five totals
and its line figures are written down at issue (ADR 0058); the PDF reads
them, and a draft's PDF reads the live figures under a DRAFT watermark, a
voided one under VOID. Nothing is saved: a document that could drift from
the row it prints is a second source of truth, and the row already cannot
change. Accounting's invoice PDF made the same choice, and the route, the
fonts and the pure-model-plus-layout split are its.

**It is the shape everybody knows, in this product's own words.** The nine
lines, the change-order summary split at the last certificate, the two
signature blocks and the continuation sheet's columns are the arithmetic of
progress billing, which is nobody's property. The form itself, its text and
its name are the AIA's, and none of them appears: the certification is a
sentence of ours, the title is *Application and certificate for payment*,
and the word AIA is on no page — a test scans for it. A business that must
file the AIA's own form fills it from these figures.

**A cost-plus or T&M application prints on the same two pages with its own
lines.** Line 1 is the guaranteed maximum or the not-to-exceed (or *None*),
line 4 is cost plus fee, or labour, cost and markup, with its parts beneath
it, and the continuation sheet carries the books' cost by code and, on T&M,
the hours by person — the rows the draft editor shows. The figures are the
ones ADRs 0060 and 0062 froze; nothing is recomputed for the page.

**Any member may print.** The route gates on the tenant and the module and
RLS proves the application is theirs; the figures are the ones the contract
page already shows every member. The party the application is made to is
the contract's counterparty, its postal address the party's, when it has
one.

## Consequences

- The document is always current with the row: a void shows VOID, a draft
  re-saved prints its new figures, and there is no file to find, re-send or
  reconcile. The cost is a render per request, which the invoice PDF has
  paid since it shipped.
- The owner's or architect's *Amount certified* line is blank for a pen:
  the pack records what was applied for, not what was certified, and a
  certified amount that differs is a conversation, not a column. Recorded
  as an open item with the architect of record.
- A subcontractor's application (ADR 0061) does not print: it is the
  subcontractor's document, prepared on their side of the table. The day a
  business prepares one on a subcontractor's behalf, it is this renderer
  in the commitment's mode.

## Alternatives considered

- **Storing the PDF in Documents at issue**, as the record the client
  signed. Rejected: the frozen row IS the record, a stored file can only
  drift from it, and the drive would then need a "regenerate" verb the day
  the layout improved. Attaching a signed scan to the application is a
  different, later want.
- **Reproducing the AIA form** so the printout matches the paper the
  architect expects to the line. Rejected: the form is copyrighted and
  licensed per copy, and a business that must file it can transcribe nine
  numbers.
- **A printable page in the browser** (`window.print()` on the contract
  page, as the reports do). Rejected: a certificate is a file that is
  signed, emailed and kept, and a print stylesheet renders differently on
  every machine.
