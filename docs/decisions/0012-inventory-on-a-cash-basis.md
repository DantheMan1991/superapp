# 0012 — Inventory is not an asset on a cash basis

- **Date:** 2026-08-21
- **Status:** Accepted
- **Affects:** accounting module — `core/balances.ts`, `core/cash-basis.ts`; `inventory` pack — `ledger-ops.ts` and everything slice 3b posts

## Context

[ADR 0007](0007-cash-basis-reporting.md) derives cash basis at read time by
re-recognising invoices and bills on their payment dates. Its scope rule is the
sentence that matters here:

> Everything else — bank imports, manual journals that never touch AR or AP,
> opening balances — is already cash-dated and passes through untouched.

That was true when nothing capitalised. **Perpetual inventory is the first thing
in this build that does**, and it breaks the rule quietly rather than loudly.

`inventory` slice 3 posts `Dr 1300 Inventory` when stock arrives and
`Dr 5000 COGS / Cr 1300` when it is consumed, and slice 3c makes a bill line for
stock post to `1300` instead of an expense account — which is correct for
accrual and is what QuickBooks and Xero do.

Trace one feed purchase through the cash-basis lens as it stands:

| | Entry | What cash basis does today |
| --- | --- | --- |
| Bill | `Dr 1300 400 / Cr AP 400` | Excluded — accrual recognition |
| Payment | `Dr AP 400 / Cr Cash 400` | Kept, and the AP leg replaced by the document's lines |
| The document's lines | `1300` | **Re-recognised as an ASSET at the payment date** |
| Consumption | `Dr 5000 200 / Cr 1300 200` | No AR/AP, so **passed through untouched** |

`cash-basis.ts` builds its recognition lines from every non-control line of the
document — it skips the AR/AP leg and nothing else
([cash-basis.ts:247](../../src/modules/accounting/core/cash-basis.ts:247)). It
does not care that the line is an asset.

**The result is a report labelled "cash basis" that expenses feed when it is
CONSUMED rather than when it is PAID FOR** — accrual behaviour under a cash-basis
heading, with an inventory asset on a balance sheet that should not have one.

This is worse than an ordinary bug because of who reads it. Most small farms
file on cash. Cash-basis farmers deduct feed, seed and fertiliser **when
purchased**; raised livestock and crops carry no basis at all. A farm under the
small-business gross-receipts threshold is generally exempt from the §471
inventory rules entirely and may treat stock as non-incidental materials and
supplies. *(Thresholds are indexed and eligibility varies — the specific
citations belong with the accountant who reviews the books, not in this file.
What is not in doubt is the direction: on cash basis the deduction lands at
payment, not at consumption.)*

So the number this app would hand a cash-basis farmer is not the number they
file, and ADR 0007's stated selling point — "every report can be produced on the
basis the business actually files on" — stops being true the moment slice 3b
ships.

## Decision

**On a cash basis, inventory is not an asset and consumption is not an expense.
The cost lands where the money left.** Three rules, two of them in the lens and
one in what the pack posts at all.

### 1. An inventory line is SUBSTITUTED, never dropped

On cash basis, any journal line whose account has subtype `inventory` is
reclassified to that item's **consumption account** — the same account perpetual
would eventually debit, resolved by `resolveInventoryAccounts` and defaulting to
`5000`.

Substitution rather than exclusion, because **dropping one leg unbalances the
entry.** A bank-imported cash purchase is `Dr 1300 / Cr Cash`; drop the debit
and the cash-basis trial balance stops balancing, which ADR 0007 already
identified as the failure mode to design against. Substituted, it becomes
`Dr Feed / Cr Cash` — recognised on the day the money moved, which is exactly
right and needed no document at all.

This applies everywhere a line can reach an inventory account: the bill
recognition in `cash-basis.ts`, and the base aggregate in `balances.ts` for
bank imports and manual journals.

**One exception, and it is a real one.** In an `opening_balance` entry the
inventory line is substituted to the entry's **Opening Balance Equity** leg
instead, so the two cancel. Substituting it to an expense account would invent a
purchase in the opening period that nobody made. A cash-basis business has no
opening inventory; collapsing it against equity is what "has no opening
inventory" looks like in double entry.

### 2. A stock-movement entry is DROPPED WHOLE

Entries whose `source` is `inventory_receipt`, `inventory_issue` or
`inventory_adjustment` are excluded from a cash-basis report entirely — the same
mechanism and the same one-line shape as the existing
`notInArray(je.source, ["invoice", "bill"])` at
[balances.ts:92](../../src/modules/accounting/core/balances.ts:92).

Their entire purpose is to move cost between an asset and cost of goods, and on
this basis **neither of those exists**. Dropping both legs together preserves
balance, which is why this is an exclusion where rule 1 is a substitution.

This also fixes something that would otherwise be a genuine tax error:
**shrinkage would be deducted twice.** Spoiled feed posts
`Dr variance / Cr 1300` on accrual. On cash basis the feed was already deducted
when it was paid for; recognising the write-off as well would deduct the same
dollar a second time. Dropping the entry is what stops that.

