# 0012 — What capitalises stock, and what joins the two records of its cost

- **Date:** 2026-08-21
- **Status:** Proposed
- **Affects:** `inventory` pack — `ledger-ops.ts`, `core/costing.ts` and everything slice 3b posts; accounting module — the general chart, `bill_lines`

> **Scope note.** An earlier draft of this ADR also decided how a CASH-BASIS
> report should treat inventory. That half was wrong and has been removed to
> [ADR 0013](0013-inventory-tax-treatment.md), which makes it a configurable
> policy rather than an inherent property of the word "cash". This ADR is now
> only about what the ACCRUAL books do, which is the same for every tenant.
>
> Two further corrections from review are folded in: an `inventory_item_id` on a
> bill line is **not** a receipt match (see A.2), and a cost correction is an
> appended record rather than a column edit (see A.4). A third correction came
> from the database itself: that record cannot be a MOVEMENT either, because two
> CHECK constraints refuse it.

## Context

`receiveStock` already takes `costCents` — "$340 for 12 bags", off the delivery
ticket. A bill for the same delivery also carries a cost. **These are two
independent records of the same money.** They arrive at different times, they
can disagree in amount, and either one can arrive without the other.

Perpetual inventory needs exactly one of them to capitalise. Get it wrong in
either direction and it is silent:

- **Both capitalise** → the delivery is on the books twice.
- **Neither reliably does** → cost goes missing, and it goes missing
  *permanently*. `issueStock` stamps cost at the moment of issue from
  `itemCostRate` ([ops.ts:1117](../../src/packs/inventory/ops.ts:1117)), and this
  repo's rule is that a stamped cost is never re-derived. Feed issued before its
  bill arrives is stamped `null` and stays `null` while `1300` holds an asset
  that has been eaten.

"Delivery ticket now, invoice at month end, feed it out in between" is an
ordinary farm month, not an edge case.

## Decision

### A.1 — The receipt capitalises

`Dr 1300 Inventory / Cr 2050 Goods Received Not Invoiced`, at the cost recorded
on the receipt.

The stock ledger is the authoritative record of what the business has and what
it cost; the books follow it rather than compete with it. That is already the
pack's premise — cost accumulation is always on, stamped when it happens.

`2050 Goods Received Not Invoiced` does not exist in the general chart and must
be added, with its own `subtype` so it can be identified without matching on a
code (`subtype` is free text, so no enum change is needed).

### A.2 — A bill line CLEARS GRNI, against specific receipts

`Dr 2050 / Cr AP`, allocated to the receipts it is settling.

**An `inventory_item_id` on the bill line is not enough, and assuming it was is
the largest hole in the previous draft.** One item can have three unbilled
receipts at three ticket prices across two lots; one invoice can cover two
receipts; one receipt can be part-invoiced; freight and discounts can span
several items. Without knowing *which receipt, what quantity, what amount*, the
system cannot clear the right GRNI balance, cannot know which lot to supply cost
to, and cannot attribute a variance to anything.

So the link is an allocation, roughly:

```
bill_line_receipt_allocations
  bill_line_id
  inventory_movement_id     -- the receipt being settled
  quantity_matched
  receipt_cost_matched      -- what the ticket said, for this quantity
  invoice_cost_allocated    -- what the invoice says, for this quantity
```

This is also what answers the **bill-first** case. A bill that arrives before its
stock posts `Dr 2050 / Cr AP` with no allocation; the later receipt allocates
against it rather than adding an unmatched credit. Without the table the two
amounts net to zero in the account while remaining unmatched in the records,
which reads as reconciled and is not.

### A.3 — What else posts

Issues post `Dr <consumption account> / Cr 1300`. Adjustments post against the
variance account. **Transfers, splits and merges post nothing** — they move cost
within one account.

### A.4 — A cost correction is appended, never an edit — and it is not a movement

