# Banking

> Your bank and card accounts: the cards and their balances, connecting a feed, adding an account by hand, and recording money in or out without waiting for the feed.
> **Route:** /dashboard/m/accounting/banking
> **Order:** 10
> **Area:** Banking

Open **Banking** in the accounting menu. The line under the title reads `Bank feeds, imports, and reconciliation for [your business].` Each bank or card account is a card. Click one to open its transactions. To add an account, click {button:Add manually|outline}, or {button:Connect a bank|primary} when a live feed is switched on for your deployment.

## What you see

- **The buttons.** {button:Rules|outline|filter} opens your bank rules, for everyone. Owners also see {button:Add manually|outline}, {button:Quick add|outline} once at least one account exists, and {button:Connect a bank|primary} when a live bank feed is switched on. Without a live feed, transactions arrive by CSV import. When the feed is running against test banks a line says so: `Plaid is in sandbox mode — bank connections use Plaid's test institutions, not real banks.`
- **An account card.** The name, with {badge:closed|outline} if the account has been closed. A line with the company (when you keep more than one), the kind, `checking`, `savings` or `credit card`, the institution, the last four digits, and {badge:connected|success} when a feed is linked. `Balance`, or `Owed` for a credit card, as of today. Figures carry no currency symbol, and a card you owe on reads as a positive number. `3 to review` when transactions are waiting. Balances here add up every entry that touched the account, whichever company posted it.
- **A connected bank.** A card of its own with {badge:connected|success}, or {badge:reconnect needed|destructive} when the bank wants you to sign in again, and the buttons {button:Sync now|outline} and {button:Disconnect|ghost}.

## How to add an account by hand

1. Click {button:Add manually|outline}. The dialog is `Add a bank account` and reads `Creates the register and its ledger account. Use CSV import (or connect via Plaid later) to feed it.`
2. Pick `Company` if you keep more than one: `This cannot be changed later. Only this company's invoices, bills and journals may use the account.`
3. Fill in `Name`, such as `Chase Operating`, and pick `Type`: `Checking`, `Savings` or `Credit card`. Add `Institution (optional)` and `Last 4 digits (optional)` if you like.
4. Fill in `Opening balance (optional)`, or `Amount owed (optional)` for a card: the balance on the day you start keeping books in Yosher. Set `As of`, the date of that balance. It is required when a balance is entered.
5. Click {button:Add account|primary}. You see `Bank account added`. The account gets its own ledger account in the chart, and an opening balance is posted against Opening Balance Equity.

The name, institution and last four cannot be changed afterwards.

## How to connect a live feed

1. Click {button:Connect a bank|primary}. Your bank's own sign-in opens.
2. Afterwards, the dialog `Link accounts from [bank]` lists the accounts found, each checked, with its kind. Click {button:Link 2 accounts|primary}. You see `Linked 2 accounts`. Each becomes an account here with its own ledger account.
3. Click {button:Sync now|outline} whenever you want the latest transactions. You see `Synced: 12 new, 0 updated, 0 removed`.

To stop the feed, click {button:Disconnect|ghost}. The dialog is `Disconnect [bank]?` and reads `Everything already imported stays in your books, reconciled or not — only the feed stops, so new transactions will not arrive on their own.`

## How to record money that moved without a feed

1. Click {button:Quick add|outline}. The dialog reads `Record money in or out without waiting for the bank feed.`
2. Pick `Direction`: `Money out (expense)` or `Money in (income)`. Set `Date` and `Bank account`.
3. Pick `Category`: an expense account for money out, an income account for money in. Fill in `Amount`, and `Memo (optional)` and `Tags (optional)` if you use them.
4. Click {button:Add|primary}. You see `Transaction added`. It posts straight to the books, in the account's company.

## Messages

| Message | What it means |
| --- | --- |
| `Connect a bank` and `Connect an account or add one manually, and the feed starts filling in.` | No accounts exist yet. The buttons are in the title row. |
| `Opening balance needs an as-of date` | You entered a balance without its date. |
| `Plaid is in sandbox mode — bank connections use Plaid's test institutions, not real banks.` | The feed is running against test banks. |

## Not on this page

Transactions, imports, rules and reconciliation are on each account's own page and the Rules page. A closed account, or a date in a closed month, refuses a quick add with the reason.

## Who can do what

Everyone sees the cards and {button:Rules|outline|filter}. Only owners add, connect, sync, disconnect and quick add.
