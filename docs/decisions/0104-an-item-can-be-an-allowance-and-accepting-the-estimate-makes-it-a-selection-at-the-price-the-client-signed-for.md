# 0104 — An item can be an allowance, and accepting the estimate makes it a selection at the price the client signed for

- **Date:** 2026-09-21
- **Status:** Accepted
- **Affects:** Layer 2a — the `jobs` pack, the estimate interview (X12). Joins the estimate's items ([0079](0079-an-estimate-groups-its-lines-into-the-items-the-client-sees-and-a-group-priced-fixed-is-the-price-not-a-cost-to-mark-up.md)) to the selections of [0067](0067-a-selection-is-a-decision-with-an-allowance-and-priced-choices-and-its-difference-moves-by-change-order.md); the assembly carries it the way [0103](0103-a-step-names-the-item-it-always-makes-and-the-item-says-whether-it-is-one-line-or-a-line-per-room.md) carries the line shape.

## Context

The founder, while settling how the walk should write a bid:

> *"one more thing, we ususaly have some items listed as an allowance. things
> like plumbing fixtures etc."*

And, asked the one question that decides the whole design — whether an
allowance is a cost the client is told, or a price:

> *"the allowance is a cost we mark up like everything else."*

**The machinery already existed and had since slice 8.** `job_selections`
(ADR 0067) holds what the contract set aside, what the client chose, and
raises the difference as a change order on the contract. What it had no way of
doing was STARTING: an estimate could not say that an item was an allowance,
so every one had to be read off the signed proposal and typed into Selections
again by hand — and any that was not typed in was simply never reconciled.

## Decision

**An ITEM is an allowance, not a line.** `is_allowance` on
`job_estimate_groups`. An item is what the client buys (ADR 0079), an
allowance is a promise about a price, and a promise needs a name and one
number. A line has neither on its own.

**An assembly can be one, so it never has to be remembered per job.**
`is_allowance` on `job_assemblies`: plumbing fixtures are an allowance on
every bid this business writes. Dropping that assembly makes an allowance
item; a walked phase whose lines came from one makes an allowance item, which
the proposed row carries so that what was reviewed is what lands.

**The client reads it in the words.** The proposal prints
*Plumbing fixtures (allowance)*, composed once in `proposal-model.ts` where
every format's rows are built — rather than as a flag each renderer could
forget. It is also how a builder writes it on paper.

**Accepting the estimate turns each allowance item into a selection**, on the
contract just accepted, with the item's name, its client paragraph and its
cost code when its lines agree on one.

**And the figure is the PRICE.** Not the cost, and not the cost plus markup:
the item's own SCHEDULED figure — its lines marked up and carrying their share
of overhead and profit, the same number printed on the proposal the client
signed. Ten thousand dollars of cost at ten and ten and ten is $13,310, and
$13,310 is what they agreed to spend. Writing $10,000 would have given away
the margin on every allowance in the job and left the later change order
comparing a price against a cost.

**The link is an id.** `job_selections.estimate_group_id`, so accepting twice
cannot make two, an allowance somebody renames is still the same one, and two
jobs may both have *Plumbing fixtures*. The call the walk already made for its
own lines, for the same reason.

## Consequences

- An estimate's acceptance now writes rows outside the estimate. It is one
  transaction, it happens after the estimate is stamped so a failure cannot
  leave a half-accepted estimate, and it is skipped entirely when no item is
  marked — the common case costs one `filter` and no query.
- An item deleted off an estimate leaves the selection standing:
  `ON DELETE SET NULL ("estimate_group_id")`, the PG 15 column-list form,
  because the client agreed to that allowance and the estimate is only where
  it came from. A bare SET NULL on the composite key could never fire.
- `isAllowance` had to be added to `applyProposal`'s whole-form group map, or
  an item somebody marked by hand would have been reset to a firm price the
  next time its phase was priced. That map's own comment says a column left
  out of it is a column reset; this is the third column it has caught.
- An allowance is still a normal item in every other way — it is in the
  total, it is in the budget, it prints its build-up if it is set to. Only
  the client-facing sentence and the selection differ.

## Alternatives considered

- **A line-level flag.** Refused: the client buys items, and an allowance
  needs a name and one figure to be a promise at all.
- **Store the allowance as the COST and mark it up when it is shown.**
  Refused by the founder's own sentence. It would also mean the number in
  `job_selections` and the number on the signed proposal were different, and
  the one thing a reconciliation must not do is compare two different kinds
  of money.
- **Create the selections when the proposal is SENT.** Refused: a sent
  proposal is an offer, and a selection is a decision the client owes — which
  they do not owe until they have accepted. It is also the point at which
  there is a contract for the allowance to sit inside.
- **Match an existing selection by name instead of keeping a link.**
  Refused. This repo has paid for name-matching more than once; a builder
  renames an allowance and two jobs share one.
