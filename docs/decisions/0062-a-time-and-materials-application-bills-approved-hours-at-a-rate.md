# 0062. A time-and-materials application bills approved hours at a rate, and the books' cost without them

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's time-and-materials billing slice as the forcing case

## Context

Slice 5b ([ADR 0060](0060-a-cost-plus-application-bills-the-ledger-not-the-bills.md))
bills a cost-plus contract from the ledger's cost tagged to the job, and
closed with the sentence that time and materials "is close to cost-plus with
billing rates in place of cost and would reuse this shape with a rate card".
Time and materials is how a remodeler, a service contractor and most
subcontractors bill: labour by the hour at agreed rates, materials and
everything else at cost with a markup, sometimes under a not-to-exceed. The
pilot bills fixed price; the market does not.

Four questions were open: **where the hours come from and which of them
count**, **what an hour is worth**, **how the cost side avoids billing the
same hour twice**, and **whether this is a second document**.

## Decision

**The hours are Time's.** A worked entry tagged with the job's cost object —
the same `project` dimension member a bill line carries, through
`time_entry_dimensions` — dated on or before the period end, on a timesheet
that has been **approved**. That is the gate the labour accrual already uses
to decide what reaches the books, so what is billed and what the books carry
are the same hours. Paid leave tagged with the job is a cost and never a
charge. Hours on a sheet nobody has approved are counted, said on the draft,
and not billed. Time has to be switched on; the page says so when it is not.

**An hour is worth the rate in force on its day.** Time's rate card carries
`bill_rate_cents` ("what a customer is charged"), effective-dated, and this
slice is its first reader. A contract may instead carry one flat rate for
everybody (`labor_rate_cents`), which is how a small shop quotes. Lines are
keyed by **person and rate**: a person whose rate changed mid-job has two
lines, each exact, because the rate card is dated by the hour's day and hours
never move between rates. A flat rate carries no date, so it is **locked once
an application has issued** — changing it would re-rate hours a certificate
already carries. An hour whose rate cannot be found is a line at a rate of
nothing that **cannot be billed** (`NO_BILL_RATE`, by name), never an hour
given away.

**The cost side leaves the wages accounts out.** A time-and-materials
application's cost lines are cost-plus's — the ledger tagged to the job, by
code, to date, never by window — except that expense accounts of the subtype
the labour accrual posts to (`payroll_expense`: the general chart's `6450`
and `6500`) are excluded, because the hours already bill them and a markup on
top would bill them twice. The fee is the **markup on cost only**, never on
the hours; the guaranteed maximum is the **not-to-exceed** on the lot.

**It is the same row, the same invoice and the same void path.**
`job_pay_applications` gains `labor_to_date_cents`; `job_pay_application_labor`
holds the labour lines beside the cost lines; `costPlusTotals` takes the
labour sum as one more term. The invoice carries a line per person — hours at
the rate through the period end, readable against the timesheet — then cost,
markup and retainage; or one line at the not-to-exceed when the cap holds.
The one-biller-per-job rule (`ONE_COST_PLUS`) covers both methods: cost
belongs to the job, whichever way it is billed.

**Work in progress earns hours at their rates plus the rest of the cost
marked up**, capped, for a job whose only counted contract is time and
materials; the wages among its cost are not earned a second time. An hour
with no rate is a reason of its own (`no_rate`) and blocks the period, since
earning it at nothing would understate the job.

## Consequences

- Nothing has to be set up beyond what Time and the bills already carry: a
  rate on the person or the contract, and the tag on the hour. The daily
  log's crews stay a headcount; the hours that bill are timesheet hours.
- Rates are owners-only in Time (`time_rates_owner_all`), and every verb that
  prices hours is owner-only in this pack, so nothing here widens who can see
  a rate. A draft's labour lines are stored priced, so a member reading the
  contract page sees the figures without reading the rate card. On the live
  WIP schedule a member sees a time-and-materials job with hours as `no_rate`,
  because they cannot tell an unpriced hour from one they may not price; the
  posted schedule, frozen by an owner, is the same for everyone.
- A business that books wages to an account of another subtype (the
  construction chart's `5250 Job Labor` is `cogs`) has told nobody they are
  wages, and would mark them up. The accrual itself posts to `6450`, so a
  business using Time's accrual is right by construction; one posting payroll
  by hand elsewhere is the open item.
- A rate dated back in Time after an application issued moves hours between
  lines, which shows as a credit on the old line and the hours again on the
  new — re-rated in the open, not quietly.
- Unit price remains the one method recorded and billed by nothing.

## Alternatives considered

- **Hours typed on the application** ("40 h carpentry"), with no link to
  Time. Rejected: it would be a second timesheet nobody reconciles, and the
  hours the books already carry through the accrual would be billed by a
  different count.
- **All logged hours, approval or not.** Rejected: billing a customer for an
  hour the business has not yet stood behind is how credit memos start; and
  the accrual uses approval, so the books and the bill would disagree.
- **A rate card per contract** (per person, or per classification: carpenter,
  labourer, foreman). Deferred, not rejected: it is a real arrangement, and it
  would be a table of rates hanging off the contract that this slice's
  per-person-per-rate lines already know how to carry. A flat rate for
  everybody covers the common small-shop case first.
- **Excluding labour by journal source** (`payroll_accrual`) instead of by
  account subtype. Rejected: a payroll journal posted by hand carries no such
  source, and the account is what a bookkeeper sees and can fix.
- **A separate document.** Rejected for ADR 0058's reason, again: one ledger,
  one invoice, one list of applications per contract, one void path.
