# 0079. An estimate groups its lines into the items the client sees, and a group priced fixed is the price, not a cost to mark up

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** founder, reviewing the estimate tool against how a builder actually sells

## Context

[ADR 0069](0069-an-estimate-prices-the-job-before-anybody-signs-and-accepting-it-names-the-contract.md)
gave the pack an estimate of lines, and
[ADR 0070](0070-a-proposal-is-the-estimate-at-its-price-and-its-words-are-fixed-with-the-money.md)
printed it three ways. Put in front of the founder, both were right about
the money and wrong about the sale.

A builder does not sell "320 sf of tile at $4.20, 320 sf of tile labour at
$3.50, two bags of thinset". A builder sells **tile flooring, $8,400**, and
keeps the three lines behind it so they know $8,400 is safe. The client
gets an item and a price; the estimator keeps the build-up. Nothing in the
model could express that: the only grouping the proposal had was **by cost
code**, and a cost code is an accounting fact a homeowner has no use for —
`09 30 00 · Tiling` is not a thing anybody buys.

Estimating has **three axes**, and the model had two:

| Axis | Unit | Who reads it |
| --- | --- | --- |
| Cost | a line — quantity of a unit at a unit cost | the estimator |
| Accounting | a cost code | the office, the books |
| **The sale** | **an item at a price** | **the client** |

The third was being borrowed from the second, which is why the proposal
read like a ledger. A related symptom: **Use as schedule of values** wrote
one schedule line per estimate line, so a two-hundred-line takeoff became
a two-hundred-line G703 that no owner would ever certify, and which
matched no proposal anybody had signed.

Three questions were open: **what a group is**, **what a group's price
means**, and **what the groups do downstream**.

## Decision

**A GROUP IS THE CLIENT-FACING ITEM, AND IT IS ONE LEVEL DEEP.** A new
table, `job_estimate_groups`: a name in the client's words ("Tile flooring,
master and hall baths"), an optional paragraph of client-facing note, a
sort order, and its price rule. A line gains a nullable `group_id`; a line
with none is **loose** and behaves exactly as every line did before this
decision. Depth stops at one, on purpose: every estimating tool that
allowed a real tree became a tree nobody could read on a phone, and a
builder who wants "Bathrooms → tile → material" writes two groups. The
group carries the client-facing words so that the *line* does not have to —
the estimator keeps typing `Tile — mud set, Schluter, mtl only, per AJ
quote 8/14` and the client reads the group.

**A GROUP'S PRICE ROLLS UP, OR IT IS FIXED — AND A FIXED PRICE IS WHAT
PRINTS.** `price_mode` is `rollup` (the default: the children's prices sum,
and each child rides the overhead-and-profit spread as any line does) or
`fixed`, where the estimator types the number the client pays. **A fixed
group is excluded from the overhead-and-profit spread**, so the number
typed is the number printed, to the cent. The reasoning, and the reason
this is not a second way to spell a markup: the model already has a place
for a lump you want *costed* and marked up — a line, quantity one, unit
cost $8,400, ADR 0069's rule. A group's fixed price answers the other
question, the sell price, and a builder who types $8,400 there has already
put their margin in it. Overhead and profit spread across what is left.

The consequence is stated on the screen rather than discovered: when every
group is priced fixed, the estimate's overhead and profit rates have
nothing to spread over and the total is the sum of what was typed. That is
correct and it is said out loud.

**COST IS ALWAYS THE LINES', AND THE MARGIN TELLS THE TRUTH.** A fixed
price changes what the client is asked for and nothing about what the work
costs: every line's extended cost counts toward the estimate's cost,
grouped or loose, fixed or rolled up. So the group shows its own margin —
$8,400 less the $6,950 behind it — the estimate's margin is still total
less cost, and **the budget does not change at all**: it is still cost by
cost code, per line (`estimateByCode`, `setBudgetLines`). Three axes, three
consumers, each taking the one it needs. That is the test of whether this
design is right, and it passes: nothing in the budget, the job cost report
or the books learns what a group is.

