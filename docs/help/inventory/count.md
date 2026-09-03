# One count

> Writing down what is on each shelf, then posting the whole walk at once so every disagreement becomes a correction.
> **Route:** /dashboard/m/inventory/counts/*
> **Order:** 40

Open **Inventory**, click `Counting`, then click a date. The heading reads `Counted 2026-09-03`, and under it the place, who counted, and the date it was posted once it has been.

While it is open you see {badge:Being counted|primary}. Once posted, {badge:Posted|outline}.

## What you see

- **{button:Count something|outline}.** Adds one shelf to the count. Only while it is being counted.
- **{button:Post|primary}.** Turns every disagreement into a correction, all at once. Only while it is being counted, and greyed until you have counted at least one thing. Nothing on the screen says that is why.
- **The table.** `What`, `Batch`, `Counted`, `Record said`, `Difference`, and a {button:Remove|ghost} at the end of each row.
- **`Batch`.** The batch counted, or `All of it` when the count was against everything of that {{item|lower}}.
- **`Record said`** and **`Difference`** show a dash until you post. That is deliberate. A number on the screen is the fastest way to make a count agree with a record that is wrong.
- **`Difference`** reads `Agreed` when the two matched, or `+3 pounds` and `−3 pounds`. Only shortfalls are in red.

While it is open, under the table: `Nothing has changed yet. Posting turns every disagreement into an adjustment at once — and lines that agree write nothing, because there is no event in "nothing happened".`

## How to write down a shelf

1. Click {button:Count something|outline}. The dialog is headed `What is actually there`.
2. Pick the `What`. Only things you have not retired are listed.
3. Pick a `Batch` if you are counting one. The help reads `A batch is counted against that batch. Without one, the count is against everything of this item there is.`
4. Type the amount into `How much is there`. The label names the unit. The help reads `Zero is a real answer — a shelf you walked and found empty.`
5. Add `Notes` if something needs saying. Up to 2,000 characters.
6. Click {button:Save|primary}. You see `Counted` and the row appears at the bottom.

Counting the same thing and batch twice replaces the first number rather than adding a second row, and nothing tells you it did. If you count it again with the `Notes` box empty, the note you wrote the first time is wiped.

To take a row out, click {button:Remove|ghost}. It goes immediately, with no confirmation.

## How to post the count

1. Click {button:Post|primary}. The dialog reads `Every line that disagrees with the record becomes an adjustment, all at once. Lines that agree write nothing — there is no event in "nothing happened".`
2. Set `Posted`. It begins on today, and **it must not be earlier than the day you counted.** If it is, the save fails with a message that does not explain why.
3. Read the note: `Once posted the lines cannot be changed. Nothing is overwritten — a count never edits an old entry, it writes new ones.`
4. Click {button:Post and reconcile|primary}.
5. You see `Posted · 3 put right, 9 already agreed`, or `Posted · all 12 agreed with the record` when nothing needed changing.

What changes on the screen: the badge flips to {badge:Posted|outline}, the buttons and the whole `Remove` column disappear, and `Record said` and `Difference` fill in for every row.

Each disagreement becomes a correction against that {{item|lower}}, reasoned `Found by counting`, dated the day you posted. Lines that agreed write nothing at all.

Counting less than the record said releases the cost with it, at the average paid. Counting more carries no cost, because nobody paid for stock that turned up.

## Messages

| Message | What it means |
| --- | --- |
| `Counted` | The shelf is written down. |
| `Removed` | The row is gone. |
| `Posted · 3 put right, 9 already agreed` | The count is reconciled and the corrections are in. |
| `Nothing counted yet` | No shelves written down yet. |
| `Pick what you counted.` | You clicked save without choosing anything. |
| `this count is posted — its variances are already in the ledger` | The count is closed. Start another one. |
| `Check the details and try again.` | The date is not a real date, or the amount has more than four decimal places. |
| `Something went wrong saving that.` | Something unexpected. Most often a `Posted` date earlier than the day you counted. |

## Not on this page

- A posted count cannot be reopened, corrected or deleted. The honest remedy is to count again.
- A count's date, place, who counted and notes cannot be changed after it is started.
- Removing a row asks for no confirmation.
- Nothing here shows what the record thinks before you post, and that is on purpose.
- If you counted something you have since retired, its row loses the name and shows the amount in the wrong unit. Tell us if you see that.
- If you need any of this, ask us.

## Who can do what

Anyone can add a row, remove one, and post the count, including staff and your accountant. Posting writes to your accounts, and it is not restricted.
