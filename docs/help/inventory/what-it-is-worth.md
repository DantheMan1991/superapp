# What it is worth

> The cost standing in stock on a chosen day, batch by batch, with what the figure leaves out shown beside it.
> **Route:** /dashboard/m/inventory/value
> **Order:** 50

Open **Inventory** and click `What it is worth`. The heading reads `The cost standing in stock on hand. Not what it would sell for — what it cost to have.`

Nothing on this page changes anything. It is a report.

## What you see

- **`As of`.** A date box with {button:Value it|outline} beside it. It starts on today and will not go past it.
- **`On hand at 2026-09-03`.** The total cost standing in stock that day, with how many lines of stock it covers underneath.
- **`What this figure leaves out`.** How many batches nobody ever costed. `Nothing` is the good answer. It turns red when there are any.
- **`Batch by batch`.** `What`, `Batch`, `On hand`, `How it was valued` and `Worth`.
- **`Batch`** shows a dash for stock held outside any batch.
- **`Worth`** reads `Not known` for a batch nobody costed. That is not zero.

**Never quote the total without the second card.** Understated by an unknown amount is a different fact from understated by nothing, and only the two together tell you which you have.

## How a batch is valued

The badge in `How it was valued` says which of three ways was used.

- **{badge:This batch|secondary}.** What went into this batch and has not left it. This is the usual one, and it is always preferred, because a batch that knows its own cost should not be averaged away.
- **{badge:Average|secondary}.** Stock held outside any batch, valued at the {{item|lower}}'s average of what came in with a price.
- **{badge:No cost recorded|destructive}.** Nobody ever costed it, so it counts for nothing in the total. Stock you raised yourself has no purchase price, so this is ordinary rather than a mistake.

## How to value stock on a different day

1. Type a date into `As of`, or pick one.
2. Press Enter, or click {button:Value it|outline}.
3. Both cards and the whole table recompute for that day.

The date is in the address, so you can send somebody the link and the back button walks through the dates you looked at.

If you use the back button and the date box looks out of step with the figures, retype the date. We are fixing that.

## Messages

| Message | What it means |
| --- | --- |
| `Nothing on hand` | Nothing is in stock on that day. |
| `Receive some stock and what it cost will stand here.` | The same, with what to do about it. |
| `Every batch on hand carries a cost, so the stock total is the whole of it.` | The total is complete. Quote it. |
| `One batch has no cost recorded — 40 in all.` | The total is short by whatever that batch is worth, which nobody has said. |
| `Not known` | That batch was never costed. |
| `Nothing on hand that anybody has costed.` | There is stock, and none of it has a price against it. |

## Not on this page

- Nothing here is what stock would sell for. Every figure is what it cost.
- There is no export and no print layout.
- There is no total row in the table. The two cards are the only totals.
- Nothing groups by place, kind or line of business.
- A batch that has gone below zero shows a negative amount with no explanation.
- The count of what is left out is a count of batches, and the quantity beside it adds up different units into one number. Read it as a rough size, not a figure.
- If you need any of this, ask us.

## Who can do what

Everyone sees this page and everything on it, including staff and your accountant. There is nothing here to change.
