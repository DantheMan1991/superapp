# 0007 — Cash-basis reporting, derived at read time

- **Date:** 2026-08-10
- **Status:** Accepted
- **Affects:** accounting module — `core/balances.ts`, `core/cash-basis.ts`, the report layer and its exports

## Context

The Phase 2 master plan put **cash-basis reporting out of scope** for the whole
core phase, alongside payroll, sales tax and multi-currency. That was a
reasonable call while the ledger itself was being built: accrual is the honest
model, cash basis is a presentation of it, and presentations can wait.

Three things have since made it the wrong call.

1. **Most US small businesses file on cash basis.** It is not an advanced
   feature for them; it is the basis their return is prepared on. A books
   product that can only produce accrual statements produces statements its
   own user cannot file from.
2. **It is the first question an accountant asks.** The expert role exists so an
   outside accountant can review the books. "Is this cash or accrual?" precedes
   every other question they have.
3. **The benchmark treats it as a control, not a feature.** On 2026-08-10 a
   walkthrough of the founder's live QuickBooks found `Cash | Accrual` as a
   first-class toggle on *every* report, with the chosen basis stamped in the
   report footer next to the generation timestamp.

The founder reversed the scope decision the same day. Because ADRs are
immutable, the reversal is recorded here rather than by editing the plan.

## Decision

Cash basis is **derived at read time from the accrual ledger**, never stored and
never posted. `getBalances` — the single query engine every report goes through
— gains `basis?: "accrual" | "cash"`, defaulting to `"accrual"`.

On cash basis, an invoice's income and a bill's expense are recognised **on the
dates their payments were received or made, pro-rata by payment amount over
document total**. The accrual issuance and approval entries are excluded, and
the AR or AP leg of each payment entry is replaced by that payment's allocated
share of the document's income or expense lines, carrying the source lines'
dimension tags.

Everything else — bank imports, manual journals that never touch AR or AP,
opening balances — is already cash-dated and passes through untouched.

## Alternatives rejected

| Option | Why not |
| --- | --- |
| **Store a second, cash-basis set of journal entries** | Two ledgers that must agree forever. This is accounting software's worst bug class — the same reason `balances.ts` computes on read instead of maintaining a balance table. |
| **Post closing/reclass entries to convert the period** | Changes the books to change a report. Cash basis is a lens, not a transaction; and it would have to be reversed to view accrual again. |
| **Recognise the whole document on its first payment date** | Simple, and wrong for anything part-paid. A half-paid invoice would report full income in the month of the deposit. |
| **Recognise by payment date but allocate evenly across lines** | Wrong whenever lines differ in size, which is most invoices; and it would misstate any per-dimension split. |
| **Filter to "entries that touch a bank account"** | The obvious cheap approximation, and it silently drops every non-cash adjustment — depreciation, accruals, reclasses — that belongs in a cash-basis P&L just as much. |

## Consequences

**What it buys.** Every report can be produced on the basis the business
actually files on, from the same ledger, with no second source of truth and no
migration. The accrual path is byte-identical to what it was: `basis` defaults
to `"accrual"` and the query is unchanged, so nothing that exists today can
regress.

**What it costs.**

- **The adjustment cannot be done in one SQL aggregate.** The base aggregate
  stays in SQL; the per-document allocation is computed in TypeScript over a
  bounded set (documents with payments in range) and merged. That is a second
  query and a merge step on every cash-basis report.
- **Rounding is now load-bearing.** Splitting a payment across lines in integer
  cents needs a remainder rule, or a cash-basis trial balance stops balancing.
  The allocator is pure and table-tested for exactly this.
- **Overpayments still show AR.** When a payment exceeds what is left to
  allocate, the residual stays on AR rather than becoming income — unapplied
  cash is genuinely a liability to the customer, not revenue. So "AR is always
  zero on cash basis" is *nearly* true, and the exception is deliberate.
- **A manual journal entry that touches AR or AP is left alone**, and this is
  the second reason those accounts can carry a balance on a cash-basis balance
  sheet. Only invoices and bills are re-recognised, because only they have a
  document and payments to re-date *to*; a hand-written `Dr Vehicles / Cr AP`
  has neither, and inventing a recognition date for it would be a guess.
  Confirmed on real data 2026-08-10: a tenant showed AP of 17,198.33 accrual
  against 521.00 cash, the difference being exactly one unpaid bill, with the
  521.00 remainder a hand-journaled vehicle purchase. Both bases balanced.
  If this becomes a complaint, the fix is to let a journal line be tagged with
  a recognition date — not to silently strip AR/AP rows the ledger never
  explained.
- **Two numbers for the same period.** Users can now produce two different and
  both-correct profit figures. The basis is therefore stamped on the rendered
  report and on every CSV export; an exported statement that does not say which
  basis it is on is worse than no statement.

## Notes

The lesson worth keeping: the master plan's out-of-scope list was written to
protect the *build*, and several items on it — cash basis, invoice delivery —
turned out to be table stakes rather than advanced features. When an item on
that list is questioned, ask whether it was excluded because it is genuinely
peripheral or because it was merely not needed to get the ledger standing up.

We would revisit this if per-document allocation ever became a performance
problem at a tenant with very many part-paid documents in one period. The fix
would be a materialised recognition table, and it should not be reached for
before there is a slow report to point at.
