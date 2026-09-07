# An account's transactions

> One bank or card account: the transactions waiting for review, the suggested categories, posting, matching to something already in the books, transfers between your own accounts, excluding, and closing the account.
> **Route:** /dashboard/m/accounting/banking/*
> **Order:** 20
> **Area:** Banking

Open **Banking** in the accounting menu and click an account's card. This is where the bank feed is worked: each transaction waits under `To review` until an owner posts it, matches it to something already in the books, or excludes it.

## What you see

- **The top of the page.** The title is the account's name. The line under it gives its kind, institution, last four digits and today's balance, or `owed` for a card. {badge:connected|success} for a live feed and {badge:closed|outline} for a closed account. Owners see, while the account is open, {button:Import CSV|outline}, {button:Suggest categories|primary|sparkles} and {button:Reconcile|outline}, and always {button:Close account|outline} or {button:Reopen account|outline}.
- **The three tabs.** `To review (3)`, transactions that have arrived and are not in your books yet. `All (120)`, everything. `Excluded (2)`, transactions you have set aside. The counts are live, and count the whole account whatever you have searched for. The list is newest first, a hundred to a page.
- **Search.** The box above the tabs. Type part of the description or the payee, or an amount such as `45.10`, and the list narrows as you type; press Enter to search at once. An amount finds the rows for exactly that figure, in or out. What you typed stays as you switch tabs. Clear the box to see everything again.
- **Pages.** When a tab holds more than a hundred transactions, `Showing 1–100 of 312 transactions` sits under the list with {button:Newer|outline} and {button:Older|outline}. A search, or a different tab, starts again from the first page.
- **Each row.** `Date` and `Description`, as the bank gave them, with a {icon:paperclip} and a count when receipts are attached from the Inbox. Under the description, on a row still to review, a chip with a suggested category: `RULE · 6300` means one of your bank rules matched, and hovering it shows which; `AI · 6100 · 87%` is the assistant's suggestion and how sure it is. When both have an opinion only the rule's chip is shown, because a rule is a decision you wrote down. `Payee`, the vendor, once a rule or a person has set one. `In` and `Out`. On `All`, `Status`: `unreviewed`, `posted` or `excluded`, where `posted` is a link to the entry in the journal. On `To review`, for owners, `Category`, already set to the suggestion. Click it and type part of a code or a name, such as `63` or `insur`, and the list narrows to what matches; click the account, or press Enter for the highlighted one. {button:Tag|outline} sits under it when your business has tags. At the end of the list, `Transfer to [account]` on money out and `Transfer from [account]` on money in, one for each of your other accounts in the same company, so money you moved between your own accounts is recorded as a transfer rather than as spending or income.
- **On a phone.** Each transaction is a card instead of a row: the description and the amount at the top, money in with a `+` in green and money out with a `−`, then the date, the payee and the receipt count, the chip, the `Category`, the tag and the buttons. Everything works the same as in the table.
- **The buttons on a row.** On `To review`: {button:Match|outline} when the row has something in the books it could be, {button:Split|outline}, {button:Exclude|ghost} and {button:Post|primary}. On `All`: {button:Unmatch|ghost} on a row that was matched to an entry; a row that posted its own entry has no button, because that entry is undone by voiding it. On `Excluded`: {button:Restore|outline}.
- **{button:Accept 12 suggestions (≥70%)|outline}.** At the top of `To review`. See how to post many at once, below.

## How to post a transaction

1. On `To review`, check the `Category`, or change it. Add a tag if you use them.
2. Click {button:Post|primary}. You see `Posted`, with {button:Undo|link} beside it for a few seconds. The transaction becomes an entry in your books: the bank account on one side and the category on the other, dated the transaction date, in the account's company.
3. If the category was wrong, click {button:Undo|link} while it shows. You see `Undone — back in review`: the entry is voided and the transaction is back under `To review`, so you can post it again. Once the message has gone, open `posted` on `All` and void the entry there; that sends the transaction back the same way.

Nothing is posted until you press the button, and the assistant never posts by itself. A bank rule set to post automatically can.

## How to split a transaction across categories

1. On `To review`, click {button:Split|outline}. The dialog is `Split 90.00 across categories` and reads `One entry posts, with a line per category. The lines must add up to the transaction.` The first line starts as the whole amount on the suggested category, with an empty line under it.
2. On each line, pick the category the way you would in `Category`, typing part of a code or a name, and type the `Amount`. Change the first line's amount to what belongs there and put the rest on the second. Click {button:Add line|outline|plus} for a third. The {icon:trash} at the end of a line removes it, down to two.
3. Under the lines, `60.00 left to assign` counts down as you type, `30.00 too much` shows when the lines overshoot, and `Balanced` when they add up. {button:Post split|primary} stays gray until they do.
4. Click {button:Post split|primary}. You see `Posted — 2 lines`, with {button:Undo|link} beside it for a few seconds. The transaction becomes one entry: the bank account on one side and a line per category on the other, dated the transaction date, in the account's company. A tag on the row goes on every line.

A split is undone the way a posting is: {button:Undo|link} while it shows, or void the entry from the journal afterwards. A split never suggests a bank rule, because a rule sets one category.

## How to post many at once

1. Click {button:Suggest categories|primary|sparkles} if rows are still without a suggestion. It reads `Thinking…`, then `Suggested categories for 12 of 14 transactions`.
2. Click {button:Accept 12 suggestions (≥70%)|outline}. Every waiting transaction with a rule match, or a suggestion the assistant is at least 70% sure of, is posted, up to 50 at a time. You see `Posted 12`, or `Posted 9, skipped 3` with the first reason, such as a date in a closed month.

## How to match a transaction to something already in the books

1. When a transaction looks like money already recorded, a payment against an invoice or a bill, or an entry written by hand, click {button:Match|outline}. The dialog is `Match to an existing entry` and lists up to five entries for the same amount within a week, such as `Payment — INV-0009 · Millbrook Restaurant`, `Bill payment — Ridgeline Feed · INV-4471` or `Deposit — 3 payments`, a deposit recorded on the Deposits page.
2. Click {button:Match|primary} beside the right one. You see `Matched — nothing new was posted`. The transaction is linked to that entry and nothing is posted twice.

On `All`, {button:Unmatch|ghost} sends a matched transaction back to review; the entry stays posted. Voiding an entry from the journal also sends its transaction back to review.

## How to record a transfer between your own accounts

1. On the account the money left, find the transaction under `To review`, click `Category`, type `trans` and pick `Transfer to [account]`. Click {button:Post|primary}. You see `Posted — match the other account's row when it arrives`. One entry is written: out of this account, into the other.
2. When the same money shows up under `To review` on the other account, click {button:Match|outline}. The dialog lists it as `Transfer from [account]`. Click {button:Match|primary}. You see `Matched — nothing new was posted`. Both transactions now point at the one entry, so the transfer is counted once.

It works the other way round too: post `Transfer from [account]` on the account the money reached, then match on the account it left. A card payment from your checking account is a transfer to the card. To undo a transfer, click {button:Undo|link} on the side that posted it while the message shows, or void its entry from the journal; the other side goes back to review with it. {button:Unmatch|ghost} on the side that only matched sends that side back alone. Money moving between two of your companies is not a transfer here; record it with {button:Move money|outline} on the Companies page. See [Companies](companies.md).

## How to exclude a transaction

1. Click {button:Exclude|ghost} on a duplicate, or on a row that is not money moving at all. It moves to `Excluded` without being posted, and you see `Excluded` with {button:Undo|link} beside it for a few seconds.
2. Click {button:Undo|link} while it shows, or {button:Restore|outline} on `Excluded`, to bring it back. You see `Back in review`.

## How to close the account

1. Click {button:Close account|outline}. The dialog is `Close this account?` and reads `Nothing is deleted and no balance changes — the account stops taking new transactions, imports and reconciliations. You can reopen it whenever you like.`
2. Confirm. A closed account shows a notice at the top and still lets you read the list, exclude and restore. {button:Reopen account|outline} reverses it.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing to review — the feed is clear.` | Every transaction has been posted, matched or excluded. |
| `No transactions here yet.` | The tab is empty. |
| `Nothing matches “…”. Try fewer words, or clear the search.` | Nothing on this tab has what you typed in its description, its payee or its amount. |
| `Suggestions were just requested — try again in a moment.` | You asked the assistant twice within half a minute. |
| `Posted 9, skipped 3` | Three suggestions could not be posted. The first reason follows. |
| `Posted` | The transaction is in your books. {button:Undo|link} beside it voids the entry and brings the transaction back. |
| `Posted — 2 lines` | A split was posted: one entry with a line per category. {button:Undo|link} works the same. |
| `The split lines must add up to the transaction amount.` | The lines overshoot or fall short; the dialog says by how much. |
| `Every split line needs a category and an amount above zero.` | A line is missing its category or its amount. |
| `A split needs at least two lines — use Post for one category.` | Only one line was sent. |
| `Posted — match the other account's row when it arrives` | A transfer was posted from this side. On the other account, the same money will offer this entry under {button:Match|outline}. |
| `This transaction posted the entry itself, so there is nothing to unmatch. Undo it from the Posted message, or void the entry from the journal.` | {button:Unmatch|ghost} was pressed on a row that posted its own entry. |
| `Undone — back in review` | The entry was voided and the transaction is waiting under `To review` again. |
| `That row has nothing to undo — it is not a posting made from here. A matched row goes back with Unmatch.` | {button:Undo|link} was pressed on a transaction that was matched rather than posted, or that had already been undone. |
| `Excluded` and `Back in review` | The transaction was set aside, or brought back. |
| `This entry is locked (closed period, reconciled, or strict mode). Create a reversal instead.` | The entry {button:Undo|link} would void has been reconciled, or its month has been closed. It stays posted. |

## Not on this page

There is no date filter. Importing a statement and reconciling have their own pages. See [Import a statement](import-statement.md) and [Reconcile an account](reconcile.md).

## Who can do what

Staff and accountants can read the list and the tabs. Posting, matching, excluding, importing, reconciling and closing are the owner's.
