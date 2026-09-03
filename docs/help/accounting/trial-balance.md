# Trial balance

> Every account's balance on one page as of a date, the company and basis controls, and the check that the two columns agree.
> **Route:** /dashboard/m/accounting/trial-balance
> **Order:** 220

Open **Trial Balance** in the accounting menu. The line under the title reads `Every account's balance as of [date] — the two columns must agree. Accrual basis.`, with the company scope after it when you keep more than one. Set the controls and click {button:Run|outline}.

## What you see

- **The badge at the right.** {badge:In balance|success}, or {badge:Out of balance|destructive}. Out of balance means an entry in the books does not balance.
- **`As of`.** The date. Today to begin with.
- **`Company`.** Only when you keep more than one: `All companies (combined)`, which adds the companies together, `All companies (consolidated)`, which also cancels out money owed between them, or one company.
- **`Basis`.** `Accrual`, the books as posted, or `Cash`, which counts invoice income and bill expense on the dates they were paid.
- **The lock line.** Beside the controls, a {icon:lock} says where the books stand, `closed through 2026-07-31 · manage on the Close page` or `books open · manage on the Close page`, and opens the Close page.
- **The table.** `Code`, `Account`, `Debit` and `Credit`, one row per account with a balance, and a `Totals` row. A zero is shown blank.
- **The consolidation note.** On a consolidated run, when money between your companies has not been linked as a transfer: `Not eliminated: 2 journal lines in the affiliate accounts with no linked transfer to follow (net 500.00 debit).` and `Record money moving between your companies as a transfer, so both sides are linked and consolidation can follow them.`

## How to run it

1. Set `As of`, and `Company` and `Basis` if you need them.
2. Click {button:Run|outline}. The table and the badge update.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing posted as of this date` and `Try a later date, or post an entry to start the books.` | No entry is posted on or before the date. |

## Not on this page

There is no export on this page. The trial balance is included in the books export for your accountant on the Close page, and the reports on the Reports page each have their own CSV.

## Who can do what

Everyone can run this page.
