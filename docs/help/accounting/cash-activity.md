# Cash Activity

> Money in and out of every bank, cash and credit card account over a period: opening balance, movement and closing balance, account by account.
> **Route:** /dashboard/m/accounting/reports/cash
> **Order:** 270

## The page

**Cash Activity** from the Reports page. The line under the title reads, for example, `Hilltop Farm · 2026-08-01 to 2026-08-31`, naming the company instead when you keep more than one. **Export CSV** and **Print** sit at the top right. See [Reports](reports.md).

There is no Basis control. Cash is cash on either basis, so the report reads the same.

## The controls

- **Preset**, **From**, **To.** The dates start on this month.
- **Company.** Only when you keep more than one: `All companies (combined)` or one company. There is no consolidated view here. Every account belongs to one company, and a transfer moves real money from one to another, so the group's cash is the sum either way.

Click **Run**.

## The report

Two panels, `Cash accounts` and `Credit cards`. A panel with nothing in it reads `No activity in this period.`

The columns are **Account**, **Opening**, then **Money in** and **Money out** for cash accounts, or **Charges** and **Payments** for credit cards, then **Net** and **Closing**. A bold `Total` row closes each panel. An account with no opening balance and no movement is left out.

## The file

**Export CSV** downloads `cash-activity_2026-08-01_2026-08-31.csv`, with the company's name at the end when you chose one. The columns are `Account`, `Opening`, `In`, `Out`, `Net` and `Closing`, with a row for each group's name, its accounts indented under it, a `Total` row for the group, and `Company: ...` at the end when you keep more than one.

Everyone can run this report.
