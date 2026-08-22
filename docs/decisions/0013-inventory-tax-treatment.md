# 0013 — Inventory treatment is a policy, not a property of "cash basis"

- **Date:** 2026-08-21, **revised 2026-08-22**
- **Status:** Proposed
- **Affects:** accounting module — `core/balances.ts`, `core/cash-basis.ts`, `accounting_settings`; `inventory` pack — item→account mapping, `setInventoryTreatmentAction`

> **REVISED IN PLACE ON 2026-08-22, which is allowed only because it is still
> Proposed.** An accepted ADR is immutable and is reversed by a successor. This
> one has never been accepted, and three of its statements were wrong or had
> gone stale within a day of being written. Revising is more honest than
> superseding a decision nobody took.
>
> What changed, and why:
>
> 1. **Treatment was business-wide. It is now per item category.** This ADR's
>    own Context names merchandise held for resale as the case that behaves
>    differently, and its Decision then put one setting on the whole tenant. It
>    contained its own counterexample and did not resolve it.
> 2. **"NIMS needs machinery that does not exist here" was true for one day.**
>    Slice 3b shipped `bill_line_stock_allocations` on 2026-08-21, which joins a
>    bill line to a specific stock receipt. Receipt → allocation → bill →
>    `bill_payments.payment_date` is now a complete chain, so "paid" is a date
>    the software can read. See A.4.
> 3. **One column was carrying two questions.** The shipped enum is
>    `none | capitalise`, which is whether stock POSTS. This ADR's enum was
>    `capitalise | expense_on_payment`, which is how a report LENS re-times.
>    Those are different axes, and putting them on one column is the category
>    error this ADR rejects for the basis enum two sections down.
>
> The correction came from a cross-model review. Two of the three are things
> this ADR already knew and did not act on, which is the more useful lesson: a
> document can carry its own refutation and still ship.

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

> **THIS PARAGRAPH IS DISPUTED AND THE DESIGN NO LONGER DEPENDS ON IT.** A
> cross-model review on 2026-08-22 put the materials-and-supplies rule as the
> LATER of the item being provided or used and it being paid for, rather than on
> use alone. Nobody here is qualified to settle that, and the paragraph is left
> standing with the disagreement recorded beside it rather than quietly edited to
> whichever reading was argued most recently.
>
> **A.1 is what makes that survivable.** The software offers dates it can
> observe, including `later_of_paid_and_consumed`, so both readings are
> expressible and neither is baked in. The way to be wrong here is to pick one
> and encode it, which is what the first draft did in the other direction.

So "cash" does not determine inventory treatment. Two businesses both correctly
on the cash method can owe different answers.

**And the danger is already live in this repo, not hypothetical.** The `retail`
pack shipped on 2026-08-21 and sells goods out of `inventory`. Merchandise held
for resale is precisely the category where sale still matters. A rule that
expensed everything at payment because the report said "cash" would be wrong for
a pack that is running today.

## Decision

### A.0 — Two axes, because there are two questions

The first draft put them on one column. They are not one question.

```
accounting_settings.inventory_posting     -- BOOK: does stock reach the ledger?
  none          -- it does not. Cost accumulation still runs.
  capitalise    -- the receipt posts Dr Inventory / Cr GRNI (ADR 0012)

inventory_tax_treatments (tenant, item_kind)  -- TAX: which event releases cost?
  timing_rule        -- one of the observable events in A.1
  expense_account_id -- what it releases TO, per A.5
```

**The shipped column is misnamed and the rename is deferred, on purpose.**
`accounting_settings.inventory_treatment` today holds `none | capitalise`, which
are posting behaviours, under a name this ADR's earlier draft gave to the tax
question. Renaming it to `inventory_posting` is one migration and about eight
call sites. It lands when the tax axis lands, because until then there is nothing
to tell it apart from and a rename with no second thing is churn.

**The tax axis has NO column yet and must not get one yet.** Nothing reads it.
This pack's own rule — *"Not columns, deliberately: each would have no reader
today"* — applies to the thing this ADR is most tempted to build early.

### A.1 — The software offers EVENTS IT CAN DATE, and no opinion about them

The list below is not a list of tax treatments. It is a list of moments the
ledger can already put a date on. Which one releases cost is the preparer's
decision, and the software's job is to be able to honour any of them.

| Rule | The date it uses | Where it comes from |
| --- | --- | --- |
| `billed` | the bill's date | `bills.bill_date` |
| `paid` | when the money left | receipt → allocation → bill → `bill_payments.payment_date` |
| `consumed` | when it was issued | the `issue` movement's `occurred_on` |
| `sold` | when it went to a customer | `retail_sale_lines.inventory_movement_id` → the movement |
| `later_of_paid_and_consumed` | max of two of the above | computed, stored nowhere |
| `later_of_paid_and_sold` | max of two of the above | computed, stored nowhere |

**Every one of these is a date the ledger already holds.** That is the test for
whether a rule belongs on this list, and it is the reason the list is what it is
rather than a reading of the regulations. A rule the software cannot date is a
rule it must refuse rather than approximate — which is what the previous draft
did to `later_of_paid_and_consumed`, on a premise that stopped being true the day
after it was written.

