# An account's transactions

> One bank or card account: the transactions waiting for review, the suggested categories, posting, matching to something already in the books, excluding, and closing the account.
> **Route:** /dashboard/m/accounting/banking/*
> **Order:** 20
> **Area:** Banking

Open **Banking** in the accounting menu and click an account's card. This is where the bank feed is worked: each transaction waits under `To review` until an owner posts it, matches it to something already in the books, or excludes it.

## What you see

- **The top of the page.** The title is the account's name. The line under it gives its kind, institution, last four digits and today's balance, or `owed` for a card. {badge:connected|success} for a live feed and {badge:closed|outline} for a closed account. Owners see, while the account is open, {button:Import CSV|outline}, {button:Suggest categories|primary|sparkles} and {button:Reconcile|outline}, and always {button:Close account|outline} or {button:Reopen account|outline}.
- **The three tabs.** `To review (3)`, transactions that have arrived and are not in your books yet. `All (120)`, everything. `Excluded (2)`, transactions you have set aside. The counts are live. The list shows up to 300 transactions, newest first. There is no search or date filter.
- **Each row.** `Date` and `Description`, as the bank gave them, with a {icon:paperclip} and a count when receipts are attached from the Inbox. Under the description, on a row still to review, a chip with a suggested category: `RULE · 6300` means one of your bank rules matched, and hovering it shows which; `AI · 6100 · 87%` is the assistant's suggestion and how sure it is. When both have an opinion only the rule's chip is shown, because a rule is a decision you wrote down. `Payee`, the vendor, once a rule or a person has set one. `In` and `Out`. On `All`, `Status`: `unreviewed`, `posted` or `excluded`, where `posted` is a link to the entry in the journal. On `To review`, for owners, `Category`, a list of your accounts already set to the suggestion, with {button:Tag|outline} under it when your business has tags.
- **The buttons on a row.** On `To review`: {button:Match|outline} when the row has something in the books it could be, {button:Post|primary} and {button:Exclude|ghost}. On `All`: {button:Unmatch|ghost} on a matched row. On `Excluded`: {button:Restore|outline}.
- **{button:Accept 12 suggestions (≥70%)|outline}.** At the top of `To review`. See how to post many at once, below.

## How to post a transaction

1. On `To review`, check the `Category`, or change it. Add a tag if you use them.
2. Click {button:Post|primary}. You see `Posted`. The transaction becomes an entry in your books: the bank account on one side and the category on the other, dated the transaction date, in the account's company.

Nothing is posted until you press the button, and the assistant never posts by itself. A bank rule set to post automatically can.

## How to post many at once

1. Click {button:Suggest categories|primary|sparkles} if rows are still without a suggestion. It reads `Thinking…`, then `Suggested categories for 12 of 14 transactions`.
2. Click {button:Accept 12 suggestions (≥70%)|outline}. Every waiting transaction with a rule match, or a suggestion the assistant is at least 70% sure of, is posted, up to 50 at a time. You see `Posted 12`, or `Posted 9, skipped 3` with the first reason, such as a date in a closed month.

## How to match a transaction to something already in the books

1. When a transaction looks like money already recorded, a payment against an invoice or a bill, or an entry written by hand, click {button:Match|outline}. The dialog is `Match to an existing entry` and lists up to five entries for the same amount within a week, such as `Payment — INV-0009 · Millbrook Restaurant` or `Bill payment — Ridgeline Feed · INV-4471`.
2. Click {button:Match|primary} beside the right one. You see `Matched — nothing new was posted`. The transaction is linked to that entry and nothing is posted twice.

On `All`, {button:Unmatch|ghost} sends a matched transaction back to review; the entry stays posted. Voiding an entry from the journal also sends its transaction back to review.

## How to exclude a transaction

1. Click {button:Exclude|ghost} on a transfer between your own accounts, or a duplicate. It moves to `Excluded` without being posted.
2. Click {button:Restore|outline} on `Excluded` to bring it back.

## How to close the account

1. Click {button:Close account|outline}. The dialog is `Close this account?` and reads `Nothing is deleted and no balance changes — the account stops taking new transactions, imports and reconciliations. You can reopen it whenever you like.`
2. Confirm. A closed account shows a notice at the top and still lets you read the list, exclude and restore. {button:Reopen account|outline} reverses it.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing to review — the feed is clear.` | Every transaction has been posted, matched or excluded. |
| `No transactions here yet.` | The tab is empty. |
| `Suggestions were just requested — try again in a moment.` | You asked the assistant twice within half a minute. |
| `Posted 9, skipped 3` | Three suggestions could not be posted. The first reason follows. |

## Not on this page

There is no search or date filter, and the list stops at 300. Importing a statement and reconciling have their own pages. See [Import a statement](import-statement.md) and [Reconcile an account](reconcile.md).

## Who can do what

Staff and accountants can read the list and the tabs. Posting, matching, excluding, importing, reconciling and closing are the owner's.
