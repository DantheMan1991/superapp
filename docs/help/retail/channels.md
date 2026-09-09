# Where you sell

> Every place the business sells, and the last twenty days of selling with what each took and cost.
> **Route:** /dashboard/m/retail
> **Order:** 10

Open **Retail** in the sidebar. The heading reads `Where the business sells, what it charges there, and what a {{marketDay|lower}} costs to stand at.` To add a place, click {button:Add a channel|primary}. To bring in a price list, click {button:Paste a list|outline|sparkles}.

## What you see

- **{button:Add a channel|primary}.** Opens the dialog that adds somewhere to sell. Owners only.
- **{button:Paste a list|outline|sparkles}.** Reads a pasted price list, or a photo of one, and proposes a row per price for you to check before anything is set. Owners only. See how to paste a price list, below.
- **{button:Start a market day|outline}.** Opens the stall so you can sell. Anyone can. It is greyed until you have somewhere to sell.
- **The {{channel}} table.** `{{channel}}`, `Kind`, `Where`, `Priced` and `State`. Click a name to open it.
- **`Priced`.** How many things have a price at that place today. A price you have set for a future date is not counted yet.
- **`State`.** {badge:Selling|primary} or {badge:Closed|outline}.
- **`Recent market days`.** The last twenty days of selling, newest first. This whole section is missing until you have had one.

## The days table

`When`, `Where`, `Took`, `Cost`, `Margin`, `Person-hours`, `Cost an hour` and `Weather`.

- **`Took`** is what came in that day. A dash means nothing was taken.
- **`Cost`** is the stall fee plus getting there. A dash means neither was recorded. A recorded zero shows as `$0.00`, which is a different answer.
- **`Margin`** is `Took` less `Cost`.
- **`Person-hours`** is your crew times the hours you stood there.

Under the table: `Margin is what a day took less what it cost to stand there. The hours stay in their own column rather than inside it: own time counted as nothing makes every market look worth going to. What the goods cost to produce is not in this either — that lives on the stock, and joining the two is a report nobody has built yet.`

**Two figures on this table are wrong today and we are fixing them.** `Took` and `Margin` undercount any day where you sold something by weight. Open the day itself for the right number. And a day that lost money shows its `Margin` without a minus sign, so a loss of fifty reads like fifty earned. The day's own page gets both right.

## How to add somewhere to sell

1. Click {button:Add a channel|primary}. The dialog reads `Somewhere the business sells. Prices live per channel, because the same pound is one price at a stall and another at the gate — and neither of them is the price.`
2. Type a `Name`, up to 200 characters. Something you would say out loud, such as `Saturday market` or `Farm store`.
3. Pick a `Kind`. To use a word of your own, pick `Something else…` and type it.
4. Fill in `Where` if it helps. The help reads `As you would say it. This is not a place the business owns.`
5. Add `Notes` if you want.
6. Click {button:Add|primary}. You see `Channel added` and the new place opens.

## How to start a day of selling

1. Click {button:Start a market day|outline}. The dialog reads `Opens the stall so you can sell. What it cost and how it went are filled in at the end, when you know them.`
2. Pick `Where`.
3. Set `When`. It begins on today.
4. Type the `Stall fee` if you paid it upfront. The help reads `If you paid it upfront. Otherwise leave it and add it at the end.`
5. Type the `Float in the tin`, the change you are taking with you.
6. Click {button:Start selling|primary}. The day opens straight away.

Everything else about the day is filled in at the end, when you know it.

## How to paste a price list

1. Have somewhere to sell and something to sell first. With no place, the dialog reads `Add somewhere to sell first.`; with nothing under Inventory, `Add what you sell first, under Inventory.` Either way it stops there.
2. Click {button:Paste a list|outline|sparkles}. `Paste a list of prices` opens and reads `Paste a list, columns from a spreadsheet, or add a photo of one. You'll see every row it found and can change anything before it saves.`
3. Paste into `The list`, or click `Or a photo of it` and choose a photo of the chalkboard, the sheet in the freezer lid, or a PDF, up to 4 MB. Only what you paste or attach is sent, together with the names of what you hold and where you sell, and nothing else about your business.
4. Click {button:Read it|primary}. Its label turns to `Reading…` while it works. The line under the title then reads `9 prices found. Untick what you don't want, fix what's wrong, then add them.`
5. Check the rows. Each has `Item`, a pick list of what you hold, which must be chosen; `Where`, a pick list of your places to sell, which may be left blank when you have only one; `Price`, in dollars, which must be filled; `Per`, `Each` or `Per pound`; `From`, the day the price starts, blank for today; and `Notes`. A line that names something you do not hold leaves `Item` empty with an amber line reading `The list said “Goat milk soap” for item — pick one, or leave it blank.`; add it under Inventory and read the list again, or untick the row. Nothing on a price list is ever marked as already here, because a new price for something already priced is exactly what a price list is.
6. Click {button:Add 9 prices|primary}. It reads `Adding…`, then you see `Added 9 prices`, the dialog closes and the page refreshes. Each price is a new row from its `From` day, and setting the same day twice replaces that day's row. Nothing is saved until you click it. If any ticked row is refused, nothing is saved at all, and the message names the row.

`Per pound` is refused for something you count in pounds, in the same words the price form uses, because the quantity is already the weight. {button:Start over|ghost} clears the rows and the list you pasted; closing the dialog does the same. Leave ten seconds between readings. At most 200 rows come back from one reading.

## Messages

| Message | What it means |
| --- | --- |
| `Add somewhere to sell first.` and `Add what you sell first, under Inventory.` | You clicked {button:Paste a list|outline|sparkles} before there was a place to sell, or anything to price. |
| `Nothing to add from that.` | The reading found no prices in what you pasted or attached. |
| `Row 3: Item is missing.` | The third ticked row names nothing you hold. Pick the item, or untick the row. |
| `Row 3: …` | The third row was refused for the reason given after the colon, such as `Per pound` on something counted in pounds. Nothing was added. Fix the row and add again. |
| `Give it a few seconds, then try again.` | Two readings inside ten seconds. |
| `That file is too large. 4 MB at most.` and `A photo (JPEG, PNG, WebP or GIF) or a PDF.` | The photo is too big, or not a kind it can read. |
| `Channel added` | The place exists and its page is open. |
| `Nowhere to sell yet` | Nothing has been added. An owner adds the first one. |
| `Add somewhere to sell first.` | You tried to start a day with no place to sell at. |
| `Only an owner can change channels or prices.` | You are signed in as staff. Ask an owner. |
| `Check the details and try again.` | Something in the dialog is not right, usually the date. |
| `Something went wrong saving that.` | Something unexpected. Try again, and tell us if it keeps happening. |

## Not on this page

- The list cannot be searched, sorted or filtered.
- Only the last twenty days are shown, and there is no way to see further back from here. A {{channel|lower}}'s own page lists all of its days.
- Nothing compares one thing's price across two places.
- `Took` and `Margin` here are wrong for weighed sales and hide a minus sign. Use the day's own page.
- If you need any of this, ask us.

## Who can do what

Only an owner can add somewhere to sell. Anyone can start a day of selling, and everyone sees both tables and every figure on them.
