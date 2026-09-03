# Reconcile an account

> Matching your books to a bank statement: starting from the statement's closing figures, ticking off what cleared, getting the difference to zero, and what a completed reconciliation locks.
> **Route:** /dashboard/m/accounting/banking/*/reconcile
> **Order:** 160

## What it is for

A reconciliation proves that your books and the bank agree up to a statement date. The title reads `Reconcile — [account]` and the line under it `Match the books to the bank statement. Cleared entries are locked — uncheck a transaction to edit its entry.` Owners only: anyone else sees `Only the business owner can reconcile.`

## Starting

The card **Start a reconciliation** reads `From the top of your bank statement.` For a credit card it adds `For credit cards, enter the balance as printed (positive = amount owed).`

- **Statement end date.**
- **Statement ending balance.** Tick **Negative balance** if the statement shows one.

Click **Start**. A badge `in progress` appears in the title row. An account that is closed, or that already has a reconciliation open, is refused with the reason.

## Ticking off

The summary at the top shows three figures: **Statement**, with its date and balance, **Cleared (prior + checked)**, what earlier reconciliations covered plus what you have ticked, and **Difference**, red until it reaches zero and green when it does.

The table lists every entry on this account up to the statement date that has not been cleared before: **Date**, **Memo**, **In** and **Out**. That includes entries written by hand in the journal, not only bank transactions. Tick each one that appears on the statement. Each tick is saved as you go.

When nothing is left to tick: `No uncleared activity on this account through [date].`

Ticking an entry locks it straight away. A locked entry cannot be edited, voided or deleted; the answer is `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.` Untick it here to edit it.

## Finishing

**Complete** stays greyed out until the difference is exactly zero. If it is not, something on the statement is missing from your books, or something in your books is not on the statement: add the missing transaction from the account's page, or untick the one that has not cleared. When it is zero, click **Complete**. You see `Reconciled — statement matched`.

**Cancel** asks `Cancel this reconciliation?`: `Every line you have ticked is released and the statement figures are discarded. The transactions themselves are untouched, so you can start the reconciliation again.` Click **Cancel reconciliation** or **Keep working**.

## Completed reconciliations

Each finished reconciliation is listed as `Statement through [date] · [balance]`. The most recent one has a **Reopen** button, which asks `Reopen this reconciliation?`: `Its cleared lines stay ticked until you untick them, so nothing is lost — but the period stops counting as reconciled, and entries it was protecting become editable again.` Only the most recent can be reopened, and not while another is in progress.
