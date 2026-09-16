# 0077. A back-charge is money the business spent that was the subcontractor's, kept back from their next application, and never a change to the order

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** founder, with the `jobs` pack's back-charge slice as the forcing case

## Context

[ADR 0065](0065-a-subcontract-change-order-is-the-orders-own-lines-tagged-with-it.md)
closed subcontract change orders and left one thing open, in its own
words: a back-charge "is not a change to the scope and is not built; it
is a negative line on the application with its own account, the day a GC
asks". The warranty slice
([ADR 0076](0076-a-warranty-claim-is-the-record-of-a-call-its-work-is-a-work-item-the-period-is-the-jobs-and-a-claim-outside-it-is-said-never-refused.md))
then made the day arrive: a claim names the trade held responsible, and
the first question after "who" is "so how do I get the money back from
them".

The open questions were **what a back-charge is**, **where the money
goes**, **when it reaches the books**, and **what happens when it comes
to more than the payment it is coming off**.

## Decision

**IT IS A RECORD ON THE ORDER, NOT A DEDUCTIVE CHANGE ORDER.** The
subcontract still says what the subcontractor agreed to do for what
money; the business paying for part of it does not restate that
agreement. So `job_back_charges` hangs off the commitment — which names
both the subcontractor and the job — with what was paid for, how much,
when, the cost code it landed on, and the warranty claim it came from
when it came from one. Numbered per order. Always positive: a
back-charge only ever runs one way, and one raised in error is dropped
rather than negated.

**IT COMES OFF THE BOTTOM OF AN APPLICATION, AND THE CERTIFICATE ABOVE
IT STAYS GROSS.** The schedule of values, what is complete to date, the
retainage held and "less previous certificates" are all about the WORK,
and the work is unchanged by who paid for some of it. So
`job_sub_applications.due_cents` keeps storing the gross payment due and
`certifiedCents` is untouched — **which is the invariant that stops the
deduction being taken twice.** Netting a back-charge into the
certificate would deduct it once on its own application and again by
leaving that much apparently still due on the next one.

**WHERE IT STANDS IS DERIVED.** `sub_application_id` says which
application it rides; the standing is read from that application's
status — none is open, a draft is on that application, a billed one is
deducted and final — with `void` the only stored state, for the
back-charge dropped or conceded. The punch list, the lien waiver and the
warranty claim all derive their standing the same way.

**IT REACHES THE BOOKS EXACTLY ONCE, AS ITS OWN NEGATIVE LINE.**
Approving the application it rides adds one line per back-charge to the
bill: negative, against the subcontract expense account, tagged with the
job **and the cost code the money landed on** — so the job cost report's
spend on that code nets out, which is the figure a builder actually
reads. One line each, never one lump: a bill has to say what for.
Voiding the application voids the bill and frees the back-charges, which
are owed again.

**MORE THAN THE PAYMENT REFUSES, BY NAME.** Back-charges that come to as
much as the application does or more would make a negative bill. The
verb refuses with both figures and the answer — take some off and deduct
them on a later application — rather than inventing a debit memo.

## Consequences

- Owner-only throughout, as every verb on a subcontract's money already
  is: the person who notices the mess is rarely the person who decides
  to charge for it.
- Subcontracts only, for the reason applications are: a purchase order is
  billed with an ordinary bill in Accounting and has no application for a
  deduction to ride on. The database does not know the difference, which
  is the compensating control the ops test proves.
- A Back-charges panel on the order's page, the amount actually paid on
  the applications table, and a line on the warranty claim saying what
  has been charged back to the trade and whether it has been taken yet.
- `commitmentBilling.billedCents` stays gross too: what a subcontractor
  has been billed for is the work certified, not the cash that reached
  them.
- The expense account is the subcontract one, not the account the
  original cost was booked to. The job's cost by CODE nets exactly; the
  profit and loss account split does not, and a business that wants the
  original account credited enters that in Accounting. No account is
  invented in anybody's chart.
- Not built, on purpose: telling the subcontractor by Mail, a
  back-charge against a supplier's purchase order, splitting one across
  two applications, and disputing one as a state of its own — a disputed
  back-charge is dropped, with the reason, and charged again if it
  survives the argument.

## Alternatives considered

- **A deductive change order.** It is the tool already in the pack and
  it is the wrong one: it would restate the scope the subcontractor
  agreed to, and the order's total would stop being the agreement.
- **A negative line typed on the application**, as ADR 0065 sketched.
  Nothing would remember the money between the day it was spent and the
  day it came off, which is exactly the gap the office is trying to
  close.
- **Netting it into the certificate.** Simpler to render and wrong: the
  next application hands the money back.
- **Its own income or contra account.** A new account in every tenant's
  chart to record a recovery the job cost report already shows by code.
- **Allowing a negative bill.** A debit memo is a real instrument and a
  much larger change to Accounting than this slice earns.
