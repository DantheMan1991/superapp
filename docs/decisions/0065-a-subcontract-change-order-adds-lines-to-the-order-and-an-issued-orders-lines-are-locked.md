# 0065. A subcontract change order adds lines to the order it changes, and an issued order's lines are locked

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's subcontract change order slice as the forcing case

## Context

Slice 4 gave the client side of a job its one legitimate way to move —
*original + approved changes = revised* — and slice 5c made a
subcontractor's application bill the subcontract's own lines, held by
RESTRICT once a certificate pointed at them. That left the payable side
with a refusal and no door: **a billed subcontract could not be changed**,
because the only edit was to replace its lines, and a general contractor
changes a subcontractor's scope every week. More work found behind a wall,
scope the owner dropped, a price agreed after the fact, the plumber's share
of the owner's CO-3: each is a subcontract change order, and every trade
system has one (Procore's commitment change order, Sage's, a PO revision).

Three questions were open: **whether a change to a subcontract is its own
document or a second kind of the existing change order**, **where its money
lives**, and **what may still be edited once the change is real**.

## Decision

**A subcontract change order is its own row, `job_commitment_change_orders`,
against ONE commitment** — a subcontract or a purchase order, the verb does
not care — with a number unique per commitment, a title, the client-side
statuses (proposed, approved, declined, void) and the client-side rule that
approved has a date and nothing else does. It is not a second kind of
`job_change_orders`: that row has a price to the owner and a cost by code,
two different numbers with a markup between them, and a change to a
subcontract has one number and no markup. It may name the **client's change
order it passes down** — the owner's CO-3 the electrician's SCO-1 is the
electrical share of — and need not, because a business absorbs plenty of its
own; the link is RESTRICT and must be on the same job.

**Its money is lines in `job_commitment_lines`, tagged with the change.**
An order's original lines carry no tag. Nothing is stored twice: what an
order is worth now is original + approved changes, summed from the one table
wherever it is shown — the Ordered table, the order's page, `committedTotals`,
the job cost report's `Ordered` column — through one predicate,
`countedCommitmentLine`: the line was placed with the order, or its change
is approved. A subcontractor's application bills a change's lines exactly as
it bills the original ones, because they are the same rows: an approved
change reaches the open draft on its next edit, after the original lines,
with the change's number beside it; a change taken back takes its draft line
with it; the bill's line names the change.

**A change's line may be negative.** A deductive change — scope taken back —
is a negative line, not a credit concept, the same choice slice 4 made for
the client side. It is the one way a commitment line goes below zero, and
the CHECK says so. On the subcontractor's application such a line runs
backwards: completed to less than nothing and never more, nothing stored
against it, and the database floors on the line's own sign, which the sync
keeps equal to the order's amount while the application is a draft.

**An issued order's lines are locked.** Once an order counts — issued or
closed — its lines are the ORIGINAL half of the line every job cost report
reads, and lines that can still be edited in place make that line
meaningless; so are the lines of an order a subcontractor has billed
against, whose certificates point at them. Either moves by a change order on
the order. A draft's lines are free, and the same lines sent back are not an
edit. The form shows the locked lines and does not send them; the verb
refuses `LINES_LOCKED` behind it.

**A change a subcontractor has billed against is fixed**: it stays approved
and its lines stay as they are (`CHANGE_BILLED`), while its words, dates and
the change it passes down may still change. The RESTRICT on the application
line is the backstop.

## Consequences

- The refusal 5c recorded as an open item now has a door with a sentence on
  it, and the trade's ordinary act — change the sub's scope, bill it next
  month — is two dialogs.
- Every reader of commitment lines carries the predicate. A new roll-up that
  sums `job_commitment_lines` without the join will count proposed changes;
  the ops test that counts a proposed change as nothing is the guard.
- A purchase order takes a change order too, since the row is the
  commitment's and not the subcontract's. It is billed with an ordinary bill
  as before; the change moves what the job has committed and nothing else.
- Back-charges — money deducted from a subcontractor for something the
  business paid on their behalf — are not a change order, and are not built.
  A deductive change reduces the scope; a back-charge reduces the payment.
- The change does not print. A subcontractor's application does not either;
  the day a business prepares one on a subcontractor's behalf, the change's
  lines are on it already.

## Alternatives considered

- **A second kind of `job_change_orders`, with a nullable commitment.**
  Rejected: the client-side row's two numbers are the wrong shape, every
  roll-up would branch on which parent is set, and a cost line there is
  required to carry a code while a subcontract's lines may not.
- **Materialising an approved change's lines into the order on approval.**
  Rejected: two stores for one fact — the change's lines and their copies —
  is how a revised total disagrees with the rows it summarises. One table,
  one tag, one predicate.
- **Adjusting the original lines' amounts in place** for a deduction.
  Rejected: the original stops being the original, the paperwork the
  subcontractor signed no longer matches, and the same line billed under two
  amounts cannot be read back.
- **Leaving an issued order's lines editable** and locking only billed ones.
  Rejected for the reason slice 4 locked a signed value: an original that
  can still change makes *original + approved changes = revised* a line
  nobody can trust. Sage and Procore lock at approval for the same reason; a
  business that wants to fix an issued order before any work starts raises a
  change and says so, which is what it does on paper.
