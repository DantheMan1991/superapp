# 0075. A change order and an order print from their rows: the change order at its price with the contract sum either side, the order with its changes beneath it

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** founder, with the `jobs` pack's paper slice as the forcing case

## Context

Two documents printed from the jobs pack before this slice: the proposal
([ADR 0070](0070-a-proposal-is-the-estimate-at-its-price-and-its-words-are-fixed-with-the-money.md))
and the pay application's certificate
([ADR 0063](0063-a-pay-applications-printout-is-rendered-from-the-frozen-certificate.md)).
The two documents every builder hands to somebody to sign did not: the
change order the client approves, and the purchase order or subcontract
the vendor accepts. The open items had carried "a change order on an
order does not print" and "a change order does not print" since the
change-order slices, and a builder who cannot print a change order
retypes it in a word processor, which is where the numbers stop agreeing
with the books.

Three questions were open: **what a client change order shows**, **what
an order shows once it has been changed**, and **whether either prints
from a frozen copy**.

## Decision

**THE CHANGE ORDER SHOWS ITS PRICE, NEVER ITS COST.** A change order
carries lines by cost code that say what the change is expected to cost
the business (the budget side, ADR 0060's slice 4). The client sees the
change described, its price, the contract sum before it and the contract
sum after it, and signs. The lines, the codes and the word cost appear
nowhere on the page, and a pure test scans the model for the words as the
proposal's does.

**THE CONTRACT SUM READS AS A LADDER.** For an approved change, "before" is
the contract's signed value plus the approved changes that came before it
— by the day approved, then by which was raised first — so a stack of
approved changes prints with each one's "after" the next one's "before",
and the last "after" is the revised contract sum the job's page shows. For
a change not yet approved, "before" is the signed value plus every
approved change: the sum as it stands the day the client reads it. A
contract with no signed value (a cost-plus contract) prints the change
alone.

**THE ORDER PRINTS AS PLACED, WITH ITS CHANGES BENEATH IT.** The order's
own lines — the ones it was placed with — are the table, with their cost
codes when any line has one; every change order on the order is listed
under it with its amount and where it stands, and only the approved ones
are in the total. A subcontract carries two signature blocks; a purchase
order carries the business's alone.

**BOTH PRINT FROM THE LIVE ROWS, NEVER A FROZEN COPY.** An issued order's
lines are locked (ADR 0065) and an approved change order's value is the
agreement, so the live rows are the frozen copy; a proposed change or a
draft order prints with a watermark saying so (PROPOSED, DRAFT), because
the document is the thing the other side signs to make it stand.
Rendered on request, never stored, as the proposal is.

**ONE LAYOUT, TWO MODELS.** Both documents are one pure model shape —
title, facts, the two parties, sections, a table when there are lines,
the money in one block, a closing the page never splits from its
signature lines — built by two pure functions and laid out by one file in
the proposal's own styles. A third document is a third model function.

## Consequences

- Two GET routes, `/api/jobs/change-orders/[id]/pdf` and
  `/api/jobs/commitments/[id]/pdf`, with the proposal's gates; a Print
  icon on every row of the Changes and Ordered tabs, and a Print button on
  the order's page. Any member may print.
- The vendor's address comes from the books' vendor record, the client's
  from the customer record, the way the proposal's does; a party the books
  have not billed or paid prints by name alone.
- The order's cost codes are resolved by the lines' own code ids rather
  than through the job's code set, so an order on a job with no set still
  prints its codes.
- Not built, on purpose: the subcontractor's own application as a document
  (theirs to prepare), sending either document by Mail, a signed copy
  attached back to the row (the file doors from the record-files slice are
  the seam), and the business's own address on the FROM block, which no
  printed document carries yet.

## Alternatives considered

- **Print the change order's cost lines.** They are the business's
  estimate of its own cost and would hand the client the margin.
- **Freeze a copy of the order at issue.** The rows are already locked at
  issue; a second copy is a second thing to keep in step.
- **Add each change's lines into the order table.** A vendor reading an
  order wants what was placed and what changed, not one merged list that
  hides which is which.
- **A separate layout per document.** The proposal's page already had the
  shape; the certificate's differs because it is a form the trade knows.
