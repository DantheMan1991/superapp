# A day of selling

> The till, the truck, the cash tin and what sold. This is the page you work from while you are standing at the stall.
> **Route:** /dashboard/m/retail/days/*
> **Order:** 30

Open **Retail**, open a place, and click a date. The heading reads `{{marketDay}} · 2026-09-03`, with the place under it. The link at the top takes you back.

Everything on this page is open to everyone. Nothing here is owners only.

## What you see

- **{button:Load the truck|outline}.** Moves stock onto the truck. It only appears once you have a truck.
- **{button:Bring it back|outline}.** Moves what did not sell back off. Greyed while the truck is empty.
- **{button:Close the day|outline}.** Records what it cost and how it went. It reads {button:Edit the day|outline} once you have filled anything in.
- **`Took`.** What came in, with how many sales and how much of it was cash.
- **`Margin`.** `Took` less what it cost to stand there. It turns red and carries a real minus sign when the day lost money.
- **`The tin`.** `Balanced`, or `+$4.00` over, or `−$4.00` short. A dash means nobody counted.
- **The till.** `On the truck` on the left, `This sale` on the right.
- **`Ran out of`.** Where you note something selling out before closing time.
- **`Sales`.** Every sale, newest first, with a {button:Void|ghost} on each.

Times on this page are in your business's own timezone, on a 24-hour clock.

## The till

`On the truck` shows a tile for each thing loaded, with how much is left and what it costs. A tile priced by the pound shows `/lb` after the money. A tile with no price here reads `no price`, is greyed, and cannot be tapped.

Tap a tile to add one to the sale. Tap it again to add another.

A line in `This sale` takes one of two shapes.

- **Sold as a thing.** A quantity box, then a price box. **The price is editable**, because a market haggles. What you type is what gets stamped on the sale.
- **Sold by the pound.** A quantity box for packages, a weight box for pounds, then the money it comes to. Type the weight and the money works itself out. You can type over the money too, and changing the weight afterwards clears what you typed.

A weighed line with no weight yet reads `weigh it` and is left out of the total. Under the total you see `Not counting ground beef — still on the scale.` and {button:Take payment|primary} stays greyed until you weigh it.

To take a line out, set its quantity to zero. Careful: backspacing over the quantity to retype it makes the line vanish, because an empty box counts as zero.

## How to sell something

1. Tap the tile. It joins `This sale`.
2. Set the quantity. For something sold by the pound, put the weight on the scale into the weight box.
3. Change the price if you have agreed a different one.
4. Pick `Paid by`: `Cash`, `Card` or `Something else`.
5. Click {button:Take payment|primary}. You see the money taken, the basket clears, and the truck count drops straight away.

{button:Clear|ghost} empties the basket without asking.

If the sale fails to go through you see the reason followed by ` — the sale is still here, try again.` Nothing is lost. Press it again. If it actually went through the first time you see `Already rung up` and it is not charged twice.

## How to load and unload the truck

1. Click {button:Load the truck|outline}. The dialog reads `A transfer, not a guess — the app knows exactly what left, and the till sells from the truck's own stock.`
2. Pick `What` and a `Batch`, then how much. As you type, a line underneath tells you roughly what it weighs, if anything has ever been weighed.
3. Click {button:Add another|outline|plus} for each further thing.
4. Set `When` and, if you like, `From`. The help reads `The day and the place are for the whole load. Leaving the place blank still records the move; only one end of it is placed.`
5. Click {button:Load|primary}. You see how many things went on.

Loading is a real stock move, so the thing's own page in Inventory agrees. The whole load goes on together or not at all.

{button:Bring it back|outline} works the same way and **opens already filled in** with everything still on the truck, at its full remaining amount. Change what you need and leave the rest. It only offers what is actually on the truck.

The load dialog offers everything you hold, not only what you sell here, so check each line before loading.

## How to note that something ran out

Under `Ran out of` there is a chip for each thing on the truck. Tap {button:Ran out|ghost} and the time is recorded. You see `Noted — ran out of Ground beef`.

The panel explains why it matters: `Selling everything you brought looks like a perfect day and is a lost sale. Nothing else in the system can tell selling out at closing time from running dry at eleven.`

**Two things to know.** A chip disappears the moment you sell the last one, so note it just before you sell out rather than after. And a tap cannot be undone from any screen, so tap carefully.

## How to close the day

1. Click {button:Close the day|outline}.
2. Fill in `Float out`, `Counted in`, `Stall fee`, `Getting there`, `Crew`, `Hours stood there`, `Weather` and `Notes`. Every one is optional.
3. Click {button:Close the day|primary}. You see `Day closed`.

Only cash is checked against the tin. The help says so: `counting card takings as a shortfall is the fastest way to teach somebody to ignore the number.` Leave the count blank if nobody counted.

Hours sit beside the money, never inside it. `If your own time counts as nothing, every market looks worth going to.`

You can reopen this dialog any time to change what you put in. **Clearing a box erases what was stored**, and nothing on the dialog warns you.

## How to void a sale

1. Click {button:Void|ghost} on the row.
2. You are asked to confirm: `The takings drop by this sale. The stock stays off the truck, because it went over the table — put it back with an inventory adjustment if it did not.`
3. Click {button:Void the sale|destructive}. You see `Voided — the stock that went out is still off the truck`.

There is no partial refund and no negative sale.

## Messages

| Message | What it means |
| --- | --- |
| `$29.60 taken` | The sale is rung up and the stock is off the truck. |
| `Already rung up` | The same sale reached us twice. You are not charged twice. |
| `Voided — the stock that went out is still off the truck` | The takings drop. Put the stock back with a stock correction if it never left. |
| `Noted — ran out of Ground beef` | The time it went is recorded. |
| `Day closed` | What the day cost and how it went is saved. |
| `3 things on the truck` | The load went on, all of it. |
| `Ground beef has no price here. Set one first.` | Nothing can be rung up without a price at this place. |
| `Weigh ground beef first — it is priced by the pound.` | A weighed line needs its weight before you can take payment. |
| `No truck to sell from` | No asset is marked as somewhere stock is kept. Add one under Assets. |
| `Nothing loaded.` | The truck is empty. Load it. |
| `Add at least one thing to put on the truck.` | Every line in the load dialog was blank. |
| `a sale with nothing in it is not a sale` | The basket was empty. |
| `Something went wrong saving that.` | Something unexpected. Try again, and tell us if it keeps happening. |

## Not on this page

- There is no receipt, no customer and no change calculator.
- A sale cannot be partly refunded or edited. Void it and ring it again.
- Voiding does not put the stock back, on purpose. Use a stock correction if it never left.
- Noting `Ran out` cannot be undone, and the chip is gone once you sell the last one.
- If your business keeps stock in more than one place, this page picks one for you and does not say which. Tell us if you sell from more than one truck.
- The `Paid by` column shows `cash`, `card` or `other`, which does not match the words on the picker.
- If you need any of this, ask us.

## Who can do what

Everything on this page is open to every member, including your accountant: loading, unloading, selling, voiding, noting that something ran out, and closing the day.

The one thing you cannot do here is fix a missing price. `Set one` takes you to the place's own page, where only an owner can set prices. If you are staff at a stall with an unpriced thing, you are stuck until an owner sets it, and the screen does not tell you that.
