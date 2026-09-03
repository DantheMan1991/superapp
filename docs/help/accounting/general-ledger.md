# General Ledger

> Every posted line in a period, account by account, with opening and running balances, or one account on its own as a transaction detail.
> **Route:** /dashboard/m/accounting/reports/general-ledger
> **Order:** 260

## The page

**General Ledger** from the Reports page. The line under the title reads, for example, `Hilltop Farm · 2026-08-01 to 2026-08-31 · accrual basis`, with the account's code and name in the middle when you picked one, and the company's name first when you keep more than one. **Export CSV** and **Print** sit at the top right. See [Reports](reports.md).

This report is accrual only, and there is no Basis control. Cash basis changes the totals of accounts, not the dates of lines, so a cash-basis ledger would show lines nothing in the books backs.

## The controls

- **Preset**, **From**, **To.** The dates start on this month.
- **Account.** `All accounts`, or one account, listed as `1000 · Checking`. Picking one turns the page into that account's transaction detail.
- **Company.** Only when you keep more than one: `All companies (combined)`, `All companies (consolidated)`, or one company.

Click **Run**.

## The report

One panel per account with an opening balance or activity in the period, headed with the code, the name, and `Opening 1,200.00 · Closing 950.00` at the right. An account with an opening balance and nothing in the period reads `No movement in this period.`

The columns are **Date**, **Type**, **Memo**, **Debit**, **Credit** and **Balance**. The first row is `Opening balance`, with the figure in the Balance column. Each line follows, with the balance after it. The last row, `Closing balance`, in bold, carries the debit total, the credit total and the closing balance.

- **Date** opens the journal entry the line belongs to.
- **Type** says where the entry came from: `Journal`, `Invoice`, `Payment`, `Bill`, `Bill payment`, `Bank`, `Opening`, `Recurring`, `Reversal`, `Between companies` or `Depreciation`.
- **Memo** is the line's memo, or the entry's memo when the line has none, or `—` when neither has one. When both exist, the entry's memo follows in small grey text.

Only posted entries appear. Before anything is posted in the period: `Nothing posted in this period` and `Only posted entries appear here — drafts and voided entries are never part of the ledger.`

## A long period

The report shows up to 5,000 lines. Past that, a warning above the panels reads `Showing the first 5000 of 8214 lines. Closing balances below are as at the last line shown, not the end of the period — narrow the dates or pick a single account to see the whole thing.` Do as it says before relying on a closing balance.

## The file

**Export CSV** downloads `general-ledger_2026-08-01_2026-08-31.csv`, with the company's name at the end when you chose one. The columns are `Account`, `Date`, `Source`, `Entry memo`, `Line memo`, `Debit`, `Credit` and `Balance`. Each account has an `Opening balance` row, its lines and a `Closing balance` row. A `Totals` row closes the file, followed by `Company: ...` when you keep more than one and the note about money between your companies when it applies. When the report was cut short, the very first row of the file says so: `INCOMPLETE — showing the first 5000 of 8214 lines for 2026-08-01 to 2026-08-31. Narrow the dates or filter to fewer accounts.`

Everyone can run this report.
