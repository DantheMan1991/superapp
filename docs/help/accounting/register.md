# An account's transactions

> One bank or card account: the transactions waiting for review, the suggested categories, posting, matching to something already in the books, excluding, and closing the account.
> **Route:** /dashboard/m/accounting/banking/*
> **Order:** 140

## The top of the page

The title is the account's name, and the line under it gives its kind, institution, last four digits and today's balance, or `owed` for a card. Badges show `connected` for a live feed and `closed` for a closed account.

Owners see, while the account is open: **Import CSV**, **Suggest categories**, and **Reconcile**. Owners always see **Close account** or **Reopen account**.

## The three tabs

- **To review (3).** Transactions that have arrived and are not in your books yet.
- **All (120).** Everything.
- **Excluded (2).** Transactions you have set aside.

The counts are live. The list shows up to 300 transactions, newest first. There is no search or date filter.

When nothing is waiting: `Nothing to review — the feed is clear.` On the other tabs: `No transactions here yet.`

## Each row

- **Date** and **Description**, as the bank gave them. A paperclip with a count shows receipts attached from the Inbox.
- Under the description, on a row still to review, a chip with a suggested category. `RULE · 6300` means one of your bank rules matched; hover it to see which. `AI · 6100 · 87%` is the assistant's suggestion and how sure it is. When both have an opinion only the rule's chip is shown, because a rule is a decision you wrote down.
- **Payee.** The vendor, once a rule or a person has set one.
- **In** and **Out.**
- **Status** on the All tab: `unreviewed`, `posted` or `excluded`. `posted` is a link to the entry in the journal.
- **Category** on the To review tab, for owners: a list of your accounts, already set to the suggestion, and a **Tag** button under it when your business has tags.

## Posting a transaction

Owners, on the To review tab. Check or change the **Category** and click **Post**. You see `Posted`, and the transaction becomes an entry in your books: the bank account on one side and the category on the other, dated the transaction date, in the account's company. Nothing is posted until you press the button, and the assistant never posts by itself. A bank rule set to post automatically can.

**Accept 12 suggestions (≥70%)** at the top of the tab posts every waiting transaction that has a rule match or a suggestion the assistant is at least 70% sure of. It works through up to 50 at a time and reports `Posted 12`, or `Posted 9, skipped 3` with the first reason, for example a date in a closed month.

**Suggest categories** asks the assistant for a category on every waiting transaction that has none: `Suggested categories for 12 of 14 transactions`. Asking again within half a minute answers `Suggestions were just requested — try again in a moment.`

## Matching instead of posting

When a transaction looks like money already recorded, a payment against an invoice or a bill, or an entry written by hand, the row offers **Match** instead. The dialog, **Match to an existing entry**, lists up to five entries for the same amount within a week, such as `Payment — INV-0009 · Millbrook Restaurant` or `Bill payment — Ridgeline Feed · INV-4471`. Click **Match** beside the right one. You see `Matched — nothing new was posted`. The transaction is linked to that entry and nothing is posted twice.

On the All tab, **Unmatch** sends a matched transaction back to review; the entry stays posted. Voiding an entry from the journal also sends its transaction back to review.

## Excluding

**Exclude** sets a transaction aside without posting it, for a transfer between your own accounts or a duplicate. It moves to the Excluded tab, where **Restore** brings it back.

## Closing the account

**Close account** asks `Close this account?`: `Nothing is deleted and no balance changes — the account stops taking new transactions, imports and reconciliations. You can reopen it whenever you like.` A closed account shows a notice at the top and still lets you read the list, exclude and restore. **Reopen account** reverses it.

## Who can do what

Staff and accountants can read the list and the tabs. Posting, matching, excluding, importing and reconciling are the owner's.
