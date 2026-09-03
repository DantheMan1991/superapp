# Trial balance

> Every account's balance on one page as of a date, the company and basis controls, and the check that the two columns agree.
> **Route:** /dashboard/m/accounting/trial-balance
> **Order:** 220

## The page

**Trial Balance** in the strip. The line under the title reads `Every account's balance as of [date] — the two columns must agree. Accrual basis.`, with the company scope after it when you keep more than one. A badge at the right reads **In balance** in green, or **Out of balance** in red.

## The controls

- **As of.** The date. Today to begin with.
- **Company.** Only when you keep more than one: `All companies (combined)`, which adds the companies together, `All companies (consolidated)`, which also cancels out money owed between them, or one company.
- **Basis.** `Accrual`, the books as posted, or `Cash`, which counts invoice income and bill expense on the dates they were paid.

Click **Run**. Beside the controls, a lock icon says where the books stand, `closed through 2026-07-31 · manage on the Close page` or `books open · manage on the Close page`, and opens the Close page.

## The table

**Code**, **Account**, **Debit** and **Credit**, one row per account with a balance, and a **Totals** row. A zero is shown blank. Before anything is posted: **Nothing posted as of this date** and `Try a later date, or post an entry to start the books.`

On a consolidated run, a note appears when money between your companies has not been linked as a transfer: `Not eliminated: 2 journal lines in the affiliate accounts with no linked transfer to follow (net 500.00 debit).` and `Record money moving between your companies as a transfer, so both sides are linked and consolidation can follow them.`

## Exporting

There is no export on this page. The trial balance is included in the books export for your accountant on the Close page, and the reports on the Reports page each have their own CSV.

Everyone can run this page.
