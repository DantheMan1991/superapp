# Reading a report

> One report, open: what it counts, how to group it, how to see the rows behind the number, and how to keep it for next time.
> **Route:** /dashboard/m/crm/reports/*
> **Order:** 130
> **Area:** Reports

Click any report on [Reports](reports.md) and it opens here. Clicking a control across the top asks the question again and puts the answer in the address bar, so the address always matches what you are looking at. Send it to a colleague and they see the same question, answered from their own records. To keep what you are looking at, click {button:Save this report|ghost|save}.

## What you see

- **{icon:chevron-left} `All reports`.** Top left. Takes you back to the list of reports.
- **The title.** The report's name, for a report you saved and for one that came with CRM. When you are building one from scratch it is the question you picked, such as `Where is the work, and what is it worth?`.
- **The line under the title.** What the report is doing at this moment, in words. It reads `Number of records by stage`, or `Total value by stage · Deal is open is true` when the report carries a condition. It changes as you click the controls.
- **The tabs.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates` take you to the rest of CRM. `Reports` is underlined while you are here.
- **`Group by`.** A row of pills that starts with `Nothing`. The one in use has a heavier outline and bold text. Which pills you get depends on what the report counts.
- **`Show`.** A second row of pills, and only on a `Records with deals` report: `Number of records`, `Total value` and `Average value`. Every other report counts one thing, so the row is not drawn.
- **`Show the rows`.** One pill. Click it and it reads `Hide the rows`.
- **{button:Save this report|ghost|save}**, or **{button:Save as new|ghost|save}** when you are already on a report somebody saved.
- **{button:Delete|ghost|trash}.** Only on a saved report you made yourself.
- **The card.** Its top line names what is being counted on the left, and prints the total on the right. It reads `Number of records` even on a report that counts deals, stage moves, notes or follow-ups. A money total reads `$9,750.00`.
- **One row per group.** The group's name on the left, its number on the right, and a thin bar under it.
- **The bar.** Measured against the largest group, not against the total. That group's bar is always full, so read the bars for relative size only.
- **`Not set`, in gray italics.** A real group with a real number, not a blank line. Everything with no value lands in it, and the groups always add up to the total above them.
- **Row order.** Largest first, and ties by name. A month grouping runs oldest to newest instead.
- **What a `Records` report counts.** Everyone in your records, including customers and vendors added in Accounting that nobody has opened in CRM. Those have no stage, no source and nobody assigned, so they land in `Not set`.
- **What a `Follow-ups` report counts.** Every follow-up in the business, including work nobody attached to a record. It is wider than the Follow-ups page in CRM.
- **Nothing is stored.** The report runs again every time the page opens, so the numbers are the ones true right now.

## How to group the answer

1. Click a pill next to `Group by`. The card breaks the total into one row per group.
2. Click `Nothing` to go back to a plain total.
3. What you can group by depends on what the report counts.

| What the report counts | The `Group by` pills |
| --- | --- |
| `Records` | `Nothing`, `Type`, `Stage`, `Source`, `Assigned to`, `Month added` |
| `Records with deals` | `Nothing`, `Stage`, `Pipeline`, `Assigned to`, `Month closed` |
| `Deal stage history` | `Nothing`, `Moved into`, `Month moved`, `Moved by` |
| `Records with activity` | `Nothing`, `Kind`, `Month`, `Assigned to` |
| `Follow-ups` | `Nothing`, `Assigned to`, `Month due`, `Completed` |

Group names are the stored values, not always the words the rest of CRM shows you. `Type` reads `person` and `organization`. `Kind` reads `note`, `call` and `meeting`. Any month reads like `2026-08`. `Assigned to` and `Moved by` read as the long sign-in id of the person, never their name. `Completed` reads `Outstanding` or `Done`, and `Done` counts a canceled follow-up alongside a finished one.

`Not set` means the value is blank. For staff it also covers a record only owners can see, because staff cannot read that record's stage, source or who it is assigned to. The two look identical, so do not read `Not set` as work nobody has started.

With `Nothing` chosen, the card still draws one row. It is labeled `Not set`, it has a full-width bar, and its number is the total printed above it. The total is said twice. Read the big number at the top and ignore the row.

## How to change what is counted

The `Show` pills appear on a `Records with deals` report only.

1. Click `Total value`. The card's top line changes to `Total value` and every number becomes money, such as `$9,750.00`.
2. Click `Average value` for the average deal. A deal with no amount on it is left out of the average, and is still counted by `Number of records`.
3. A group whose deals all have no amount reads `$0.00` rather than an empty space.
4. Money is always shown with a dollar sign here, whatever symbol the rest of your business uses.

## How to see the rows behind a number

1. Click `Show the rows`. The pill reads `Hide the rows` and `The rows behind it` appears under the card.
2. Each row shows a name on the left. On a `Records` report it is the record's name. On `Records with deals` and `Deal stage history` it is the deal's name, so a deal that moved four times appears four times. On `Records with activity` it is the note's subject, or the word `note`, `call` or `meeting` when there is none. On `Follow-ups` it is the follow-up's name. Anything with no name reads `—`.
3. At the right you see the group the row falls in, as a chip such as {badge:2026-08|outline}, whenever the report is grouped. A row that falls in `Not set` carries no chip. On `Records with deals` the deal's own amount follows the chip, and a deal with no amount shows nothing there.
4. The list is every row the report matched, in name order. It is not narrowed to one group, and clicking a group above does not change it.
5. Two hundred rows at most. At the cap you see `Showing the first 200. A report is a summary — narrow it to see fewer.`
6. The rows are plain text. Clicking one does not open the record.
7. With the rows turned on and nothing matching, `The rows behind it` sits above an empty box. Click `Hide the rows` to put the list away.

## How to save a report

1. Click {button:Save this report|ghost|save}. On a report somebody already saved the button reads {button:Save as new|ghost|save} and makes a copy, leaving the one you are on untouched.
2. The dialog is headed `Save this report`, both times. Nothing in it says whether you are making a copy, so go by the button you clicked.
3. Under the heading you see `It answers 42 records right now, and will re-run every time somebody opens it.` The number is whatever total is on the card. On a money report that is the total in cents, so a `$9,750.00` report claims `It answers 975000 records right now`. On the other reports it counts deals, stage moves, notes or follow-ups rather than records. Trust the card, not this sentence.
4. Type a `Name`. The box suggests `What is the open work worth?`, and under it you see `Name it as a question if you can — it makes the list of reports easier to read.`
5. A name is 1 to 80 characters. No counter tells you how long it is, and a longer name is refused with `Invalid input` when you save. Two of your own reports cannot share a name, though a colleague may use the same one.
6. Leave `Share with the team` off to keep the report to yourself. Turn the switch on and everyone sees it in their list, under `Everyone gets the same question, answered from the records they have access to.`
7. Click {button:Save report|primary}. It stays grayed out until the name box has something in it, and reads `Saving…` while it works.
8. You see `Report saved` and land on the new report at its own address. The grouping, the measure and the rows toggle are stored with it, so it opens looking the way you left it.
9. {button:Cancel|ghost} closes the dialog and saves nothing. The sharing switch stays where you put it for the next time you open the dialog.

A report you save from one that came with CRM keeps that report's condition, such as `Deal is open is true`. That is the only way a report of your own gets a condition.

## How to delete a report you saved

1. {button:Delete|ghost|trash} shows only on a saved report you made yourself.
2. Click it. The report goes at once. Nothing asks you to confirm and nothing brings it back.
3. You see `Report deleted` and land back on the list of reports.
4. There is no {button:Delete|ghost|trash} on a colleague's shared report, even for an owner. Ask the person who made it.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing matches yet.` | A grouped report found nothing to count. An ungrouped report never shows this, because it always draws its one `Not set` row. |
| `Showing the first 200. A report is a summary — narrow it to see fewer.` | The rows list hit its cap. The total on the card still counts everything. |
| `Report saved` | The report is kept, and you are now looking at it. |
| `Report deleted` | The report is gone, and you are back on the list. |
| `You already have a report with that name.` | You have saved a report under that name before. Pick another. |
| `Only the person who made a report can change it.` | You tried to delete a report that is not yours. The wording says change, and deleting is what was refused. |
| `Invalid input` | The name is longer than 80 characters. Shorten it. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. You can read every report and save none. |
| `Something went wrong. Please try again.` | Something unexpected. Try once more, and tell us if it keeps happening. |

A report link that no longer works, or one typed by hand, shows the page-not-found screen rather than a different report. Go back to [Reports](reports.md) and pick one.

## Not on this page

There is no filter on a report, in spite of what the reports list promises under `Start from scratch`. You cannot add a condition, and there is no date range, so a report always covers everything you are allowed to see. Only the reports that came with CRM carry a condition, and {button:Save as new|ghost|save} is the one way to keep it. Nothing exports a report. There is no download, no spreadsheet, no print button, and nothing sends a report by email or on a schedule. Printing the page from your browser is the only way onto paper, and the row of CRM tabs is left out when you do. The chart is horizontal bars and cannot be changed to anything else. Clicking a bar or a group name does nothing. You get one grouping level, never two. Your own fields cannot be grouped on. A saved report cannot be renamed, shared later, un-shared or edited: save a new one and delete the old. The list of reports is in [Reports](reports.md), and the saved views on your records list are a different thing, in [Filters and saved views](views.md).

## Who can do what

Owners and staff get the same page and the same controls. Both can save a report, and both can delete one they made themselves. A report answers from the records you are allowed to see, so your total can differ from a colleague's on the same shared report and both numbers are right. A record only owners can see is still counted by a `Records` report for everybody, with its stage, source and assignee in `Not set` for staff. Its deals, notes and stage moves are missing from a staff member's report altogether, and so are follow-ups on an owners-only Work list. The outside accountant can read every report and change what it asks — the question lives in the address of the page, so running one is a read. Keeping the question is not: {button:Save|outline} is not drawn for them.
