# Cash Activity

> Money in and out of every bank, cash and credit card account over a period: opening balance, movement and closing balance, account by account.
> **Route:** /dashboard/m/accounting/reports/cash
> **Order:** 270

Open **Reports** in the accounting menu and click `Cash Activity`. Set the dates and click {button:Run|outline}. The line under the title reads, for example, `Hilltop Farm · 2026-08-01 to 2026-08-31`, naming the company instead when you keep more than one. There is no `Basis` control. Cash is cash on either basis, so the report reads the same.

## What you see

- **{button:Export CSV|outline|download}** and **{button:Print|outline|printer}.** See [Reports](reports.md).
- **`Preset`, `From`, `To`.** The dates start on this month.
- **`Company`.** Only when you keep more than one: `All companies (combined)` or one company. There is no consolidated view here. Every account belongs to one company, and a transfer moves real money from one to another, so the group's cash is the sum either way.
- **The report.** Two panels, `Cash accounts` and `Credit cards`. The columns are `Account`, `Opening`, then `Money in` and `Money out` for cash accounts, or `Charges` and `Payments` for credit cards, then `Net` and `Closing`. A bold `Total` row closes each panel. An account with no opening balance and no movement is left out.

## How to run it

1. Set the dates, and `Company` if you keep more than one.
2. Click {button:Run|outline}.

## How to export it

1. Click {button:Export CSV|outline|download}. The file is `cash-activity_2026-08-01_2026-08-31.csv`, with the company's name at the end when you chose one.
2. The columns are `Account`, `Opening`, `In`, `Out`, `Net` and `Closing`, with a row for each group's name, its accounts indented under it, a `Total` row for the group, and `Company: ...` at the end when you keep more than one.

## Messages

| Message | What it means |
| --- | --- |
| `No activity in this period.` | The panel's accounts had no opening balance and no movement. |

## Who can do what

Everyone can run this report.