The previous draft proposed that a cost which was never recorded could be
*supplied* by writing into a `null` column, while a recorded cost could never be
changed. Review was right to reject the shape, and the argument against it is in
this pack's own source. [costing.ts:4](../../src/packs/inventory/core/costing.ts:4):

> **COST IS A LEDGER, NOT A COLUMN**, exactly as quantity is.

And the dossier, for quantity: *"A COUNT NEVER EDITS A MOVEMENT. It writes new
ones. What happened, happened; a disagreement is another event rather than a
rewrite of an old one."*

Cost follows the same rule. **A stamped cost is immutable; a correction is an
appended record** carrying its own date, reason and author. This covers the
uncosted receipt (the correction supplies what the ticket never said), the
mis-entered ticket, the omitted freight and the wrong unit of measure — one
mechanism instead of a special case, and no conditionally-writable column for a
future reader to get wrong.

**It is a row in its own table, NOT a movement**, and the database settles that
rather than taste. `inventory_movements` carries two CHECK constraints that a
cost correction cannot satisfy
([inventory.ts:409](../../src/db/schema/inventory.ts:409)):

```sql
check("inventory_movements_quantity_nonzero",   quantity <> 0)
check("inventory_movements_cost_not_negative",  cost_cents is null or cost_cents >= 0)
```

A cost correction moves **no quantity** — it is pure money — so it fails the
first. And it must be able to go **down**, because a ticket can overstate as
easily as understate, so it fails the second. Relaxing either would weaken a
constraint that protects the quantity ledger for every other caller, to
accommodate rows that are not quantities.

So: `inventory_cost_adjustments`, keyed to the lot, with a **signed**
`amount_cents`. `lotCarried` folds it alongside the movements it already folds,
and the cost ledger stays a ledger without the quantity ledger having to pretend
these are movements.

A cost adjustment splits by what has already left the lot:

- the portion **still on hand** raises the lot's carrying value;
- the portion **already issued** goes to the consumption or variance account,
  because sending it to `1300` would capitalise stock that has been eaten.

**That split is STORED, not re-derived**, for the reason a count line stores its
`expected_quantity`: it is what the ledger believed at the moment somebody
corrected it, and a movement backdated tomorrow must not restate a posting that
already happened.

### A.5 — A price difference is recorded, never absorbed

Ticket $340, invoice $352: the $12 lands in a purchase-price variance account.
Silently adjusting the lot to match the invoice would be a rewrite under A.4;
silently leaving it would let GRNI drift with nothing naming why.

### Invariants

These should be assertable, and are the cheapest way to catch a wrong
implementation:

```
GRNI credited by receipts
  − GRNI debited by invoice allocations
  = value of stock received and not yet invoiced

original stamped cost
  + appended cost adjustments
  − cost of quantity issued
  = the lot's carrying value          (== core/valuation.ts carriedValue)
```

The second is the one that keeps the ledger and the valuation screen the same
view. If they diverge, one of them is wrong and the invariant says which.

### The cases this has to handle

