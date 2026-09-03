# Companies

> Keeping more than one set of books: adding a company, the default company, deactivating one, and recording money moving between two of your companies.
> **Route:** /dashboard/m/accounting/companies
> **Order:** 330

Companies is not in the accounting menu. Open it from the `Companies` card on the accounting Overview, which reads `One set of books. Add another for a second LLC.` while you keep one company, and `Each keeps its own books — reports can scope to one` once you keep more. The line under the title reads `Each company keeps its own books — its own trial balance, profit & loss and balance sheet. The chart of accounts, customers, vendors and contacts are shared across all of them.` To add one, click {button:Add a company|primary}.

## What you see

- **The buttons.** Owners see {button:Add a company|primary} at the top right, and {button:Move money|outline} beside it once there are two.
- **The explainer.** With two or more companies, a gray panel: `Reports carry a Company control, and every statement and export says which one it covers. Invoices, bills and bank accounts each belong to one company, and money moving between two of them is recorded on both sides at once.`
- **Who owes whom.** When one of your companies owes another, a table above the list: `Company`, `Owed by / to`, which reads `is owed by Maple Street LLC` or `owes Maple Street LLC`, and `Balance`. The figures come from the two affiliate accounts in each company's books, and a transfer the other way settles them.
- **The list.** `Company`, the name, with {badge:Default|secondary} on the default company and {badge:Inactive|outline} on one that has been deactivated. `Legal name`, the name on the tax return, or `—`, hidden on a narrow screen. `Posted entries`, how many posted journal entries are in that company's books. `Actions`, owners only: {button:Edit|outline} on every row, {button:Make default|outline} on a row that is neither the default nor inactive, and {button:Deactivate|ghost} or {button:Reactivate|ghost} on every row but the default.

Every invoice, bill and bank transaction posts into the default company's books. A journal entry can name any company.

## How to add a company

1. Click {button:Add a company|primary}. The dialog is `Add a company` and reads `A second company keeps its own books — its own trial balance, profit & loss and balance sheet. The chart of accounts, customers, vendors and contacts stay shared, so you still manage everything in one place.`
2. Fill in `Name`, such as `Maple Street LLC`, and `Legal name (optional)`, `The name on the tax return, if it differs`. Under the fields: `Nothing moves across. Invoices, bills and bank transactions keep posting to your default company until you change it; a journal entry can name this one straight away.`
3. Click {button:Add company|primary}. It reads `Adding…`, then you see `Maple Street LLC added`.

The two accounts that track money between companies are created for you.

## How to change the default company

1. Click {button:Make default|outline} on the row. The dialog is `Make Maple Street LLC the default company?` and reads `From now on every invoice, bill, bank transaction and recurring journal posts into its books. Entries already posted do not move.`
2. Click {button:Make it the default|primary}. You see `Maple Street LLC is now the default`.

## How to edit or deactivate a company

1. Click {button:Edit|outline}. The dialog is `Edit Maple Street LLC` with `Name` and `Legal name`. Click {button:Save|primary}. It reads `Saving…`, then you see `Saved`.
2. Click {button:Deactivate|ghost} to take a company out of the pickers without touching its books. You see `Maple Street LLC deactivated`, and the row shows {badge:Inactive|outline}. Its entries, reports and closes stay as they are, and it still appears in the `Company` control on reports and on the Close page, because a wound-up company still has a last period to close. {button:Reactivate|ghost} brings it back: `Maple Street LLC reactivated`.

A company cannot be deleted, because its books are part of your record.

## How to move money between companies

1. Click {button:Move money|outline}. The dialog is `Move money between companies` and reads `Recorded on both sides at once: the paying company is owed the amount, and the other owes it, until it is settled.`
2. Pick `Paid from`, `Which account did the money leave?`: the bank accounts of all your companies, listed as `Maple Street LLC · Checking`. The account's company is the one that paid.
3. Pick `To company`, `Which company benefited?`: any company but the payer.
4. Pick `What did they get?`, shown once you pick the company: `Cash into an account, or what it paid for`. The receiving company's own bank accounts are listed first, as `Checking (cash in)`, then its ordinary accounts as `6100 · Rent`. Under it: `Their own account if the cash reached them, otherwise whatever it paid for on their behalf.` It is required.
5. Fill in `Amount`, `Date` and `Memo`, `What was it for?`, then click {button:Record transfer|primary}. It reads `Recording…`, then you see `Transfer recorded in both companies`. Two journal entries are posted, one in each company's books, linked to each other, and the who-owes-whom table updates.

## Messages

| Message | What it means |
| --- | --- |
| `This is the default company — make another one the default first.` | The default company cannot be deactivated. |
| `This business is missing the Due from / Due to Affiliates accounts. Toggle the accounting module off and on again to add them.` | The two affiliate accounts are missing. Ask us rather than toggling the module yourself. |
| `Enter an amount above zero.` | The transfer amount is zero. |
| `Pick two different companies.` | The same company is on both sides. |
| `Say what the receiving company got — cash into an account, or what was paid for on its behalf.` | `What did they get?` is empty. |
| `This is one half of a transfer between two of your companies. Undo it from the transfer, so both sides move together.` | On a journal entry page: neither half of a transfer can be voided or reversed on its own. |

## Not on this page

There is no undo for a transfer on any page yet. If one was recorded wrongly, record one the other way, or ask us. Once you keep two companies, list pages such as the journal and the bills list carry a `Company` select, and reports carry a `Company` control with combined and consolidated views. See [Reports](reports.md).

## Who can do what

Only an owner can add, edit, deactivate or move money. Staff and accountants see the list.
