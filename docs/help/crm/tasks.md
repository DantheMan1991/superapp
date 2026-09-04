# Follow-ups

> Everything still to be chased on your records, gathered in one list: what a row tells you, ticking one off, handing it to somebody else, and moving its date.
> **Route:** /dashboard/m/crm/tasks
> **Order:** 60
> **Area:** Follow-ups

Open **CRM** in the sidebar, then `Follow-ups` in the row of sections across the top. This page gathers every open follow-up that hangs off one of your records, so you can chase them without opening each record in turn. Tick one off with {button:Done|ghost|check}. You cannot write a new follow-up here, so raise it on the record itself, which is in [The timeline](timeline.md).

## What you see

- **The heading.** `Follow-ups`, and under it `What is still outstanding on your records.` There is no button beside it.
- **The row of sections.** `Records`, `Follow-ups` with {icon:checks}, `Board`, `Pipelines`, `Fields`, `Reports`, `Automations` and `Duplicates`. Click one to move around CRM. The section you are on has a colored line under it. On a narrow screen the row scrolls sideways, with an arrow at each end that still has something to show.
- **The open list.** One row for every follow-up that is not finished and has a record on it. Soonest due date first, and the ones with no date at the bottom. Two follow-ups due the same day can swap places between visits, because nothing decides which of them comes first.
- **Every one is listed.** There is no page size, no `Load more` and no page numbers, however many you have.
- **The words of the follow-up.** The first line of a row. It is what somebody typed when they raised it, and it is not a link.
- **`On this record`.** Small gray text under the words. Click it to open the record the follow-up hangs off. It always reads those three words and never names the customer, so a long list gives no clue which record each one belongs to.
- **{button:Done|ghost|check}.** At the right of the row. It finishes the follow-up.
- **Who it is for.** The next button carries their name. It reads their email address when they have not set a name, `Someone` when the person has left the business, and {button:Nobody yet|ghost|user-round} when nobody has it. Click it to hand the follow-up over.
- **When it is due.** The last button, showing the date as `2026-09-14`, or {button:No date|ghost|calendar-days} when there is none. Click it to change the date. A date that went by last month reads exactly like one due next year. Nothing on this page marks a follow-up late.
- **`Recently done`.** A second list under the first, and only when it has something in it. Each row shows the words in gray and a single {button:Reopen|ghost|rotate-ccw}. There is no record link, no name and no date on these rows. Ten rows at most, most recently finished first.
- **What `Recently done` leaves out.** Those ten are counted across everything your business finished, not only CRM, and the ones with no record on them are dropped afterwards. So this list can be short, or missing altogether, minutes after you ticked one off.
- **The line at the bottom.** It starts `These are follow-ups attached to a record.` and then sends you to the Work module for everything else. `Work` is a link when your business has that module switched on, and plain words when it does not.
- **`Nothing outstanding`.** The card that replaces the list when nothing is open. It reads `Follow-ups you raise on a record show up here. Add one from the record itself.` `Recently done` and the bottom line still show under it.

## How to tick a follow-up off

1. Find the row and click {button:Done|ghost|check}.
2. You see `Done`. The row leaves the open list and turns up under `Recently done`.
3. It stops appearing on your daily list and in the morning email. See [What needs you](../workspace/what-needs-you.md).
4. On the record it stays on the timeline, grayed out, at the moment you ticked it rather than at its due date. See [The timeline](timeline.md).
5. A rule you set up for `A follow-up is completed` does not run when you tick one off here. See [Rules that run by themselves](automations.md).

## How to reopen one

1. Under `Recently done`, click {button:Reopen|ghost|rotate-ccw}.
2. You see `Reopened`. It returns to the open list, with the date and the person it already had.
3. In the Work module it goes back to the start of the board.
4. A follow-up somebody canceled in Work sits under `Recently done` too, and reopening it works the same way.
5. Reopening one that has no due date brings it back to this page, but not to the record's timeline.

## How to hand a follow-up to somebody else

1. Click the button carrying the current name, or {button:Nobody yet|ghost|user-round} when nobody has it.
2. The menu lists `Nobody yet` first, then everyone in the business, ordered by their email address. Somebody who has not set a name is listed by email address.
3. Click a name. You see `Given to [name]`.
4. Click `Nobody yet` to take it off everybody. You see `Unassigned`.
5. It moves onto that person's daily list and into their morning email, as long as your business has the Work module switched on and the date is within the next seven days or already past. A follow-up with no date is never chased that way.
6. Two people changing this at the same moment do not clash. The last click wins, and nobody is told the other one happened.
7. The outside accountant is never in the menu, so no follow-up can be given to one.

## How to change when a follow-up is due

1. Click the date button, or {button:No date|ghost|calendar-days}.
2. It turns into a date box, ready to type in. Type a date or pick one from the calendar.
3. It saves the moment the date changes. You see `Date set`, and the row moves to its new place in the list.
4. Empty the box to take the date off. You see `Date cleared`. The follow-up drops to the bottom of the list, and nothing chases it again.
5. Click anywhere else without changing the date and the box closes with nothing saved.
6. Only an open follow-up has this button. A finished one shows {button:Reopen|ghost|rotate-ccw} and nothing else.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing outstanding` | No follow-up is open on any record. Raise one from a record, or check `Recently done` under it. |
| `Done` | The follow-up is finished. It has moved to `Recently done`. |
| `Reopened` | The follow-up is open again and back in the top list. |
| `Given to [name]` | That person now has it. |
| `Unassigned` | Nobody has it. It still shows on this page. |
| `Date set` | The new due date is saved. |
| `Date cleared` | The follow-up has no date now, and nothing will chase it. |
| `That work no longer exists.` | The follow-up is gone, or you can no longer see it. Reload the page. |
| `Somebody else changed this. Refresh and try again.` | Somebody ticked or re-dated the same follow-up first. Reload and look at it again. Handing it to somebody else never says this. |
| `That person cannot be given work here.` | The person you picked has left, or is the outside accountant. Pick somebody else. |
| `Could not update that.` | Ticking or reopening was refused before it started. Reload and try again. |
| `Could not reassign that.` | Handing it over was refused before it started. Reload and try again. |
| `Pick a date.` | The date box was not filled in properly. Type the date again. |
| `Something went wrong with that.` | Something failed that we did not expect. Try again, and tell us if it keeps happening. |

## Not on this page

Nothing here writes a new follow-up, and there is no button that would. Raise one on the record, in [The timeline](timeline.md). You cannot change the words of a follow-up, give it notes, or read the notes it already has. All three are in [Work](/dashboard/m/work). Nothing anywhere deletes a follow-up, so cancel one in Work if you raised it by mistake. There is no search, no filter, no sorting, no way to show only your own, and no grouping by week or by person. Nothing marks a late follow-up: no color, no badge, no count and no separate list of them. Nothing names the record on a row. Follow-ups with no record on them never appear here, wherever they were raised, and neither does anything from the rest of Work. Ask us if you need any of it.

## Who can do what

Owners and staff get the same page and can do everything on it. The outside accountant can open it and read every follow-up, when it is due and who it is on, with a line under the tabs saying that is all. The row's own controls are no longer drawn for them, so CRM is read-only for the accountant everywhere, with no exception. A follow-up raised on a record with `Restrict this record` turned on is still listed here for everyone, words and all, and its `On this record` link then opens a page that shows staff nothing. The page is not there at all when CRM is switched off for your business.
