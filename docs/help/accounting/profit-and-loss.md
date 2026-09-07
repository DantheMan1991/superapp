# Profit & Loss

> Income, cost of goods sold and expenses over a period, on accrual or cash basis, with a comparison period, columns by month, quarter or year, or a column per tag.
> **Route:** /dashboard/m/accounting/reports/pnl
> **Order:** 240
> **Area:** Reports

Open **Reports** in the accounting menu and click `Profit & Loss`. Set the controls and click {button:Run|outline}. The line under the title says what the report covers, for example `Hilltop Farm · 2026-08-01 to 2026-08-31 · Accrual basis`. It names the company instead when you keep more than one, adds ` · vs 2026-07-01 to 2026-07-31` when you compare, and ` · by month`, ` · by quarter` or ` · by year` when the columns are periods.

## What you see

- **{button:Export CSV|outline|download}** and **{button:Print|outline|printer}** at the top right. See [Reports](reports.md) for both, and for the line about the basis reports open on.
- **`Preset`, `From`, `To`.** The dates start on this month. `Preset` reads `Custom` until you pick `This month`, `Last month`, `This quarter`, `This fiscal year` or `Last fiscal year`.
- **`Company`.** Only when you keep more than one: `All companies (combined)`, `All companies (consolidated)`, or one company.
- **`Basis`.** `Accrual` or `Cash`.
- **`Columns`.** `One total`, or a column per period with a `Total` column at the end that adds them up: `By month` for calendar months, headed `Aug 2026`, `Sep 2026` and so on; `By quarter` for quarters of your fiscal year, headed `Q1 2026` when your year starts in January and `Q1 FY2026` otherwise, the fiscal year named for the year it ends in; `By year` for fiscal years, headed `2026` or `FY2026`. The first and last columns cover only the part of the period inside your dates, so the columns always add up to the one-total report. Up to 24 columns.
- **`Compare`.** `No comparison`, `Previous period`, the stretch of the same length just before your dates, or `Previous year`, the same dates a year earlier. The comparison is a second column headed with its dates.
- **`Split by`.** Only when you use tags. `No split`, or a tag type such as `Enterprise` for a column per tag. The eight tags with the most activity get a column each, then `Other` for the rest, `Unassigned` for lines with no tag, and `Total`.
- **The report.** The first column is `Account`, then the period, headed `2026-08-01 – 2026-08-31`, and the comparison beside it when you asked for one. `Income`, each income account, then `Total Income`. `Cost of Goods Sold`, then `Total Cost of Goods Sold` and `Gross Profit`, when you have cost of goods sold accounts with activity. `Expenses`, then `Total Expenses`. `Net Operating Income`, when there is a cost of goods sold section or an other income or other expense section. `Other Income` and `Other Expense`, each with its total, when they have activity. `Net Income`, in bold, always. An account with sub-accounts shows them indented under it and a `Total [account]` line. Accounts with nothing in the period are left out. Codes are shown in a fixed-width font before the names.

On accrual basis the report reads the books as posted. On cash basis, invoice income and bill expense count on the dates they were paid, so an unpaid invoice adds nothing to income yet.

## How to run it

1. Set the dates, and `Company` and `Basis` if you need them.
2. Pick one column axis: `Columns` for months, quarters or years, `Compare` for a second period, or `Split by` for tags. With period columns, `Compare` is ignored, and with either of those, `Split by` is ignored.
3. Click {button:Run|outline}.

## How to export it

1. Click {button:Export CSV|outline|download}. The file is `profit-and-loss_2026-08-01_2026-08-31_accrual.csv`, with `-by-month`, `-by-quarter` or `-by-year` after the name when the columns are periods, and the company's name at the end when you chose one.
2. Sub-accounts are indented with spaces. The last rows record `Accrual basis` or `Cash basis`, then `Company: ...` when you keep more than one, then the note about money between your companies when it applies.

## Messages

| Message | What it means |
| --- | --- |
| `That's too long a range for that many columns — 24 at most. Shorten the range, or pick larger columns.` | The range needs more than 24 columns at the size you picked: over 24 months by month, over six years by quarter. Shorten it, or switch to quarters or years. The table is not shown until you do. |
| `Not eliminated: 2 journal lines in the affiliate accounts with no linked transfer to follow (net 500.00 debit).` | On a consolidated run, money between your companies was written by hand. See [Reports](reports.md). |

## Not on this page

Columns and a comparison cannot be shown together; pick one. Quarters and years follow your fiscal year, set on the Close page, and there is no calendar-year option when your year starts in another month.

## Who can do what

Everyone can run this report.
