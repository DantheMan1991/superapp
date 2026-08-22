# Inventory: when should the cost be deducted?

> A template to hand to a client's accountant, one business at a time. **Written
> to be sent, so it does not follow the house documentation style** — plain
> sentences, no jargon, no internal shorthand. Fill in the business name and
> delete any category the business does not hold.
> Status: `brief` · Scope: `platform`
>
> The reasoning behind it is [ADR 0013](../decisions/0013-inventory-tax-treatment.md),
> which is Proposed and stays that way. **This is not a question the platform
> answers once.** The setting is per business, so the answer belongs to whoever
> prepares that business's return. If nobody ever answers it, the software keeps
> every underlying fact and makes no claim about timing, which is the design and
> not a fallback.

---

## Inventory and supplies: when should the cost be deducted?

**Business:** _______________________

We've built inventory tracking into the bookkeeping software this business uses.
It records purchases, quantities received, what they cost, what has been used or
sold, and what's still on hand.

We need your guidance on when those costs should be deducted for tax. We're
asking rather than guessing, because a wrong answer here still balances and still
looks right on every report.

Most of what we need is one table. It's near the end.

## What the software does today

Two things, and every business starts with the first.

**Stock does not reach the ledger.** Costs are still tracked, so we can always say
what a batch cost and what's on hand. Nothing posts.

**Stock is an asset.** A delivery is recorded as Inventory, with the amount owed
sitting in a holding account until the supplier's bill arrives. The bill clears
that account. The cost reaches the profit and loss when the item is used or sold.

The second is the only treatment built so far. We're not calling it the safe
choice. Doing nothing is still adopting a method, and moving off it later may be
a formal change rather than a settings edit. What is actually safe is that we
keep every underlying record, so any timing rule can be applied later.

## What we can date

We can attach any of these dates to a purchase, because the system already
records them:

* when the bill was dated
* when it was paid
* when the item was used or consumed
* when it was sold to a customer
* the later of payment and use
* the later of payment and sale

We can also keep beginning and ending quantities and values for any period.

If the right rule needs a date that isn't on that list, please say so. We'd
rather add it than approximate it.

## What we'd like to confirm first

1. The method this business uses for tax, cash or accrual.
2. Whether it's a small business taxpayer under section 448(c).
3. What inventory or section 471(c) treatment its returns already show.
4. Whether adopting anything different would be a change in accounting method
   needing Form 3115 or a section 481(a) adjustment.

Point 4 matters to us more than it might seem. We've built the software so a
treatment cannot be changed casually once it's in use, and we don't want to treat
a method change as if it were a settings edit.

## The table we need back

For each category the business holds, when does the cost become deductible?

| Category | Examples | When is it deducted? | Which expense account? |
| --- | --- | --- | --- |
| Feed and animal supplies | Feed, minerals, bedding | | |
| Crop inputs | Seed, fertiliser, chemicals | | |
| Veterinary supplies | Medicine, treatment supplies | | |
| Production materials | Packaging, ingredients that go into a finished product | | |
| Goods bought to resell | Finished products sold on without much change | | |
| Small shop supplies | Consumables nobody keeps usage records for | | |

Two notes on that table:

**We expect the answers to differ by row.** Our reading is that goods held for
resale may turn on the sale in a way feed does not. If that's wrong, one answer
for everything is easier for us, so please say so.

**The account column is not a formality.** "All of it to cost of goods sold"
produces a report that balances and is no use at return time. Every item in the
system already carries a category, so we can route each one wherever you say.

## Three specific questions

**Payment plus use.** We understand some treatments need both payment and use or
sale to have happened, whichever is later. Please confirm whether that applies
here. If it does, we can already tell whether a purchase has been paid, with one
exception: on a bill that's only part paid we know the bill isn't settled but not
which line the money reached. We need a convention. Either nothing on the bill
counts as paid until the whole bill is, or we pro-rate. Please pick one.

**Prepaid supplies.** We understand there may be limits on deducting feed or
other farm supplies bought in one year and used in the next. If there are tests
the software should flag, please tell us what to watch for.

**Books versus tax.** We can keep the financial statements on one treatment and
produce the tax numbers on another, or we can make the ledger follow the tax
treatment directly. The first is how the software is built. Please confirm that's
acceptable, or tell us you'd rather they match.

## What we're not asking you to do

Design anything. If the categories above are the wrong cuts, or one of them isn't
a real choice, telling us that is the most useful answer we can get.

Happy to walk through the software or send the technical write up.