### 3. A movement posts exactly the cost the valuation says it carries

The accrual-side rule the other two rest on: **`inventory` posts the figure
`carriedValue` reports, and where that is null it posts nothing.**

This is what makes the ledger and the valuation screen provably the same view.
It also removes a whole account: stock received before its bill has no cost in
the books, so consuming it credits nothing and `1300` cannot be driven negative
by unbilled stock. **A goods-received-not-invoiced clearing account is therefore
NOT needed**, which reverses an earlier assumption in this slice's planning. The
bill is the capitalising event; a receipt with no bill is simply stock the books
have not costed yet, and slice 3a's "what this figure leaves out" card already
names it on screen.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **Leave it — a cash-basis balance sheet showing inventory is close enough** | It is the number a farmer files from. "Close enough" here means a deduction taken in the wrong tax year, which is the one class of error this module exists to prevent. |
| **Drop inventory lines instead of substituting them** | Unbalances every entry with a non-inventory leg — a cash purchase, an opening balance. ADR 0007 already names a non-balancing cash-basis trial balance as the thing not to ship. |
| **Filter to "entries that touch a bank account"** | ADR 0007 rejected this exact shortcut for the same reason it fails here: it silently drops every non-cash adjustment that belongs in a cash-basis P&L. |
| **Post inventory only for accrual tenants; skip it for cash filers** | Makes cost accumulation depend on tax basis, which the design forbids in as many words — *"cost per finished hog is wanted regardless of tax basis"*. A cash-basis farmer still wants to know what the pen cost. |
| **Store a second, cash-basis inventory ledger** | The alternative ADR 0007 rejected as accounting software's worst bug class. Nothing about inventory makes it less true. |
| **A GRNI clearing account so the books track receipts rather than bills** | Correct in a large ERP with three-way matching, and machinery a farm will not maintain. Rule 3 gets the same safety — no negative inventory from unbilled stock — with no account, no reconciliation and no extra entries. |
| **Recognise the cash-basis expense at the receipt date rather than the payment date** | Simpler, and wrong: it is the accrual answer wearing cash clothes. The whole point of the basis is when the money moved. |

## Consequences

**What it buys.** A cash-basis report a farmer can actually file from: feed
deducted when paid, no inventory on the balance sheet, no second deduction for
spoilage. The accrual path stays byte-identical — `basis` still defaults to
`"accrual"` and every rule above is inside the `cash` branch — so ADR 0007's
"nothing that exists today can regress" property survives slice 3b. And rule 3
means one number, not two: the ledger and the valuation screen cannot drift,
because the posting *is* the valuation.

**What it costs.**

- **`accountIds` filtering now happens at the wrong moment.** `getBalances`
  filters on `jl.accountId` inside the query
  ([balances.ts:89](../../src/modules/accounting/core/balances.ts:89)), before
  anything is substituted. A cash-basis report asking only for the expense
  account would filter out the `1300` lines that were about to become it, and
  silently under-report. The filter has to be widened to include the inventory
  accounts that map into the requested ones, or substitution has to move into
  SQL. **This is the implementation trap in this ADR most likely to ship as a
  bug**, and it will look like a rounding difference rather than a missing
  filter.
- **A third thing to get right on every new report.** Basis, scope, and now
  substitution. A report that goes around `getBalances` gets none of it.
- **Two accounts now answer to one item.** The consumption account is used by
  perpetual on accrual and by substitution on cash, so changing it moves both.
  That is intended — they are the same question asked on two bases — but it
  means the mapping is load-bearing in a place its name does not suggest.
- **The substitution target is a single account per tenant, not per item.**
  Everything lands in cost of goods. A farm's return separates feed from seed
  from vet supplies, so per-item expense mapping is a real gap; it is deferred
  because the bill→item link that would carry it does not exist until 3c.
- **The valuation screen is now basis-blind in a way it does not say.** It
  reports accumulated cost, which is right and always on — but a cash-basis
  tenant reading "$463 on hand" will not find that figure anywhere in their
  financial statements, because on their basis it is not an asset. The screen
  should say so.
- **`opening_balance` is handled by a special case**, and special cases in a
  lens are where the next bug lives. It is written down here because it was
  found by tracing rather than by testing, and it is the one path with no
  natural test data.

## Notes

The lesson is ADR 0007's own, arriving from the other direction. That ADR asked
whether an item was excluded from the plan because it was peripheral or merely
because it was not needed yet. This is the mirror: **ADR 0007's pass-through
rule was not a decision that non-AR/AP entries are cash-dated. It was an
observation that, at the time, they all happened to be.** Perpetual inventory is
the first entry type for which the observation is false, and it was recorded as a
rule rather than as a condition — so nothing failed when it stopped holding.

Worth re-examining the same way if any future feature capitalises: prepaid
expenses amortised over a period, work in progress on a job, and capitalised
labour would each land in exactly this trap.