| # | Case | What happens |
| --- | --- | --- |
| 1 | Receipt, then bill | Receipt credits GRNI; bill allocates and debits it |
| 2 | Bill, then receipt | Bill debits GRNI unallocated; receipt allocates against it |
| 3 | Partly consumed before the bill | A.5 variance splits per A.4 — on-hand to `1300`, issued to consumption |
| 4 | One invoice, several receipts | Several allocation rows against one bill line |
| 5 | Partial invoice for one receipt | One allocation for part of the quantity; GRNI keeps the rest |
| 6 | Quantity variance | Allocation matches what arrived; the difference stays in GRNI and shows on the reconciliation |
| 7 | Price variance | A.5 |
| 8 | Received, never invoiced | GRNI keeps a credit — a true accrued liability, and the report says so |
| 9 | Invoiced, never received | GRNI keeps a debit — equally visible, and equally worth chasing |
| 10 | Goods returned | A negative receipt, allocated like any other; before or after invoicing is just ordering |

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **No GRNI — the bill capitalises directly** | The first draft of this ADR. Works only when the bill arrives before consumption; otherwise `1300` holds cost for feed already eaten and `issueStock`'s stamp-once rule means it can never be corrected. |
| **No GRNI — the receipt capitalises and the bill expenses** | The delivery is then on the books twice. |
| **Match on `inventory_item_id` alone** | Works only for one receipt against one invoice. Every other case in the table above is unresolvable. |
| **Let the bill overwrite the lot's recorded cost** | Would let a late invoice restate a cost already used to stamp issues — the drift `costing.ts` exists to prevent. |
| **A conditionally-writable `cost_cents`** | The previous draft's A.4. Contradicts the header of the file it governs, and is one `is null` check away from being violated by a well-meaning change. |
| **A cost correction as a new MOVEMENT kind** | The shape this ADR first proposed. The database refuses it twice: `quantity <> 0` rules out a pure-money row, and `cost_cents >= 0` rules out a correction downwards. Relaxing either weakens a constraint that protects the quantity ledger for every other caller. |
| **Full three-way match with purchase orders** | The complete answer, and machinery a farm will not maintain. A.2 and A.5 get the reconciliation and the variance without the third document. |
| **GRNI as an item-level pool, no allocation table** | The genuine fallback if the allocation table proves too heavy: reconciliation in aggregate, no A.4 and no A.5. Cheaper, and it leaves uncosted lots uncosted forever. Recorded here so the trade is visible rather than rediscovered. |

## Consequences

**What it buys.** An accrual set of books where inventory reconciles to the stock
ledger, a GRNI balance that names the gap between what the business has and what
it owes, and one mechanism — an appended movement — for every kind of cost
correction. The invariants above make "are these two views the same?" a testable
question instead of a hope.

**What it costs.**

- **An allocation table is real work**: schema, RLS, a matching UI, and its own
  tests. It is the bulk of slice 3b and it does not exist today.
- **A new account, and one more thing to explain.** "Goods Received Not
  Invoiced" is unfamiliar to anybody who has not used a system that has it, and
  a farmer will ask. The reconciliation screen has to earn it.
- **A second table now feeds the cost fold.** `lotCarried` currently reads
  movements alone; after this it reads movements and adjustments, and any caller
  that reaches for movements directly to compute cost will be quietly wrong. The
  invariant above is what catches that.
- **A.4 cannot recover a stamped `null` issue at the rate that applied then.**
  The already-issued portion is corrected at the adjustment's rate. Over one
  delivery this is immaterial; across a long gap with moving prices it is an
  approximation, and it is one.
- **Matching is somebody's job.** An unallocated GRNI balance is only useful if a
  person looks at it. This ADR creates the number; it does not create the habit.

## What this ADR is least sure of

1. **Whether the allocation table is proportionate** for a farm with one feed
   supplier. The fallback in the rejected-alternatives table is real and cheaper,
   and the honest test is whether anybody ever opens the reconciliation screen.
2. **The cost-adjustment split in A.4** — on-hand versus already-issued — is
   arithmetic nobody in this repo has written yet, and the issued side is an
   approximation as noted. That it needs its own table is now settled by the
   CHECK constraints rather than by argument; what the table's columns should be
   is not.
3. **Whether `2050` is the right code** and whether GRNI should be one account or
   one per inventory account. One is simpler; per-account reconciles more
   finely. Nothing here needs the finer version yet.

## Notes

The first draft of this ADR dismissed GRNI as machinery a farm would not
maintain, and wrote a confident paragraph around the dismissal. It reached that
by tracing one ordering of events — bill, then stock — and never trying the
other. **A design that has only been walked forwards has not been tested**, which
is why this version carries a table of ten orderings rather than a paragraph of
reassurance.

The second lesson is smaller and sharper: the rejected A.4 was refused by a
sentence already sitting at the top of the file it would have changed. Reading
the header of the thing you are about to modify is cheaper than review.
