# Close

> Month-end: the pre-close checklist, closing the books through a date, the close history, reopening a close, and the export of your whole books for your accountant.
> **Route:** /dashboard/m/accounting/close
> **Order:** 320
> **Area:** Close

Open **Close** in the accounting menu. The line under the title reads `Month-end review, period lock, and the close history.` Closing the books through a date locks every entry dated on or before it. A locked entry cannot be edited or voided; a correction goes in as a reversal, or as a new entry dated after the close. To close, work through the checklist and click {button:Close the books|primary|lock}.

## What you see

- **The top right.** {button:Export books|outline} for owners and accountants, then a badge: {badge:Closed through 2026-07-31|secondary}, or {badge:Books open|outline}. When you keep more than one company, the badge starts with the company's name, and a row of pills under the accounting menu shows every company with `closed through 2026-07-31` or `open` beside its name. Click a pill to work on that company's books. Each company closes on its own.
- **`Pre-close checklist — through 2026-08-31`.** With the company's name in it when you keep more than one. It reads `Outstanding items warn but never block a close; they get snapshotted with it.` and is shown while the chosen period is later than the date the books are closed through. Owners see a period select at the top right listing month ends as `Through 2026-08-31`, from the month after the last close up to this month, and {button:Close the books|primary|lock} beside it.
- **The eight items.** Each with a green check or an amber alert, a count in brackets when something is outstanding, and {button:Review|ghost}, which opens the page where you sort it out. `Unreviewed bank transactions` in this company's accounts, dated on or before the period end, opens Banking. `Draft journal entries` opens the Journal. `Draft invoices` opens Sales. `Draft bills` and `Bills awaiting approval` open Bills. `Unfiled inbox documents`, counted across the whole business because a document nobody has filed does not belong to a company yet, opens the Inbox. `Bank accounts not reconciled through period end`, with the account names listed under it, opens Banking. `Ledger out of balance`, posted entries in this company's books whose debits and credits do not agree, opens the Trial Balance. None of these stops a close.
- **`Close history`.** `Every close, who completed it, and its review state.` Every close for every company, newest period first. `Period end`, which opens the close's page. `Company`, only when you keep more than one. `Status`: {badge:Completed|success} or {badge:Reopened|secondary}. `Completed`, who closed it and the date, such as `Dan · 2026-09-01`. `Review`: {badge:Signed off · Dan|outline} once an owner or accountant has signed off, or {badge:Awaiting sign-off|outline}, and {badge:Narrative|outline} when the summary has been written. Owners see {button:Reopen|outline|lock-open} on the latest completed close of the company selected above.

## How to close the books

1. Pick the period in the select. The page reloads with that period's checklist.
2. Work through the outstanding items with {button:Review|ghost}. They warn but never block.
3. Click {button:Close the books|primary|lock}. The dialog is `Close the books through 2026-08-31?`, or `Close Maple Street LLC's books through 2026-08-31?`, and reads `Entries dated on or before this day become locked — corrections go through reversals. You can reopen the latest close if needed.` With more than one company it adds `Your other companies are unaffected; each one closes on its own.` If anything is outstanding, an amber box lists it under `Still outstanding — you can close anyway; these will be recorded in the close snapshot:`.
4. Click {button:Close books|primary}. It reads `Closing…`, you see `Books closed through 2026-08-31.`, and the close's own page opens. Yosher also starts writing a plain-English summary of the month in the background; if it is not on the close's page, click {button:Generate narrative|outline|sparkles} there. See [A close](close-record.md).

A close only moves forward. Anything you then try to post into a closed month answers `That date falls in a closed period. Use a reversal, or reopen the period first.` A bank rule leaves a transaction dated inside a closed period for review, and a recurring journal that would post into a closed month is made as a draft instead.

## How to reopen a close

1. Click {button:Reopen|outline|lock-open} on the latest completed close of the selected company. The dialog is `Reopen the close through 2026-08-31?` and reads `The period lock rolls back to where it stood before this close. The close stays in the history as reopened, and its sign-off and narrative are kept for the record.`
2. Click {button:Reopen close|destructive}. It reads `Reopening…`, then you see `Close reopened.` The books are open again from the day after the previous close, and the row shows {badge:Reopened|secondary}. Close them again when the corrections are in.

## How to export your books

1. Click {button:Export books|outline}. The dialog is `Export your books` and reads `A complete copy of your accounting records — chart of accounts, every journal entry, sales, purchases, banking, the audit trail, and current statements — as CSV files in one zip. Your books belong to you.`
2. Leave `Include document files` checked for `Every uploaded or emailed receipt and bill, as the original files. Can make the download large.`, or uncheck it for a smaller file with the records only.
3. Click {button:Download zip|primary}. The file is `yosher-books-[your business]-[today].zip`.

Inside: `README`, explaining the layout, and `manifest.csv`, listing every file; `ledger/`, the chart of accounts, every journal entry and line, tags, settings, the close history and notes, the recurring templates, and the full audit trail; `reports/`, a profit and loss for the fiscal year to today, a balance sheet and a trial balance as of today, with a set for each company, a combined set and a consolidated set when you keep more than one; `sales/`, customers, invoices, invoice lines, tax rates and payments received; `purchases/`, vendors, bills, bill lines and payments made; `banking/`, accounts, imported transactions, reconciliations and the lines cleared in each; and `documents/`, the list of stored documents and where each is attached, plus the files themselves when the box was checked. Documents in the trash are included, because the export is your record. Amounts are in dollars and cents, and dates are written year-month-day, so any spreadsheet program opens the files.

## Messages

| Message | What it means |
| --- | --- |
| `No closes yet. The first close locks the books through the period you pick above.` | The history is empty. |
| `The close date must be after the current closed-through date.` | You picked a date on or before the current close. |
| `Only the most recent close can be reopened.` | Reopen works on the latest close of that company only. |
| `That close was reopened — complete a new close first.` | The close was already reopened. |
| `This entry changed since you opened it — reload and try again.` | Somebody else changed the close while your page was open. |
| `An export just ran — try again in a minute.` | One export a minute. Wait. |

## Not on this page

There is no close for all companies at once. A company that shows `closed through` a date but has no close in the history was locked before closes were kept per company. It can be closed forward, but that lock cannot be reopened from this page. Ask us if you need it moved.

## Who can do what

Only an owner closes and reopens. Owners and accountants export. Staff see the checklist and the history, without the period select, the buttons or the export.
