# Close

> Month-end: the pre-close checklist, closing the books through a date, the close history, reopening a close, and the export of your whole books for your accountant.
> **Route:** /dashboard/m/accounting/close
> **Order:** 310

## What a close does

Closing the books through a date locks every entry dated on or before it. A locked entry cannot be edited or voided. A correction goes in as a reversal, or as a new entry dated after the close. Anything you try to post into a closed month answers `That date falls in a closed period. Use a reversal, or reopen the period first.` A bank rule leaves a transaction dated inside a closed period for review instead of posting it, and a recurring journal that would post into a closed month is made as a draft instead.

## The page

**Close** in the strip. The line under the title reads `Month-end review, period lock, and the close history.` At the top right, owners and accountants see **Export books**, then a badge: `Closed through 2026-07-31`, or `Books open`.

When you keep more than one company, the badge starts with the company's name, and a row of pills under the strip shows every company with `closed through 2026-07-31` or `open` beside its name. Click a pill to work on that company's books. Each company closes on its own. There is no close for all companies at once.

## The pre-close checklist

The card is titled `Pre-close checklist — through 2026-08-31`, with the company's name in it when you keep more than one, and reads `Outstanding items warn but never block a close; they get snapshotted with it.` It is shown while the chosen period is later than the date the books are closed through.

Owners see a period select at the top right listing month ends as `Through 2026-08-31`, from the month after the last close up to this month. With no close yet, it starts about a year back. Pick one and the page reloads with that period's checklist. Beside it is **Close the books**.

Eight items, each with a green tick or an amber alert, a count in brackets when something is outstanding, and a **Review** link that opens the page where you sort it out:

- **Unreviewed bank transactions**, dated on or before the period end, in this company's accounts. Review opens Banking.
- **Draft journal entries**, dated on or before the period end. Review opens the Journal.
- **Draft invoices**, dated on or before the period end. Review opens Sales.
- **Draft bills**, dated on or before the period end. Review opens Bills.
- **Bills awaiting approval**, dated on or before the period end. Review opens Bills.
- **Unfiled inbox documents.** Documents still in the Inbox, counted across the whole business, because a document nobody has filed does not belong to a company yet. Review opens the Inbox.
- **Bank accounts not reconciled through period end.** Accounts whose last completed reconciliation stops short of the period end, or that were never reconciled. Their names are listed under the item. Review opens Banking.
- **Ledger out of balance.** Posted entries in this company's books whose debits and credits do not agree. Review opens the Trial Balance.

None of these stops a close. They are recorded with it, so the close's page shows what was still open on the day.

## Closing the books

Click **Close the books**. The dialog is titled `Close the books through 2026-08-31?`, or `Close Maple Street LLC's books through 2026-08-31?`, and reads `Entries dated on or before this day become locked — corrections go through reversals. You can reopen the latest close if needed.` With more than one company it adds `Your other companies are unaffected; each one closes on its own.`

If anything on the checklist is outstanding, an amber box lists it under `Still outstanding — you can close anyway; these will be recorded in the close snapshot:`.

Click **Close books**. The button reads `Closing…`, you see `Books closed through 2026-08-31.`, and the close's own page opens. Yosher also starts writing a plain-English summary of the month in the background. It appears on the close's page when it is ready. If it is not there, click **Generate narrative** on that page. See [A close](close-record.md).

A close only moves forward. Picking a date on or before the current closed-through date answers `The close date must be after the current closed-through date.`

Only an owner can close the books. Staff and accountants see the checklist without the period select or the button.

## Close history

The card reads `Every close, who completed it, and its review state.` and lists every close for every company, newest period first, so you can see at a glance that one company has not been closed since March. Before the first close it reads `No closes yet. The first close locks the books through the period you pick above.`

- **Period end** opens the close's page.
- **Company.** Only when you keep more than one.
- **Status.** `Completed`, or `Reopened`.
- **Completed.** Who closed it and the date, for example `Dan · 2026-09-01`.
- **Review.** `Signed off · Dan` once an owner or accountant has signed off, or `Awaiting sign-off`. A `Narrative` badge shows when the summary has been written.

## Reopening a close

An owner sees **Reopen** on the latest completed close of the company selected above, and on no other row. The dialog is titled `Reopen the close through 2026-08-31?` and reads `The period lock rolls back to where it stood before this close. The close stays in the history as reopened, and its sign-off and narrative are kept for the record.` Click **Reopen close**. The button reads `Reopening…`, then you see `Close reopened.` The books are open again from the day after the previous close, and the row shows `Reopened`. Close them again when the corrections are in.

An older close answers `Only the most recent close can be reopened.` A close that was already reopened answers `That close was reopened — complete a new close first.` If somebody else changed the close while your page was open, you see `This entry changed since you opened it — reload and try again.`

A company that shows `closed through` a date but has no close in the history was locked before closes were kept per company. It can be closed forward, but that lock cannot be reopened from this page. Ask us if you need it moved.

## Export books

**Export books** gives you a complete copy of your accounting records. The dialog is titled `Export your books` and reads `A complete copy of your accounting records — chart of accounts, every journal entry, sales, purchases, banking, the audit trail, and current statements — as CSV files in one zip. Your books belong to you.`

One box, **Include document files**, is ticked to begin with: `Every uploaded or emailed receipt and bill, as the original files. Can make the download large.` Untick it for a smaller file with the records only.

Click **Download zip**. The file is named `yosher-books-[your business]-[today].zip`. Inside:

- `README`, explaining the layout, and `manifest.csv`, listing every file.
- `ledger/`: the chart of accounts, every journal entry and line, tags, settings, the close history and notes, the recurring templates, and the full audit trail.
- `reports/`: a profit and loss for the fiscal year to today, a balance sheet and a trial balance as of today. With more than one company there is a set for each company, a combined set and a consolidated set.
- `sales/`: customers, invoices, invoice lines, tax rates and payments received.
- `purchases/`: vendors, bills, bill lines and payments made.
- `banking/`: accounts, imported transactions, reconciliations and the lines cleared in each.
- `documents/`: the list of stored documents and where each is attached, plus the files themselves when the box was ticked. Documents in the trash are included, because the export is your record.

Amounts are in dollars and cents, and dates are written year-month-day, so any spreadsheet program opens the files. One export a minute: a second request answers `An export just ran — try again in a minute.` Owners and accountants can export. Staff do not see the button.
