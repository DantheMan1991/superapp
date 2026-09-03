# Balance Sheet

> What the business owns and owes on a date, with Retained Earnings and Net Income worked out for you, a check that it balances, and a comparison with a year earlier.
> **Route:** /dashboard/m/accounting/reports/balance-sheet
> **Order:** 250
> **Area:** Reports

Open **Reports** in the accounting menu and click `Balance Sheet`. Set the controls and click {button:Run|outline}. The line under the title reads, for example, `Hilltop Farm · as of 2026-08-31 · fiscal year begins 2026-01-01 · Accrual basis`, naming the company instead when you keep more than one.

## What you see

- **The badge at the top right.** {badge:In balance|success}, or {badge:Out of balance|destructive}. It says whether Total Assets equals Total Liabilities & Equity. Out of balance means an entry in the books does not balance; the Trial Balance page shows the two columns side by side.
- **{button:Export CSV|outline|download}** and **{button:Print|outline|printer}.** See [Reports](reports.md) for both, and for the line about the basis reports open on.
- **`As of`.** The date. Today to begin with.
- **`Company`.** Only when you keep more than one: `All companies (combined)`, `All companies (consolidated)`, or one company.
- **`Basis`.** `Accrual` or `Cash`.
- **`Compare`.** `No comparison`, or `Previous year`, which adds a column for the same date a year earlier.
- **The report.** The first column is `Account`, then `As of 2026-08-31`, and `As of 2025-08-31` beside it when you compare. `Assets`: `Current Assets`, `Fixed Assets` and `Other Assets`, each with its accounts, then `Total Assets`. `Liabilities`: `Current Liabilities`, `Long-Term Liabilities` and `Other Liabilities`, then `Total Liabilities`. `Equity`: your equity accounts, then two lines worked out from the rest of the books, in italics: `Retained Earnings`, the profit of every earlier fiscal year, shown when it is not zero, and `Net Income`, the profit of this fiscal year to the date, always shown. Then `Total Equity` and `Total Liabilities & Equity`. Accounts with a zero balance are left out. Codes are shown before the names.

Money owed between your companies sits in current assets and current liabilities, in the two affiliate accounts. On the consolidated view the two cancel out and neither line appears.

## How to run it

1. Set `As of`, and `Company`, `Basis` and `Compare` if you need them.
2. Click {button:Run|outline}.

## How to export it

1. Click {button:Export CSV|outline|download}. The file is `balance-sheet_2026-08-31_accrual.csv`, with the company's name at the end when you chose one.
2. The last rows record the basis, then `Company: ...` when you keep more than one, then the note about money between your companies when it applies.

## Messages

| Message | What it means |
| --- | --- |
| `Not eliminated: 2 journal lines in the affiliate accounts with no linked transfer to follow (net 500.00 debit).` | On a consolidated run, money between your companies was written by hand. See [Reports](reports.md). |

## Who can do what

Everyone can run this report.