`capitalise` on the book axis with `consumed` on the tax axis is today's
behaviour exactly, and is what every tenant gets by writing nothing down.

### A.2 — Treatment is PER ITEM CATEGORY, not per business

The previous draft made this one setting for a whole tenant, in the same document
that says *"merchandise held for resale is precisely the category where sale
still matters."* A farm that buys feed and also runs a market stall has both
cases inside one set of books, and `retail` has been selling goods out of
`inventory` since 2026-08-21.

`inventory_items.item_kind` is already an open taxonomy with an index
([inventory.ts:73](../../src/db/schema/inventory.ts:73)) and is already how A.5
resolves the expense account. So the same key carries both, and one table answers
both questions:

```
inventory_tax_treatments
  tenant_id
  item_kind            -- null = the tenant's default
  timing_rule
  expense_account_id
```

Resolution is most specific first, the same order A.5 already used: the item's
own row, then its `item_kind`'s, then the tenant default. **A tenant with no rows
at all gets `consumed`**, which is what the books do today, so writing nothing
changes nothing.

### A.3 — The book axis decides POSTING. The tax axis decides a REPORT.

Nothing on the tax axis changes a journal entry. It is a read-time lens, exactly
as ADR 0007 derives cash basis at read time rather than keeping a second ledger,
and for the same reason: a second set of stored numbers has to agree with the
first forever.

This is what keeps a business able to hold one treatment for its financial
statements and a different one for its return, which is ordinary and which the
previous draft's single column could not express.

### A.4 — How the lens applies a rule, and the two ways it can unbalance

Two knobs. `consumed` is both of them left alone, which is why today's books need
no lens at all.

| Rule | Lines to a capitalising account | Stock-movement entries |
| --- | --- | --- |
| `consumed` | pass through | pass through |
| every other rule | substitute → the item's expense account, dated by the rule | dropped whole |

**Substituted, never dropped.** A capitalising line is reclassified, not removed,
because dropping one leg unbalances the entry — a bank-imported cash purchase is
`Dr 1300 / Cr Cash`, and dropping the debit stops the trial balance balancing,
which ADR 0007 already named as the failure to design against.

**Movement entries are dropped whole**, both legs together, so balance holds.
Under any rule other than `consumed` this also prevents a real error:
**shrinkage would otherwise be deducted twice**, once when the stock was paid for
and again when it spoiled.

**One exception.** In an `opening_balance` entry a capitalising line is
substituted to the entry's Opening Balance Equity leg so the two cancel, rather
than inventing a purchase in the opening period that nobody made.

#### `paid` is a date this software can already read

The previous draft said the later-of rules needed "payment allocated down to the
lot — machinery that does not exist here", and refused to implement them on that
basis. **The machinery shipped the following day** and the draft was never
updated, which is the whole reason this ADR is being revised rather than
accepted.

`bill_line_stock_allocations` joins a bill line to a specific receipt movement
with a matched quantity and amount ([ADR 0012](0012-what-capitalises-stock.md)
§A.2). `bill_payments` carries `bill_id` and `payment_date`. So:

```
inventory_movements (the receipt)
  → bill_line_stock_allocations   -- which line settled it, for how much
  → bill_lines → bills
  → bill_payments.payment_date    -- when the money left
```

Every join in that chain is indexed and none of it is new work.

**What is still missing is smaller than the draft claimed, and is not nothing.**
Three gaps, in descending order of how likely they are to matter:

1. **A part-paid bill has no line-level allocation.** `bill_payments` sits on the
   BILL. "Is this bill settled, and on what date" is exact; "which of a part
   payment's dollars reached this line" is not, and nothing in the schema
   answers it. A rule is needed rather than machinery: settle the whole bill
   before any line counts as paid, or pro-rate. **That is a question for whoever
   elects the treatment**, and it is on the list in the brief.
2. **A receipt with no bill has no payment date at all.** GRNI exists precisely
   because stock arrives before its invoice. Under a `paid` rule such stock is
   not yet deductible, which is probably right and is certainly reportable — the
   reconciliation screen already lists exactly these.
3. **A cash purchase that never became a bill** — bank-imported, `Dr 1300 /
   Cr Cash` — is paid on its own entry date and needs no chain.

### The names stay industry-neutral

Not `farm_cash_payment_basis`. `accounting` is a core module, and core modules
carry no trade-specific nouns — that is the add-on layers' job. The farm profile
*selects* a rule; it does not get its name written into core. The rules in A.1
are named after the EVENT they observe for the same reason: `paid` is a fact
about a bank account, and it means the same thing to a bakery and a feedlot.

### A.5 — The expense account cannot be one per tenant

A substituting rule has to substitute *to* something, and "everything to cost of
goods" produces a report that balances and is useless for preparing a return,
where feed, seed and veterinary supplies are separate lines.

Resolution, most specific first: the item's own expense account, then its
`item_kind`'s, then the tenant default. `item_kind` already exists as an open
taxonomy with an index ([inventory.ts:73](../../src/db/schema/inventory.ts:73)),
so this reuses a spine rather than inventing a category — and since A.2 keys the
timing rule the same way, one row carries both and one resolution order serves
both.

