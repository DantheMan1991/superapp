# Reconcile an account

> Matching your books to a bank statement: starting from the statement's closing figures, checking off what cleared, getting the difference to zero, and what a completed reconciliation locks.
> **Route:** /dashboard/m/accounting/banking/*/reconcile
> **Order:** 160

Open an account from **Banking** and click {button:Reconcile|outline}. Owners only. A reconciliation proves that your books and the bank agree up to a statement date. The title reads `Reconcile — [account]` and the line under it `Match the books to the bank statement. Cleared entries are locked — uncheck a transaction to edit its entry.`

## What you see

- **`Start a reconciliation`.** `From the top of your bank statement.` For a credit card it adds `For credit cards, enter the balance as printed (positive = amount owed).` The fields `Statement end date` and `Statement ending balance`, the check box `Negative balance`, and {button:Start|primary}.
- **The summary**, once one is in progress, with {badge:in progress|secondary} in the title row. Three figures: `Statement`, with its date and balance; `Cleared (prior + checked)`, what earlier reconciliations covered plus what you have checked; and `Difference`, red until it reaches zero and green when it does.
- **The table.** Every entry on this account up to the statement date that has not been cleared before: `Date`, `Memo`, `In` and `Out`, each with a check box. That includes entries written by hand in the journal, not only bank transactions.
- **{button:Complete|primary}** and **{button:Cancel|outline}.**
- **Completed reconciliations.** Each listed as `Statement through [date] · [balance]` with {badge:completed|secondary}, and {button:Reopen|outline} on the most recent one.

## How to reconcile

1. Fill in `Statement end date` and `Statement ending balance` from the top of the statement. Check `Negative balance` if the statement shows one. Click {button:Start|primary}.
2. Check each entry that appears on the statement. Each check is saved as you go, and checking an entry locks it straight away.
3. When `Difference` reaches zero, click {button:Complete|primary}. It stays gray until the difference is exactly zero. It reads `Working…`, then you see `Reconciled — statement matched`.

If the difference will not reach zero, something on the statement is missing from your books, or something in your books is not on the statement. Add the missing transaction from the account's page, or uncheck the one that has not cleared.

## How to cancel or reopen

1. To abandon a reconciliation in progress, click {button:Cancel|outline}. The dialog is `Cancel this reconciliation?` and reads `Every line you have ticked is released and the statement figures are discarded. The transactions themselves are untouched, so you can start the reconciliation again.` Click {button:Cancel reconciliation|destructive}, or {button:Keep working|outline}.
2. To reopen the most recent completed one, click {button:Reopen|outline}. The dialog is `Reopen this reconciliation?` and reads `Its cleared lines stay ticked until you untick them, so nothing is lost — but the period stops counting as reconciled, and entries it was protecting become editable again.` Only the most recent can be reopened, and not while another is in progress.

## Messages

| Message | What it means |
| --- | --- |
| `No uncleared activity on this account through [date].` | Nothing is left to check up to the statement date. |
| `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.` | You tried to edit, void or delete an entry that is checked here. Uncheck it first. |
| `Only the business owner can reconcile.` | You are staff or an accountant. |

## Not on this page

An account that is closed, or that already has a reconciliation open, cannot start another. The reason is shown.

## Who can do what

Owners only.
