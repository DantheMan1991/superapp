# 0064. A unit-price application bills quantities at the schedule's prices, and the schedule's value is an estimate

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** founder, with the `jobs` pack's unit-price billing slice as the forcing case

## Context

Slice 1 recorded six billing methods on a contract and slices 5, 5b and 5d
built five of them. **Unit price** — excavation by the cubic yard, pipe by
the linear foot, manholes each — is how civil, utility, paving and
earthwork contractors bill, and how a subcontractor on a lump-sum job is
often paid: a schedule of items with a unit, an estimated quantity and a
price, and each application saying how many of each were installed. The
pilot does not bill this way; the market does, and it was the one method
still "recorded and billed by nothing".

Three questions were open: **whether unit price is a different document or
the schedule with more columns**, **what the contract is worth when the
quantities are estimates**, and **what the person types**.

## Decision

**Unit price is the schedule of values with three more columns.** A
schedule line gains a unit, an estimated quantity (in thousandths, the
grain estimating works to, kept as an integer so every sum is exact) and a
price per unit — both or neither, which the database enforces — and a
unit line's scheduled value is its estimate at its price, computed on save
and never typed. The application, the certificate, the invoice, retainage,
the void path and the printout are the fixed-price ones: `unit_price` joins
the schedule methods, and `UNBILLED_METHODS` is empty.

**The contract's value is the estimate the schedule adds up to.** Unit
price has no fixed sum: the final sum is what is measured. The pack
already lets the schedule and the contract value disagree and says so on
the page; a unit-price job is expected to end above or below its estimate,
and a line's percent complete may pass 100 with its balance negative,
which the certificate prints in parentheses.

**The person types quantities, never money.** An application line on a
unit-priced item carries the quantity completed on earlier applications
(carried, never typed) and the quantity completed this period (typed, may
be negative to correct); its money is that quantity at the line's price,
rounded half up once per line, computed on save from whatever quantity was
typed and ignoring any money that arrived beside it. Stored materials stay
money, because what is stored is what it cost, not a count.

**The invoice reads like a unit-price invoice.** A line per item with the
quantity this period at its price — *Excavation, 600 cy at 18.00/cy* — and
one line for whatever the certificate carries beyond the items (stored
materials coming and going). The printout's continuation sheet carries the
unit, the price, the estimate and the three quantities beside the money.

**Work in progress measures a unit-price job as a fixed-value one**:
cost-to-cost against the estimate. The output method — units installed
over units estimated — is the better measure for this kind of work and is
recorded as the open item it is.

## Consequences

- Every method on the contract now bills. The contract page shows a
  schedule of items for unit price, with unit, estimate and price columns,
  and the application editor a quantity box per item with the money beside
  it, live.
- A quantity is stored in thousandths. A fourth decimal typed is rounded
  away; a quantity of 800.5 lf at 12.50 is 10,006.25 exactly, and the sum
  of lines is the sum of their rounded money, never re-rounded.
- A unit price cannot change once billed against without re-pricing the
  quantities already certified: the schedule editor lets a billed item's
  quantity and price change, as it lets a value change, and the earlier
  applications keep the money they froze. A negotiated price change is a
  new item from a change order, which the schedule already supports.
- Per-unit rounding differences between this pack and a customer's own
  arithmetic are possible on quantities with three decimals; the invoice
  states the quantity and the price, so the difference is visible.

## Alternatives considered

- **A separate unit-price document** with its own lines and its own
  certificate. Rejected for the reason every billing slice has given: one
  ledger, one invoice, one list of applications, one void path.
- **Typing money and showing the implied quantity.** Rejected: a
  unit-price application is a count of what was installed, and the price
  is the contract's; money typed by hand is how quantities and invoices
  drift apart.
- **Quantities as decimals in the database.** Rejected: integer thousandths
  keep every sum exact and every comparison honest, the rule money already
  follows in cents.
- **Refusing a quantity past the estimate.** Rejected: passing the estimate
  is what unit price is for. The page shows the percent and the balance,
  and the certificate prints the overrun in parentheses.
