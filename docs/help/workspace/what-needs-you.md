# What needs you

> One list of everything waiting on you today, drawn live from the tools you use, and the switch that emails it to you each morning.
> **Route:** /dashboard/today
> **Order:** 10

## What the page shows

The line under the title reads `Outstanding work as of [today's date], in [your business's time zone].` The date is the business's today, not your phone's, so it is the same for everyone on the team.

Each row is one thing that needs doing. On the left is its title and, underneath, a detail line. On the right is a badge:

- **Overdue.** Its date has passed.
- **Today.** It is due today.
- **Soon.** It is due on a later date.
- **Open.** It needs you but has no date.

Rows are ordered overdue first, then today, then soon, and within each by date. Click a row and it opens the record itself, not a list.

There is nothing to tick off, dismiss or snooze here. Every row is worked out fresh each time the page loads. When you do the thing, or change its date, the row disappears on its own.

## Your items, and items nobody has picked up

The list at the top is yours: things assigned to you, and things that are yours because of your role.

Owners also see a second list, **Not assigned to anyone**, under a rule. Its caption reads `Nobody has picked these up. You see them because you own the business, not because they are yours.` Only owners see this list.

## Where the rows come from

Four tools feed this page. Each tool only contributes if it is switched on for your business.

**Scheduling.** Invitations you have not answered, for events in the next 30 days. The row reads `[event title] — you have not replied`, with the time and place underneath. Also today's events, on calendars you own or are invited to, with the event title as the row.

**Work.** Work items assigned to you that are due within seven days or overdue. Owners also see unassigned work. The row is the item's title. The detail line combines its state, its due date and its list, for example `Blocked · 3 days overdue · Site prep`. Due dates read `Due today`, `Due tomorrow`, `3 days overdue` or `Due 2026-09-14`. Blocked items are listed on purpose, so a late item cannot be hidden by marking it blocked. Undated work is never listed.

**Production.** Bookings with a processor in the next 21 days, or in the past with nothing recorded against them. Upcoming rows read `[processor] is booked in 18 days` or `is booked tomorrow`. A missed one reads `[processor] was booked 3 days ago and nothing has been recorded`, with the note `Start the batch, or cancel the date if it did not go ahead`. A booking that is only pencilled in says `Pencilled in, not confirmed`. These rows go to everyone in the business.

**Accounting.** Owners only. Three kinds of row:

- `Invoice 1042 is 3 days overdue`, with the amount underneath.
- `Bill 88 is waiting for approval`, with the amount underneath. It reads **Today** while the bill is not yet due and **Overdue** once it is.
- `Recurring journal "Rent" could not run today`, or `could not run, 2 days behind`, with the reason underneath. Fix the cause, pause the template, or move its next run date past today, and the row clears.

Staff and accountants never see accounting rows, because an invoice or a bill is not assigned to a person.

Mail is not on this page. Unread mail shows as the count on the Mail row in the sidebar.

## When the list is empty

If every tool answered and nothing is waiting, the page says **Nothing needs you today.** and `No follow-ups due and nothing waiting on you.`

If a tool could not be reached, a warning box appears at the top: **This list may be incomplete.** and, for example, `Accounting and Work could not be checked just now, so anything from those sections is missing. Reload in a moment.` An empty list in that case reads **Nothing to show from the sections we could check.** so that silence and a failed check never look the same.

## The morning email

At the right of the title is a switch labelled **Email me this each morning**. It is on for everyone to begin with.

The switch is yours alone. An owner cannot turn a staff member's email off, and nobody can turn on yours. Flick it and you see `Daily email on` or `Daily email off`.

When it is on, Yosher sends you this list at 7am in your business's time zone, once a day. The subject line says how many things need you, for example `3 things need you (2 new)`, or `Nothing needs you today` when the list is empty. The email opens with your first name, then one line comparing today with the last email you got, such as `2 new since last time, 3 still waiting.` Each row shows its title and detail with a link to the record, and new rows are marked **NEW**. If a tool could not be checked, the email says so in the same way the page does.

If a morning's email fails to send, it is not retried that day. The link at the foot of every email, **Turn these emails off**, brings you back to this page and this switch.
