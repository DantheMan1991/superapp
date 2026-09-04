# One asset

> Everything about a single thing you own: its details, what is kept inside it, how it is being written down, what needs doing to it, and its photos.
> **Route:** /dashboard/m/assets/*
> **Order:** 20

Open **Assets** and click a name in the list. This page is where nearly all the work happens. {button:All assets|ghost|chevron-left} at the top takes you back.

## What you see

The heading is the asset's name. Under it sits its kind, then the company whose books it is on if your business keeps more than one set. Once it has been disposed of, {badge:disposed 2026-08-14|outline} sits beside the name.

- **{button:Edit|outline}.** Opens the dialog that changes anything about the asset. Owners only. It stays available after disposal.
- **{button:Dispose|outline}.** Takes the asset off the books. Owners only, and it disappears once the asset is disposed of.
- **`Details`.** `Model`, `Serial or tag`, `Acquired`, `Cost`, and `Kept in`. A dash means nothing was recorded. `Kept in` is a link to whatever this sits inside. `Notes` only appears when you have written some.
- **`Contains`.** What is kept inside this one, with a count beside the heading. Each is a link. Something disposed of still shows here, marked {badge:disposed|outline}. When nothing is inside you see `Nothing is kept in this one.`
- **`Depreciation`.** How the cost is being written down. See below.
- **`Maintenance`.** What comes round again, and what has been raised as a job. See below.
- **`Photos`.** Pictures of this asset over time. This panel only appears when Documents is switched on.

## The Depreciation panel

Under the heading you see `Straight-line, posted a month at a time.` once it is set up, or `Not depreciated.` before that.

- **{button:Set up|outline}.** Opens the schedule dialog. Once a schedule exists the button reads {button:Edit schedule|outline}. Owners only.
- **Before it is set up** you see `Land and anything held for resale are never written down. Everything else usually is.` and no figures.
- **`In service`.** The day it started being used.
- **`Life`.** How long it is being written down over, as `5 years (60 months)`.
- **`Posted to date`.** How much has actually reached your accounts, with `12 of 60 months` underneath. This is read from your accounts, not worked out again, so editing the schedule later does not change it.
- **`Book value`.** The cost less what has been written down.
- **{badge:fully depreciated|outline}.** Every month in the schedule has been posted.

Owners also see one of two things at the bottom. Either `Up to date through 2026-09.`, or {button:Post 3 months|primary} with the amount due beside it. If some months fall before your closing date, a line reads `2 months fall before your closing date and will be combined into one catch-up entry dated 2026-09.`

Staff and accountants see all the figures but none of this, so they cannot tell from here whether anything is outstanding.

## How to set up depreciation

1. Click {button:Set up|outline}. The dialog is headed `Depreciation schedule`, and tells you the cost it is working from.
2. Pick a `Method`. `Straight line` writes the cost down evenly. `Not depreciated (land, held for resale)` turns it off.
3. Fill in `Placed in service`. The help reads `When it started being used — not necessarily when it was bought.`
4. Fill in `Useful life (years)`. Half years are allowed, so `7.5` works.
5. Fill in `Salvage value` if the thing will still be worth something at the end. Leave it blank for nothing.
6. Click {button:Save|primary}. You see `Schedule saved`, or `Depreciation turned off` if you chose not to depreciate it.

The asset must have a cost before a schedule will save. If it has none, the dialog says so at the top, and saving fails with a message that does not explain why. Add the cost under {button:Edit|outline} first.

## How to post depreciation for this asset

1. Click {button:Post 3 months|primary}. The number is how many months are owed, counting back to the day it went into service.
2. You see `Posted 3 months of depreciation`.
3. `Posted to date` and `Book value` both move, and the button disappears until next month.

Each month becomes its own entry in your accounts, dated the last day of that month. Months that fall before your closing date are combined into a single catch-up entry instead, so the number of entries can be smaller than the number of months.

If nothing was actually owed you see `Nothing was due`.

## The Maintenance panel

Under the heading you see `What needs doing, and when it was last done.`

- **{button:Add schedule|outline}.** Opens the dialog that adds something that comes round. Owners only.
- **Each schedule** shows its name and where it stands: `Due in 30 days`, `Due today`, `Overdue by 12 days`, `Due now`, `Due in 50 hours`, or `No baseline yet`. Anything due is in red.
- **{badge:raised|outline}.** A job for this schedule is already open, so it will not be raised again.
- **{button:Mark done today|ghost}.** Records that the work was done today and starts the clock again. Anyone can, including an accountant. Whoever did the work records it.
- **{button:Raise 2 due jobs|primary}.** Turns everything due into jobs on your Work list. Owners only, and only when something is due that has not been raised.
- **`Current hours`.** A box for the meter reading, with {button:Record|outline} beside it. When a reading already exists the label reads `Current hours (was 1200)`. Anyone can, including an accountant.
- **`Raised from this asset`.** The open jobs, each named `Oil change — Kubota L3901`. Everyone can work these.

Something that has never been done reads `No baseline yet` rather than showing as overdue. A meter schedule with no reading at all stays there until you record one.

## How to add a service schedule

1. Click {button:Add schedule|outline}. The dialog reads `A calendar schedule comes round on a date. A meter one comes round on hours run, so a machine that sat all winter does not fall due.`
2. Type `What needs doing`, such as `Oil change`. Up to 200 characters.
3. Pick `Comes round by`. `Time` counts months. `Hours or miles` counts a meter.
4. For `Time`, set `Every (months)`. It starts at `12`.
5. For `Hours or miles`, set `Every` and a `Unit`. They start at `100` and `hours`.
6. Click {button:Add|primary}. You see `Schedule added`.

The reading box on the panel always says `Current hours`, whatever unit you chose here, and every reading you record is stored as hours. If you count miles, tell us, because this box will not do it.

## How to record work that was done

1. Find the schedule and click {button:Mark done today|ghost}. You see `Recorded`, and the schedule's due date moves on.
2. To record a meter reading on its own, type it into `Current hours` and click {button:Record|outline}. You see `Reading recorded`. Whole numbers only.

**Marking a raised job done is not the same thing.** {button:Done|ghost} on a job under `Raised from this asset` closes that job, but the schedule still reads overdue and will raise the same job again. Only {button:Mark done today|ghost} tells the schedule the work happened, so press that one too.

## How to turn due work into jobs

1. Click {button:Raise 2 due jobs|primary}.
2. You see `Raised`, and each one appears under `Raised from this asset` and on your Work list.
3. Give a job to somebody with the {icon:user-round} button, or set a date with the {icon:calendar-days} button. Anyone can do either.

Only schedules that count months get a due date on the job. A meter schedule raises a job with `No date`.

## How to add photos

1. Click {button:Add a photo|outline|camera}. Pick one or more files.
2. You see `Photo added`, or `3 photos added`.
3. The first one becomes the picture of this asset, and shows beside its name in the list. To choose a different one, rest on it and click the {icon:star} button. You see `Picture set`.
4. To take one off, rest on it and click the {icon:x} button. You see `Photo removed — the file is still in Documents`.

Photos must be JPEG, PNG, WEBP or GIF, up to 100MB each. Anything else is refused with `photos only, up to 100MB` after the file name.

## How to dispose of an asset

1. Click {button:Dispose|outline}. The dialog is headed `Dispose of Kubota L3901?` and tells you what will come off the balance sheet.
2. Check `Date of disposal`. It starts on today.
3. Type what you got for it into `Sold for`. It shows `0.00 if scrapped or given away`.
4. Pick `Money went into`, the account the money landed in. Leave it on `Nothing received` only if you got nothing. Entering an amount and leaving this alone is refused.
5. Click {button:Mark as disposed|primary}. You see `Disposed, and the books are settled`.

The cost and the depreciation come off, and the difference against book value is recorded as a gain or a loss.

Two things stop the books being settled, and the dialog says which. `This asset has no recorded cost, so there is nothing to take off the balance sheet.` means you never entered a cost. `This asset's cost is not linked to an account, so Yosher does not know what to remove.` means you need to set `Cost sits in` under {button:Edit|outline} first. In both cases the asset is still marked as disposed, and you see `Marked as disposed — nothing posted, see the note`.

**This cannot be undone.** There is no way to bring an asset back.

Once an asset is disposed of, do not trust `Posted to date` or `Book value` on this page. Both jump the moment the disposal posts, and we are fixing it. Your accounts are right. It is only these two figures on this screen that are not.

## How to change an asset

1. Click {button:Edit|outline}. The dialog reads `Changing the name also renames it wherever it is reported on.`
2. Change what you need. `Cost sits in` is the account the cost was booked to when you bought it. Its help reads `Where this asset's cost was booked when you bought it. Yosher does not post it again — it needs to know where it already sits so a disposal can take it back off.`
3. Click {button:Save|primary}. You see `Saved`.

Emptying the `Acquired` box does not clear the date. It keeps whatever it had, and nothing tells you. Ask us if you need a date removed.

`Kept in` shows nothing at all when the thing this sits inside has been disposed of, even though `Details` still names it. Pick again before saving, or you will move the asset out of it.

## Messages

| Message | What it means |
| --- | --- |
| `Saved` | Your changes are in. |
| `Schedule saved` | The depreciation schedule is set. |
| `Depreciation turned off` | The method was set to not depreciated. |
| `Posted 3 months of depreciation` | It reached your accounts. |
| `Nothing was due` | Everything was already posted up to this month. |
| `Schedule added` | The service schedule is on. |
| `Recorded` | The work is recorded and the schedule's clock has restarted. |
| `Reading recorded` | The meter reading is stored. |
| `Raised` | Due work is now on your Work list. |
| `Disposed, and the books are settled` | It is off the books and the accounts balance. |
| `Marked as disposed — nothing posted, see the note` | It is off the list, but nothing reached your accounts. Read the note in the dialog. |
| `Photo removed — the file is still in Documents` | It is off this asset. The file itself is untouched. |
| `Nothing is kept in this one.` | Nothing sits inside this asset. |
| `No schedules yet. Add one for anything that comes round — a service, an inspection, a filter.` | No maintenance is set up. |
| `No baseline yet` | The schedule has never been done, and has nothing to count from. |
| `Only an owner can change what the business owns.` | You are signed in as staff. Ask an owner. |
| `Accountant access is read-only — reviews, sign-offs and exports only.` | An accountant cannot change anything here. |
| `Enter a whole number.` | The meter reading had a decimal in it. |
| `Choose the account the sale proceeds went into.` | You entered an amount under `Sold for` but left `Money went into` on `Nothing received`. |
| `Set a method, in-service date, life and cost first.` | Depreciation was posted before the schedule was complete. |
| `Something went wrong saving that.` | Something unexpected. Most often a depreciation schedule on an asset with no cost. Tell us if it keeps happening. |

## Not on this page

- An asset cannot be deleted, and a disposal cannot be undone.
- You cannot move an asset to another company after it is added.
- You cannot clear the `Acquired` date once it is set.
- A meter schedule cannot count anything but hours, whatever unit you named.
- Nothing warns you that a schedule is due except this page. Raise it as a job to see it on your Work list.
- Depreciation is straight line only. There is no declining balance and no half-year convention.
- Nothing here values the asset at what it would sell for today.
- If you need any of this, ask us.

## Who can do what

Only an owner can edit an asset, dispose of one, set up or post depreciation, add a service schedule, or raise jobs.

Anyone can mark a service done and record a meter reading, an accountant included. Whoever changed the oil logs the oil change — a service recorded late, or not at all, is worse than one recorded by the wrong person.

Everyone sees every panel and every figure, including the depreciation.

Jobs under `Raised from this asset` are open to everyone. Any member can mark one done, give it to somebody, or set its date.

Photos can be added, chosen and removed by anyone except an accountant, who can only look. A photo is a file, and files belong to Documents, where an accountant reads and never writes.
