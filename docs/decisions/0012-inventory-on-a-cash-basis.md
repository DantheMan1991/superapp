# 0012 — What capitalises stock, and what a cash basis does with it

- **Date:** 2026-08-21
- **Status:** Proposed
- **Affects:** accounting module — `core/balances.ts`, `core/cash-basis.ts`, the general chart; `inventory` pack — `ledger-ops.ts` and everything slice 3b posts

> **Proposed, not Accepted, deliberately.** Two things in it should be confirmed
> before code depends on them: the tax direction in *Context* wants an
> accountant's eye, and the cost-supply rule in *Decision, part A.4* is the one
> piece here with no precedent elsewhere in this repo.
>
> **An earlier draft of this ADR was wrong** and is corrected here rather than
> superseded, because it was never merged or accepted by anyone. It claimed a
> goods-received-not-invoiced account "is NOT needed". It is needed, for the
> reason set out in *Two records of one cost* below, and the draft reached the
> opposite conclusion by considering only the case where the bill arrives first.

## Context

### The cash lens breaks the moment anything capitalises

[ADR 0007](0007-cash-basis-reporting.md) derives cash basis at read time by
re-recognising invoices and bills on their payment dates. Its scope rule:

> Everything else — bank imports, manual journals that never touch AR or AP,
> opening balances — is already cash-dated and passes through untouched.

That was true when nothing capitalised. **Perpetual inventory is the first thing
in this build that does.** Trace one feed purchase through the lens as it stands:

| | Entry | What cash basis does today |
| --- | --- | --- |
| Bill | `Dr 1300 400 / Cr AP 400` | Excluded — accrual recognition |
| Payment | `Dr AP 400 / Cr Cash 400` | Kept, AP leg replaced by the document's lines |
| The document's lines | `1300` | **Re-recognised as an ASSET at the payment date** |
| Consumption | `Dr 5000 200 / Cr 1300 200` | No AR/AP, so **passed through untouched** |

`cash-basis.ts` builds recognition from every non-control line of the document —
it skips the AR/AP leg and nothing else
([cash-basis.ts:247](../../src/modules/accounting/core/cash-basis.ts:247)). It
does not care that the line is an asset.

**The result is a report labelled "cash basis" that expenses feed when it is
CONSUMED rather than when it is PAID FOR**, with an inventory asset on a balance
sheet that should not have one.

Most small farms file on cash, where feed, seed and fertiliser are deducted when
purchased and raised livestock carries no basis at all. *(The thresholds and
elections behind that — and whether a given farm is exempt from the §471
inventory rules — belong with the accountant who reviews the books. What is not
in doubt is the direction: on cash basis the deduction lands at payment, not at
consumption.)*

### Two records of one cost

The second problem, and the one the earlier draft missed.

`receiveStock` already takes `costCents` — "$340 for 12 bags", off the delivery
ticket. A bill for the same delivery also carries a cost. **These are two
independent records of the same money**, they arrive at different times, and
they can disagree in amount.

Perpetual needs exactly one of them to capitalise. Get that wrong in either
direction and it is silent:

- **Both capitalise** → the delivery is on the books twice.
- **Neither reliably does** → cost goes missing. And it goes missing
  *permanently*, because `issueStock` stamps cost at the moment of issue from
  `itemCostRate` ([ops.ts:1117](../../src/packs/inventory/ops.ts:1117)) and this
  repo's rule is that a stamped cost is never re-derived. Feed issued before its
  bill arrives is stamped `null` and stays `null`.

"Delivery ticket now, invoice at month end, feed it out in between" is an
ordinary farm month, not an edge case.

## Decision

### Part A — what capitalises, and what joins the two records

**A.1 — The receipt capitalises. `Dr 1300 Inventory / Cr 2050 Goods Received
Not Invoiced`.**

The stock ledger is the authoritative record of what the business has and what
it cost; the books follow it rather than compete with it. That is already the
premise of the pack — cost accumulation is always on, stamped when it happens.

**A.2 — A bill line for stock clears GRNI, it does not capitalise.**
`Dr 2050 / Cr AP`. This requires the `inventory_item_id` link on `bill_lines`
that slice 3c adds; a bill line without one is an ordinary expense and untouched
by any of this.

