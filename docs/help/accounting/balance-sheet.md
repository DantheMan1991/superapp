# Balance Sheet

> What the business owns and owes on a date, with Retained Earnings and Net Income worked out for you, a check that it balances, and a comparison with a year earlier.
> **Route:** /dashboard/m/accounting/reports/balance-sheet
> **Order:** 250

## The page

**Balance Sheet** from the Reports page. The line under the title reads, for example, `Hilltop Farm · as of 2026-08-31 · fiscal year begins 2026-01-01 · Accrual basis`, naming the company instead when you keep more than one. At the top right, a badge reads **In balance** in green, or **Out of balance** in red, then **Export CSV** and **Print**. See [Reports](reports.md) for both, and for the line about the basis reports open on.

## The controls

- **As of.** The date. Today to begin with.
- **Company.** Only when you keep more than one: `All companies (combined)`, `All companies (consolidated)`, or one company.
- **Basis.** `Accrual` or `Cash`.
- **Compare.** `No comparison`, or `Previous year`, which adds a column for the same date a year earlier.

Click **Run**.

## The report

The first column is **Account**, then `As of 2026-08-31`, and `As of 2025-08-31` beside it when you compare.

- **Assets**: `Current Assets`, `Fixed Assets` and `Other Assets`, each with its accounts, then **Total Assets**.
- **Liabilities**: `Current Liabilities`, `Long-Term Liabilities` and `Other Liabilities`, then **Total Liabilities**.
- **Equity**: your equity accounts, then two lines worked out from the rest of the books, in italics. `Retained Earnings` is the profit of every earlier fiscal year, shown when it is not zero. `Net Income` is the profit of this fiscal year to the date, always shown. Then **Total Equity** and **Total Liabilities & Equity**.

The badge at the top says whether Total Assets equals Total Liabilities & Equity. Out of balance means an entry in the books does not balance. The Trial Balance page shows the two columns side by side.

Accounts with a zero balance are left out. Codes are shown before the names.

Money owed between your companies sits in current assets and current liabilities, in the two affiliate accounts. On the consolidated view the two cancel out and neither line appears. A note appears under the controls when money between your companies was written by hand rather than recorded as a transfer. See [Reports](reports.md).

## The file

**Export CSV** downloads `balance-sheet_2026-08-31_accrual.csv`, with the company's name at the end when you chose one. The last rows record the basis, then `Company: ...` when you keep more than one, then the note about money between your companies when it applies.

Everyone can run this report.
