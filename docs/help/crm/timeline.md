# The timeline

> The history on one record: what was said, and what still has to happen. Write up a call, raise a follow-up, and tick it off without leaving the record.
> **Route:** /dashboard/m/crm/records/*
> **Order:** 50
> **Area:** Records

Open a record from [Your records](records.md) and scroll to `Timeline`. Under the heading you read `What was said, and what still has to happen.` Three buttons sit to its right. Click {button:Log|outline|plus} to write up a call or a note. The rest of the record page is in [One record](record.md).

## What you see

- **{button:From a note|outline|sparkles}.** Paste what happened and it proposes what to log and what to chase. Nothing is saved until you look at it and press {button:Save|primary}.
- **{button:Log|outline|plus}.** Writes up one note, call or meeting, at a date you pick.
- **{button:Follow-up|outline|plus}.** Raises something that still has to happen on this record.
- **The list.** Newest first, one row each. There is no paging and nothing to click for more, so what the list holds is all on the page.
- **A row's icon.** A speech bubble for a note, a phone for a call, {icon:user-round} for a meeting. An open follow-up gets a calendar with a tick, and a completed one gets a tick in a circle.
- **The title line.** On a logged entry it is your `Summary`. With no summary it is the first line of `What happened`. With neither it reads `Note`, `Call` or `Meeting`. On a follow-up it is what you typed under `What needs doing`.
- **The second line.** Only when there is more to show. It is the first line of the entry's `What happened`, or of the follow-up's `Notes`. Past 140 characters it is cut and ends `…`.
- **The date.** Written `2026-09-03`. An open follow-up adds ` · due` and a completed one adds ` · done`. A logged entry has no suffix.
- **Where a row sits.** A logged entry sits at the date you gave it. An open follow-up sits at its due date. A completed one sits at the moment you ticked it, so the list reads as history.
- **A completed follow-up reads gray** instead of bold, so a finished job does not look like another thing to do.
- **The date is read in UTC.** A day you pick in `When` is stored at midday UTC, so the row always shows the day you chose. An entry saved from a pasted note is stamped at the moment you saved it, so late in the evening in a western time zone it can show tomorrow's date.
- **An open follow-up with no due date is not on this list at all.** It still exists. Find it on [Follow-ups](tasks.md). Nothing here counts them for you.
- **The row controls.** A logged entry gets {button:Delete this entry|ghost|trash}. A follow-up gets its own three, described below.
- **`Nothing logged yet.`** stands in for the list when the record has no history.
- **The oldest entries drop off at 200.** The list holds the 200 most recent logged entries per record, and nothing on screen says so. Follow-ups are not capped.

## How to log what happened

1. Click {button:Log|outline|plus}. `Log what happened` opens and reads `A note, a call or a meeting. It lands on the timeline at the date you give it.`
2. Pick a `Kind`. The choices are `Note`, `Call` and `Meeting`, and it starts on `Note`. There is no email choice, because mail is filed against the record from the Mail module instead.
3. Set `When`. It starts on today by your own computer's clock. Change it to any day, past or future. Nothing checks the range, so write up Friday's visit on Monday and it lands on Friday.
4. Type a `Summary (optional)`, up to 200 characters. The placeholder reads `One line, if it helps`.
5. Type into `What happened`, up to 10,000 characters. This is the body of the note and it is kept exactly as you type it.
6. Click {button:Log it|primary}. You see `Logged`.
7. The dialog closes and every field goes back to how it started. The entry appears at the date you chose, which may put it partway down the list rather than at the top.

One of the two text boxes has to have something in it. Leave both blank and you see `Write something first`.

## How to remove a logged entry

1. Click {button:Delete this entry|ghost|trash} at the right of the row.
2. There is no confirmation and no undo. One click removes it. You see `Deleted`.

A logged entry is one of the few things in the CRM you can delete outright. It holds somebody's own words about another person, and the person who wrote it may well want it gone. You cannot edit one from any screen, so fix a wrong word by deleting the entry and logging it again.

## How to raise a follow-up

1. Click {button:Follow-up|outline|plus}. `Add a follow-up` opens and reads `A date is optional. Without one it sits under “someday” rather than going overdue.`
2. Fill in `What needs doing`, up to 200 characters. The placeholder reads `Send the revised figures`. Leave it blank and you see `Give it a name`.
3. Pick `Who is doing it`. It starts on you, shown as your name then ` (you)`. Everyone else is listed by name, or by email when they have not set a name. `Nobody yet` is last. The outside accountant is never offered, because the CRM treats them as read-only.
4. Set `By when (optional)`. Leave it empty and the follow-up has no date and never goes overdue.
5. Type `Notes (optional)`, up to 4,000 characters. Its first line shows under the title on the row.
6. Click {button:Add it|primary}. You see `Follow-up added`, the dialog closes and the fields reset.

The follow-up now lives in three places. It shows on this timeline, but only once it has a due date. It shows on [Follow-ups](tasks.md). It shows in the Work tool as an ordinary piece of work. If it carries your name and a date inside the next seven days, it also reaches your daily reminder email and your Today page.

## How to work a follow-up here

1. Click {button:Done|ghost|check} on the row. You see `Done`. The row turns gray, gets ` · done` and moves to the moment you ticked it.
2. Click {button:Reopen|ghost|rotate-ccw} on a finished one. You see `Reopened`. It goes back to its due date, or off the list entirely when it has no date.
3. Click the button with the person's name on it to hand the work over. `Nobody yet` is first in the menu, then everyone else. You see `Given to` and the person's name, or `Unassigned`. The button reads `Nobody yet` when nobody has it, and `Someone` when the person has since left the business.
4. Click the button showing the date, or {icon:calendar-days} `No date`, to change when it is due. Pick a day and it saves as you pick it. You see `Date set`, or `Date cleared` when you empty the field. Click away without picking and nothing changes.

A finished follow-up shows only {button:Reopen|ghost|rotate-ccw}. You cannot rename it, change its notes or delete it here.

## How to turn a written note into entries

1. Click {button:From a note|outline|sparkles}. `Record a note` opens and reads `Paste what happened. You'll see what it found and can change anything before it saves.`
2. Paste into `The note`. Until you type, it shows an example note. The counter under the box reads `0 / 8,000` and counts up. The box stops accepting text at 8,000 characters and cuts a longer paste.
3. Click {button:Read the note|primary}. Its label turns to `Reading…` while it works. Only the words you pasted are sent. The record's name, its contact details and everything else on this timeline are not.
4. Read `What happened`. Each card carries {badge:Note|secondary}, {badge:Call|secondary} or {badge:Meeting|secondary} and the summary it wrote. Click {button:Drop this activity|ghost|x} to throw one away. You cannot change the kind or the wording, so drop what is wrong.
5. Read `Follow-ups`. Each card gives you the title in a box you can retype, a date box, and a name picker with `Nobody yet` at the bottom. Click {button:Drop this follow-up|ghost|x} to throw one away.
6. Sort out any amber line, such as `The note said “Dave” — pick who that is, or leave it unassigned.` It means the note named somebody it could not place. Pick the right person or leave the follow-up unassigned.
7. Click {button:Save|primary}. You see `Saved 2 activities and 1 follow-up`, or `Saved 1 activity` when there is only one thing. The dialog closes and the record refreshes.

At most ten entries and ten follow-ups come back from one note. Everything saved is stamped with the time you pressed {button:Save|primary}, never the date the note talks about, so back-date it by logging it by hand instead. Each saved entry also shows its sentence twice, once as the title and once cut short underneath.

{button:Start over|ghost} clears the proposal and the note you pasted, so keep your own copy if you want a second reading. Closing the dialog does the same with no warning. Leave fifteen seconds between readings. That wait is shared by everyone in the business, and a reading that fails still spends it.

When it finds nothing you get a dashed panel reading `Nothing to record from that note.` and the same words as a message. That is different from a failure, and it is worded so you can tell them apart.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing logged yet.` | This record has no history. Click {button:Log|outline|plus} or {button:Follow-up|outline|plus} to start it. |
| `Logged` | Your entry was saved, at the date you gave it. |
| `Deleted` | The entry is gone for good. |
| `Follow-up added` | It is on the timeline if you dated it, and on [Follow-ups](tasks.md) either way. |
| `Write something first` | Both text boxes in `Log what happened` were blank. Fill in one. |
| `Write something before saving.` | The same thing, caught on the way out. |
| `Give it a name` | `What needs doing` was blank. |
| `Give the follow-up a name.` | The same thing, caught on the way out. |
| `Invalid input` | Something was too long or the date was malformed. Shorten the text and check the date. |
| `That entry could not be found.` | Somebody deleted it while your page was open. Reload. |
| `That record could not be found.` | The record was removed, or you no longer have access. |
| `Just a moment — try that again in a few seconds.` | Somebody in the business read a note in the last fifteen seconds. Wait and click {button:Read the note|primary} again. |
| `Couldn't read that note. Try rewording it, or add the details yourself.` | Nothing usable came back. Reword the note, or click {button:Log|outline|plus} and type it in. |
| `Nothing to record from that note.` | The note held no interaction and promised nothing. |
| `Something went wrong. Please try again.` | The connection dropped, or something else failed. Nothing was saved. Try again in a moment. |
| `Done` / `Reopened` | The follow-up was ticked off, or put back. |
| `Given to` and a name / `Unassigned` | The follow-up changed hands. |
| `Date set` / `Date cleared` | The due date moved, or was taken off. |
| `Somebody else changed this. Refresh and try again.` | A colleague changed that follow-up first. Reload and look before you repeat yourself. |
| `That work no longer exists.` | The follow-up is gone, or you can no longer see it. Reload. |
| `That person cannot be given work here.` | That person cannot hold work. Pick somebody from the menu. |
| `You cannot change that one.` / `That change is not allowed.` | The change was refused. Reload and tell us if it happens again. |
| `Something went wrong with that.` | Ticking a follow-up off, handing it over or moving its date failed for some other reason. Reload and try again. |
| `Accountant access to this module is read-only.` | You are signed in as the outside accountant. |

## Not on this page

You cannot edit a logged entry anywhere in the product, so correct one by deleting it and logging it again. You cannot rename a follow-up or change its notes from the CRM at all. Do those in the Work tool. Nothing anywhere in the product deletes a follow-up, so tick one you raised by mistake as done, or ask us. A deal has no timeline of its own, and nothing here files an entry or a follow-up against a deal, so everything you log lands on the record. Mail filed against a record does not appear on this list either. Ticking a follow-up here does not set off the `A follow-up is completed` rule on [Rules that run by themselves](automations.md), which is worth knowing before you build one. The rest of the record page is in [One record](record.md), and the whole list of what is outstanding is in [Follow-ups](tasks.md).

## Who can do what

Owners and staff get exactly the same buttons here and can do all of it. The difference is one step earlier, at the record. A record set to restricted is closed to staff who are not named on it, and they see `Nothing to show here` in place of the whole timeline, buttons included. What you log inherits that, so a blunt note about a customer cannot outlive the restriction. A follow-up does not. Its title is readable by every colleague in the Work tool and on [Follow-ups](tasks.md), and it reaches the daily email of whoever it is given to, whether or not they can open the record. The outside accountant can read the whole timeline. Logging, deleting, raising a follow-up and reading a note all answer `Accountant access to this module is read-only.` Ticking a follow-up off, handing it over and changing its date are not stopped for them.