GRNI is the join between *what I have* and *what I owe*, and its balance is a
report worth having rather than plumbing: a credit balance is **goods received
with no invoice yet**, a debit balance is **invoiced for goods the books never
received**. Both are things a farm wants to see at month end.

`2050 Goods Received Not Invoiced` does not exist in the general chart and must
be added, with its own subtype so it can be identified without matching on a
code — `subtype` is free text, so this needs no enum change.

**A.3 — Transfers, splits and merges post nothing.** They move cost within one
account. Issues post `Dr <consumption account> / Cr 1300`; adjustments post
against the variance account.

**A.4 — A cost that was never recorded may be SUPPLIED; a cost that was
recorded may never be CHANGED.**

This is the rule that rescues the stock-arrives-first case, and it is a
distinction rather than an exception. When a bill line names a lot whose receipt
carries no cost, the bill supplies it — writing a figure into a column that held
`null`. That is not rewriting history; it is recording something for the first
time. Changing a figure that is already there stays forbidden, because that is
what would let an October delivery restate June's cost and make every FCR
comparison meaningless.

**The already-consumed portion goes straight to the consumption account, not to
1300.** If 100 lb arrived uncosted and 40 lb has already been issued when the
bill lands, 60 lb capitalises and 40 lb is expensed on the spot. Sending all of
it to 1300 would leave the books holding an asset that has been eaten.

**A.5 — A price difference is recorded, never absorbed.** Ticket $340, invoice
$352: the $12 lands in a purchase-price variance account (defaulting to the same
variance account adjustments use). Silently adjusting the lot to match the
invoice would be a change under A.4; silently leaving it would let GRNI drift
forever with nothing naming why.

### Part B — the cash lens

**B.1 — A line to a CAPITALISING ACCOUNT is substituted, never dropped.**

Capitalising accounts are those holding cost a cash-basis filer would have
expensed: inventory accounts (`subtype = 'inventory'`) and GRNI. On cash basis a
line to either is reclassified to that item's consumption account.

Substitution rather than exclusion, because **dropping one leg unbalances the
entry** — a bank-imported cash purchase is `Dr 1300 / Cr Cash`, and dropping the
debit stops the trial balance balancing, which ADR 0007 already named as the
failure to design against. Substituted, it becomes `Dr Feed / Cr Cash` on the day
the money moved.

**One exception.** In an `opening_balance` entry the capitalising line is
substituted to the entry's Opening Balance Equity leg instead, so the two cancel.
Substituting it to an expense account would invent a purchase in the opening
period that nobody made.

**B.2 — A stock-movement entry is dropped whole.** Entries whose `source` is
`inventory_receipt`, `inventory_issue` or `inventory_adjustment` are excluded
entirely — the same one-line shape as the existing
`notInArray(je.source, ["invoice", "bill"])` at
[balances.ts:92](../../src/modules/accounting/core/balances.ts:92). Their purpose
is to move cost between an asset and cost of goods, and on this basis neither
exists. Dropping both legs preserves balance.

This also prevents a genuine tax error: **shrinkage would otherwise be deducted
twice**, once when the feed was paid for and again when it spoiled.

Traced end to end, a feed purchase on cash basis becomes `Dr Feed / Cr Cash` at
the payment date, with `1300` and `2050` both at zero and no COGS at
consumption — which is what a cash-basis farmer files.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **No GRNI — let the bill capitalise directly** | The earlier draft of this ADR. It works only when the bill arrives before the stock is consumed. Otherwise `1300` holds cost for feed already eaten, and `issueStock`'s stamp-once rule means it can never be corrected. |
| **No GRNI — let the receipt capitalise and the bill expense** | The delivery is then on the books twice. |
| **Leave it — a cash-basis balance sheet showing inventory is close enough** | It is the number a farmer files from. "Close enough" means a deduction in the wrong tax year. |
| **Drop capitalising lines instead of substituting them** | Unbalances every entry with a non-capitalising leg. ADR 0007 already names a non-balancing cash-basis trial balance as the thing not to ship. |
| **Filter to "entries that touch a bank account"** | ADR 0007 rejected this exact shortcut for the same reason it fails here: it silently drops every non-cash adjustment that belongs in a cash-basis P&L. |
| **Post inventory only for accrual tenants** | Makes cost accumulation depend on tax basis, which the design forbids in as many words — *"cost per finished hog is wanted regardless of tax basis"*. |
| **Store a second, cash-basis inventory ledger** | The alternative ADR 0007 rejected as accounting software's worst bug class. |
| **Let the bill overwrite the lot's recorded cost** | Would let a late invoice restate a cost already used to stamp issues, which is the drift `costing.ts` exists to prevent. A.4 permits supplying a missing cost and nothing more. |
| **Full three-way match with purchase orders** | The complete answer, and machinery a farm will not maintain. A.2 and A.5 get the reconciliation and the variance without the third document. |

