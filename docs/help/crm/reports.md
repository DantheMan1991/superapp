# Reports

> The questions you can ask about your records, deals and follow-ups: the four reports that come with Yosher, the ones you and your colleagues have saved, and the five you can build yourself.
> **Route:** /dashboard/m/crm/reports
> **Order:** 120
> **Area:** Reports

Open **CRM** in the sidebar, then `Reports` in the row of sections across the top. This page lists every question you can ask, in three groups. Click any row to open that report and read its answer. What you can do once a report is open is in [Reading a report](report.md).

## What you see

- **The title and the line under it.** The title is `Reports`. Under it you read a line that names your business and ends `answered from the records you can see.` Take that last part literally. A report counts only the rows you are allowed to see.
- **The tabs.** `Records`, `Follow-ups`, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`. `Reports` is underlined while you are here.
- **The four reports at the top.** Always these four, always in this order. They are part of Yosher rather than something your business set up, so nobody can rename, hide or delete one. Each row shows the question, then a gray line saying what it counts, then {icon:chevron-right}.
- **`Where is everybody in the pipeline?`** Its line reads `Number of records by stage`. It counts every record you can see and groups them by what you typed in the record's own `Stage` box. It does not read the deal board. A record with an empty `Stage` counts under `Not set`, and so does every customer or vendor added in accounting that nobody has opened in CRM.
- **`How many records are we adding each month?`** Its line reads `Number of records by month added`. One row per month, oldest first, written as `2026-08` rather than as a month name.
- **`What is the open work worth, by stage?`** Its line reads `Total value by stage · Deal is open is true`. It adds up the amounts on open deals and groups them by the stage each deal sits in. A deal with no amount on it still counts toward the number of deals but adds nothing to the money.
- **`Who is carrying what?`** Its line reads `Number of records by assigned to · Completed is false`. It counts outstanding work and groups it by whoever it is assigned to. Two things to expect: the group names are sign-in codes rather than people's names, and the count is wider than you think. Read the note under `Not on this page` before you act on it.
- **`Saved`.** A heading and a panel, shown only once at least one saved report is visible to you. Rows are in alphabetical order by name. Each row shows the name and, underneath, the same gray line saying what that report counts.
- **{badge:shared|outline}.** A small lowercase badge at the right of a saved row. It marks a colleague's report that they chose to share. Your own reports never carry it, shared or not, so nothing on this page tells you which of yours are shared.
- **`Start from scratch`.** The bottom heading. Under it you read `Pick what you want to count. You can group and filter it once it opens.` The grouping half is true. The filtering half is not, and there is a note below.
- **`Records`.** `How are the people and companies we deal with distributed?` One row per record, counting everyone the business deals with.
- **`Records with deals`.** `Where is the work, and what is it worth?` One row per deal, so a record with three deals is counted three times. This is the only one that can total or average money.
- **`Deal stage history`.** `How does work actually move through the pipeline?` One row per move between stages, so one deal appears once for every move it has made.
- **`Records with activity`.** `Who have we actually spoken to, and who has gone quiet?` One row per note, call or meeting. Email is never counted here.
- **`Follow-ups`.** `What is outstanding, and who is carrying it?` One row per item in Work, whether or not it is attached to a record.
- **The page is never empty.** The four reports at the top are always there, so there is no empty state and no message when you have saved nothing yet.

## How to open a report

1. Click any row on this page. That report opens on its own page.
2. Nothing is stored or cached. The question is asked again the moment you open it, so what you read is the position right now.
3. Click `All reports` at the top left of the report to come back here.
4. Expect your total to differ from a colleague's total on the very same report. That is correct, not a fault. A report counts what you can see, and a restricted record's deals, notes and calls do not reach staff.
5. Expect a number to move for reasons outside CRM. A new customer added in accounting lifts the `Records` count, and a job raised anywhere in Work lifts the `Follow-ups` count.

## How to build a report of your own

1. Pick one of the five rows under `Start from scratch`.
2. The report opens with that row's question as its title, counting everything, with nothing grouped.
3. Use the `Group by` row along the top to split the answer up, and `Show the rows` to list what is behind it. All of that is in [Reading a report](report.md).
4. You cannot add a condition. Nothing in a report filters it, so build the question by picking the right row here.

## How to get a report onto this page

1. Open the report you want to keep, then save it there. The buttons and the dialog are in [Reading a report](report.md).
2. It appears under `Saved` here, in its alphabetical place.
3. A report you did not share is yours alone. Nobody else sees it on this page, not even an owner.
4. A shared report appears for everybody. Each person gets their own answer, counted from the records they can see, so sharing a report gives nothing away.
5. A name only has to be different from your own other report names. You and a colleague can each keep one called `My pipeline`.

## How to remove a saved report

1. Click the report under `Saved` to open it, then delete it there. The button is on the report, and only on one you saved yourself.
2. It goes on the first click. There is no confirmation and no undo.
3. You land back on this page and see `Report deleted`. The row is gone from `Saved`.
4. You cannot delete a colleague's shared report, even as an owner. Ask them to delete it.

## Messages

| Message | What it means |
| --- | --- |
| `Report deleted` | Your report is gone and you are back on this page. It cannot be brought back. Build it again and save it if you deleted the wrong one. |

## Not on this page

`Pick what you want to count. You can group and filter it once it opens.` promises more than you get. There is no filter box, no date range and no condition builder anywhere in Reports. Two of the four reports at the top carry a condition of their own, and opening one of those and saving it is the only way to end up with a report that has one.

`Who is carrying what?` is not the CRM [Follow-ups](tasks.md) page counted up. It counts every outstanding item in Work, including work that is about nothing in CRM at all. The Follow-ups page counts only what is attached to a record, so the two will not agree. An item attached to both a person and a company is counted twice here.

A saved report cannot be renamed, shared later or un-shared. Save a new one with the name and the sharing you want, then delete the old one.

The `Saved` list has no search, no folders, no count and no paging. Every report you can see is listed at once, which is comfortable at five and unwieldy at fifty.

Nothing here exports. There is no CSV, Excel or PDF, and no print view. There is no way to have a report emailed to you, and no way to run one on a schedule. A report is a page you open.

Money reports are not here. Profit, cash and what customers owe are in accounting, on [Reports](../accounting/reports.md).

The five things you can count are fixed, and you cannot add a sixth. Ask us if the question you need is not one of them.

## Who can do what

Owners and staff see the same list and can open every report on it. Both save their own reports and share them, and each of you can delete only the ones you saved yourself. Being an owner adds nothing here. The outside accountant can open this page and read any report on it. Saving and deleting are not offered to them.
