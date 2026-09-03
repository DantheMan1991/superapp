# Profit & Loss

> Income, cost of goods sold and expenses over a period, on accrual or cash basis, with a comparison period, monthly columns, or a column per tag.
> **Route:** /dashboard/m/accounting/reports/pnl
> **Order:** 240

## The page

**Profit & Loss** from the Reports page. The line under the title says what the report covers, for example `Hilltop Farm · 2026-08-01 to 2026-08-31 · Accrual basis`. It names the company instead when you keep more than one, adds ` · vs 2026-07-01 to 2026-07-31` when you compare, and ` · by month` when the columns are months. **Export CSV** and **Print** sit at the top right. See [Reports](reports.md) for both, and for the line about the basis reports open on.

## The controls

- **Preset**, **From**, **To.** The dates start on this month. Preset reads `Custom` until you pick `This month`, `Last month`, `This quarter`, `This fiscal year` or `Last fiscal year`.
- **Company.** Only when you keep more than one: `All companies (combined)`, `All companies (consolidated)`, or one company.
- **Basis.** `Accrual` or `Cash`.
- **Columns.** `One total`, or `By month` for a column per calendar month, headed `Aug 2026`, `Sep 2026` and so on, with a `Total` column at the end that adds them up. Up to 24 months. A longer range shows `That's too long a range for monthly columns — pick 24 months or fewer.` instead of the report.
- **Compare.** `No comparison`, `Previous period`, the stretch of the same length just before your dates, or `Previous year`, the same dates a year earlier. The comparison is a second column headed with its dates.
- **Split by.** Only when you use tags. `No split`, or a tag type such as `Enterprise` for a column per tag. The eight tags with the most activity get a column each, then `Other` for the rest, `Unassigned` for lines with no tag, and `Total`.

Click **Run**. One column axis at a time: with monthly columns, Compare is ignored, and with either of those, Split by is ignored.

## The report

The first column is **Account**, then the period, headed `2026-08-01 – 2026-08-31`, and the comparison beside it when you asked for one.

- **Income**, each income account, then **Total Income**.
- **Cost of Goods Sold**, then **Total Cost of Goods Sold** and **Gross Profit**, when you have cost of goods sold accounts with activity.
- **Expenses**, then **Total Expenses**.
- **Net Operating Income**, when there is a cost of goods sold section or an other income or other expense section.
- **Other Income** and **Other Expense**, each with its total, when they have activity.
- **Net Income**, in bold, always.

An account with sub-accounts shows them indented under it and a `Total [account]` line. Accounts with nothing in the period are left out. Codes are shown in a fixed-width font before the names.

On accrual basis the report reads the books as posted. On cash basis, invoice income and bill expense count on the dates they were paid, so an unpaid invoice adds nothing to income yet.

## The file

**Export CSV** downloads `profit-and-loss_2026-08-01_2026-08-31_accrual.csv`, with `-by-month` after the name when the columns are months, and the company's name at the end when you chose one. Sub-accounts are indented with spaces. The last rows record `Accrual basis` or `Cash basis`, then `Company: ...` when you keep more than one, then the note about money between your companies when it applies.

## Money between your companies

The consolidated view is offered so that a group can see its profit as one, and so that a fee one of your companies charges another is cancelled out from the day you record one. A note appears under the controls when money between your companies was written by hand rather than recorded as a transfer. See [Reports](reports.md).

Everyone can run this report.
