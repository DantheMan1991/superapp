# What it is worth

> The cost standing in stock on a chosen day, batch by batch, with what the figure leaves out shown beside it.
> **Route:** /dashboard/m/inventory/value
> **Order:** 50

Open **Inventory** and click `What it is worth`. The heading reads `The cost standing in stock on hand. Not what it would sell for — what it cost to have.`

Nothing on this page changes anything. It is a report.

## What you see

- **`As of`.** A date box with {button:Value it|outline} beside it. It starts on today and will not go past it.
- **{button:Export|outline}.** Downloads what you are looking at as a spreadsheet file. See below.
- **Three rows of filters.** Kind along the top, then {{enterprise|lower}}, then `Place`. `All` is a pill of its own on each row, so you can always see whether you are narrowed. They are the same three the {{item|lower}} list uses, and the address remembers them.
- **`On hand at 2026-09-03`.** The total cost standing in stock that day, with how many lines of stock it covers underneath. With a place picked it reads `At Market truck on 2026-09-03` instead, and the line under it ends `, narrowed`.
- **`What this figure leaves out`.** How many batches nobody ever costed. `Nothing` is the good answer. It turns red when there are any.
- **`Batch by batch`.** `What`, `Batch`, `On hand`, `How it was valued` and `Worth`.
- **`Batch`** shows a dash for stock held outside any batch.
- **`Worth`** reads `Not known` for a batch nobody costed. That is not zero.
- **A minus sign** in front of a figure means the batch has gone below zero: more has left it than ever went in. The total counts it as it falls, so a minus is a disagreement worth opening the {{item|lower}} for.

**Never quote the total without the second card.** Understated by an unknown amount is a different fact from understated by nothing, and only the two together tell you which you have.

## How a batch is valued

The badge in `How it was valued` says which way was used.

- **{badge:This batch|secondary}.** What went into this batch and has not left it. This is the usual one, and it is always preferred, because a batch that knows its own cost should not be averaged away.
- **{badge:Average|secondary}.** Stock held outside any batch, valued at the {{item|lower}}'s average of what came in with a price.
- **{badge:This much of the batch|secondary}.** Only when you have picked a place. See below.
- **{badge:Cannot be split|destructive}.** Also only with a place picked. See below.
- **{badge:No cost recorded|destructive}.** Nobody ever costed it, so it counts for nothing in the total. Stock you raised yourself has no purchase price, so this is ordinary rather than a mistake.

## How to see what is in one place

1. Click a place along the `Place` row. The list narrows to what is there and the address remembers it.
2. The top card renames itself to `At Market truck on 2026-09-09`.
3. A line under the cards explains what the figures now mean.

**A batch has one cost, and nothing anywhere records what each place's share of it was.** So a batch's figure is split by how much of it is in the place you picked: a batch that cost $8.00 across three packages, two of them in the truck, shows $5.33 in the truck and $2.67 wherever the third one is. The two add back to the whole.

Where that cannot be done honestly the line reads {badge:Cannot be split|destructive} and `Not known`, and it counts in the second card as something the total leaves out. That happens when the batch nets to zero across the whole business while a place still holds some of it — nine in the truck and nine short somewhere else, say. There is no share of nothing to take, so the page says so instead of inventing one.

`No place` is a real answer, not a gap: it is the stock whose entries never said where it was.

## How to narrow by kind or {{enterprise|lower}}

Click a pill on either of the first two rows. They stack with the place, so `Feed` and `Market truck` together answer *what feed is on the truck worth*.

A batch's {{enterprise|lower}} beats the {{item|lower}}'s, which is how the cost is charged too. So a bag of feed tagged Broilers, in a batch tagged Pigs, is counted under Pigs.

At the bottom, `Showing Market truck, Feed.` names what is in force with a `Show everything` link beside it.

## How to export it

1. Narrow the page to what you want, or leave it whole.
2. Click {button:Export|outline}. You see `Downloaded`.
3. The file is named for the day and the filters, like `stock-value_2026-09-09_market-truck_feed.csv`.

**What is missing is the first line of the file**, before anything a spreadsheet would add up: `INCOMPLETE — 11 batches have no cost recorded, 51 in all, and the total below does NOT include them.` The `As of` date and every filter follow it. A file that lands in an accountant's inbox has to carry its own caveat, because the screen it came from will not be there.

A line that could not be valued has an **empty** `Worth` cell, never `0.00`. A spreadsheet adds up a zero and skips a blank.

## How to value stock on a different day

1. Type a date into `As of`, or pick one.
2. Press Enter, or click {button:Value it|outline}.
3. Both cards and the whole table recompute for that day.

The date is in the address, so you can send somebody the link and the back button walks through the dates you looked at. The date box follows, so what it shows is always the day the figures are for.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing on hand` | Nothing is in stock on that day. |
| `Receive some stock and what it cost will stand here.` | The same, with what to do about it. |
| `Every batch on hand carries a cost, so the stock total is the whole of it.` | The total is complete. Quote it. |
| `One batch has no cost recorded — 40 in all.` | The total is short by whatever that batch is worth, which nobody has said. |
| `Not known` | That batch was never costed. |
| `Nothing on hand that anybody has costed.` | There is stock, and none of it has a price against it. |
| `Nothing here matches what you have narrowed it to. Widen the filters above.` | The filters are on and nothing is left. |
| `Downloaded` | The file is on your machine. |
| `Across 2 lines of stock, narrowed.` | The total is of what you filtered to, not of the whole business. |

## Not on this page

- Nothing here is what stock would sell for. Every figure is what it cost.
- There is no print layout.
- There is no total row in the table. The two cards are the only totals.
- The page shows one place at a time. There is no view listing every place side by side.
- The filter pills carry no counts, unlike the {{item|lower}} list's.
- Nothing here explains why a batch went below zero. The page shows the minus and no more; open the {{item|lower}} and read its entries.
- The count of what is left out is a count of batches, and the quantity beside it adds up different units into one number. Read it as a rough size, not a figure.
- If you need any of this, ask us.

## Who can do what

Everyone sees this page and everything on it, including staff and your accountant. There is nothing here to change.
