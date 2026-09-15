# 0067. A selection is a decision with an allowance and priced choices, and its difference moves by change order

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's selections slice (construction plan slice 8) as the forcing case

## Context

A custom builder writes **allowances** into the contract — "$12,000 for
flooring, $8,500 for plumbing fixtures" — for things the client has not
chosen when the price is signed, and reconciles each against what was
picked: the overage is billed, the underage credited. A production builder
offers an **option book** — standard laminate included, quartz +$3,200,
granite +$4,100 — and the buyer's picks add to the base price. Both spend
their weeks chasing decisions against a schedule: the tile has to be chosen
by the fifteenth or it will not be on site when the setter is. The plan
called this slice 8 and asked for one mechanism covering "the production
option book and the custom selection process".

Three questions were open: **whether the two trades share a model**,
**where the money lives and how it reaches the books**, and **what the
pack decides on its own**.

## Decision

**One model: a SELECTION and its CHOICES.** A selection is a decision the
client owes — a name, the room, the cost code, the **allowance** the
contract already holds for it, the date it is **needed by**, and a status
(pending, selected, approved, cancelled). Its choices are what is on offer:
each with a description, a supplier if there is one, a reference, a price
by the unit (320 sf at $4.20, the unit-price rule of ADR 0064) or as a sum,
and a flag marking the one the client picked — **at most one per
selection, at the database**, by a partial unique index. A production
option is a selection whose allowance is the standard's price and whose
choices are the upgrades; a custom allowance is a selection whose choices
are whatever came back from the showroom. Same two rows, same page.

**The difference is computed, never stored, and it moves by change order.**
The chosen price less the allowance is worked out wherever it is shown, and
counts once the client has chosen. Once the builder has **approved** the
choice, the difference is raised as a **change order on the selection's
contract** — slice 4's row, through slice 4's own owner verb: the overage
as the change's price to the client (an underage as a credit), and one
cost line moving the selection's cost code by the same amount. The
selection remembers which change order it raised, so the difference cannot
be raised twice while that stands; **while it stands, the allowance and the
choices are fixed**, because the change order was priced from them, and a
voided change order frees them. Nothing bills on its own: a business that
reconciles allowances at the end rather than as it goes raises them later.

**A selection belongs to the job; its money to a contract.** The room is
the job's; the allowance is a contract's, because that is the price it is
inside. The contract is nullable — a selection list is drawn up during
design, before the build contract exists — and a selection with no
contract has nowhere to raise its difference and says so.

**The reminder is Work, linked to the selection**, not to the job's punch
list, which is what still needs fixing on site. A pending selection past
its date is overdue on the page; one click raises the item. Samples and
spec sheets are Documents attachments on the selection, the shared gallery.

**Drawing up the list and recording the choice is a member's chore**, as
the daily log is; the one decision — raising money against a signed
contract — is the change order's owner gate.

## Consequences

- The job gets a Selections page — the five numbers (allowances, chosen,
  over or under, to raise, raised), the table, the dialog with the choices
  — and a Selections panel on its page saying what the client still owes.
- Every change order raised from a selection is an ordinary change order:
  it appears in the job's Change orders panel, moves the contract value and
  the budget when approved, and reaches the next pay application the way
  any change order does. The pack has no second billing path.
- Unit-priced choices use the same thousandths and rounding as unit-price
  billing, so a choice and a schedule line for the same tile agree.
- The tenant-level **option book** — a catalogue of selections with their
  choices that seeds a new job — is the next slice (8b). This one is
  per-job; a production builder enters the standard and the upgrades on the
  job until then.
- A **client portal** for the client to choose from is not built, and
  nothing here presumes one: the office records what the client said.
- The selections panel shows on every job. A project template that turns
  the workflow off for a delivery method that has no selections (the
  plan's `workflows` field) is later, and the panel's empty state costs
  one line.

## Alternatives considered

- **Two models**, an option catalogue for production and an allowance
  ledger for custom. Rejected: the plan's own test — every difference
  between delivery methods is a value, not a branch — and the two are the
  same rows with different numbers in them.
- **Storing the overage on the selection and posting it to the invoice
  directly.** Rejected: a second way for a signed value to move, beside the
  change order the client signs. The change order is the paperwork the
  overage becomes on every builder's desk.
- **Letting the difference be raised from a selected selection**, before
  approval. Rejected: the client choosing and the builder confirming the
  price are two acts, and raising money on the first is how a showroom
  quote becomes a change order the builder has not checked.
- **Many chosen choices per selection.** Rejected: one decision, one price.
  Two tiles in one bathroom are two selections.
