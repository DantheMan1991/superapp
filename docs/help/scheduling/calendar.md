# The calendar

> Day, week or month, with everything on the calendars you can see, and the dialog where an event is made.
> **Route:** /dashboard/m/scheduling
> **Order:** 10

Open **Scheduling** in the sidebar. The heading reads `Jobs, appointments and time off, on the calendars you can see.`

## What you see

- **{button:Today|outline}.** Jumps to today, keeping whichever view you are in.
- **{icon:chevron-left} and {icon:chevron-right}.** Step back and forward. A day at a time in day view, a week in week view, and to the first of the next month in month view.
- **The dates you are looking at**, between them, such as `August 30, 2026 – September 5, 2026`.
- **`day`, `week`, `month`.** The view switcher. `week` is where you start.
- **{button:Calendars|outline|calendar-days}.** The page where you decide who can see what. This is the only way in.
- **{button:New event|primary|plus}.** Greyed out when you have no calendar you can write to.

If you can look but not add, a note reads `You can look at these calendars but not add to them. Anything you own appears under Calendars.`

**An event's colour is its calendar's colour.** You cannot give one event a colour of its own. Change it on the [Calendars](calendars.md) page.

**An event you are only allowed to see as busy reads `Busy`** with no title. That is honest rather than broken: the title never reached your browser.

## Week and day view

- A row across the top for anything all day. It is always there, even when empty.
- Below it, midnight to midnight, an hour to a line. Hours read `9am`, `12pm`, `5pm`. **Midnight has no label.**
- Today is marked only by its date turning bold and coloured. There is no tint and no line showing the current time.
- The whole twenty-four hours is laid out, so you scroll the page to reach the evening.
- **Two events at the same time sit side by side**, each half width. They never overlap or hide each other.
- An event shorter than about forty minutes shows its title and no time, because there is no room.
- **An event running across several days is drawn in each day separately**, not as one bar.
- Rest the pointer on an event to see its full title.

Week view always starts on Sunday. That cannot be changed.

## Month view

- Whole weeks, so the grid can be four, five or six rows, and days either side of the month are shown.
- **The date at the top of a cell is a button.** Click it to make an event on that day.
- Each event is a coloured dot and its title. **No times at all**, and all-day and timed events sit in the same list.
- **A day shows three events at most**, then `+2 more`. That text is not clickable, and there is no way to expand the day. Switch to week or day view to see the rest.

## How to make an event

1. Click {button:New event|primary|plus}, or a date in month view.
2. Type a `Title`. Nothing saves without one.
3. Pick the `Calendar`. Only calendars you can write to are listed.
4. Turn on `All day` if it has no times, which hides the time boxes.
5. Pick `Repeats` if it comes round: `Every day`, `Every weekday`, `Every week`, `Every 2 weeks`, `Every month` or `Every year`. Anything more particular than those is not offered.
6. Set `Starts` and `Ends`. Moving the start past the end pushes the end along for you.
7. Fill in `Location` and `Notes` if you want them.
8. Set `Show as` to `Busy`, `Free`, `Tentative` or `Away`.
9. Turn on `Private` to keep the details to yourself and the people on it, however widely the calendar is shared.
10. Add `People`. See below.
11. Click {button:Save|primary}. You see `Event created`.

**Every time is in your workspace's timezone**, which the dialog names at the top. Somebody in another state editing your calendar is typing your times, not theirs.

## How to put people on an event

- Pick a colleague from `Add a colleague`. The list is everybody not already on it.
- Or type an address into `Or an email address` and click {button:Add|outline}.
- The {icon:x} beside a name takes them off.

Nothing happens until you press {button:Save|primary}. The help says it plainly: `Nobody is emailed yet — adding somebody puts the event on their calendar in Yosher.`

While you are picking times you may see `Already busy: Sarah, Dan`, or `Cannot see the calendar for Ali — they may or may not be free.` Neither stops you saving.

**Nobody can see who has accepted.** People can answer an invitation, and their answer is stored, but no screen shows it. Ask them.

## How to answer an invitation

Open an event somebody else put you on. A strip at the top reads `You are on this event.` with {button:Yes|primary}, {button:Maybe|outline} and {button:No|outline}. Click one and you see `Response sent`. The dialog stays open.

## How to link an event to a record

**Save the event first.** The `Related to` box only appears on an event that already exists, so after creating one you have to click it again on the grid.

1. Type into `Search a customer, invoice, file…`
2. Results appear grouped by what they are. You can link a customer, vendor, invoice, bill, contact, company, deal, file, folder or a work item.
3. Click one to attach it. There is no confirmation and no message.

A link to something that has since gone reads `invoice (no longer available)` rather than vanishing, so you can tell it was made.

Clicking a link leaves the calendar entirely.

## How to change or cancel an event

Click it on the grid. If you can edit it, change what you need and press {button:Save|primary}.

At the bottom sit the cancel buttons. On a repeating event **the narrow one comes first on purpose**:

- {button:Cancel just this one|ghost|trash} takes off the one occurrence you clicked. You see `That one is off`.
- {button:Cancel the series|ghost|trash} takes off all of them.

On a one-off event the second reads {button:Cancel event|ghost|trash}.

**Neither asks you to confirm.** One click and it is gone, and nobody who was on it is told.

There is no way to move a single occurrence of a repeating event to a different time. Cancel that one and make a new event.

## Messages

| Message | What it means |
| --- | --- |
| `Event created` / `Event updated` | It is saved and on the grid. |
| `Event cancelled` | The whole event, or the whole series, is off. |
| `That one is off` | Just the occurrence you clicked. |
| `Response sent` | Your answer is recorded. Nobody is shown it. |
| `Busy` | You may see that this time is taken and not what it is. |
| `Already busy: Sarah` | Somebody you added has something else then. It does not stop you. |
| `an event cannot end before it starts` | Check the dates and times. |
| `you can look at this calendar but not change it` | You have been given viewing access, not editing. |
| `Invalid input` | Something is missing or malformed. Most often no calendar is chosen. |
| `accountant access is read-only` | Accountants cannot change anything here. |
| `Something went wrong.` | Something unexpected. Tell us if it keeps happening. |

## Not on this page

- Nothing can be dragged. You cannot drag to create, move or resize an event.
- You cannot click an empty slot to make an event at that time. New events start at the date you are looking at, at 9am.
- There is no empty state. A week with nothing on it is simply an empty grid.
- There is no line showing the current time.
- `Show as`, the location and whether an event repeats are **never shown on the grid**. A `Free` event looks exactly like a busy one.
- If you can only view an event, the `Calendar` box reads `Choose a calendar` instead of naming it. That is us, not you.
- In month view the date button opens the dialog even when you have nowhere to save it. You get `Invalid input` on save.
- If you need any of this, ask us.

## Who can do what

What you can do depends on the calendar, not on your job title. Your own calendars you can always edit. Somebody else's you can do whatever they granted.

Business calendars are editable by owners.

Accountants see this page fully, with an enabled {button:New event|primary|plus} and no warning, and every click fails with `accountant access is read-only`. Opening an event closes it again with the same message.
