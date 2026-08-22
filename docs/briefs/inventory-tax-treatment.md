# Inventory: when should the cost become a deduction?

> A brief to hand to an accountant. **Written to be sent, so it does not follow
> the house documentation style** — plain sentences, no jargon, no internal
> shorthand. The technical version is
> [ADR 0013](../decisions/0013-inventory-tax-treatment.md), which is Proposed and
> should not be Accepted until this comes back answered.
> Status: `brief` · Scope: `platform` <!-- keep Status on ONE line — /admin/docs parses it -->

---

## What this is

We've built stock tracking into the bookkeeping software this business runs on.
It records what was delivered, what it cost, what's still on the shelf and what
has been used.

There's one question we can't answer ourselves. When does the cost of that stock
become a deduction? We'd rather ask than guess, because a wrong answer here still
balances and still looks right.

We need about twenty minutes of your time.

## What the software does today

Two settings, and every business starts on the first one.

**Off.** Stock doesn't reach the books at all. Costs are still tracked, so we can
always say what a batch cost and what's on hand. Nothing posts to the ledger.

**On.** Stock is an asset. A delivery is recorded as Inventory, with the amount
owed sitting in a holding account until the supplier's bill arrives. The bill
clears that account. The cost reaches the profit and loss when the stock is
actually used or sold.

That second one is the only treatment we've built so far. It's also the safest
one to have running while this is undecided, since it doesn't claim anything
about timing that we haven't been told.

## The question

Which of these is right, and are these even the right choices to offer?

**1. Stock is an asset. The cost lands when it's used.**
Built and running. Nothing changes if this is the answer.

**2. The cost lands when the money left.**
Not built. We'd build it if you tell us it's right. Roughly a week's work, and
the design is already written.

**3. The deduction turns on the stock being used, and on it having been paid
for.**
Not built, and we've written down that it's missing rather than approximating it.
It would need us to track payments down to each individual batch, which we don't
do. If this is the answer for this business, tell us now, because the honest
position is that the software can't do it yet.

We're not asking you to pick from a menu we've decided is complete. If the useful
cuts are different, or if one of these isn't a real option, that's the most
valuable thing you can tell us.

## If the answer is option 2, we need one more thing

"Put it all to cost of goods sold" produces a report that balances and is no use
at return time. Feed, seed and veterinary supplies want to be separate lines.

We can map each kind of item to its own expense account. Every item in the system
already carries a kind. So we need to know which accounts you want those kinds
landing in, and we'll wire it up once.

## Two things we're not assuming

**Cash or accrual doesn't decide this.** We had it the other way round in an
early draft and it was wrong. Our reading is that two businesses both correctly
on the cash method can owe different answers here, which is why this is a setting
of its own rather than something we infer. Tell us if that reading is off.

**Goods held for resale might not follow the same rule.** There's a retail side
that sells finished product, and our understanding is that merchandise held for
resale is the case where the sale still matters. If feed and shop stock want
different answers, say so and we'll make it settable per item rather than per
business.

## What happens if nobody decides

The safe setting keeps running. Stock stays an asset and the cost lands when it's
used. That's a real answer rather than a placeholder, but it may not be the one
you'd elect, and the difference shows up as timing.

## One gap worth knowing about before you pick

We haven't built anything for changing method later. If this business ever
switches treatment there's an adjustment to make, and today that would be done by
hand. Worth factoring in if two options look close.

---

## What we need back

1. Which treatment, and whether the three above are the right choices to offer.
2. If it's option 2, the expense accounts for each kind of item.
3. Whether any pairing of reporting basis and treatment is one you'd refuse, so
   we can stop the software offering it.
4. Whether feed and goods held for resale need different answers.

Happy to walk through the software or send the full technical write up.
