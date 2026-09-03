# Banking

> Your bank and card accounts: the cards and their balances, connecting a feed, adding an account by hand, and recording money in or out without waiting for the feed.
> **Route:** /dashboard/m/accounting/banking
> **Order:** 130

## The page

**Banking** in the strip. The line under the title reads `Bank feeds, imports, and reconciliation for [your business].`

At the right, everyone sees **Rules**, which opens your bank rules. Owners also see **Add manually**, **Quick add** once at least one account exists, and **Connect a bank** when a live bank feed is switched on for your deployment. Without a live feed, transactions arrive by CSV import. When the feed is running against test banks a line says so: `Plaid is in sandbox mode — bank connections use Plaid's test institutions, not real banks.`

## The account cards

Each bank or card account is a card. Click it to open the account's transactions.

- The name, with a `closed` badge if the account has been closed.
- A line with the company (when you keep more than one), the kind, `checking`, `savings` or `credit card`, the institution, the last four digits, and `connected` when a feed is linked.
- **Balance**, or **Owed** for a credit card, as of today. Figures carry no currency symbol, and a card you owe on reads as a positive number.
- `3 to review` when transactions are waiting.

Balances here add up every entry that touched the account, whichever company posted it.

Before any exist, the page says **Connect a bank** and `Connect an account or add one manually, and the feed starts filling in.` The buttons are in the title row.

## Adding an account by hand

**Add manually** opens **Add a bank account**: `Creates the register and its ledger account. Use CSV import (or connect via Plaid later) to feed it.`

- **Company.** Only when you keep more than one. `This cannot be changed later. Only this company's invoices, bills and journals may use the account.`
- **Name.** Required, for example `Chase Operating`.
- **Type.** `Checking`, `Savings` or `Credit card`.
- **Institution (optional).**
- **Last 4 digits (optional).**
- **Opening balance (optional)**, or **Amount owed (optional)** for a card. The balance on the day you start keeping books in Yosher.
- **As of.** The date of that balance. Required when a balance is entered: `Opening balance needs an as-of date`.

Click **Add account**. You see `Bank account added`. The account gets its own ledger account in the chart, and an opening balance is posted against Opening Balance Equity.

The name, institution and last four cannot be changed afterwards.

## Connecting a feed

When **Connect a bank** is shown, it opens the bank's own sign-in. Afterwards a dialog, `Link accounts from [bank]`, lists the accounts found, each ticked. Click **Link 2 accounts**. You see `Linked 2 accounts`. Each becomes an account here with its own ledger account.

A connected bank shows as a card of its own with `connected`, or `reconnect needed` when the bank wants you to sign in again. **Sync now** pulls the latest transactions: `Synced: 12 new, 0 updated, 0 removed`. **Disconnect** asks `Disconnect [bank]?`: `Everything already imported stays in your books, reconciled or not — only the feed stops, so new transactions will not arrive on their own.`

## Quick add

For money that moved without a feed to catch it. The dialog reads `Record money in or out without waiting for the bank feed.`

- **Direction.** `Money out (expense)` or `Money in (income)`.
- **Date.**
- **Bank account.**
- **Category.** An expense account for money out, an income account for money in.
- **Amount.**
- **Memo (optional).**
- **Tags (optional).** When your business has lines of business or other tags.

Click **Add**. You see `Transaction added`. It posts straight to the books, in the account's company. A closed account or a date in a closed month is refused, with the reason.
