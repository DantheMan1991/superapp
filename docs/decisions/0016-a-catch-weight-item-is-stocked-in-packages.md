# 0016 — A catch-weight item is stocked in packages and weighed on arrival

- **Date:** 2026-08-25
- **Status:** Accepted
- **Affects:** Layer 2a `inventory` (the lot spine and the movement ledger),
  `production` (run outputs), `retail` (slice 8, unbuilt at the time of writing)

## Context

Meat leaves a freezer as a wrapped package that has a weight, and a farm sells
it **sometimes by the package and sometimes by the pound**. The founder's
framing, 2026-08-25: *"when loading the truck, for retail we will always be
loading packages. not 10 lbs of beef."*

The pack rests on one rule, and it is a good one:

> Every item has exactly one stocking unit and its balance is kept only in that
> unit. Buy feed in bags, keep the balance in pounds.

Applied to ground beef, neither available unit works. Stocked in `lb`, the
on-hand figure and a price per pound are right, while loading the truck reads
*"43.2 lb"* — not an instruction anybody can follow — and counting a freezer
means counting packages and multiplying. Stocked in `each`, the truck, the
count and a price per package are all right, and the stock can never be sold by
weight nor answer how many pounds are in the freezer.

**The item genuinely has two measures.** That is the case `core/units.ts`
already names as the third kind of conversion and refuses:

> A steer goes in at 1,150 lb live and hangs at 690. **That is not a conversion
> at all.** Modelling it as a factor bakes a permanent unauditable fudge into
> the books and every carcass is quietly wrong.

## Decision

**A catch-weight item is stocked in packages, and its weight is a MEASUREMENT
recorded on the receipt rather than a conversion applied to the balance.**

1. The balance is kept in `pkg` — what gets loaded, counted, handed over and put
   back, and a whole number somebody can check by looking.
2. `inventory_movements.weight_lb` holds the TOTAL pounds that arrived, exactly
   as `cost_cents` holds the total money. **Only an inbound movement may carry
   one**, enforced by a CHECK.
3. Pounds anywhere else are `quantity × the batch's average`, folded by
   `core/weight.ts` per LOT, and are reported as approximate.
4. The pounds that were actually SOLD are a `retail` fact on the sale line, and
   never feed back into inventory.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **A second balance in pounds alongside the package count** | Inverts the pack's founding rule and restores the "is it bags or pounds" bug class in the one place it costs real money. Two balances must agree forever and nothing could make them. |
| **A packages-per-pound factor on the item** | Exactly the third kind of conversion `core/units.ts` refuses. Every package is a different weight, so the factor is wrong by construction and unauditably so. |
| **A signed pound ledger — weight on EVERY movement, pounds on hand as the fold** | The tidier idea, and it breaks on the first transfer: a transfer carries no weight, so a freezer would still read 47.5 lb and the truck 0.0 lb after loading half of it. Fixing that means every transfer, adjustment and count line derives a weight — the invented factor, now spread across five writers instead of none. |
| **`inventory_lots.weight_lb`** | A lot can be received into more than once, so a stored batch total is a maintained number that must agree with the ledger forever. ADR 0007 and this pack's own *"valuation is not a column and never will be"* both exist to refuse that shape. |
| **`inventory_packages` — one row per physical package** | The correct food-ERP answer, and enormous: ~38 rows a run, a scale integration, printed labels and scanning at the point of sale. Nobody scans at a farmers market. See Notes for what would force it. |
| **Deriving the weight for an item stocked by mass and storing it too** | Redundant: the quantity already IS the weight and `convert` is exact. Two copies of one number is how they come to disagree. `production_run_outputs` has said so since it was written. |

## Consequences

**What it buys.**

- The truck loads packages with **no change to `retail` at all** —
  `moveStockToTruck` already moves quantity in the item's stocking unit. Counts
  and the till follow by the same mechanism.
- **No new data entry anywhere.** `production_run_outputs` has recorded the pair
  (`quantity` and `weight_lb`) since it was written; `completeRun` was passing
  the count and dropping the weight for want of somewhere to put it.
- Cost per package becomes a more meaningful figure for meat than cost per
  pound, at no cost — the average-cost fold is untouched.
- It opens `retail`'s slice 8 (a price per pound at the till) without either
  pack learning anything about the other.

**What it costs, honestly.**

- **Pounds on hand are approximate and will never reconcile with pounds sold.**
  38 packages at an average of 1.25 lb is 47.5 lb; the actual 38 are each a
  little more or less. **That is what catch weight IS.** One figure is a shelf
  estimate and the other is a transaction record, and nothing should ever try to
  make them agree. `WeightReading.approximate` carries the caveat to the screen
  so no caller can quietly drop it.
- **An item stocked in the wrong unit cannot be corrected once anything has
  moved.** That predates this ADR — `updateItem` has always refused it, and
  correctly — but stocking meat in packages makes the choice consequential for
  a farm that has never had to think about it. The item editor shipped in the
  same slice so the mistake is at least recoverable before the first movement.
- **A weight is optional and most items will never carry one**, so every read
  has to handle "nobody weighed this" as a first-class answer rather than as
  zero. That is the `hasRecordedCost` discipline again, now in a second place.

## Notes

**What would make us revisit.** Per-package serialization
(`inventory_packages`) becomes necessary the moment a buyer demands
package-level traceability, or a farm sells from a plant-printed sticker whose
exact weight has to be reproduced on an invoice. Neither is true of a market
stall, and both are a different, much larger build.

**The lesson worth keeping.** The first two designs written for this were a
stored lot weight and a signed pound ledger, and both failed the same test:
*does any figure here have to agree with another figure forever?* The answer
that survived is the one already used for money — a total on the event, a rate
folded at read time, and null when nobody said.
