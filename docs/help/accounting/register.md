# An account's transactions

> One bank or card account, or your own account when the business's money runs through it: the transactions waiting for review, the suggested categories, posting, matching to something already in the books, transfers between your own accounts, excluding or setting aside as personal, and closing the account.
> **Route:** /dashboard/m/accounting/banking/*
> **Order:** 20
> **Area:** Banking

Open **Banking** in the accounting menu and click an account's card. This is where the bank feed is worked: each transaction waits under `To review` until an owner posts it, matches it to something already in the books, or excludes it. On a personal account the same page runs the other way round: every transaction is yours until you post it as the business's, and setting one aside is the ordinary thing to do.

## What you see

- **The top of the page.** The title is the account's name. The line under it gives its kind, institution, last four digits and today's balance, or `owed` for a card, or `put in by you, net` for a personal account. {badge:connected|success} for a live feed and {badge:closed|outline} for a closed account. Owners see, while the account is open, {button:Import CSV|outline}, {button:Suggest categories|primary|sparkles} and {button:Reconcile|outline}, and always {button:Close account|outline} or {button:Reopen account|outline}. A personal account has no {button:Reconcile|outline}: there is nothing to reconcile it against.
- **On a personal account, a note under the menu.** `Your own account, with some of the business's money running through it. Only the lines you post reach the books, as money you put in or took out. Everything you set aside as personal stays out of them: never counted, never reported, and never seen by staff.`
- **The three tabs.** `To review (3)`, transactions that have arrived and are not in your books yet. `All (120)`, everything. `Excluded (2)`, transactions you have set aside; on a personal account this tab reads `Personal (2)`. The counts are live, and count the whole account whatever you have searched for. The list is newest first, a hundred to a page.
- **Search.** The box above the tabs. Type part of the description or the payee, or an amount such as `45.10`, and the list narrows as you type; press Enter to search at once. An amount finds the rows for exactly that figure, in or out. What you typed stays as you switch tabs. Clear the box to see everything again.
- **Pages.** When a tab holds more than a hundred transactions, `Showing 1–100 of 312 transactions` sits under the list with {button:Newer|outline} and {button:Older|outline}. A search, or a different tab, starts again from the first page.
- **Each row.** `Date` and `Description`, as the bank gave them, with a {icon:paperclip} and a count when receipts are attached from the Inbox. Under the description, on a row still to review, a chip with a suggested category: `RULE · 6300` means one of your bank rules matched, and hovering it shows which; `AI · 6100 · 87%` is the assistant's suggestion and how sure it is. On a personal account the chip can also read `AI · personal · 92%`, the assistant saying the line is not the business's, and on the `Personal` tab `RULE · personal` names the rule that set a row aside. When both have an opinion only the rule's chip is shown, because a rule is a decision you wrote down. `Payee`, the vendor, once a rule or a person has set one. `In` and `Out`. On `All`, `Status`: `unreviewed`, `posted` or `excluded`, where `posted` is a link to the entry in the journal. On `To review`, for owners, `Category`, already set to the suggestion. Click it and type part of a code or a name, such as `63` or `insur`, and the list narrows to what matches; click the account, or press Enter for the highlighted one. {button:Tag|outline} sits under it when your business has tags. At the end of the list, `Transfer to [account]` on money out and `Transfer from [account]` on money in, one for each of your other accounts in the same company, so money you moved between your own accounts is recorded as a transfer rather than as spending or income.
- **On a phone.** Each transaction is a card instead of a row: the description and the amount at the top, money in with a `+` in green and money out with a `−`, then the date, the payee and the receipt count, the chip, the `Category`, the tag and the buttons. Everything works the same as in the table.
- **The buttons on a row.** On `To review`: {button:Match|outline} when the row has something in the books it could be, {button:Split|outline}, {button:Exclude|ghost} and {button:Post|primary}. On `All`: {button:Unmatch|ghost} on a row that was matched to an entry; a row that posted its own entry has no button, because that entry is undone by voiding it. On `Excluded`: {button:Restore|outline}. On a personal account the two are named for what they mean there: {button:Personal|ghost} in place of {button:Exclude|ghost}, and {button:It's the business's|outline} in place of {button:Restore|outline}.
- **{button:Accept 12 suggestions (≥70%)|outline}.** At the top of `To review`. See how to post many at once, below. On a personal account the assistant's `personal` suggestions count among them, and accepting sets those aside rather than posting them.
- **{button:Set aside the rest as personal (42)|ghost}.** On a personal account only, beside it: every transaction still waiting that nothing has called the business's. See how to sort a personal account, below.

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
2. Click {button:Accept 12 suggestions (≥70%)|outline}. Every waiting transaction with a rule match, or a suggestion the assistant is at least 70% sure of, is posted, up to 50 at a time. You see `Posted 12`, or `Posted 9, skipped 3` with the first reason, such as a date in a closed month. On a personal account a suggestion of `personal` is accepted by setting the row aside instead, and the message says so: `Posted 3, set aside 9 as personal`.

## How to sort a personal account

On a personal account most of what arrives is your own spending, so the work is picking out the business's lines rather than coding every line.

1. Import the statement. Any rule that sets aside as personal has already moved its matches to `Personal` when the summary appears. See [Bank rules](bank-rules.md).
2. Click {button:Suggest categories|primary|sparkles}. The assistant is told whose account this is, treats every line as yours unless it looks like the business's, and remembers what you have set aside before. It answers `personal` for your own spending and a category for the rest.
3. Check the rows it called the business's. Post each with {button:Post|primary}, changing `Category` first if it guessed wrong, or click {button:Accept 12 suggestions (≥70%)|outline} to post the confident ones and set aside the confident `personal` ones together.
4. Click {button:Set aside the rest as personal (42)|ghost}. The dialog reads `Set aside 42 as personal?` and `Nothing posts. Anything that turns out to be the business's can be brought back from the Personal tab.` Click {button:Set aside|primary}. You see `Set aside 42 as personal`. Everything still waiting that had no rule and no category from the assistant is now on `Personal`, up to 50 at a time; press it again for more.
5. Skim `Personal` now and then. Click {button:It's the business's|outline} on anything that belongs in the books; it goes back to `To review`, and you see `Back in review`.

Every business line you post from this account is recorded as money you put into the business, and every business receipt that landed here as money you took out. Setting the same payee aside three times proposes a rule that does it on arrival, named like `(Suggested) Kroger as personal`; keep or dismiss it on the Rules page. A transaction set aside is not deleted and not counted anywhere. It is not on any report, and staff never see it.

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

On a personal account the same button is {button:Personal|ghost}, the message is `Set aside as personal`, the tab is `Personal`, and the way back is {button:It's the business's|outline}.

## How to close the account

1. Click {button:Close account|outline}. The dialog is `Close this account?` and reads `Nothing is deleted and no balance changes — the account stops taking new transactions, imports and reconciliations. You can reopen it whenever you like.`
2. Confirm. A closed account shows a notice at the top and still lets you read the list, exclude and restore. {button:Reopen account|outline} reverses it.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing to review — the feed is clear.` | Every transaction has been posted, matched or excluded. |
| `Nothing to review — everything is sorted.` | The same, on a personal account. |
| `Set aside as personal` and `Set aside 42 as personal` | On a personal account: one transaction, or many, moved to `Personal` without posting. {button:Undo|link} on the single one brings it back. |
| `Posted 3, set aside 9 as personal` | {button:Accept 12 suggestions (≥70%)|outline} on a personal account posted the business's lines and set aside the ones the assistant called personal. |
| `A personal account has no opening balance and is never reconciled — only the lines you mark as the business's reach the books, so its balance was never the business's.` | Something asked this account to reconcile. It never does. |
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

Staff and accountants can read the list and the tabs. Posting, matching, excluding, importing, reconciling and closing are the owner's. A personal account is the exception to the first sentence: owners and accountants can open it, and staff never see it, its transactions, or the rules written for it.
