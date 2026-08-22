# 0013 — Inventory treatment is a policy, not a property of "cash basis"

- **Date:** 2026-08-21
- **Status:** Proposed
- **Affects:** accounting module — `core/balances.ts`, `core/cash-basis.ts`, `accounting_settings`; `inventory` pack — item→account mapping

> **Nothing here should be Accepted without an accountant's sign-off**, and that
> is the point of the ADR rather than a caveat on it. It exists because an
> earlier draft encoded one likely tax treatment as the universal meaning of the
> word "cash", and the fix is to stop encoding tax answers at all.
>
> **The question is written out for them** in
> [docs/briefs/inventory-tax-treatment.md](../briefs/inventory-tax-treatment.md)
> — plain prose, meant to be sent rather than read here. This ADR is the
> reasoning; that is the ask. Neither is a substitute for the other, and the
> brief is the thing that actually moves this from Proposed.

## Context

### The lens breaks the moment anything capitalises

[ADR 0007](0007-cash-basis-reporting.md) derives cash basis at read time and says
everything that is not an invoice or a bill *"is already cash-dated and passes
through untouched."* That held while nothing capitalised. Once
[ADR 0012](0012-what-capitalises-stock.md) has a receipt posting
`Dr 1300 / Cr 2050`, it does not:

`cash-basis.ts` builds recognition from every non-control line of a document —
it skips the AR/AP leg and nothing else
([cash-basis.ts:247](../../src/modules/accounting/core/cash-basis.ts:247)) — so a
bill line pointing at a capitalising account is **re-recognised as an asset at
the payment date**, while the consumption entry has no AR/AP leg and passes
through untouched. The report says "cash basis" and expenses stock when it is
CONSUMED.

That much is simply a bug and needs fixing whatever else is decided.

### The fix that was wrong

The obvious repair — on cash basis, substitute capitalising lines to an expense
account and drop the stock-movement entries — produces "deduct at payment". That
is a plausible treatment for feed, seed and fertiliser bought by a qualifying
farmer on the cash method. **It is not what "cash basis" means.**

A qualifying small business has more than one option available for inventory.
Broadly: treat it as non-incidental materials and supplies, where the deduction
turns on when the item is **used or consumed**; or follow its books-and-records
treatment. Those are different answers, and the second is close to doing nothing
at all.

So "cash" does not determine inventory treatment. Two businesses both correctly
on the cash method can owe different answers.

**And the danger is already live in this repo, not hypothetical.** The `retail`
pack shipped on 2026-08-21 and sells goods out of `inventory`. Merchandise held
for resale is precisely the category where sale still matters. A rule that
expensed everything at payment because the report said "cash" would be wrong for
a pack that is running today.

## Decision

**Inventory treatment is its own setting on `accounting_settings`, orthogonal to
the reporting basis.** The lens applies whichever treatment is configured; the
basis continues to decide only what ADR 0007 says it decides.

```
accounting_settings.inventory_treatment
  capitalise           -- default; stock is an asset, cost lands at consumption
  expense_on_payment   -- cost lands when the money left
```

Basis and treatment form a matrix rather than a list. `capitalise` on accrual is
today's behaviour exactly; `capitalise` on cash is a cash-basis P&L that still
carries inventory, which is a legitimate answer for a business conforming to its
books and records.

### How the lens applies each treatment

Two knobs, and each treatment is a named setting of them:

| Treatment | Lines to a capitalising account | Stock-movement entries | Deduction lands |
| --- | --- | --- | --- |
| `capitalise` | pass through | pass through | at consumption |
| `expense_on_payment` | substitute → the item's expense account | dropped whole | at payment |

**Substituted, never dropped.** A capitalising line is reclassified, not removed,
because dropping one leg unbalances the entry — a bank-imported cash purchase is
`Dr 1300 / Cr Cash`, and dropping the debit stops the trial balance balancing,
which ADR 0007 already named as the failure to design against.

**Movement entries are dropped whole**, both legs together, so balance holds.
Under `expense_on_payment` this also prevents a real error: **shrinkage would
otherwise be deducted twice**, once when the stock was paid for and again when it
spoiled.

**One exception.** In an `opening_balance` entry a capitalising line is
substituted to the entry's Opening Balance Equity leg so the two cancel, rather
than inventing a purchase in the opening period that nobody made.

### The names stay industry-neutral

Not `farm_cash_payment_basis`. `accounting` is a core module, and core modules
carry no trade-specific nouns — that is the add-on layers' job. The farm profile
*selects* `expense_on_payment`; it does not get its name written into core.

### The expense account cannot be one per tenant