## Consequences

**What it buys.** A cash-basis report a farmer can file from, an accrual set of
books where inventory reconciles to the stock ledger, and a GRNI balance that
names the gap between the two. The accrual path stays byte-identical — every
Part B rule lives inside the `cash` branch — so ADR 0007's "nothing that exists
today can regress" property survives slice 3b.

**What it costs.**

- **A new account, and one more thing to explain.** GRNI is unfamiliar to
  anybody who has not worked in a system that has it, and a farmer seeing
  "Goods Received Not Invoiced" on a balance sheet will ask. The reconciliation
  screen has to earn it.
- **`accountIds` filtering happens at the wrong moment.** `getBalances` filters
  on `jl.accountId` inside the query
  ([balances.ts:89](../../src/modules/accounting/core/balances.ts:89)), before
  anything is substituted, so a cash-basis report asking only for the expense
  account would filter out the lines about to become it. **This is the
  implementation trap here most likely to ship as a bug**, and it will present
  as a rounding difference rather than a missing filter.
- **A.4 makes `cost_cents` conditionally writable**, and every future reader of
  that column has to know the difference between supplying and changing. It is
  one `is null` check and one comment away from being violated by a well-meaning
  change.
- **A.4 cannot recover a stamped `null` issue.** The consumed portion is
  expensed at the bill's rate rather than at the rate that applied when it was
  issued. Over a single delivery this is immaterial; across a long gap with
  moving prices it is an approximation, and it is one.
- **The substitution target is one account per tenant.** Everything lands in cost
  of goods, so a cash-basis P&L will not map to Schedule F, where feed, seed and
  vet supplies are separate lines. Per-item expense mapping is the fix and it
  waits on the same bill→item link.
- **The valuation screen is basis-blind and does not say so.** A cash-basis
  tenant reading "$463 on hand" will not find that figure in their financial
  statements.
- **Three things to get right on every new report**: basis, scope, and now
  substitution. A report that goes around `getBalances` gets none of them.

## What this ADR is least sure of

Recorded explicitly, because the rest of the document reads more confident than
the evidence behind these three warrants.

1. **The tax direction.** High confidence that a cash-basis farmer deducts feed
   at payment. Low confidence on the specifics that decide how much of this
   machinery a given farm needs — the gross-receipts threshold, prepaid farm
   supply limits, and which inventory elections apply. **Confirm before 3b.**
2. **A.4, supplying a missing cost.** The supply-versus-change distinction is
   principled and has no precedent elsewhere in this repo. If it turns out to be
   a bad seam, the fallback is that an uncosted receipt simply never capitalises
   and GRNI carries the residual — worse books, simpler rule.
3. **The `opening_balance` exception in B.1.** Derived by tracing, with no test
   data behind it, and it says nothing about a business *converting* between
   methods, which is a real event with its own required adjustment. If a tenant
   ever changes basis for filing, this ADR does not cover it.

## Notes

The lesson is ADR 0007's own, arriving from the other direction. **ADR 0007's
pass-through rule was not a decision that non-AR/AP entries are cash-dated. It
was an observation that, at the time, they all happened to be** — recorded as a
rule, so nothing failed when it stopped holding.

The second lesson is about this document. Its first draft dismissed GRNI as
machinery a farm would not maintain, and wrote a confident paragraph around that
dismissal. The dismissal was reached by tracing one ordering of events — bill,
then stock — and never trying the other. **A design that has only been walked
forwards has not been tested.**

Worth re-examining the same way if any future feature capitalises: prepaid
expenses amortised over a period, work in progress on a job, and capitalised
labour would each land in exactly this trap.
