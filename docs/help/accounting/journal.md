# The journal

> Every entry in the ledger, where each one came from, and its status.
> **Route:** /dashboard/m/accounting/journal
> **Order:** 190
> **Area:** Journal

Open **Journal** in the accounting menu. The line under the title reads `Every entry in [your business]'s books.`, or `Every entry across all 2 companies.` when you keep more than one. Most entries are not written here. They arrive on their own when an invoice is issued, a bill is approved, a payment is recorded, a bank transaction is posted, or a recurring template runs. To write one by hand, click {button:New entry|primary}. See [Write a journal entry](new-entry.md).

## What you see

- **The list.** Newest first, fifty to a page. `Date` and `Memo`, which both open the entry. `Company`, only when you keep more than one. `Source`, where it came from: `manual`, `bank import`, `invoice`, `invoice payment`, `bill`, `bill payment`, `deposit`, `credit memo`, `opening balance`, `reversal`, `recurring`, `depreciation`, or an inventory movement. `Status`: {badge:posted|primary}, {badge:draft|secondary} or {badge:void|outline}. A reconciled entry still reads {badge:posted|primary}; reconciliation locks it without changing its status. `Amount`, the total of the entry's debits.
- **`Company`.** Only when you keep more than one: `All companies`, or one.
- **Search.** The box above the list. Type part of a memo and the list narrows as you type; press Enter to search at once. Capitals do not matter. Clear the box to see everything again.
- **Pages.** When there are more than fifty entries, `Showing 1–50 of 312 entries` sits under the list with {button:Newer|outline} and {button:Older|outline}. A search starts again from its first page.

## How to find an entry

1. Type part of the memo in the search box, or scan the list by date, or by `Source` for the kind of thing you are looking for.
2. Click the date or the memo. The entry opens. See [A journal entry](entry.md).

For one account's entries with running balances, use the General Ledger report on the Reports page.

## Messages

| Message | What it means |
| --- | --- |
| `Open the books` and `The first entry starts the ledger. Most entries arrive on their own, from invoices, bills and the bank feed.` | No entry exists yet. |
| `Nothing matches “…”` and `Try fewer words, or clear the search.` | No memo contains what you typed. |

## Not on this page

The search reads memos only, not amounts, accounts or dates, and there is no date filter. Ask us if you need one.

## Who can do what

Everyone can read the journal. What each person can do with an entry is on the entry's own page.