`expense_on_payment` has to substitute *to* something, and "everything to cost of
goods" produces a report that balances and is useless for preparing a return,
where feed, seed and veterinary supplies are separate lines.

Resolution, most specific first: the item's own expense account, then its
`item_kind`'s, then the tenant default. `item_kind` already exists as an open
taxonomy with an index ([inventory.ts:73](../../src/db/schema/inventory.ts:73)),
so this reuses a spine rather than inventing a category.

This is why the mapping cannot be deferred: it is not a refinement of
`expense_on_payment`, it is a prerequisite for it.

### Non-incidental materials and supplies is named and NOT implemented

A third treatment belongs in this list and is deliberately absent. Under NIMS the
deduction turns on use or consumption *and* on payment, which needs payment
allocated down to the lot — machinery that does not exist here.

Approximating it with either of the two implemented values would produce a
confident wrong number, which is the exact failure this ADR was written to end.
It is recorded as known and missing rather than guessed at. Adding it later costs
one enum value and one migration.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **Treat "cash basis" as meaning expense-at-payment** | The draft this ADR replaces. Encodes one likely treatment as the meaning of a word that does not carry it, and is wrong today for the `retail` pack. |
| **Fold treatment into the basis enum** (`cash_nims`, `cash_payment`, …) | Mixes two orthogonal questions into one column, and makes `accrual_inventory` a kind of cash basis, which is a category error. The matrix is the honest shape. |
| **Ask the tenant at report time** | A tax election is not a per-report choice. It also puts the question to whoever opened the report rather than to whoever decides it. |
| **Infer treatment from the industry profile** | Convenient, and it guesses at a legal election from a dropdown the user picked to get the right screens. A profile may *suggest* a default; it must not silently be the answer. |
| **Implement NIMS approximately** | A confident wrong number, in the one place where being wrong means an amended return. |
| **Leave the cash lens broken until an accountant rules** | The re-recognition of an asset at the payment date is a bug on any treatment. The mechanism lands now; which treatment a tenant selects is theirs. |

## Consequences

**What it buys.** The cash lens stops being wrong, and it stops claiming to know
something it cannot. A retail tenant and a farm tenant can both be on the cash
method and get different, correct answers. The setting is also the natural place
for an accountant's decision to be recorded, which is better than that decision
living in a developer's assumption.

**What it costs.**

- **A setting nobody can answer without help.** "Inventory treatment" is not a
  question a farmer can be expected to answer unprompted, and the wrong value
  produces a plausible, balanced, wrong return. The UI has to say *ask your
  accountant* rather than offer a tidy dropdown with a default that looks
  authoritative.
- **The default is the conservative one, not the common one.** `capitalise`
  changes nothing for anybody today, which is right for safety and means a farm
  that should be on `expense_on_payment` gets the wrong answer until somebody
  sets it. Silence favours the status quo, not correctness.
- **A third knob on every report path.** Basis, scope, and now treatment. A
  report that goes around `getBalances` gets none of them.
- **`accountIds` filtering happens at the wrong moment.** `getBalances` filters
  on `jl.accountId` inside the query
  ([balances.ts:89](../../src/modules/accounting/core/balances.ts:89)), before
  anything is substituted, so a report asking only for the expense account would
  filter out the lines about to become it. **This is the implementation trap here
  most likely to ship**, and it will present as a rounding difference.
- **NIMS remains a hole** with a name on it. Anybody who needs it gets a refusal,
  which is the intended behaviour and is still a refusal.

## What this ADR is least sure of

1. **The treatment list itself.** Two implemented values and one named gap is my
   reading of what a qualifying small business can elect. Whether those are the
   right cuts — and whether `capitalise` should be split further — is the
   accountant's call, and the list is the thing to hand them first.
2. **Whether treatment is genuinely orthogonal to basis** in every combination,
   or whether some pairs are incoherent and should be refused rather than
   rendered.
3. **Basis or treatment CONVERSION is not covered at all.** A business changing
   method has an adjustment to make, and neither this ADR nor the
   `opening_balance` rule in it says anything about it. That is its own ADR and
   should not be improvised.

## Notes

The generalisable mistake is worth naming, because it will recur. **ADR 0007's
pass-through rule was not a decision that non-AR/AP entries are cash-dated. It
was an observation that, at the time, they all happened to be** — recorded as a
rule, so nothing failed when it stopped holding.

The second is this ADR's own reason for existing: the first attempt to repair
that rule replaced one over-general statement with another. The fix was not a
better default. It was noticing that the software had no business holding an
opinion, and turning the opinion into a setting.

Prepaid expenses amortised over a period, work in progress on a job, and
capitalised labour would each land in exactly the same trap.
