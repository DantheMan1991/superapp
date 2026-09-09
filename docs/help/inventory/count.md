# One count

> Writing down what is on each shelf, one after another, then posting the whole walk at once so every disagreement becomes a correction.
> **Route:** /dashboard/m/inventory/counts/*
> **Order:** 40

Open **Inventory**, click `Counting`, then click a count. The heading reads `Counted 2026-09-09`, and under it the place, who counted, and the date it was posted once it has been. On a phone each shelf is a card. On a wide screen the shelves are rows in a table.

While it is open you see {badge:Being counted|primary}. Once posted, {badge:Posted|outline}.

## What you see

- **{badge:Being counted|primary}** or **{badge:Posted|outline}.** Which state the count is in.
- **{button:Count something|outline}.** Adds one shelf to the count, and stays open for the next one. Only while it is being counted.
- **{button:Post|primary}.** Turns every disagreement into a correction, all at once. Only while it is being counted, and grayed until you have counted at least one thing.
- **{button:Count again|outline}.** Only on a posted count. Starts a new count at the same place, because a posted count cannot be changed and the fix for one that went wrong is the same walk again.
- **`Notes`.** Whatever was typed when the count was started, shown under the tabs so whoever walks the shelves sees it. Only there when something was typed.
- **The shelves.** On a phone, one card per shelf: the name, the batch, the line's own note, what was counted, and {button:Remove|ghost}. On a wide screen the same as a table: `What`, `Batch`, `Counted`, `Record said`, `Difference`, and {button:Remove|ghost} at the end of each row. Click a name to open the {{item|lower}}.
- **`Batch`.** The batch counted, or `All of it` when the count was against everything of that {{item|lower}}.
- **`Record said`** and **`Difference`** show a dash until you post. That is deliberate. A number on the screen is the fastest way to make a count agree with a record that is wrong.
- **`Difference`** reads `Agreed` when the two matched, or `+3 pounds` and `−3 pounds`. Only shortfalls are in red.

While it is open, under the shelves: `Nothing has changed yet. Posting turns every disagreement into an adjustment at once — and lines that agree write nothing, because there is no event in "nothing happened".`

## How to write down a shelf

1. Click {button:Count something|outline}. The dialog is headed `What is actually there`.
2. Click `What` and type part of the name. The list narrows as you type, with the kind beside each name. Pick the one you counted. Only things you have not retired are listed.
3. Pick a `Batch` if you are counting one. The help reads `A batch is counted against that batch. Without one, the count is against everything of this item there is.` The box is only there when the {{item|lower}} has open batches.
4. Type the amount into `How much is there`. The label names the unit. The help reads `Zero is a real answer — a shelf you walked and found empty.`
5. Add `Notes` if something needs saying. Up to 2,000 characters.
6. Click {button:Save and count another|primary}, or press Enter. You see `Counted · Grower crumble · 795 pounds`, the shelf appears behind the dialog, and the dialog clears for the next shelf with `What` ready to type into.
7. On the last shelf, click {button:Save|outline} instead. It writes the shelf and closes.

If the {{item|lower}} and batch you picked are already on this count, the help under the amount changes to `Already on this count as 795 pounds. Saving replaces that figure.` and the `Notes` box fills in with that line's note. Saving replaces the earlier figure rather than adding a second line, and whatever is in `Notes` is what is kept.

## How to remove a shelf

1. Click {button:Remove|ghost} on the shelf.
2. You are asked `Take Grower crumble off this count?` The line comes off the walk, and nothing in the record changes until the count is posted.
3. Click {button:Remove|primary}. You see `Removed`.

## How to post the count

1. Click {button:Post|primary}. The dialog reads `Every line that disagrees with the record becomes an adjustment, all at once. Lines that agree write nothing — there is no event in "nothing happened".`
2. Set `Posted`. It begins on today, and it cannot be earlier than the day you counted. The help names that day: `On or after the day it was counted, 2026-09-09. The corrections are dated this day.`
3. Read the note: `Once posted the lines cannot be changed. Nothing is overwritten — a count never edits an old entry, it writes new ones.`
4. Click {button:Post and reconcile|primary}.
5. You see `Posted · 3 put right, 9 already agreed`, or `Posted · all 12 agreed with the record` when nothing needed changing.

What changes on the screen: the badge flips to {badge:Posted|outline}, {button:Count something|outline} and {button:Post|primary} give way to {button:Count again|outline}, every {button:Remove|ghost} disappears, and `Record said` and `Difference` fill in for every shelf.

Each disagreement becomes a correction against that {{item|lower}}, reasoned `Found by counting`, dated the day you posted. Lines that agreed write nothing at all.

Counting less than the record said releases the cost with it, at the average paid. Counting more carries no cost, because nobody paid for stock that turned up.

## How to count the same place again

1. On a posted count, click {button:Count again|outline}.
2. The `Count stock` dialog opens with `Where` already set to this count's place. Set `When`, type `Who`, add `Notes`, and click {button:Start counting|primary}.
3. You see `Count started` and the new count opens, empty.

## Messages

| Message | What it means |
| --- | --- |
| `Counted · Grower crumble · 795 pounds` | The shelf is written down. |
| `Already on this count as 795 pounds. Saving replaces that figure.` | You picked a shelf that is already on this count. Save to replace it, or pick another. |
| `Removed` | The shelf is off the count. |
| `Posted · 3 put right, 9 already agreed` | The count is reconciled and the corrections are in. |
| `Nothing counted yet` | No shelves written down yet. |
| `Pick what you counted.` | You saved without choosing a `What`. |
| `Type how much is there. Zero is a real answer.` | The amount box was empty. |
| `Nothing you hold is called that.` | Nothing matches what you typed in `What`. Check the spelling, or add the {{item|lower}} under `Items` first. |
| `post it on or after the day it was counted — this one was walked on 2026-09-09` | The `Posted` date is before the day of the count. Pick that day or later. |
| `this count is posted — its variances are already in the ledger` | The count is closed. Click {button:Count again|outline}. |
| `Check the details and try again.` | The date is not a real date, or the amount has more than four decimal places. |
| `Something went wrong saving that.` | Something unexpected. Try again, and tell us if it keeps happening. |

## Not on this page

- A posted count cannot be reopened, corrected or deleted. {button:Count again|outline} is the remedy.
- A count's date, place, who counted and notes cannot be changed after it is started.
- Nothing here shows what the record thinks before you post, and that is on purpose.
- There is no scanner. Type the name.
- If you need any of this, ask us.

## Who can do what

Anyone can add a shelf, remove one, post the count and start another, including staff and your accountant. Posting writes to your accounts, and it is not restricted.
