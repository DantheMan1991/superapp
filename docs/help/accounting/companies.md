# Companies

> Keeping more than one set of books: adding a company, the default company, deactivating one, and recording money moving between two of your companies.
> **Route:** /dashboard/m/accounting/companies
> **Order:** 330

## Getting here

Companies is not in the strip. Open it from the **Companies** card on the accounting Overview, which reads `One set of books. Add another for a second LLC.` while you keep one company, and `Each keeps its own books — reports can scope to one` once you keep more.

## The page

The title is **Companies** and the line under it reads `Each company keeps its own books — its own trial balance, profit & loss and balance sheet. The chart of accounts, customers, vendors and contacts are shared across all of them.` Owners see **Add a company** at the top right, and **Move money** beside it once there are two.

With two or more companies, a grey panel explains how they fit together: `Reports carry a Company control, and every statement and export says which one it covers. Invoices, bills and bank accounts each belong to one company, and money moving between two of them is recorded on both sides at once.`

## Who owes whom

When one of your companies owes another, a table above the list shows it: **Company**, **Owed by / to**, which reads `is owed by Maple Street LLC` or `owes Maple Street LLC`, and **Balance**. The figures come from the two affiliate accounts in each company's books, and a transfer the other way settles them.

## The list

- **Company.** The name, with a `Default` badge on the default company and `Inactive` on one that has been deactivated.
- **Legal name.** The name on the tax return, or `—`. Hidden on a narrow screen.
- **Posted entries.** How many posted journal entries are in that company's books.
- **Actions.** Owners only. **Edit** on every row. **Make default** on a row that is neither the default nor inactive. **Deactivate**, or **Reactivate**, on every row but the default.

## The default company

Every invoice, bill and bank transaction posts into the default company's books. A journal entry can name any company. To change it, click **Make default**. The dialog is titled `Make Maple Street LLC the default company?` and reads `From now on every invoice, bill, bank transaction and recurring journal posts into its books. Entries already posted do not move.` Click **Make it the default**. You see `Maple Street LLC is now the default`.

## Adding a company

Click **Add a company**. The dialog is titled `Add a company` and reads `A second company keeps its own books — its own trial balance, profit & loss and balance sheet. The chart of accounts, customers, vendors and contacts stay shared, so you still manage everything in one place.`

- **Name.** Required. For example `Maple Street LLC`.
- **Legal name (optional).** `The name on the tax return, if it differs`.

Under the fields: `Nothing moves across. Invoices, bills and bank transactions keep posting to your default company until you change it; a journal entry can name this one straight away.` Click **Add company**. The button reads `Adding…`, then you see `Maple Street LLC added`.

The two accounts that track money between companies are created for you. If they are missing, the page says `This business is missing the Due from / Due to Affiliates accounts. Toggle the accounting module off and on again to add them.` Ask us rather than toggling the module yourself.

## Editing and deactivating

**Edit** opens `Edit Maple Street LLC` with **Name** and **Legal name**. Click **Save**. The button reads `Saving…`, then you see `Saved`.

**Deactivate** takes a company out of the pickers without touching its books. You see `Maple Street LLC deactivated`, and the row shows `Inactive`. Its entries, reports and closes stay as they are, and it still appears in the Company control on reports and on the Close page, because a wound-up company still has a last period to close. **Reactivate** brings it back: `Maple Street LLC reactivated`. The default company cannot be deactivated. Make another one the default first, or you see `This is the default company — make another one the default first.` A company cannot be deleted, because its books are part of your record.

## Money between your companies

When one company pays for something on another's behalf, or moves cash to it, click **Move money**. The dialog is titled `Move money between companies` and reads `Recorded on both sides at once: the paying company is owed the amount, and the other owes it, until it is settled.`

- **Paid from.** `Which account did the money leave?` The bank accounts of all your companies, listed as `Maple Street LLC · Checking`. The account's company is the one that paid.
- **To company.** `Which company benefited?` Any company but the payer.
- **What did they get?** Shown once you pick the company. `Cash into an account, or what it paid for`. The receiving company's own bank accounts are listed first, as `Checking (cash in)`, then its ordinary accounts as `6100 · Rent`. Under it: `Their own account if the cash reached them, otherwise whatever it paid for on their behalf.` It is required. A transfer that reached no account and bought nothing is not a transfer.
- **Amount.** `0.00`.
- **Date.**
- **Memo.** `What was it for?`

Click **Record transfer**. The button reads `Recording…`, then you see `Transfer recorded in both companies`. Two journal entries are posted, one in each company's books, linked to each other, and the who-owes-whom table updates. An amount of zero answers `Enter an amount above zero.` The same company on both sides answers `Pick two different companies.` Leaving the third field empty answers `Say what the receiving company got — cash into an account, or what was paid for on its behalf.`

Neither half of a transfer can be voided or reversed from its journal entry page: `This is one half of a transfer between two of your companies. Undo it from the transfer, so both sides move together.` There is no undo for a transfer on any page yet. If one was recorded wrongly, record one the other way, or ask us.

## The Company control elsewhere

Once you keep two companies, list pages such as the journal and the bills list carry a **Company** select, `All companies` or one company, and reports carry a **Company** control with combined and consolidated views. See [Reports](reports.md). Every statement and export names the company it covers.

Only an owner can add, edit, deactivate or move money. Staff and accountants see the list.