**THE SCHEDULE OF VALUES FOLLOWS THE GROUPS.** `Use as schedule of values`
takes a shape — **by group** when the estimate has any (the new default) or
**by line** — and by group it writes one schedule line per group and per
loose line, in sort order, at the group's price with its share of overhead
and profit. This is the repair the founder asked for by name: the schedule
an owner draws against now matches the proposal they signed. A group bills
as a sum; a loose line sold by the unit keeps its unit, quantity and raised
unit price, so a unit-price contract still bills by the quantity (ADR
0064). By line stays available and stays well defined even under fixed
groups: a fixed group's price is spread across its own children in
proportion to their rolled-up price, so the schedule totals the contract
sum either way and there is no error case to design.

**A FOURTH PRESENTATION, `groups`**, which becomes what a custom-home
proposal uses: each group at its price, its note beneath it, the children
nowhere. ADR 0070's `codes` stays — a commercial client does expect a CSI
breakdown — it simply stops being the answer to "show the client a
summary".

`lines` still reads as a takeoff: a ROLLUP group prints as a heading with
its children beneath it. **A FIXED group prints as one row at its price**,
and that clause is not decoration — without it, printing a takeoff of an
estimate with a fixed group would print its children at their shares of
that price, publishing the build-up the typed price existed to hide. Typing
a price is itself the statement that what is behind it is not the client's
business, and it holds in every presentation.

The cent-perfect property ADR 0070 established holds in all four: the rows
add to the total, with a *Rounding* row when unit-price arithmetic leaves
cents.

## Consequences

- One new table (`job_estimate_groups`: name, client note, `price_mode`
  CHECK rollup / fixed, `fixed_price_cents` with a CHECK tying it to the
  mode, sort order) and one new nullable column
  (`job_estimate_lines.group_id`, composite FK, `SET NULL` in PG 15's
  column-list form so a group deleted leaves its lines loose rather than
  failing — the composite-key rule from 0046). Two migrations, schema and
  RLS, the pack's pattern.
- `estimate-math.ts` stays the single pure module and gains an optional
  third argument rather than a second entry point, so **every figure an
  ungrouped estimate reports is what it reported the day before this
  decision**. The pinned lines' values are untouched, which is the proof the
  change is additive; the only edit the suite needed was for the two
  exact-equality assertions to name the two fields the type gained.
- `EstimateTotals` gains `spreadableCents` (the overhead-and-profit base)
  and `fixedCents`, so the base is explicit and testable rather than
  implied by a subtraction.
- The three verbs an accepted estimate feeds are unchanged in meaning:
  accept still sets the contract's value to the total, budget still writes
  cost by code, and the schedule now has a shape. An accepted estimate's
  groups are fixed with its lines and its rates (`ESTIMATE_ACCEPTED`).
- **Not built here, on purpose, each its own slice:** the client-facing
  line title and the line hidden from the client (next slice — a hidden
  line will only be offered *inside* a group, because hidden money must
  have somewhere to hide or the printed rows stop adding up); the
  entry bar, the paste target and per-row saving that make typing one
  fast; the price memory; **assemblies, which are a saved group** and
  which is why they wait for this table rather than arriving with one of
  their own; and the proposal as a section list.

## Alternatives considered

- **A `parent_line_id` on the line instead of a table.** Cheaper — no
  migration for policies — and rejected: a group needs a price rule a line
  cannot carry without its `unit_price_cents` meaning two different things,
  one level could only be asked for politely rather than held by the
  shape, and the arithmetic would have to remember that a parent's own
  figures do not count. A group is a different noun.
- **A fixed group inside the overhead-and-profit spread.** Rejected by the
  founder with the arithmetic in front of him: at ten and ten, a group
  typed at $8,400 prints $10,164, which is a trap, and the honest way to
  ask for that is a lump-sum line.
- **Let a group carry its own cost code.** Rejected: that is the axis the
  group exists to stop borrowing. A group's schedule line takes its
  children's code when they agree on one and none when they do not.
- **Arbitrary nesting.** Rejected above.
- **Group by cost code and give the code a client-facing name.** The cheap
  fix, and rejected as the answer: "Tile flooring, master and hall baths"
  is one item on one job, not a rename of `09 30 00` for every job the
  business will ever run.
