# 0076. A warranty claim is the record of a call, its work is a Work item, the period is the job's, and a claim outside it is said, never refused

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** founder, with the `jobs` pack's warranty slice as the forcing case

## Context

The construction plan's last row was `warranty`, `bonding` and
`certified-payroll`, "last, and certified-payroll may not belong in
software at all". Warranty is the one of the three every builder in the
survey lives with: the job closes, and for a year or two the owner calls
about a drip, a cupped board, a crack — and the builder has to know
whether the call is inside the warranty, who to send, what it cost, and
which trade it comes back to. Today that lives in a text thread and a
memory.

The questions were **where the period lives**, **what a claim is**,
**how its work is chased**, **where its cost lands** and **what a claim
outside the period does**.

## Decision

**THE PERIOD IS THE JOB'S.** Two columns on the project — the months the
business warrants its work, and the day of substantial completion — and
the expiry DERIVED from the two (`warrantyExpiresOn`, calendar months
with the day clamped to the month's last), never stored. One period per
job, the general warranty; the 1-2-10 tiers some builders carry and a
per-contract warranty are refinements nobody has asked for, and a column
per tier would be an industry branch in the schema. Owner-set, because it
is a term of the agreement.

**A CLAIM IS THE RECORD OF THE CALL.** What is wrong, where, when it was
reported and by whom, the trade the business holds responsible (a party,
so the subcontractor on the job's order is the same row), the cost code
the fix is charged under, and the decision — covered, not covered, or not
yet — with its day and reason. Numbered per job in the order recorded,
which is how a claim is referred to out loud. Any member records one;
the person who takes the call is rarely the owner.

**ITS WORK IS A WORK ITEM, LINKED TO THE CLAIM.** Recording a claim raises
an ordinary Work item at once — somebody has to go and look whatever the
decision turns out to be — the same row the daily digest chases and the
Work module assigns and dates. The link is to the CLAIM, a registered
entity type of the pack's provider, not to the job: so the Work module
names which call it is, and the job's punch list stays the punch list
(a pin's punch item links to the job, ADR 0073). The claim remembers the
item in `work_item_id`, SET NULL in the column-list form; an item cleared
from Work leaves the claim as the record of the call, and the next tick
raises the work again.

**WHERE A CLAIM STANDS IS DERIVED.** Not covered by the decision,
whatever the work says; otherwise done, scheduled or open by the Work
item — closed, dated, or neither. Nothing stores a status, so the tick in
Work and the tick on the claim are one fact. Not covered closes the work
item: going to look was the work, and the claim's row says the rest.

**THE COST IS THE JOB'S.** A claim names a cost code and the job cost
report already shows what was spent under it; the Warranty tab reads that
figure from the report for the codes its claims name and keeps no ledger
of its own. A claim with no code is a claim whose cost the office codes
when the bill arrives.

**OUTSIDE THE PERIOD IS SAID, NEVER REFUSED.** A claim reported after the
expiry is recorded and marked *Outside the warranty period*; the builder
decides what the warranty covers, and fixes things as goodwill every
week. A claim reported before substantial completion is inside: a defect
found early is still the builder's.

## Consequences

- One table, `job_warranty_claims`, member-wide under RLS; two nullable
  columns on `job_projects`. A Warranty tab on every job and a Warranty
  page across jobs: the open claims with their jobs, and every job under
  warranty soonest to end first, with *Ending soon* inside sixty days so
  the last walk-through gets booked before the period does.
- The Work module gains a linkable type it did not know: a work item or a
  calendar item can point at *Warranty claim 3 · 24-109* and open it.
- Removing a claim is an owner's, and leaves its work item in Work,
  unlinked: the item may already have been worked.
- Not built, on purpose: a back-charge to the responsible trade (the open
  item from ADR 0065 still stands; a claim names the trade, which is the
  first half of it), warranty tiers, a per-contract period, telling the
  owner by Mail, and the manufacturer's warranty on a product, which is a
  document in the cabinet.

## Alternatives considered

- **A status column on the claim.** It would drift from the Work item the
  moment somebody ticked the item in Work; deriving it is the same rule
  the punch list follows.
- **Link the work item to the job, as a punch item.** It would land on
  the job's punch list beside pre-closeout items, and the Work module
  would say only which job, not which call.
- **A warranty ledger — cost typed on the claim.** A second place for a
  number the bill already carries; the job cost report is the ledger.
- **Refuse a claim after the expiry.** The expiry is what the contract
  says; what the builder does about a late call is the builder's, and the
  software's job is to say which side of the line it fell on.
- **The period on the contract.** A job with a design agreement and a
  construction contract would need the period on one of them and the
  claim to know which; substantial completion is a job milestone, not a
  contract's.
