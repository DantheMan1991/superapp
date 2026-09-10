# One {{engagement|lower}}

> Its terms, how this month is going, every hour logged against it, and the months before.
> **Route:** /dashboard/m/professional-services/*
> **Order:** 20

Click an {{engagement|lower}}'s name in the list to open it. Everything about one agreement is here. To record work you have done, click {button:Log time|primary}.

## What you see

- **{{engagement|plural}}.** Top left, with a {icon:chevron-left}. Takes you back to the list.
- **The heading.** The {{engagement|lower}}'s name, and under it the {{client|lower}}, the kind and the dates, as `Hollis & Co · Retainer · from 2026-07-01`. An end date is added when there is one.
- **The status badge.** `Active`, `Proposed`, `Paused` or `Ended`.
- **{button:Log time|primary}.** Opens the dialog that records work. Everyone sees it. It is grayed out on an ended {{engagement|lower}}.
- **{button:Edit terms|outline}.** Opens the same dialog you agreed the {{engagement|lower}} in, filled in. Owners only. The {{client|lower}} is not in it, because that cannot change.
- **`This month`.** Hours logged this calendar month, large. Under it, `6.5 h left of 10.0 h`, or `over 10.0 h by 1.5 h` once you go past, or `no hours included — everything logged is extra` when the {{engagement|lower}} has no hours a month.
- **`Worth`.** The fee, large. Under it, `$120.00 an hour beyond the retainer`, or `no rate set`.
- **`Extra this month`.** What the overage comes to at the rate. On an {{engagement|lower}} with no hours included the heading changes to `Logged at the rate` and the figure is everything logged. Under it, `nothing is invoiced automatically` — this is a figure to bill from, not a bill.
- **`Move it along:`** and the buttons beside it. Owners only. Which buttons appear depends on where the {{engagement|lower}} is: see below.
- **`Scope`.** What you agreed to do, shown as you typed it. Only appears when there is one.
- **`Time`.** Every entry, newest day first: `Day`, `What`, `Who` and `How long`. Each row has {button:Edit|ghost} at the end when you are allowed to change it.
- **`Month by month`.** Only appears once there is more than one month. Each row is `Month`, `Included`, `Logged`, `Over` and `At the rate`.

## How to log time

1. Click {button:Log time|primary}. The dialog reads `What you did and how long it took. This is what the month is measured against.`
2. Type `How long`. The box takes any of these: `1:30`, `1.5`, `1.5h`, `90m`, `90 minutes`. A plain number under 16 is read as hours, so `2` is two hours; a plain number of 16 or more is read as minutes, so `45` is forty-five minutes.
3. Set the `Day`. It defaults to today. Back-date it for work you are writing up later.
4. Type `What you did`, such as `Month-end close`. Up to 1,000 characters. It is worth filling in, because it is what your {{client|lower}} would recognize if you ever showed them the log.
5. Click {button:Log time|primary}. You see `Time logged`, the dialog closes, and the figures at the top move.

Time can be logged against a `Proposed` or `Paused` {{engagement|lower}} as well as an active one. Only an ended one refuses it.

## How to correct or remove an entry

1. Find the row in `Time` and click {button:Edit|ghost}. The dialog says who logged it.
2. Change `How long`, the `Day` or `What you did`.
3. Click {button:Save|primary}. You see `Entry saved`.
4. To remove it instead, click {button:Delete|destructive}. You see `Entry deleted`. There is no confirmation step and no undo, so check the row first.

Anyone can correct anyone's entry. Nothing is locked once a month has passed, so a figure you have already billed from can still change — worth knowing if you bill from this.

## How to move an {{engagement|lower}} along

The buttons beside `Move it along:` are only the moves this {{engagement|lower}} can make.

| Where it is | Buttons | What happens |
| --- | --- | --- |
| `Proposed` | {button:Start|primary} {button:End|outline} | Starting makes it live. |
| `Active` | {button:Pause|primary} {button:End|outline} | Pausing puts it on hold; time can still be logged. |
| `Paused` | {button:Resume|primary} {button:End|outline} | Resuming makes it live again. |
| `Ended` | {button:Reopen|primary} | Reopening makes it live and clears the end date. |

Ending stamps today as the end date, unless you already set one. It also stops the {{engagement|lower}} being offered when you tag something in your accounts — what is already tagged keeps reporting. Reopening puts it back. Nothing asks you to confirm, because every one of these can be undone.

## How to change the terms

1. Click {button:Edit terms|outline}.
2. Change any of `Name`, `Kind`, `Starts`, `Ends`, `Hours a month`, `Fee`, `Rate an hour`, `Scope` or `Notes`.
3. Click {button:Save terms|primary}. You see `Terms saved`.

Changing `Hours a month` takes effect **from this month onward**. Every earlier month keeps the hours that were agreed then, which is why an old month in `Month by month` does not move when you raise a retainer. Renaming the {{engagement|lower}} also renames it wherever your accounts group by it.

## Messages

| Message | What it means |
| --- | --- |
| `Time logged` | The entry is in, and the figures at the top have moved. |
| `Entry saved` / `Entry deleted` | Your correction went through. |
| `Terms saved` | The new terms are in. A changed retainer applies from this month. |
| `Started` / `Paused` / `Resumed` / `Reopened` / `Ended` | The status moved. |
| `How long? Try 1:30, 1.5 or 90m.` | The duration box was empty or in a shape it could not read. |
| `Log between 1 minute and 24 hours.` | One entry cannot be longer than a day. Split it across the days you actually worked. |
| `That {{engagement|lower}} has ended. Reopen it to log time against it.` | Reopen it first, or log the time against the right one. |
| `Somebody changed this while you had it open. Reload and try again.` | Two people edited at once. Nothing was overwritten. Reload and make your change again. |
| `That is not something this {{engagement|lower}} can do next.` | The status changed in another tab. Reload to see where it is. |
| `Only an owner can change an {{engagement|lower}}.` | You are signed in as staff. Ask an owner. |
| `Nothing logged yet` | No time against this one. Click {button:Log time|primary}. |
| `Something went wrong saving that.` | Something unexpected. Try again, and tell us if it keeps happening. |

## Not on this page

- Nothing is invoiced from here. `Extra this month` is a figure to bill from; you raise the invoice in Accounting.
- There is no timer to start and stop.
- You cannot change who the work is for.
- You cannot attach files or notes to a single entry beyond the one line.
- Entries cannot be filtered by person or by month, and there is no way to export them.
- Time already billed is not locked, and nothing marks an entry as billed.
- If you need any of this, ask us.

## Who can do what

Changing terms and moving the {{engagement|lower}} along belong to the owner.

Logging time, correcting an entry and deleting one are open to everyone, an accountant included. The person who did the work is the person who knows how long it took, and a slip is fixed by whoever made it.

Everyone can see the whole page, the fee and the rate included.
