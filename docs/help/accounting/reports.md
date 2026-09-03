# Reports

> The seven financial reports, the controls they share, and how exporting, printing and the accrual or cash basis work.
> **Route:** /dashboard/m/accounting/reports
> **Order:** 230

Open **Reports** in the accounting menu. The line under the title reads `Financial statements for [your business], computed live from the ledger.` Every report is worked out from the posted entries at the moment you run it. Nothing is stored, so a report always agrees with the journal. Click a tile to open a report.

## What you see

- **`Profit & Loss`.** `Income, cost of goods sold, and expenses over a period — with comparisons and per-tag columns.` See [Profit & Loss](profit-and-loss.md).
- **`Balance Sheet`.** `What the business owns and owes as of a date, with computed Retained Earnings and Net Income.` See [Balance Sheet](balance-sheet.md).
- **`General Ledger`.** `Every posted line in the period, by account, with opening and running balances. Pick one account for a transaction detail.` See [General Ledger](general-ledger.md).
- **`Cash Activity`.** `Money in and out of every bank, cash, and credit-card account over a period.` See [Cash Activity](cash-activity.md).
- **`A/R Aging`.** `Who owes what and how overdue — open invoice balances bucketed by days past due.` See [A/R Aging](ar-aging.md).
- **`A/P Aging`.** `What the business owes vendors — open bill balances bucketed by days past due.` See [A/P Aging](ap-aging.md).
- **`Sales Tax Summary`.** `Taxable and non-taxable sales by rate, and what you have collected but not yet remitted.` See [Sales Tax Summary](sales-tax.md).

The trial balance is not on this page. It has its own place in the accounting menu, `Trial Balance`.

## How to run a report

1. Open the report and set its controls. On a report that covers a period, the dates start on this month, and `Preset` reads `Custom` until you pick `This month`, `Last month`, `This quarter`, `This fiscal year` or `Last fiscal year`. Picking one fills `From` and `To`. Typing a date puts `Preset` back to `Custom`. The quarter is the calendar quarter; the fiscal year presets follow the fiscal year start in your business settings. On a report that shows a position on one day, set `As of`, today to begin with.
2. Pick `Company` if you keep more than one. `All companies (combined)` adds the companies together. `All companies (consolidated)`, offered on the Profit & Loss, Balance Sheet and General Ledger, also cancels out money owed between your companies. Or pick one company. The company you chose is named in the line under the title and in every export. The other four reports do not offer the consolidated view; if a link asks one of them for it, the page reports that it could not be found.
3. Pick `Basis` on the Profit & Loss and Balance Sheet. `Accrual` reads the books as posted. `Cash` counts invoice income and bill expense on the dates they were paid. The other reports read the same on either basis, or are accrual only, and say so.
4. Click {button:Run|outline}. The page reloads with the report, and the address bar carries your choices, so you can bookmark a report or send the link to somebody on your team.

A report's own controls, `Account`, `Columns`, `Compare` and `Split by`, are described on its page.

## How to change the basis reports open on

Reports open on the basis saved for your business, accrual to begin with.

1. Run a report on the other basis. A line appears under the title: `Reports open on accrual basis.`
2. As an owner, click {button:Always open them on cash|link} beside it. It is followed by `— this is the basis you file on, not a change to the books.` You see `Reports will open on cash basis`, and every report opens on that basis from now on.

Staff and accountants see `You are looking at cash. An owner can change what opens by default.` instead. The line is not shown while you are on the saved basis.

## How to export or print a report

1. On the Profit & Loss, Balance Sheet, Cash Activity and General Ledger, click {button:Export CSV|outline|download}. It reads `Exporting…` while the file is built. The file's last rows record the basis, and the company when you keep more than one, so a saved file always says what it covers. If the export fails, the reason is shown at the bottom of the screen.
2. Or click {button:Print|outline|printer}. Your browser's print dialog opens. The controls and the accounting menu are left off the printed page.

The two aging reports and the Sales Tax Summary have no export and no print button. The full set of your books, with the current statements, is exported from the Close page. See [Close](close.md).

## Messages

| Message | What it means |
| --- | --- |
| `Not eliminated: 2 journal lines in the affiliate accounts with no linked transfer to follow (net 500.00 debit).` and `Record money moving between your companies as a transfer, so both sides are linked and consolidation can follow them.` | On a consolidated run, money between your companies was written by hand rather than recorded as a transfer. Record it with {button:Move money|outline} on the Companies page and the note goes. See [Companies](companies.md). |

## Not on this page

The trial balance has its own page. The books export lives on the Close page.

## Who can do what

Everyone can run every report. Only an owner can change the basis reports open on.
