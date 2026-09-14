# 0060. A cost-plus application bills the ledger's cost to date, not the bills

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's cost-plus billing slice as the forcing case

## Context

Slice 5 ([ADR 0058](0058-a-pay-application-is-an-ordinary-invoice.md)) bills
a fixed-price contract against a schedule of values and parked cost-plus,
unit-price and time-and-materials billing as different sums. Cost plus a fee
is the second most common way a custom home or a commercial job is billed:
the client pays what the work cost, plus a fee that is a share of it, a fixed
sum, or both, often under a guaranteed maximum. The pilot bills fixed price;
the market does not, and the work-in-progress schedule
([ADR 0059](0059-work-in-progress-is-a-snapshot-and-a-self-reversing-entry.md))
could not measure a cost-plus job at all.

Three questions were open: **where the billable cost comes from**, **how the
period is bounded**, and **whether a cost-plus application is a second kind
of document**.

## Decision

**The billable cost is the ledger's cost tagged to the job, read as of the
period end and split by cost code.** Every bill, timecard and journal line
that carries the job's cost object is what the application proposes to bill —
through `getBalances` sliced to the job (`withinMemberId`, the same read the
job cost report's `Spent` column makes), never through the bills themselves.
A person may bill less on a line (a disputed bill left out) or less than
nothing (a credit passed on); the books' figure stays beside it.

**Applications bill TO DATE, never by window.** A line carries the books'
figure to date, what earlier issued applications billed of it, and what this
one bills, defaulting to the difference. A bill dated inside an earlier period
and posted late shows up as books greater than billed and goes on the next
application, rather than falling between two windows that were both "closed".
The same shape the G703 has always had — previous, this period, to date —
applied to cost.

**The fee is on the total to date, rounded once**, like retainage: a
percentage of cost to date, plus a fixed fee billed to date by hand, and the
sum is capped at the guaranteed maximum. When the cap binds, the invoice
carries one line that says so rather than two that do not add up to it.

**A cost-plus application is the same row, the same invoice and the same void
path as a fixed-price one.** `job_pay_applications` gains cost and fee to
date; `job_pay_application_costs` holds the lines where `job_pay_application_lines`
holds a fixed-price application's. Retainage, the counterparty, the accounts
and ADR 0058's entry are unchanged. The certificate's five bottom lines are
the G702's with "cost plus fee to date" where "completed and stored to date"
was.

**A job's cost is billed by one cost-plus contract.** Cost belongs to the
project; a second cost-plus contract on the same project would bill the same
dollar twice, and is refused the moment it starts an application. A
fixed-price contract may sit beside a cost-plus one (a design agreement before
a cost-plus build), and its schedule is its own.

**Work in progress measures a cost-plus job as cost plus fee**, capped, with
no estimate asked for — a job on a single cost-plus contract earns what it has
spent plus its fee. A job mixing methods falls through to the fixed-value rule
and is left out with a reason, because its cost cannot be split between the
two.

## Consequences

- Nothing has to be set up before a cost-plus contract bills: the coding on
  the bills IS the schedule. The `Spent` column, the cost-plus application and
  the WIP schedule are three readings of the same tags, which is what makes
  them agree.
- A bill coded to the job but not to a code is billed like any other, as the
  "no cost code" line. The pack does not decide a line is unbillable because
  it is uncoded; that is the person's call, per line, per application.
- The invoice a client receives lists cost this period and the fee as two
  lines, with retainage as a third — readable without the application.
- Unit-price and time-and-materials remain different sums and are not billed;
  a T&M contract is close to cost-plus with billing rates in place of cost
  and would reuse this shape with a rate card.
- The GMAX is not locked when the contract is signed, unlike the value: no
  report yet says *original + changes = revised* for it, and a lock would
  protect a line nobody reads. Recorded as an open item.

## Alternatives considered

- **Rebilling the bills themselves**, line by line, with a "billed" mark on
  each bill line. Rejected: labor comes from timecards and journal entries,
  not bills; a bill split across jobs would need a share; and a mark on
  Accounting's rows would teach Accounting that jobs exist, which ADR 0004
  forbids. The ledger's tags already answer the question for every source at
  once.
- **Billing by window** (the period between two dates). Rejected: a late bill
  falls between windows and is never billed, and every contractor has one.
- **A separate document** — a "cost-plus invoice" of the pack's own. Rejected
  for ADR 0058's reason: one ledger, one invoice, one list of applications
  per contract, one void path.
- **Fee rates per cost code** (labor at 20%, materials at 10%, subcontractors
  at 5%). Deferred, not rejected: it is a real arrangement, and it would be a
  rate per line on the contract rather than a different model. One rate on
  the total is the common case and ships first.