This is why the mapping cannot be deferred: it is not a refinement of the
substituting rules, it is a prerequisite for them.

### A.6 — Changing a rule is a CONVERSION, not a settings change

An adopted treatment is a method. Changing it has an adjustment attached, and the
software does not know what the adjustment is.

**This is already a live defect on the book axis, and it has nothing to do with
tax.** `setInventoryTreatmentAction` is a plain owner toggle. Switching
`capitalise → none` stops `postMovement` posting, so issues stop crediting
Inventory — and whatever was capitalised before the switch **stays on the balance
sheet forever**, relieved by nothing, while the stock behind it is eaten. The
switch's own copy says it does not backfill; nothing said it does not unwind
either.

So: the book axis refuses to leave `capitalise` once anything has posted under
it, and says what would be stranded. The tax axis, when it exists, gets the same
treatment for the same reason.

**What this ADR does NOT decide** is what the conversion adjustment should be.
That is a second decision, it belongs to whoever elects the method, and
improvising it here is exactly the failure this document was written to end.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **Treat "cash basis" as meaning expense-at-payment** | The draft this ADR replaces. Encodes one likely treatment as the meaning of a word that does not carry it, and is wrong today for the `retail` pack. |
| **Fold treatment into the basis enum** (`cash_nims`, `cash_payment`, …) | Mixes two orthogonal questions into one column, and makes `accrual_inventory` a kind of cash basis, which is a category error. The matrix is the honest shape. |
| **Ask the tenant at report time** | A tax election is not a per-report choice. It also puts the question to whoever opened the report rather than to whoever decides it. |
| **Infer treatment from the industry profile** | Convenient, and it guesses at a legal election from a dropdown the user picked to get the right screens. A profile may *suggest* a default; it must not silently be the answer. |
| **Implement a later-of rule approximately** | A confident wrong number, in the one place where being wrong means an amended return. Still true; what changed is that it no longer HAS to be approximate — see A.4. |
| **One treatment for the whole business** | This ADR's own first decision, and it was wrong in the same document that refuted it: merchandise held for resale behaves differently from feed, and `retail` has been selling goods out of `inventory` since 2026-08-21. Per-category costs one table keyed on a column that already exists. |
| **One column for posting and for tax timing** | Also this ADR's first decision, arrived at by accident: the shipped enum grew a `none` value for "does not post" and the ADR kept describing it as a tax treatment. Two questions on one column, which is the objection to the row above this one. |
| **Enumerate tax treatments rather than observable events** | The list would then be a reading of the regulations, maintained by people who cannot read them, and every gap in it would be invisible. A list of dates the ledger can produce is checkable by looking at the ledger. |
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
- **THE DEFAULT IS NOT "SAFE". It is a choice made by not choosing.** An earlier
  version of this bullet, and the brief written from it, called `capitalise` the
  safe answer. It is conservative about the TIMING of a deduction and it is still
  a method, adopted by silence, and moving off it later may be a formal change
  rather than a settings edit (A.6). The honest claim is narrower: it changes
  nothing for anybody today, and it keeps every underlying fact — purchase,
  payment, use, sale, on hand — so any rule can be applied later. That is what is
  actually safe. Not the value; the fact that nothing is thrown away.
- **A third knob on every report path.** Basis, scope, and now treatment. A
  report that goes around `getBalances` gets none of them.
- **`accountIds` filtering happens at the wrong moment.** `getBalances` filters
  on `jl.accountId` inside the query
  ([balances.ts:89](../../src/modules/accounting/core/balances.ts:89)), before
  anything is substituted, so a report asking only for the expense account would
  filter out the lines about to become it. **This is the implementation trap here
  most likely to ship**, and it will present as a rounding difference.
- **A part-paid bill has no line-level allocation**, so a `paid` rule needs a
  stated convention rather than more machinery. A.4 lists the three gaps; this is
  the one that will actually come up.
- **A rules table is more surface than a column.** Per-category treatment means a
  resolution order, a place to edit it, and a way to see what a given item
  resolves to. A setting nobody can inspect is one nobody can check.

## What this ADR is least sure of

1. **Whether "events the software can date" is the right list**, or whether some
   election needs a date the ledger does not hold. That is the failure mode of
   A.1: it is checkable and complete against the ledger, and the ledger is not
   the law. A rule nobody can express is the signal, and the answer is another
   observable event rather than an approximation of one.
2. **Whether `item_kind` is the right grain.** It is the grain the expense
   mapping already needed and it is free. Whether a tenant ever needs two rules
   inside one kind is unknown, and the per-item override in A.5's resolution
   order is the escape hatch if so.
3. **Whether treatment is genuinely orthogonal to basis** in every combination,
   or whether some pairs are incoherent and should be refused rather than
   rendered.
4. **What the CONVERSION adjustment is.** A.6 makes changing a rule refuse rather
   than proceed quietly, which is a guard rather than an answer. What entry a
   business owes when it changes method is not decided here and should not be
   improvised.

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
