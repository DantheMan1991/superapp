# General Ledger

> Every posted line in a period, account by account, with opening and running balances, or one account on its own as a transaction detail.
> **Route:** /dashboard/m/accounting/reports/general-ledger
> **Order:** 260

Open **Reports** in the accounting menu and click `General Ledger`. Set the controls and click {button:Run|outline}. The line under the title reads, for example, `Hilltop Farm · 2026-08-01 to 2026-08-31 · accrual basis`, with the account's code and name in the middle when you picked one, and the company's name first when you keep more than one. This report is accrual only. Cash basis changes the totals of accounts, not the dates of lines, so a cash-basis ledger would show lines nothing in the books backs.

## What you see

- **{button:Export CSV|outline|download}** and **{button:Print|outline|printer}.** See [Reports](reports.md).
- **`Preset`, `From`, `To`.** The dates start on this month.
- **`Account`.** `All accounts`, or one account, listed as `1000 · Checking`. Picking one turns the page into that account's transaction detail.
- **`Company`.** Only when you keep more than one: `All companies (combined)`, `All companies (consolidated)`, or one company.
- **The report.** One panel per account with an opening balance or activity in the period, headed with the code, the name, and `Opening 1,200.00 · Closing 950.00` at the right. The columns are `Date`, `Type`, `Memo`, `Debit`, `Credit` and `Balance`. The first row is `Opening balance`, with the figure in the `Balance` column. Each line follows, with the balance after it. The last row, `Closing balance`, in bold, carries the debit total, the credit total and the closing balance. `Date` opens the journal entry the line belongs to. `Type` says where the entry came from: `Journal`, `Invoice`, `Payment`, `Bill`, `Bill payment`, `Bank`, `Opening`, `Recurring`, `Reversal`, `Between companies` or `Depreciation`. `Memo` is the line's memo, or the entry's memo when the line has none, or `—` when neither has one; when both exist, the entry's memo follows in small gray text. Only posted entries appear.

## How to run it

1. Set the dates. Pick one `Account` for a transaction detail, or leave `All accounts`.
2. Click {button:Run|outline}.

The report shows up to 5,000 lines. Past that, a warning above the panels tells you the closing balances are cut short. Narrow the dates or pick one account before relying on a closing balance.

## How to export it

1. Click {button:Export CSV|outline|download}. The file is `general-ledger_2026-08-01_2026-08-31.csv`, with the company's name at the end when you chose one.
2. The columns are `Account`, `Date`, `Source`, `Entry memo`, `Line memo`, `Debit`, `Credit` and `Balance`. Each account has an `Opening balance` row, its lines and a `Closing balance` row. A `Totals` row closes the file, followed by `Company: ...` when you keep more than one and the note about money between your companies when it applies. When the report was cut short, the very first row of the file says so: `INCOMPLETE — showing the first 5000 of 8214 lines for 2026-08-01 to 2026-08-31. Narrow the dates or filter to fewer accounts.`

## Messages

| Message | What it means |
| --- | --- |
| `Showing the first 5000 of 8214 lines. Closing balances below are as at the last line shown, not the end of the period — narrow the dates or pick a single account to see the whole thing.` | The period has more lines than the page shows. Narrow it. |
| `No movement in this period.` | The account has an opening balance and nothing in the period. |
| `Nothing posted in this period` and `Only posted entries appear here — drafts and voided entries are never part of the ledger.` | No posted entry falls in the period. |

## Not on this page

There is no `Basis` control. A cash-basis ledger is not built.

## Who can do what

Everyone can run this report.
