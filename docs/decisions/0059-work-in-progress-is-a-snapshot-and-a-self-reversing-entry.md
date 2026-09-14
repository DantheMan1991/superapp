# 0059. Work in progress is a snapshot and a self-reversing entry

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's WIP slice as the forcing case

## Context

A contractor's revenue on the books is what has been billed (ADR 0058: a pay
application is an invoice). Billing runs ahead of the work on some jobs and
behind it on others, so a profit and loss made of billings swings with the
draw schedule rather than the work. The work-in-progress schedule is how the
trade corrects that at a period end — percent complete, earned revenue, and
the over- and under-billing that a bank and a surety read first on a
builder's statements — and the construction dossier had already found that it
cannot be a basis lens: a lens may drop an entry or re-point a line, and never
invent one, and over/under billing is an invented entry.

Three questions were open: **what percent complete is**, **what the period's
inputs are and where they live**, and **what the entry looks like** — one
cumulative balance adjusted each period, or an entry per period.

## Decision

**Percent complete is cost-to-cost.** Cost to date over the estimated total
cost, capped at 100%; a finished job is 100% whatever its cost says. It is the
input method a bank and a surety expect, the one ASC 606 names first for a
contractor, and the only one whose inputs the books already hold. A percent
somebody types is an opinion; a percent the ledger computes is a fact somebody
argues with by re-estimating the cost — which is what a monthly WIP meeting is
for.

**The one human input is the re-estimated total cost, per job, per period.**
`job_wip_lines.estimate_cents`, null meaning "the revised budget stands". A
business that never re-estimates types nothing and gets the budget; a
commercial GC whose surety wants a monthly cost-to-complete types one number
per job. Nothing else on the schedule is typed.

**A period is a snapshot, per company.** `job_wip_periods` is one row per
company per date; its lines hold the figures WRITTEN DOWN when it posted, so
the schedule a bank was shown reads the same next year whatever the ledger has
become. A draft's figures are live; a posted period's are frozen — the rule an
issued pay application's totals follow.

**The entry is posted per period and reversed the next day.** One pair of
lines per job, tagged with the job: `Dr 1240 Costs in Excess of Billings / Cr
revenue` for a job billed behind its work, `Dr revenue / Cr 2420 Billings in
Excess of Costs` for one billed ahead, never netted across jobs. Both entries
carry the `wip_adjustment` source and name the period. Because each period's
entry is the WHOLE over/under and reverses itself, every period is
self-contained, the books between period ends carry billings, and the ledger's
own revenue-by-job read as of any later period end nets the earlier
adjustments to nothing — which is what lets the pack read billings from the
ledger with no filter and no knowledge of its own earlier entries. Periods
post forward only, and only the latest one unposts, for the same reason a
close is reopened latest-first.

**Under the cash basis the adjustment does not exist.** The pack registers a
basis-lens provider that drops every `wip_adjustment` entry whole. That is the
lens doing what it is for — saying an entry does not belong in a basis — and
does not contradict the finding above, which is that a lens may not create
one.

## Consequences

- Statements as of a period end carry earned revenue and the two balance-sheet
  lines; statements between period ends carry billings. A P&L by job at a
  period end reads what the job earned, because every line is tagged.
- `wip_adjustment` is in `MANAGED_SOURCES`: the journal refuses to void
  either entry, because the period row says `posted` and points at both. The
  pack's unpost voids the pair and resets the period, keeping the estimates.
- A job that cannot be measured — no budget and no estimate on an unfinished
  job, or billings on a job with no fixed contract value — stops the whole
  period from posting, by name. A schedule missing a job is exactly what a
  bank would not accept, and posting the rest quietly would be worse than
  refusing.
- A completed job stays on the schedule only until it is fully billed. A
  schedule of every job ever finished stops being readable within a year; the
  schedule of completed contracts a bank sometimes asks for is a different
  report and not built.
- Cost-plus, unit-price and time-and-materials jobs cannot be measured this
  way and are not: a job with no fixed value is shown and left out, and one
  with billings refuses. When those billing methods are built (jobs open
  items), the schedule needs a second method for them.

## Alternatives considered

- **One cumulative balance in 1240 and 2420, adjusted by the difference each
  period.** The common bookkeeper's practice. Rejected because it makes the
  ledger's revenue-by-job read carry every earlier adjustment, so the pack
  would have to filter its own source out of every read and keep a running
  reconciliation between the accounts and the schedule; the self-reversing
  form gives the same statements at every period end with none of that.
- **A typed percent complete per job.** Rejected as the default: a figure
  nobody can argue with from the books. Left open as a later override for a
  business that measures by units delivered or an engineer's estimate; the
  line would carry a second nullable column, not a different model.
- **Computing the schedule live with no snapshot.** Rejected: a schedule
  somebody sent to a bank must not change when a late bill lands, and the
  re-estimate is a human input that has to live somewhere.
- **A basis lens that recognises percent-complete revenue.** Rejected before
  this slice (construction.md, the basis-lens finding): a lens may not invent
  an entry.
